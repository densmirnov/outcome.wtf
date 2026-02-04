# Progress Update (Day 1) — Solana Outcome Market

- Published MVP spec (transfer-only outcome market) with escrow, bond, TTL, and reputation.
- Added Solana program skeleton (Anchor) with core instructions: create_intent, select_winner, fulfill, expire.
- Designed PDA scheme for intent, reward escrow, bond escrow, and solver reputation.
- Planned devnet-first MVP and tx-builder API (off-chain indexer).

Next 24–48h:
- Validate account layout and state machine.
- Implement minimal indexer + read API schema.
- Devnet smoke test with SPL transfers.
