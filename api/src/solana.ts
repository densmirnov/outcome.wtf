import fs from "fs";
import path from "path";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const DEFAULT_RPC = "https://api.devnet.solana.com";

function loadIdl() {
  const idlPath = path.resolve(process.cwd(), "target/idl/outcome_market.json");
  const raw = fs.readFileSync(idlPath, "utf-8");
  return JSON.parse(raw);
}

function loadKeypair() {
  if (process.env.WALLET_KEYPAIR_JSON) {
    const secret = Uint8Array.from(JSON.parse(process.env.WALLET_KEYPAIR_JSON));
    return Keypair.fromSecretKey(secret);
  }

  if (process.env.WALLET_KEYPAIR_BASE64) {
    const secret = Uint8Array.from(
      JSON.parse(
        Buffer.from(process.env.WALLET_KEYPAIR_BASE64, "base64").toString(
          "utf-8",
        ),
      ),
    );
    return Keypair.fromSecretKey(secret);
  }

  const keypairPath = process.env.WALLET_KEYPAIR;
  if (keypairPath) {
    const raw = fs.readFileSync(keypairPath, "utf-8");
    const secret = Uint8Array.from(JSON.parse(raw));
    return Keypair.fromSecretKey(secret);
  }

  return Keypair.generate();
}

export function getConnection() {
  const url = process.env.SOLANA_RPC_URL || DEFAULT_RPC;
  return new Connection(url, "confirmed");
}

export function getProgram() {
  const idl = loadIdl();
  const programId = new PublicKey(process.env.PROGRAM_ID || idl.address);
  const connection = getConnection();
  const keypair = loadKeypair();
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new Program(idl, programId, provider);
}
