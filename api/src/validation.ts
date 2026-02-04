import { z } from "zod";

const publicKey = z.string().min(32);
const u64 = z.union([z.string(), z.number()]);

export const createIntentSchema = z.object({
  payer: publicKey,
  initiator: publicKey,
  verifier: publicKey,
  feeRecipient: publicKey,
  tokenOut: publicKey,
  rewardToken: publicKey,
  payerRewardAta: publicKey,
  intentSeed: u64,
  minAmountOut: u64,
  rewardAmount: u64,
  ttlSubmit: u64,
  ttlAccept: u64,
  feeBpsOnAccept: z.number().int().min(0).max(10_000),
  fixedFeeOnExpire: u64,
});

export const selectWinnerSchema = z.object({
  verifier: publicKey,
  solver: publicKey,
  rewardToken: publicKey,
  solverRewardAta: publicKey,
  bondEscrow: publicKey,
  amountOut: u64,
  bondMin: u64,
  bondBpsOfReward: z.number().int().min(0).max(10_000),
});

export const fulfillSchema = z.object({
  winner: publicKey,
  tokenOut: publicKey,
  rewardToken: publicKey,
  winnerTokenOutAta: publicKey,
  initiatorTokenOutAta: publicKey,
  rewardEscrow: publicKey,
  bondEscrow: publicKey,
  winnerRewardAta: publicKey,
  feeRecipientRewardAta: publicKey,
  amountOut: u64,
});

export const expireSchema = z.object({
  caller: publicKey,
  rewardToken: publicKey,
  rewardEscrow: publicKey,
  bondEscrow: publicKey,
  payerRewardAta: publicKey,
  feeRecipientRewardAta: publicKey,
});

export function validate<T>(schema: z.ZodSchema<T>, body: unknown) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const error = new Error(result.error.flatten().fieldErrors ? "Invalid request" : "Invalid request");
    // @ts-expect-error attach status + details
    error.status = 400;
    // @ts-expect-error attach details
    error.details = result.error.flatten().fieldErrors;
    throw error;
  }
  return result.data;
}
