# Demo Flow

Run the API and then execute the scripted flow:

```bash
npm run api:dev
npm run demo:flow
```

The script:
1. Creates reward and output mints
2. Builds unsigned txs via API
3. Signs and submits create → select → fulfill

Outputs tx signatures and the intent PDA.
