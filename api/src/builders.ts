import { BN } from "@coral-xyz/anchor";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getConnection, getProgram } from "./solana.js";

function toBn(value: string | number) {
  if (typeof value === "number") return new BN(value);
  return new BN(value);
}

function toPubkey(value: string) {
  return new PublicKey(value);
}

export function deriveIntentPda(
  programId: PublicKey,
  payer: PublicKey,
  initiator: PublicKey,
  intentSeed: BN,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("intent"),
      payer.toBuffer(),
      initiator.toBuffer(),
      intentSeed.toArrayLike(Buffer, "le", 8),
    ],
    programId,
  )[0];
}

export function deriveRewardEscrow(programId: PublicKey, intentPda: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("reward_escrow"), intentPda.toBuffer()],
    programId,
  )[0];
}

export function deriveBondEscrow(programId: PublicKey, intentPda: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bond_escrow"), intentPda.toBuffer()],
    programId,
  )[0];
}

export function deriveReputation(programId: PublicKey, solver: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("rep"), solver.toBuffer()],
    programId,
  )[0];
}

async function finalizeTx(tx: Transaction, feePayer: PublicKey) {
  const connection = getConnection();
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = feePayer;
  const serialized = tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  return {
    txBase64: serialized.toString("base64"),
    blockhash,
    lastValidBlockHeight,
  };
}

export async function buildCreateIntentTx(body: {
  payer: string;
  initiator: string;
  verifier: string;
  feeRecipient: string;
  tokenOut: string;
  rewardToken: string;
  payerRewardAta: string;
  intentSeed: string | number;
  minAmountOut: string | number;
  rewardAmount: string | number;
  ttlSubmit: string | number;
  ttlAccept: string | number;
  feeBpsOnAccept: number;
  fixedFeeOnExpire: string | number;
}) {
  const program = getProgram();
  const payer = toPubkey(body.payer);
  const initiator = toPubkey(body.initiator);
  const intentSeed = toBn(body.intentSeed);
  const intentPda = deriveIntentPda(
    program.programId,
    payer,
    initiator,
    intentSeed,
  );
  const rewardEscrow = deriveRewardEscrow(program.programId, intentPda);
  const bondEscrow = deriveBondEscrow(program.programId, intentPda);

  const tx = await program.methods
    .createIntent(
      intentSeed,
      toBn(body.minAmountOut),
      toBn(body.rewardAmount),
      toBn(body.ttlSubmit),
      toBn(body.ttlAccept),
      body.feeBpsOnAccept,
      toBn(body.fixedFeeOnExpire),
    )
    .accounts({
      payer,
      initiator,
      verifier: toPubkey(body.verifier),
      feeRecipient: toPubkey(body.feeRecipient),
      tokenOut: toPubkey(body.tokenOut),
      rewardToken: toPubkey(body.rewardToken),
      intent: intentPda,
      rewardEscrow,
      bondEscrow,
      payerRewardAta: toPubkey(body.payerRewardAta),
    })
    .transaction();

  const finalized = await finalizeTx(tx, payer);
  return {
    ...finalized,
    intentPda: intentPda.toBase58(),
    rewardEscrow: rewardEscrow.toBase58(),
    bondEscrow: bondEscrow.toBase58(),
  };
}

export async function buildSelectWinnerTx(body: {
  verifier: string;
  solver: string;
  intent: string;
  rewardToken: string;
  solverRewardAta: string;
  bondEscrow: string;
  amountOut: string | number;
  bondMin: string | number;
  bondBpsOfReward: number;
}) {
  const program = getProgram();
  const verifier = toPubkey(body.verifier);
  const tx = await program.methods
    .selectWinner(
      toPubkey(body.solver),
      toBn(body.amountOut),
      toBn(body.bondMin),
      body.bondBpsOfReward,
    )
    .accounts({
      verifier,
      solver: toPubkey(body.solver),
      intent: toPubkey(body.intent),
      rewardToken: toPubkey(body.rewardToken),
      solverRewardAta: toPubkey(body.solverRewardAta),
      bondEscrow: toPubkey(body.bondEscrow),
    })
    .transaction();

  return finalizeTx(tx, verifier);
}

export async function buildFulfillTx(body: {
  winner: string;
  intent: string;
  tokenOut: string;
  rewardToken: string;
  winnerTokenOutAta: string;
  initiatorTokenOutAta: string;
  rewardEscrow: string;
  bondEscrow: string;
  winnerRewardAta: string;
  feeRecipientRewardAta: string;
  amountOut: string | number;
}) {
  const program = getProgram();
  const winner = toPubkey(body.winner);
  const reputation = deriveReputation(program.programId, winner);
  const tx = await program.methods
    .fulfill(toBn(body.amountOut))
    .accounts({
      winner,
      intent: toPubkey(body.intent),
      tokenOut: toPubkey(body.tokenOut),
      rewardToken: toPubkey(body.rewardToken),
      winnerTokenOutAta: toPubkey(body.winnerTokenOutAta),
      initiatorTokenOutAta: toPubkey(body.initiatorTokenOutAta),
      rewardEscrow: toPubkey(body.rewardEscrow),
      bondEscrow: toPubkey(body.bondEscrow),
      reputation,
      winnerRewardAta: toPubkey(body.winnerRewardAta),
      feeRecipientRewardAta: toPubkey(body.feeRecipientRewardAta),
    })
    .transaction();

  const finalized = await finalizeTx(tx, winner);
  return { ...finalized, reputation: reputation.toBase58() };
}

export async function buildExpireTx(body: {
  caller: string;
  intent: string;
  rewardToken: string;
  rewardEscrow: string;
  bondEscrow: string;
  payerRewardAta: string;
  feeRecipientRewardAta: string;
}) {
  const program = getProgram();
  const intentPk = toPubkey(body.intent);
  const intentAccount = await program.account.intent.fetch(intentPk);
  const winner = intentAccount.winner as PublicKey;
  const reputation = deriveReputation(program.programId, winner);
  const caller = toPubkey(body.caller);
  const tx = await program.methods
    .expire()
    .accounts({
      caller,
      intent: intentPk,
      rewardToken: toPubkey(body.rewardToken),
      rewardEscrow: toPubkey(body.rewardEscrow),
      bondEscrow: toPubkey(body.bondEscrow),
      payerRewardAta: toPubkey(body.payerRewardAta),
      feeRecipientRewardAta: toPubkey(body.feeRecipientRewardAta),
      reputation,
    })
    .transaction();

  const finalized = await finalizeTx(tx, caller);
  return { ...finalized, reputation: reputation.toBase58() };
}
