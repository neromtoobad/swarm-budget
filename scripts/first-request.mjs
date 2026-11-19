// Nov 14 milestone: one real paid Telegraph request with receipt, saved to evidence/.
// Always decodes the free 402 challenge first; pays only if --pay is passed.
import { mkdirSync, writeFileSync } from "node:fs";
import { createTelegraph } from "../server/src/telegraph.mjs";

const tg = createTelegraph();
const body = { intent: "WEATHER_FORECAST_GENERAL", params: { location: "Fresno, California", window_hours: 24 } };

const c = await tg.challenge(body);
const exact = c.challenge?.accepts?.find((a) => a.scheme === "exact");
console.log("unpaid →", c.status, exact ? `price ${Number(exact.amount) / 1e6} USDC to ${exact.payTo}` : c.body);

if (!process.argv.includes("--pay")) process.exit(0);

// Escrow by default (the x402 facilitator was timing out on Nov 19); pass --x402 to use the exact rail.
const r = process.argv.includes("--x402") ? await tg.ask(body) : await tg.askEscrow(body);
console.log("paid →", r.status, `${r.ms}ms`);
console.log(JSON.stringify(r.body, null, 2).slice(0, 2000));
console.log("receipt", r.receipt);
mkdirSync("evidence", { recursive: true });
const file = `evidence/first-request-${Date.now()}.json`;
writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), request: body, ...r }, null, 2));
console.log("saved", file, "· verify:", `${tg.node}/engine/v1/signal/${r.body?.signal_hash}`);
