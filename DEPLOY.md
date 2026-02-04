# Deployment

This repo is designed for one-command launch via DOKPLOY:

```bash
docker compose up --build
```

## Required secrets
Set one of these env vars:
- `WALLET_KEYPAIR_JSON` (JSON array string)
- `WALLET_KEYPAIR_BASE64` (base64 of JSON array)
- `WALLET_KEYPAIR` (path to keypair file)

Helper:
```bash
scripts/encode_keypair.sh ~/.config/solana/id.json
```

## Services
- `api`: serves REST + UI on port 8787
- `indexer`: writes snapshots to `api/data/intents.json`

## Env
Set in `docker-compose.yml` or your deployment system:
- `SOLANA_RPC_URL`
- `PROGRAM_ID`
- `WALLET_KEYPAIR_JSON` or `WALLET_KEYPAIR_BASE64` (preferred for DOKPLOY)
