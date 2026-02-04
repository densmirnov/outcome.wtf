import fs from "fs";
import os from "os";
import path from "path";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

const API_URL = process.env.API_URL || "http://localhost:8787";
const SOLANA_RPC_URL =
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function expandHome(filePath: string) {
  if (filePath.startsWith("~/")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function loadKeypair() {
  const rawPath =
    process.env.WALLET_KEYPAIR ||
    path.join(os.homedir(), ".config/solana/id.json");
  const keypairPath = expandHome(rawPath);
  const secret = Uint8Array.from(
    JSON.parse(fs.readFileSync(keypairPath, "utf-8")),
  );
  return Keypair.fromSecretKey(secret);
}

async function postJson<T>(
  route: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${API_URL}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${route} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

async function sendUnsignedTx(
  provider: AnchorProvider,
  txBase64: string,
  signers: Keypair[],
) {
  const tx = Transaction.from(Buffer.from(txBase64, "base64"));
  tx.partialSign(...signers);
  const sig = await provider.connection.sendRawTransaction(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    { skipPreflight: false },
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
  return sig;
}

async function fundSolver(
  provider: AnchorProvider,
  payer: Keypair,
  solver: Keypair,
) {
  try {
    const airdropSig = await provider.connection.requestAirdrop(
      solver.publicKey,
      2e9,
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");
    return;
  } catch (err) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: solver.publicKey,
        lamports: 200_000_000,
      }),
    );
    await sendAndConfirmTransaction(provider.connection, tx, [payer]);
  }
}

async function main() {
  const payer = loadKeypair();
  const provider = new AnchorProvider(
    new (await import("@solana/web3.js")).Connection(
      SOLANA_RPC_URL,
      "confirmed",
    ),
    new Wallet(payer),
    { commitment: "confirmed" },
  );

  const solver = Keypair.generate();
  const initiator = Keypair.generate();

  await fundSolver(provider, payer, solver);

  const rewardMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
  );
  const tokenOutMint = await createMint(
    provider.connection,
    payer,
    payer.publicKey,
    null,
    6,
  );

  const payerRewardAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    rewardMint,
    payer.publicKey,
  );
  const solverRewardAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    rewardMint,
    solver.publicKey,
  );
  const solverTokenOutAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    tokenOutMint,
    solver.publicKey,
  );
  const initiatorTokenOutAta = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    tokenOutMint,
    initiator.publicKey,
  );

  const rewardAmount = 1_000_000;
  const amountOut = 500_000;

  await mintTo(
    provider.connection,
    payer,
    rewardMint,
    payerRewardAta.address,
    payer.publicKey,
    rewardAmount,
  );

  await mintTo(
    provider.connection,
    payer,
    tokenOutMint,
    solverTokenOutAta.address,
    payer.publicKey,
    amountOut,
  );

  const now = Math.floor(Date.now() / 1000);
  const ttlSubmit = now + 60;
  const ttlAccept = now + 120;
  const intentSeed = Date.now();

  const createIntent = await postJson<{
    txBase64: string;
    intentPda: string;
    rewardEscrow: string;
    bondEscrow: string;
  }>("/intents/build", {
    payer: payer.publicKey.toBase58(),
    initiator: initiator.publicKey.toBase58(),
    verifier: payer.publicKey.toBase58(),
    feeRecipient: payer.publicKey.toBase58(),
    tokenOut: tokenOutMint.toBase58(),
    rewardToken: rewardMint.toBase58(),
    payerRewardAta: payerRewardAta.address.toBase58(),
    intentSeed,
    minAmountOut: amountOut,
    rewardAmount,
    ttlSubmit,
    ttlAccept,
    feeBpsOnAccept: 0,
    fixedFeeOnExpire: 0,
  });

  const createSig = await sendUnsignedTx(provider, createIntent.txBase64, [
    payer,
  ]);

  const selectWinner = await postJson<{ txBase64: string }>(
    `/intents/${createIntent.intentPda}/select-winner/build`,
    {
      verifier: payer.publicKey.toBase58(),
      solver: solver.publicKey.toBase58(),
      rewardToken: rewardMint.toBase58(),
      solverRewardAta: solverRewardAta.address.toBase58(),
      bondEscrow: createIntent.bondEscrow,
      amountOut,
      bondMin: 0,
      bondBpsOfReward: 0,
    },
  );

  const selectSig = await sendUnsignedTx(provider, selectWinner.txBase64, [
    payer,
    solver,
  ]);

  const fulfill = await postJson<{ txBase64: string }>(
    `/intents/${createIntent.intentPda}/fulfill/build`,
    {
      winner: solver.publicKey.toBase58(),
      tokenOut: tokenOutMint.toBase58(),
      rewardToken: rewardMint.toBase58(),
      winnerTokenOutAta: solverTokenOutAta.address.toBase58(),
      initiatorTokenOutAta: initiatorTokenOutAta.address.toBase58(),
      rewardEscrow: createIntent.rewardEscrow,
      bondEscrow: createIntent.bondEscrow,
      winnerRewardAta: solverRewardAta.address.toBase58(),
      feeRecipientRewardAta: payerRewardAta.address.toBase58(),
      amountOut,
    },
  );

  const fulfillSig = await sendUnsignedTx(provider, fulfill.txBase64, [solver]);

  console.log("CreateIntent tx", createSig);
  console.log("SelectWinner tx", selectSig);
  console.log("Fulfill tx", fulfillSig);
  console.log("Intent PDA", createIntent.intentPda);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
