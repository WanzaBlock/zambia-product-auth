# WanzaBlock – Blockchain Product Authentication System

WanzaBlock is a blockchain-based product authentication platform designed to help combat counterfeit medicines and agricultural inputs.

The system allows manufacturers to register products on-chain and enables consumers to verify authenticity by scanning a QR code. Each verification is recorded on-chain, providing transparent and tamper-resistant proof.

Built and tested on Base Sepolia testnet.

## Screenshots

### Dashboard
![Dashboard](https://raw.githubusercontent.com/WanzaBlock/zambia-product-auth/main/docs/screenshots/dashboard.png)

### Blockchain Proof & Verification
![Blockchain Proof](https://raw.githubusercontent.com/WanzaBlock/zambia-product-auth/main/docs/screenshots/blockchain-proof.png)

### Manufacturer Dashboard
![Manufacturer Dashboard](https://raw.githubusercontent.com/WanzaBlock/zambia-product-auth/main/docs/screenshots/manufacturer-dashboard.png)

## Live Demo

https://wanzablock.vercel.app/

## Test Credentials

> **Note:** These credentials are for demo and testing purposes only.

### Manufacturer Portal Login

| Field    | Value               |
|----------|---------------------|
| Email    | demo@wanzablock.com |
| Password | demo2026            |

### Sample Batch Codes

| Item ID              | Expected Result |
|----------------------|-----------------|
| `WB-MMMQH0A6-00001` | ✦ Genuine       |
| `WB-MMMQEGDQ-00001` | ✦ Genuine       |
| `WB-MMMNKXJD-00001` | ✦ Genuine       |

> ⚠️ **Security Notice:** Change the demo account password before going to production.

## Architecture

\`\`\`
Frontend (Vanilla HTML / CSS / JavaScript)
        ↓
Backend API (Node.js / Express / Ethers.js v6)
        ↓
Smart Contract (Solidity 0.8.20 / Foundry)
        ↓
Blockchain (Base Sepolia)
        ↓
Off-chain Database (Supabase / PostgreSQL)
\`\`\`

## Project Components

| Layer | Folder | Description |
|-------|--------|-------------|
| Smart Contract | [contracts/](https://github.com/WanzaBlock/zambia-product-auth/tree/main/contracts) | Solidity + Foundry — deployed on Base Sepolia |
| Backend API | [backend/](https://github.com/WanzaBlock/zambia-product-auth/tree/main/backend) | Node.js/Express — product registration & verification |
| Frontend | [frontend/](https://github.com/WanzaBlock/zambia-product-auth/tree/main/frontend) | Vanilla HTML/CSS/JS — QR scan interface & manufacturer dashboard |

## Features

- Manufacturer dashboard for registering product batches
- QR-based product authentication
- Consumer scan interface for verifying products
- On-chain scan count tracking with off-chain GPS logging via Supabase
- Blockchain transparency through transaction hashes
- Scan count monitoring to detect potential QR cloning

## Example Verified Product

| Field         | Value             |
|---------------|-------------------|
| Product       | Telma H           |
| Batch ID      | WB-MMIX0K37-00011 |
| Category      | Medicine          |
| Expires       | 11 Nov 2026       |
| Times Scanned | 1                 |
| Network       | Base Sepolia      |

## Smart Contract

The Solidity contract stores product batch identifiers and records scan verification events.

Each scan triggers an on-chain event which allows users to verify authenticity using a blockchain explorer.

## Future Work

- Mainnet deployment
- Manufacturer identity verification
- Scan analytics dashboard
- Mobile scanning support
- Supply chain integration

## License

MIT © 2026 WanzaBlock Solutions
