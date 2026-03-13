// qr-generator.js
const QRCode = require("qrcode");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// Change this to your actual backend URL when you deploy
// For now it points to localhost for testing
const BASE_VERIFY_URL = "http://localhost:3001/verify-page";

/**
 * Generate a unique itemId hash from a batch and serial number.
 * The secret salt means a counterfeiter cannot guess other valid IDs.
 */
function generateItemId(batchId, serialNumber, manufacturerSecret) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["string", "uint256", "string"],
      [batchId, serialNumber, manufacturerSecret]
    )
  );
}

/**
 * Generate a single QR code image and save it as a PNG file.
 */
async function generateQRCode(itemId, outputPath) {
  const verifyUrl = `${BASE_VERIFY_URL}?id=${itemId}`;

  await QRCode.toFile(outputPath, verifyUrl, {
    errorCorrectionLevel: "H", // highest — survives damage or dirt on label
    width: 300,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });

  return verifyUrl;
}

/**
 * Generate QR codes for an entire batch.
 * Creates one PNG file per item in the output folder.
 */
async function generateBatchQRCodes(batchId, itemCount, manufacturerSecret) {
  const outputDir = path.join(__dirname, "qr-codes", batchId);

  // Create output folder if it does not exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = [];

  for (let i = 1; i <= itemCount; i++) {
    const itemId = generateItemId(batchId, i, manufacturerSecret);
    const fileName = `item-${i}.png`;
    const outputPath = path.join(outputDir, fileName);

    const verifyUrl = await generateQRCode(itemId, outputPath);

    results.push({
      serial: i,
      itemId,
      verifyUrl,
      file: outputPath,
    });

    console.log(`Generated QR ${i}/${itemCount} — ${itemId}`);
  }

  // Save a manifest file — maps each serial number to its itemId
  // You will use this to register the batch on-chain
  const manifestPath = path.join(outputDir, "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2));

  console.log(`\nDone. ${itemCount} QR codes saved to: ${outputDir}`);
  console.log(`Manifest saved to: ${manifestPath}`);

  return results;
}

// ── Run it ────────────────────────────────────────────────────
// Change these values for each real batch
const BATCH_ID          = "BATCH_002";
const ITEM_COUNT        = 5;           // number of items in this batch
const MANUFACTURER_SECRET = "zambia-secret-salt-change-this"; // keep this private

generateBatchQRCodes(BATCH_ID, ITEM_COUNT, MANUFACTURER_SECRET)
  .then((results) => {
    console.log("\nSample item IDs for registerBatch call:");
    console.log(results.map((r) => r.itemId));
  })
  .catch(console.error);
