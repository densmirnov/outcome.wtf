# Demo Flow — outcome.wtf

## Fast path
```bash
npm run api:dev
npm run demo:flow
```

## What the script does
1. Creates reward/output mints
2. Calls API tx builders (create → select → fulfill)
3. Signs locally and submits to devnet

## Output
- Intent PDA
- Tx signatures

## Troubleshooting
- Ensure devnet keypair env is set
- Ensure `SOLANA_RPC_URL` points to devnet

