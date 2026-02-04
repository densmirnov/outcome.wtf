# Solana Outcome Market (MVP Spec) — outcome.wtf

> Goal: minimal, agent-native outcome marketplace on Solana with escrow, liveness, and reputation attestations.

## 1) Summary
A transfer-only outcome market where agents post intents, solvers submit offers, verifier selects a winner, and settlement happens only after on-chain delivery. Reputation updates and attestations are event-based to keep MVP simple.

## 2) Roles
- `payer`: locks reward in escrow.
- `initiator`: receives delivered tokenOut.
- `verifier`: selects winner.
- `solver`: executes and delivers outcome.

## 3) Intent (on-chain account)
**IntentAccount (PDA)**
- `id`: derived PDA
- `state`: OPEN | SELECTED | FULFILLED | ACCEPTED | EXPIRED
- `token_out`: SPL mint
- `min_amount_out`
- `reward_token`: SPL mint
- `reward_amount`
- `payer`
- `initiator`
- `verifier`
- `winner`
- `winner_amount_out`
- `bond_amount`
- `ttl_submit` (unix)
- `ttl_accept` (unix)
- `fee_bps_on_accept`
- `fixed_fee_on_expire`
- `fee_recipient`

## 4) Escrow
- Reward escrow: PDA token account owned by program.
- Bond escrow: separate PDA token account (per intent or per winner).

## 5) State transitions
- OPEN → SELECTED (`select_winner`)
- SELECTED → FULFILLED (`fulfill`)
- FULFILLED → ACCEPTED (`accept`, internal)
- OPEN → EXPIRED (`expire` after `ttl_submit`)
- SELECTED → EXPIRED (`expire` after `ttl_accept` if not fulfilled)

Forbidden: transitions from ACCEPTED/EXPIRED.

## 6) Time rules
- On create: `now < ttl_submit < ttl_accept`
- `submit_offer` only if `now <= ttl_submit`
- `select_winner` only if `now <= ttl_submit`
- `fulfill` only if `now <= ttl_accept`

## 7) Economics
- Fee on ACCEPTED: `fee = reward_amount * fee_bps_on_accept / 10_000`
- On EXPIRED: `fee = min(fixed_fee_on_expire, reward_amount)`
- Refunds: `reward_amount - fee` to payer
- Bond: `bond_amount = max(bond_min, reward_amount * bond_bps / 10_000)`
- Bond returned on ACCEPTED; slashed to fee recipient on winner timeout

## 8) Reputation (MVP)
**ReputationAccount (PDA per solver)**
- `solver_pubkey`
- `score` (i64)
- `last_updated`

Updates:
- On ACCEPTED: `score += 1`
- On winner timeout: `score -= 1`

Events:
- `ReputationUpdated { solver, delta, reason }`

## 9) Attestations (event-only MVP)
**AttestationEvent**
- `subject` (solver pubkey)
- `issuer` (verifier or program authority)
- `kind` (ACCEPTED | TIMEOUT | MANUAL)
- `intent_id`
- `timestamp`

No on-chain validation beyond signature. Indexer can derive trust graph off-chain.

## 10) API (tx-builder only)
- `POST /intents` → build `create_intent`
- `POST /intents/{id}/offers` → build `submit_offer`
- `POST /intents/{id}/select-winner` → build `select_winner`
- `POST /intents/{id}/fulfill` → build `fulfill`
- `POST /intents/{id}/expire` → build `expire`

Read endpoints are indexer-derived. The API is not a source of truth.

## 11) Wallet integration
Use AgentWallet to sign and submit all SPL token and program instructions. Keys never leave the agent.

## 12) MVP constraints
- Single chain (Solana mainnet or devnet in MVP)
- Transfer-only outcomes
- No calldata execution
- No arbitration
- No off-chain deliverables
