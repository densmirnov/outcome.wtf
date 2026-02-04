# outcome.wtf API (devnet)

Minimal indexer + API for the Outcome Market program on Solana devnet.

## Endpoints

- `GET /health` -> `{ ok, programId, rpcUrl }`
- `GET /intents` -> list on-chain intents
- `GET /intents/:intent` -> fetch intent account
- `GET /reputation/:solver` -> fetch reputation PDA for solver
- `POST /intents/:intent/accept` -> alias to fulfill (unsigned tx builder)

### Transaction builders (unsigned)

- `POST /intents/build`
- `POST /intents/:intent/select-winner/build`
- `POST /intents/:intent/fulfill/build`
- `POST /intents/:intent/accept`
- `POST /intents/:intent/expire/build`

Each builder returns:
- `txBase64` (unsigned)
- `blockhash`, `lastValidBlockHeight`
- relevant PDAs (intent, escrow, reputation)

## Env

- `SOLANA_RPC_URL` (default: devnet)
- `PROGRAM_ID` (default: IDL address)
- `WALLET_KEYPAIR_JSON` (JSON array string) or
- `WALLET_KEYPAIR_BASE64` (base64 JSON array) or
- `WALLET_KEYPAIR` (path to keypair; used for fee payer in unsigned txs)

## Run

```bash
npm install
npm run api:dev
```

## Demo flow

```bash
# terminal 1
npm run api:dev

# terminal 2
npm run demo:flow
```

## Indexer

```bash
npm run api:indexer
```

The indexer writes snapshots to `api/data/intents.json`.
