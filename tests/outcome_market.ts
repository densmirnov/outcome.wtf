import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddress,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

// Minimal smoke test for create -> select -> fulfill -> accept.
// Requires local validator via `anchor test`.

describe("outcome_market", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.OutcomeMarket as Program;

  it("creates intent and settles on fulfill", async () => {
    const payer = provider.wallet as anchor.Wallet;
    const solver = anchor.web3.Keypair.generate();
    const initiator = anchor.web3.Keypair.generate();
    const verifier = payer.publicKey;
    const feeRecipient = payer.publicKey;

    const connection = provider.connection;
    const airdropSig = await connection.requestAirdrop(solver.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig, "confirmed");

    const rewardMint = await createMint(
      connection,
      payer.payer,
      payer.publicKey,
      null,
      6,
    );
    const tokenOutMint = await createMint(
      connection,
      payer.payer,
      payer.publicKey,
      null,
      6,
    );

    const payerRewardAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      rewardMint,
      payer.publicKey,
    );
    const solverRewardAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      rewardMint,
      solver.publicKey,
    );
    const winnerRewardAta = solverRewardAta.address;
    const feeRecipientRewardAta = payerRewardAta.address;

    const solverTokenOutAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      tokenOutMint,
      solver.publicKey,
    );
    const initiatorTokenOutAta = await getOrCreateAssociatedTokenAccount(
      connection,
      payer.payer,
      tokenOutMint,
      initiator.publicKey,
    );

    const rewardAmount = 1_000_000;
    const amountOut = 500_000;

    await mintTo(
      connection,
      payer.payer,
      rewardMint,
      payerRewardAta.address,
      payer.publicKey,
      rewardAmount,
    );

    await mintTo(
      connection,
      payer.payer,
      tokenOutMint,
      solverTokenOutAta.address,
      payer.publicKey,
      amountOut,
    );

    const intentSeed = new anchor.BN(1);

    const [intentPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("intent"),
        payer.publicKey.toBuffer(),
        initiator.publicKey.toBuffer(),
        intentSeed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId,
    );

    const [rewardEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("reward_escrow"), intentPda.toBuffer()],
      program.programId,
    );
    const [bondEscrow] = PublicKey.findProgramAddressSync(
      [Buffer.from("bond_escrow"), intentPda.toBuffer()],
      program.programId,
    );

    const now = Math.floor(Date.now() / 1000);
    const ttlSubmit = now + 60;
    const ttlAccept = now + 120;

    await program.methods
      .createIntent(
        intentSeed,
        new anchor.BN(amountOut),
        new anchor.BN(rewardAmount),
        new anchor.BN(ttlSubmit),
        new anchor.BN(ttlAccept),
        0,
        new anchor.BN(0),
      )
      .accounts({
        payer: payer.publicKey,
        initiator: initiator.publicKey,
        verifier,
        feeRecipient,
        tokenOut: tokenOutMint,
        rewardToken: rewardMint,
        intent: intentPda,
        rewardEscrow,
        bondEscrow,
        payerRewardAta: payerRewardAta.address,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .selectWinner(
        solver.publicKey,
        new anchor.BN(amountOut),
        new anchor.BN(0),
        0,
      )
      .accounts({
        verifier,
        solver: solver.publicKey,
        intent: intentPda,
        rewardToken: rewardMint,
        solverRewardAta: solverRewardAta.address,
        bondEscrow,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([solver])
      .rpc();

    await program.methods
      .fulfill(new anchor.BN(amountOut))
      .accounts({
        winner: solver.publicKey,
        intent: intentPda,
        tokenOut: tokenOutMint,
        rewardToken: rewardMint,
        winnerTokenOutAta: solverTokenOutAta.address,
        initiatorTokenOutAta: initiatorTokenOutAta.address,
        rewardEscrow,
        bondEscrow,
        reputation: PublicKey.findProgramAddressSync(
          [Buffer.from("rep"), solver.publicKey.toBuffer()],
          program.programId,
        )[0],
        winnerRewardAta,
        feeRecipientRewardAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([solver])
      .rpc();

    const winnerReward = await getAccount(connection, winnerRewardAta);
    expect(Number(winnerReward.amount)).to.equal(rewardAmount);

    const initiatorOut = await getAccount(
      connection,
      initiatorTokenOutAta.address,
    );
    expect(Number(initiatorOut.amount)).to.equal(amountOut);
  });
});
