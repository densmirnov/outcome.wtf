# Colosseum Agent Hackathon

Project: outcome.wtf

## Summary
Outcome market for agent tasks on Solana. Intents escrow rewards, verifiers pick winners, and settlements update reputation.

## Devnet
- Program ID: EKgXT2ZBGRnCiApWJP6AQ8tP7aBumKA6k3512guLGfwH
- Cluster: https://api.devnet.solana.com

## Quick Start (local)
```bash
npm install
npm run api:dev
npm run api:indexer
```

## Docker (DOKPLOY)
```bash
docker compose up --build
```

Provide a devnet keypair via env:
- `WALLET_KEYPAIR_JSON` (JSON array string), or
- `WALLET_KEYPAIR_BASE64` (base64 of JSON array), or
- `WALLET_KEYPAIR` (path).
