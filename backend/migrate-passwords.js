const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("hex");
    crypto.scrypt(password, salt, 64, (err, hash) => {
      if (err) return reject(err);
      resolve(`scrypt:${salt}:${hash.toString("hex")}`);
    });
  });
}

function isAlreadyHashed(password) {
  return typeof password === "string" && password.startsWith("scrypt:");
}

async function migrate() {
  console.log("Fetching manufacturer accounts...\n");
  const { data: manufacturers, error } = await supabase
    .from("manufacturers")
    .select("id, email, password");

  if (error) { console.error("Fetch failed:", error.message); process.exit(1); }
  if (!manufacturers || manufacturers.length === 0) { console.log("No accounts found."); return; }

  console.log(`Found ${manufacturers.length} account(s).\n`);
  let migrated = 0, skipped = 0, failed = 0;

  for (const mfr of manufacturers) {
    if (isAlreadyHashed(mfr.password)) {
      console.log(`  SKIP  ${mfr.email} — already hashed`);
      skipped++; continue;
    }
    try {
      const hash = await hashPassword(mfr.password);
      const { error: updateError } = await supabase
        .from("manufacturers").update({ password: hash }).eq("id", mfr.id);
      if (updateError) throw updateError;
      console.log(`  OK    ${mfr.email} — hashed`);
      migrated++;
    } catch (err) {
      console.error(`  FAIL  ${mfr.email} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Migrated: ${migrated}  Skipped: ${skipped}  Failed: ${failed}`);
  if (failed > 0) { console.error("\nRe-run to retry failed accounts."); process.exit(1); }
}

migrate();
