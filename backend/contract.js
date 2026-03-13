const { ethers } = require("ethers");
require("dotenv").config();

// Read ABI from Foundry output
const ABI = require("./abi.json");

// Connect to Anvil (or Base Sepolia later — just change RPC_URL in .env)
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Signer — wallet that sends transactions
const signer = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Read-only contract instance
const contractRead = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  ABI,
  provider
);

// Write contract instance
const contractWrite = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  ABI,
  signer
);

module.exports = { provider, signer, contractRead, contractWrite };
