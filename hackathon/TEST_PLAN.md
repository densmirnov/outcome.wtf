# Test Plan (MVP)

## Scope
- Program state machine: create_intent, select_winner, fulfill/accept, expire.
- Token transfers: reward escrow, payout, bond escrow.
- Reputation updates.

## Current Tests
- `tests/outcome_market.ts`: create → select → fulfill → accept (smoke).

## TODO
- Expire from OPEN (ttl_submit passed).
- Expire from SELECTED (ttl_accept passed, bond slashed).
- Fee calculations and caps.
- Reputation decrements on timeout.
