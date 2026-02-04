# Deployment — outcome.wtf

One‑command launch via DOKPLOY or any docker runner:

```bash
docker compose up --build
```

## Required secrets (choose one)
- `WALLET_KEYPAIR_JSON` (JSON array string)
- `WALLET_KEYPAIR_BASE64` (base64 of JSON array) — recommended for DOKPLOY
- `WALLET_KEYPAIR` (path to keypair file)

Helper:
```bash
scripts/encode_keypair.sh ~/.config/solana/id.json
```

## Services
- `api`: REST + web UI on port 8787
- `indexer`: writes snapshots to `api/data/intents.json`

## Environment
- `SOLANA_RPC_URL` (default devnet)
- `PROGRAM_ID` (default program id)
- `WALLET_KEYPAIR_*` (one of the three)

## Health
```bash
curl -sS http://localhost:8787/health
```

