import express from "express";
import cors from "cors";
import path from "path";
import { PublicKey } from "@solana/web3.js";
import { getProgram } from "./solana.js";
import {
  buildCreateIntentTx,
  buildExpireTx,
  buildFulfillTx,
  buildSelectWinnerTx,
  deriveReputation,
} from "./builders.js";
import {
  createIntentSchema,
  expireSchema,
  fulfillSchema,
  selectWinnerSchema,
  validate,
} from "./validation.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.resolve(process.cwd(), "web")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    programId: getProgram().programId.toBase58(),
    rpcUrl: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  });
});

app.get("/intents", async (_req, res, next) => {
  try {
    const program = getProgram();
    const intents = await program.account.intent.all();
    res.json({
      count: intents.length,
      items: intents.map((item) => ({
        pubkey: item.publicKey.toBase58(),
        account: item.account,
      })),
    });
  } catch (err) {
    next(err);
  }
});

app.get("/intents/:intent", async (req, res, next) => {
  try {
    const program = getProgram();
    const intent = await program.account.intent.fetch(req.params.intent);
    res.json({ pubkey: req.params.intent, account: intent });
  } catch (err) {
    next(err);
  }
});

app.get("/reputation/:solver", async (req, res, next) => {
  try {
    const program = getProgram();
    const solver = new PublicKey(req.params.solver);
    const repPda = deriveReputation(program.programId, solver);
    const rep = await program.account.reputation.fetchNullable(repPda);
    if (!rep) {
      res
        .status(404)
        .json({ error: "reputation not found", pubkey: repPda.toBase58() });
      return;
    }
    res.json({ pubkey: repPda.toBase58(), account: rep });
  } catch (err) {
    next(err);
  }
});

app.post("/intents/build", async (req, res, next) => {
  try {
    const payload = validate(createIntentSchema, req.body);
    const result = await buildCreateIntentTx(payload);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/intents/:intent/select-winner/build", async (req, res, next) => {
  try {
    const payload = validate(selectWinnerSchema, req.body);
    const result = await buildSelectWinnerTx({
      ...payload,
      intent: req.params.intent,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/intents/:intent/fulfill/build", async (req, res, next) => {
  try {
    const payload = validate(fulfillSchema, req.body);
    const result = await buildFulfillTx({
      ...payload,
      intent: req.params.intent,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/intents/:intent/accept", async (req, res, next) => {
  try {
    const payload = validate(fulfillSchema, req.body);
    const result = await buildFulfillTx({
      ...payload,
      intent: req.params.intent,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.post("/intents/:intent/expire/build", async (req, res, next) => {
  try {
    const payload = validate(expireSchema, req.body);
    const result = await buildExpireTx({
      ...payload,
      intent: req.params.intent,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const status = err.status || 500;
    res.status(status).json({
      error: err.message || "Internal error",
      details: err.details,
    });
  },
);

const port = Number(process.env.PORT || 8787);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`outcome.wtf API listening on :${port}`);
});
