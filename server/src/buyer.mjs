// The fleet's buyer: the checked-ask package's buy-check-rebuy loop, wired to the fleet's
// budget, the owner's spending permission, and the SQLite ledger.
import { createCheckedAsk } from "../../packages/checked-ask/checked-ask.mjs";

const MAX_REBUYS = Number(process.env.MAX_REBUYS ?? 2);

export function createBuyer({ tg, store, budget, onPurchase = () => {}, onAsk = () => {} }) {
  const checkedAsk = createCheckedAsk({
    client: tg,
    maxRebuys: MAX_REBUYS,
    // our own track record per miner ranks re-buys; every attempt is already stored, so nothing to add here
    record: { get: (intent) => store.minerRecord(intent) },
    // spending permission is checked before every purchase, so a withdrawal stops the very next one
    canSpend: (ctx) => (ctx.mandate?.revoked ? { ok: false, why: ctx.mandate.why } : budget.canSpend(ctx.machine)),
    onAsk: (a, ctx) => onAsk({ farm: ctx.farm, machine: ctx.machine, ...a }),
    onAttempt: (rec, ctx) => {
      Object.assign(rec, { farm: ctx.farm, machine: ctx.machine });
      rec.id = store.addPurchase(rec);
      onPurchase(rec);
    },
  });

  // ctx: { farm, machine, intent, params, place, origin?, destination?, forceMinerId?, mandate?, prefer? }
  return async function buy(ctx) {
    const { accepted, attempts } = await checkedAsk({ ...ctx, firstMinerId: ctx.forceMinerId });
    return { accepted, attempts };
  };
}
