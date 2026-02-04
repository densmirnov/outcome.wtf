import fs from "fs";
import path from "path";
import { getProgram } from "./solana.js";

const outputDir = path.resolve(process.cwd(), "api/data");
const outputFile = path.join(outputDir, "intents.json");
const intervalMs = Number(process.env.INDEXER_INTERVAL_MS || 30000);

async function writeSnapshot() {
  const program = getProgram();
  const intents = await program.account.intent.all();
  const payload = {
    updatedAt: new Date().toISOString(),
    count: intents.length,
    items: intents.map((item) => ({
      pubkey: item.publicKey.toBase58(),
      account: item.account,
    })),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2));
}

async function run() {
  // eslint-disable-next-line no-console
  console.log(`Indexer started. Interval: ${intervalMs}ms`);
  await writeSnapshot();
  setInterval(() => {
    writeSnapshot().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Indexer error", err);
    });
  }, intervalMs);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal indexer error", err);
  process.exit(1);
});
