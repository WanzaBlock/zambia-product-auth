const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

const BATCH_ID   = process.argv[2];
const QUANTITY   = parseInt(process.argv[3], 10);
const VERIFY_URL = "https://zambia-frontend-seven.vercel.app";

if (!BATCH_ID || !QUANTITY) {
  console.error("Usage: node generate-qr.js <batchId> <quantity>");
  process.exit(1);
}

const outDir = path.join(__dirname, "qr-codes", BATCH_ID);
fs.mkdirSync(outDir, { recursive: true });

async function run() {
  const manifest = [];
  for (let i = 1; i <= QUANTITY; i++) {
    const itemId  = `${BATCH_ID}-${String(i).padStart(5, "0")}`;
    const url     = `${VERIFY_URL}?item=${encodeURIComponent(itemId)}`;
    const outFile = path.join(outDir, `item-${String(i).padStart(5, "0")}.png`);
    await QRCode.toFile(outFile, url, { width: 400, margin: 2 });
    manifest.push({ serial: i, itemId, url });
    console.log(`✓ ${itemId}`);
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nDone. ${QUANTITY} QR codes saved to qr-codes/${BATCH_ID}/`);
}

run().catch(console.error);
