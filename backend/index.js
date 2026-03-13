
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { ethers } = require("ethers");
const { createClient } = require("@supabase/supabase-js");
const { contractRead, contractWrite } = require("./contract");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Supabase ──────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ─────────────────────────────────────────────────────────────
// PASSWORD HASHING — Node built-in crypto.scrypt, zero new deps
// Stored format: "scrypt:<salt_hex>:<hash_hex>"
// ─────────────────────────────────────────────────────────────

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, hash) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${hash.toString("hex")}`);
    });
  });
}

function verifyPassword(password, stored) {
  return new Promise((resolve, reject) => {
    // Plaintext fallback — handles accounts that haven't run migrate-passwords.js yet
    if (!stored || !stored.startsWith("scrypt:")) {
      return resolve(password === stored);
    }
    const parts = stored.split(":");
    if (parts.length !== 3) return resolve(false);
    const [, salt, hashHex] = parts;
    const expected = Buffer.from(hashHex, "hex");
    crypto.scrypt(password, salt, 64, (err, hash) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(hash, expected));
    });
  });
}

// ─────────────────────────────────────────────────────────────
// AUTH HELPERS
// ─────────────────────────────────────────────────────────────

const TOKEN_SECRET = process.env.TOKEN_SECRET || "wanzablock-token-secret";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createToken(email) {
  const payload = Buffer.from(
    JSON.stringify({ email, ts: Date.now(), exp: Date.now() + TOKEN_TTL_MS })
  ).toString("base64url");
  const sig = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  try {
    const dotIdx = token.lastIndexOf(".");
    if (dotIdx === -1) return null;
    const payload = token.slice(0, dotIdx);
    const sig     = token.slice(dotIdx + 1);
    const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(payload).digest("hex");
    if (sig !== expected) return null;
    const { email, exp } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!exp || Date.now() > exp) return null;
    return email || null;
  } catch {
    return null;
  }
}

async function requireMfr(req, res, next) {
  const auth  = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token provided" });

  const email = verifyToken(token);
  if (!email) return res.status(401).json({ error: "Invalid or expired token" });

  const { data: mfr } = await supabase
    .from("manufacturers")
    .select("email, company_name, company_type, is_active")
    .eq("email", email)
    .single();

  if (!mfr || !mfr.is_active)
    return res.status(401).json({ error: "Account not found or inactive" });

  req.manufacturerEmail = mfr.email;
  req.manufacturerName  = mfr.company_name;
  req.manufacturerType  = mfr.company_type;
  next();
}

// ─────────────────────────────────────────────────────────────
// GEO-LOCATION COUNTERFEIT DETECTION
// ─────────────────────────────────────────────────────────────

function distanceKm(lat1, lon1, lat2, lon2) {
  const R  = 6371;
  const dL = (lat2 - lat1) * Math.PI / 180;
  const dO = (lon2 - lon1) * Math.PI / 180;
  const a  = Math.sin(dL/2) * Math.sin(dL/2)
           + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180)
           * Math.sin(dO/2) * Math.sin(dO/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function saveAlert(itemId, type, severity, description, metadata) {
  const { error } = await supabase.from("alerts").insert({
    item_id: itemId, type, severity, description, metadata,
    resolved: false, detected_at: new Date().toISOString(),
  });
  if (error) console.warn("Alert save failed:", error.message);
}

async function runRealTimeDetection(itemId, lat, lng) {
  if (!itemId) return;
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentScans } = await supabase
      .from("scans")
      .select("latitude, longitude, district, scanned_at")
      .eq("item_id", itemId).gte("scanned_at", since)
      .not("latitude", "is", null).order("scanned_at", { ascending: false });

    if (!recentScans || recentScans.length < 2) return;

    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    for (const scan of recentScans) {
      if (!scan.latitude || new Date(scan.scanned_at) < twoHoursAgo) continue;
      const dist = distanceKm(lat, lng, scan.latitude, scan.longitude);
      if (dist > 50) {
        await saveAlert(itemId, "IMPOSSIBLE_TRAVEL", "HIGH",
          `Item scanned ${Math.round(dist)} km apart within 2 hours — likely cloned.`,
          { scan1: { lat: scan.latitude, lng: scan.longitude, time: scan.scanned_at },
            scan2: { lat, lng, time: new Date().toISOString() }, distance_km: Math.round(dist) });
        break;
      }
    }

    const districts = new Set(recentScans.map(s => s.district).filter(Boolean));
    if (districts.size >= 3) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { data: existing } = await supabase.from("alerts").select("id")
        .eq("item_id", itemId).eq("type", "DISTRICT_SPREAD")
        .gte("detected_at", today.toISOString()).limit(1);
      if (!existing || existing.length === 0)
        await saveAlert(itemId, "DISTRICT_SPREAD", "MEDIUM",
          `Item scanned in ${districts.size} districts in 24 hours: ${[...districts].join(", ")}.`,
          { districts: [...districts], scan_count: recentScans.length });
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentHour = recentScans.filter(s => new Date(s.scanned_at) > oneHourAgo);
    if (recentHour.length >= 8) {
      const { data: existing } = await supabase.from("alerts").select("id")
        .eq("item_id", itemId).eq("type", "SCAN_FLOOD")
        .gte("detected_at", oneHourAgo.toISOString()).limit(1);
      if (!existing || existing.length === 0)
        await saveAlert(itemId, "SCAN_FLOOD", "MEDIUM",
          `Item scanned ${recentHour.length} times in 1 hour — possible coordinated clone verification.`,
          { scan_count: recentHour.length, window_hours: 1 });
    }
  } catch (err) {
    console.warn("Geo detection error:", err.message);
  }
}

async function runNightlySweep() {
  const results = { checked: 0, alerts: 0, errors: 0 };
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: items } = await supabase.from("scans").select("item_id")
      .gte("scanned_at", since).not("latitude", "is", null);
    if (!items) return results;

    const uniqueItems = [...new Set(items.map(r => r.item_id))];
    results.checked = uniqueItems.length;

    for (const itemId of uniqueItems) {
      try {
        const { data: scans } = await supabase.from("scans")
          .select("latitude, longitude, district, scanned_at")
          .eq("item_id", itemId).gte("scanned_at", since)
          .not("latitude", "is", null).order("scanned_at", { ascending: true });
        if (!scans || scans.length < 2) continue;

        let travelAlerted = false;
        for (let i = 0; i < scans.length && !travelAlerted; i++) {
          for (let j = i + 1; j < scans.length && !travelAlerted; j++) {
            const a = scans[i], b = scans[j];
            if (!a.latitude || !b.latitude) continue;
            const timeDiffHours = (new Date(b.scanned_at) - new Date(a.scanned_at)) / 3600000;
            const dist = distanceKm(a.latitude, a.longitude, b.latitude, b.longitude);
            if (timeDiffHours <= 2 && dist > 50) {
              await saveAlert(itemId, "IMPOSSIBLE_TRAVEL", "HIGH",
                `Nightly sweep: ${Math.round(dist)} km apart in ${timeDiffHours.toFixed(1)} hours.`,
                { scan1: { lat: a.latitude, lng: a.longitude, time: a.scanned_at },
                  scan2: { lat: b.latitude, lng: b.longitude, time: b.scanned_at },
                  distance_km: Math.round(dist) });
              results.alerts++; travelAlerted = true;
            }
          }
        }

        const districts = new Set(scans.map(s => s.district).filter(Boolean));
        if (districts.size >= 3) {
          const today = new Date(); today.setHours(0, 0, 0, 0);
          const { data: existing } = await supabase.from("alerts").select("id")
            .eq("item_id", itemId).eq("type", "DISTRICT_SPREAD")
            .gte("detected_at", today.toISOString()).limit(1);
          if (!existing || existing.length === 0) {
            await saveAlert(itemId, "DISTRICT_SPREAD", "MEDIUM",
              `Nightly sweep: ${districts.size} districts in 24h — ${[...districts].join(", ")}.`,
              { districts: [...districts], scan_count: scans.length });
            results.alerts++;
          }
        }
      } catch (err) {
        results.errors++;
        console.warn(`Sweep error for ${itemId}:`, err.message);
      }
    }
  } catch (err) {
    console.error("Nightly sweep failed:", err.message);
  }
  return results;
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

// Returns batch ID strings for scoped queries
function getBatchIds(batches) {
  return (batches || []).map(b => b.batch_id).filter(Boolean);
}

// Applies a manufacturer-scoped filter to a Supabase query builder.
// Single batch: uses .like() directly.
// Multiple batches: uses .or() with PostgREST filter string syntax.
function applyBatchFilter(query, batchIds) {
  if (!batchIds || batchIds.length === 0) return query;
  if (batchIds.length === 1) {
    return query.like("item_id", `${batchIds[0]}-%`);
  }
  const filter = batchIds.map(id => `item_id.like.${id}-%`).join(",");
  return query.or(filter);
}

// Ownership check by batch ID prefix — works for any quantity
function itemBelongsToMfr(itemId, batches) {
  return (batches || []).some(b => b.batch_id && itemId.startsWith(`${b.batch_id}-`));
}

// ─────────────────────────────────────────────────────────────
// ROUTES — PUBLIC
// ─────────────────────────────────────────────────────────────

app.get("/", (req, res) => res.json({ status: "Backend is running" }));

app.get("/stats/public", async (req, res) => {
  try {
    const { count: manufacturers } = await supabase.from("manufacturers")
      .select("*", { count: "exact", head: true }).eq("is_active", true);
    const { count: batches } = await supabase.from("batches")
      .select("*", { count: "exact", head: true });
    const { count: scans } = await supabase.from("scans")
      .select("*", { count: "exact", head: true });
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: cloneFlags } = await supabase.from("alerts")
      .select("*", { count: "exact", head: true }).gte("detected_at", weekAgo);
    res.json({
      manufacturers: manufacturers || 0,
      batches: batches || 0,
      scans: scans || 0,
      weeklyCloneFlags: cloneFlags || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/add-manufacturer", async (req, res) => {
  try {
    const tx = await contractWrite.addManufacturer(req.body.address);
    const receipt = await tx.wait(1);
    res.json({ success: true, txHash: receipt.hash });
  } catch (err) {
    res.status(500).json({ error: "Failed to add manufacturer" });
  }
});

app.get("/product/:itemId", async (req, res) => {
  try {
    const itemIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(req.params.itemId));
    const product = await contractRead.getProduct(itemIdBytes32);
    if (product.productName === "") return res.status(404).json({ error: "Product not found" });
    res.json({
      productName: product.productName, category: product.category,
      manufacturer: product.manufacturer, scanCount: Number(product.scanCount),
      isActive: product.isActive, isPotentialClone: product.isPotentialClone,
      expiryDate: new Date(Number(product.expiryDate) * 1000).toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to read product" });
  }
});

app.post("/verify", async (req, res) => {
  try {
    const { itemId, lat, lng } = req.body;
    if (!itemId) return res.status(400).json({ error: "itemId is required" });

    const itemIdBytes32 = ethers.keccak256(ethers.toUtf8Bytes(itemId));

    // Check existence before writing to chain — avoids gas waste and false scan logs
    const productCheck = await contractRead.getProduct(itemIdBytes32);
    if (productCheck.productName === "") {
      return res.json({
        status: "NOT_FOUND",
        productName: "",
        scanCount: 0,
        isPotentialClone: false,
        isExpired: false,
      });
    }

    const tx      = await contractWrite.verifyProduct(itemIdBytes32);
    const receipt = await tx.wait(1);
    const product = await contractRead.getProduct(itemIdBytes32);

    const scanCount = Number(product.scanCount);
    const isExpired = Date.now() / 1000 > Number(product.expiryDate);

    let status = "GENUINE";
    if (product.isPotentialClone) status = "POTENTIAL_CLONE";
    else if (isExpired)           status = "EXPIRED";

    const { error: dbError } = await supabase.from("scans").insert({
      item_id: itemId, latitude: lat ?? null, longitude: lng ?? null,
      is_flagged: product.isPotentialClone, scan_count: scanCount,
    });
    if (dbError) console.warn("Supabase log failed:", dbError.message);

    runRealTimeDetection(itemId, lat, lng).catch(err =>
      console.warn("Background detection failed:", err.message)
    );

    res.json({
      status, productName: product.productName, category: product.category,
      manufacturer: product.manufacturer, scanCount,
      isPotentialClone: product.isPotentialClone, isExpired,
      expiryDate: new Date(Number(product.expiryDate) * 1000).toISOString(),
      txHash: receipt.hash,
    });
  } catch (err) {
    res.status(500).json({ error: "Verification failed" });
  }
});

app.get("/scans/:itemId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("scans").select("*")
      .eq("item_id", req.params.itemId).order("scanned_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch scans" });
  }
});

app.get("/scans/flagged/all", async (req, res) => {
  try {
    const { data, error } = await supabase.from("scans").select("*")
      .eq("is_flagged", true).order("scanned_at", { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch flagged scans" });
  }
});

app.get("/dashboard/stats", async (req, res) => {
  try {
    const { count: totalScans }   = await supabase.from("scans").select("*", { count: "exact", head: true });
    const { count: flaggedScans } = await supabase.from("scans").select("*", { count: "exact", head: true }).eq("is_flagged", true);
    const { data: uniqueItems }   = await supabase.from("scans").select("item_id");
    const uniqueCount = new Set((uniqueItems || []).map(r => r.item_id)).size;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { count: todayScans }   = await supabase.from("scans").select("*", { count: "exact", head: true }).gte("scanned_at", today.toISOString());
    const { count: openAlerts }   = await supabase.from("alerts").select("*", { count: "exact", head: true }).eq("resolved", false);
    res.json({ totalScans, flaggedScans, uniqueItems: uniqueCount, todayScans, openAlerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/districts", async (req, res) => {
  try {
    const { data } = await supabase.from("scans")
      .select("district, is_flagged, latitude, longitude").not("district", "is", null);
    const map = {};
    (data || []).forEach(row => {
      const d = row.district || "Unknown";
      if (!map[d]) map[d] = { district: d, total: 0, flagged: 0, lat: row.latitude, lng: row.longitude };
      map[d].total++;
      if (row.is_flagged) map[d].flagged++;
    });
    res.json(Object.values(map).sort((a, b) => b.total - a.total));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/recent", async (req, res) => {
  try {
    const { data } = await supabase.from("scans").select("*")
      .order("scanned_at", { ascending: false }).limit(30);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/dashboard/map-data", async (req, res) => {
  try {
    const { data } = await supabase.from("scans")
      .select("item_id, latitude, longitude, is_flagged, scanned_at, district")
      .not("latitude", "is", null).order("scanned_at", { ascending: false }).limit(500);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/alerts", async (req, res) => {
  try {
    const { severity, resolved, limit = 50 } = req.query;
    let query = supabase.from("alerts").select("*")
      .order("detected_at", { ascending: false }).limit(parseInt(limit));
    if (severity)               query = query.eq("severity", severity.toUpperCase());
    if (resolved !== undefined) query = query.eq("resolved", resolved === "true");
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/alerts/item/:itemId", async (req, res) => {
  try {
    const { data, error } = await supabase.from("alerts").select("*")
      .eq("item_id", req.params.itemId).order("detected_at", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/alerts/:id/resolve", async (req, res) => {
  try {
    const { error } = await supabase.from("alerts")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/detection/run", async (req, res) => {
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: "CRON_SECRET not configured on server" });
  if (req.query.secret !== expected) return res.status(401).json({ error: "Unauthorized" });
  try {
    const results = await runNightlySweep();
    res.json({ success: true, ...results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/report", async (req, res) => {
  try {
    const { itemId, notes, lat, lng } = req.body;
    if (!itemId) return res.status(400).json({ error: "itemId is required" });
    await supabase.from("scans").insert({
      item_id: itemId, latitude: lat ?? null, longitude: lng ?? null,
      is_flagged: true, scan_count: 0, notes: notes || null,
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTES — ADMIN
// ─────────────────────────────────────────────────────────────

app.post("/admin/create-manufacturer", async (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) return res.status(500).json({ error: "ADMIN_SECRET not configured on server" });
  if (req.headers["x-admin-secret"] !== adminSecret)
    return res.status(401).json({ error: "Unauthorized" });

  const { email, password, companyName, companyType } = req.body;
  if (!email || !password || !companyName)
    return res.status(400).json({ error: "email, password, and companyName are required" });

  try {
    const passwordHash = await hashPassword(password);
    const { data, error } = await supabase.from("manufacturers").insert({
      email,
      password: passwordHash,
      company_name: companyName,
      company_type: companyType || "Manufacturer",
    }).select().single();
    if (error) throw error;
    res.json({ success: true, id: data.id, email: data.email, companyName: data.company_name });
  } catch (err) {
    if (err.message.includes("unique"))
      return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// ROUTES — MANUFACTURER (authenticated)
// ─────────────────────────────────────────────────────────────

app.post("/mfr/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const { data: mfr } = await supabase.from("manufacturers").select("*")
      .eq("email", email).single();

    if (!mfr) return res.status(401).json({ error: "Invalid credentials" });

    const passwordMatch = await verifyPassword(password, mfr.password);
    if (!passwordMatch) return res.status(401).json({ error: "Invalid credentials" });

    if (!mfr.is_active) return res.status(401).json({ error: "Account inactive. Contact WanzaBlock." });

    const token = createToken(email);

    const { data: batches } = await supabase.from("batches").select("*")
      .eq("manufacturer_email", email).order("registered_at", { ascending: false });

    const totalItems = (batches || []).reduce((sum, b) => sum + (b.quantity || 0), 0);
    const batchIds   = getBatchIds(batches || []);

    let totalScans = 0, openAlerts = 0;
    if (batchIds.length > 0) {
      const { count: sc } = await applyBatchFilter(
        supabase.from("scans").select("*", { count: "exact", head: true }), batchIds
      );
      totalScans = sc || 0;

      const { count: ac } = await applyBatchFilter(
        supabase.from("alerts").select("*", { count: "exact", head: true }).eq("resolved", false),
        batchIds
      );
      openAlerts = ac || 0;
    }

    res.json({
      token,
      companyName: mfr.company_name,
      companyType: mfr.company_type,
      email:       mfr.email,
      batchCount:  (batches || []).length,
      totalItems,
      totalScans,
      alerts:      openAlerts,
      batches:     batches || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/mfr/stats", requireMfr, async (req, res) => {
  try {
    const { data: batches } = await supabase.from("batches")
      .select("batch_id, quantity").eq("manufacturer_email", req.manufacturerEmail);

    const totalItems = (batches || []).reduce((sum, b) => sum + (b.quantity || 0), 0);
    const batchIds   = getBatchIds(batches || []);

    let totalScans = 0, flaggedScans = 0, todayScans = 0, openAlerts = 0;

    if (batchIds.length > 0) {
      const { count: sc } = await applyBatchFilter(
        supabase.from("scans").select("*", { count: "exact", head: true }), batchIds
      );
      totalScans = sc || 0;

      const { count: fc } = await applyBatchFilter(
        supabase.from("scans").select("*", { count: "exact", head: true }).eq("is_flagged", true),
        batchIds
      );
      flaggedScans = fc || 0;

      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { count: tc } = await applyBatchFilter(
        supabase.from("scans").select("*", { count: "exact", head: true }).gte("scanned_at", today.toISOString()),
        batchIds
      );
      todayScans = tc || 0;

      const { count: ac } = await applyBatchFilter(
        supabase.from("alerts").select("*", { count: "exact", head: true }).eq("resolved", false),
        batchIds
      );
      openAlerts = ac || 0;
    }

    res.json({
      batchCount: (batches || []).length,
      totalItems, totalScans, flaggedScans, todayScans, openAlerts,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/mfr/batches", requireMfr, async (req, res) => {
  try {
    const { data, error } = await supabase.from("batches").select("*")
      .eq("manufacturer_email", req.manufacturerEmail)
      .order("registered_at", { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/mfr/alerts", requireMfr, async (req, res) => {
  try {
    const { resolved, limit = 50 } = req.query;

    const { data: batches } = await supabase.from("batches")
      .select("batch_id, quantity").eq("manufacturer_email", req.manufacturerEmail);

    const batchIds = getBatchIds(batches || []);
    if (batchIds.length === 0) return res.json([]);

    let query = applyBatchFilter(
      supabase.from("alerts").select("*")
        .order("detected_at", { ascending: false })
        .limit(parseInt(limit)),
      batchIds
    );
    if (resolved !== undefined) query = query.eq("resolved", resolved === "true");

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/mfr/scans/recent", requireMfr, async (req, res) => {
  try {
    const { data: batches } = await supabase.from("batches")
      .select("batch_id, quantity").eq("manufacturer_email", req.manufacturerEmail);

    const batchIds = getBatchIds(batches || []);
    if (batchIds.length === 0) return res.json([]);

    const { data, error } = await applyBatchFilter(
      supabase.from("scans").select("*")
        .order("scanned_at", { ascending: false }).limit(30),
      batchIds
    );
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const ITEMS_PER_TX = 50;

app.post("/mfr/register-batch", requireMfr, async (req, res) => {
  const { productName, category, quantity, expiryDate, notes } = req.body;

  if (!productName || !productName.trim()) return res.status(400).json({ error: "Product name is required" });
  if (!quantity || quantity < 1)           return res.status(400).json({ error: "Quantity must be at least 1" });
  if (!expiryDate)                         return res.status(400).json({ error: "Expiry date is required" });

  const qty = parseInt(quantity, 10);
  if (qty > 10000) return res.status(400).json({ error: "Maximum 10,000 items per batch" });

  const batchId         = "WB-" + Date.now().toString(36).toUpperCase();
  const expiryTimestamp = Math.floor(new Date(expiryDate).getTime() / 1000);
  const allItems        = Array.from({ length: qty }, (_, i) =>
    `${batchId}-${String(i + 1).padStart(5, "0")}`
  );

  const chunks = [];
  for (let i = 0; i < allItems.length; i += ITEMS_PER_TX)
    chunks.push(allItems.slice(i, i + ITEMS_PER_TX));

  // Pre-insert as 'pending' — always visible in dashboard, never silently lost
  const { error: insertError } = await supabase.from("batches").insert({
    batch_id:           batchId,
    product_name:       productName,
    category:           category || "other",
    quantity:           qty,
    expiry_date:        expiryDate,
    notes:              notes || null,
    tx_hashes:          [],
    chunk_count:        chunks.length,
    manufacturer_email: req.manufacturerEmail,
    registered_at:      new Date().toISOString(),
    chain_status:       "pending",
  });

  if (insertError) {
    console.error("Batch pre-insert failed:", insertError.message);
    return res.status(500).json({ error: "Failed to create batch record: " + insertError.message });
  }

  const txHashes = [];
  try {
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      const tx = await contractWrite.registerBatch(
        ethers.keccak256(ethers.toUtf8Bytes(batchId)),
        chunk.map(id => ethers.keccak256(ethers.toUtf8Bytes(id))),
        productName.slice(0, 64),
        (category || "other").slice(0, 32),
        expiryTimestamp
      );
      await tx.wait(1);
      txHashes.push(tx.hash);
    }

    await supabase.from("batches")
      .update({ tx_hashes: txHashes, chain_status: "confirmed" })
      .eq("batch_id", batchId);

    res.json({
      success: true, batchId, txHashes, itemCount: qty, chunks: chunks.length,
      message: qty > ITEMS_PER_TX
        ? `Registered in ${chunks.length} transactions of ${ITEMS_PER_TX} items each`
        : `Registered ${qty} items in 1 transaction`,
    });
  } catch (err) {
    await supabase.from("batches")
      .update({
        tx_hashes:    txHashes,
        chain_status: "failed",
        notes: `${notes || ""}\n[chain error at chunk ${txHashes.length + 1}/${chunks.length}]: ${err.message}`.trim(),
      })
      .eq("batch_id", batchId);

    res.status(500).json({
      error: err.message,
      batchId,
      detail: `${txHashes.length} of ${chunks.length} chunks registered before failure. Batch marked as failed in dashboard.`,
    });
  }
});

app.post("/mfr/alerts/:id/resolve", requireMfr, async (req, res) => {
  try {
    const { data: alert } = await supabase.from("alerts").select("item_id")
      .eq("id", req.params.id).single();
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    const { data: batches } = await supabase.from("batches")
      .select("batch_id").eq("manufacturer_email", req.manufacturerEmail);

    if (!itemBelongsToMfr(alert.item_id, batches || []))
      return res.status(403).json({ error: "This alert does not belong to your account" });

    const { error } = await supabase.from("alerts")
      .update({ resolved: true, resolved_at: new Date().toISOString() })
      .eq("id", req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));