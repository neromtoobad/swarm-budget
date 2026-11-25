// The three rule-based judges from check/compare.mjs, run on the scorer's final-test pairs, by kind of
// worse answer, so the trained scorer can be read against them.
//   node adapter/baselines.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { checkForecast } from "../check/rules.mjs";

const here = (p) => new URL(p, import.meta.url);
const lines = (p) => readFileSync(here(p), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const rows = lines("./heldout-test.jsonl");
const meta = lines("./heldout-test.meta.jsonl");
const formOnly = (res) => {
  const c = res.checks.filter((x) => x.name === "complete" || x.name === "in_range");
  return c.filter((x) => x.pass).length / c.length;
};
const by = {};
const add = (kind, judge, v) => {
  for (const k of [kind, "all"]) {
    const o = ((by[k] ??= {})[judge] ??= { won: 0, tied: 0, pairs: 0 });
    o.pairs++;
    if (v === 1) o.won++;
    if (v === 0.5) o.tied++;
  }
};
for (const [i, row] of rows.entries()) {
  const [good, bad] = await Promise.all([checkForecast(row.prompt, row.chosen), checkForecast(row.prompt, row.rejected)]);
  const cmp = (a, b) => (a === b ? 0.5 : a > b ? 1 : 0);
  add(meta[i].kind, "longer_answer", cmp(row.chosen.length, row.rejected.length));
  add(meta[i].kind, "well_formed_only", cmp(formOnly(good), formOnly(bad)));
  add(meta[i].kind, "rule_checker", cmp(good.score, bad.score));
}
// Strict wins only, the node's rule: a tie is not a win.
const out = Object.fromEntries(Object.entries(by).map(([k, j]) => [k, Object.fromEntries(Object.entries(j).map(([name, o]) => [name, { pairs: o.pairs, won: o.won, tied: o.tied, win_rate: Number((o.won / o.pairs).toFixed(4)) }]))]));
mkdirSync(here("./results/"), { recursive: true });
writeFileSync(here("./results/baselines-heldout-test.json"), JSON.stringify({ data: "adapter/heldout-test.jsonl", win_rule: "better answer scored strictly above the worse one; ties are not wins", by_kind: out }, null, 1));
console.table(Object.fromEntries(Object.entries(out).map(([k, j]) => [k, { pairs: j.longer_answer.pairs, "longer answer": j.longer_answer.win_rate, "well-formed only": j.well_formed_only.win_rate, "rule checker": j.rule_checker.win_rate }])));
