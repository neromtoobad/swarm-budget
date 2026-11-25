// How well do different judges tell the better answer from the worse one in each pack?
//
//   node check/compare.mjs            every pack, all rows and the held-out rows
//
// Judges:
//   longer answer     "the longer answer is better" (what a lazy scorer learns first)
//   well-formed only  are the fields there and in range? This is what a schema validator sees. It cannot
//                     tell Paris, Texas from Paris, France: both answers are perfectly formed.
//   rule checker      check/rules.mjs: place, time, completeness, range, consistency, topic
//
// A judge wins a pair when it scores the better answer strictly above the worse one, the same rule the
// node uses when it competes Evaluator adapters. A tie counts as half a win here, and is also shown.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { CHECKERS, readAnswer } from "./rules.mjs";

const here = (p) => new URL(p, import.meta.url);
const lines = (p) => readFileSync(here(p), "utf8").trim().split("\n").map((l) => JSON.parse(l));

// Completeness and range only, taken from the full checker's own results.
const formOnly = (res) => {
  const c = res.checks.filter((x) => x.name === "complete" || x.name === "in_range");
  return c.filter((x) => x.pass).length / c.length;
};

const report = { run_at: new Date().toISOString(), win_rule: "better answer scored strictly above the worse one; a tie counts 0.5", packs: {} };
for (const file of readdirSync(here("../packs/")).filter((f) => f.endsWith(".jsonl") && !f.includes(".meta."))) {
  const intent = file.replace(".jsonl", "");
  const check = CHECKERS[intent];
  if (!check) continue;
  const rows = lines(`../packs/${file}`);
  const meta = lines(`../packs/${intent}.meta.jsonl`);
  const judged = [];
  for (const [i, row] of rows.entries()) {
    const [good, bad] = await Promise.all([check(row.prompt, row.chosen), check(row.prompt, row.rejected)]);
    judged.push({
      line: i + 1,
      kind: meta[i].kind,
      split: meta[i].split,
      real: Boolean(meta[i].real_traffic),
      longer: row.chosen.length === row.rejected.length ? 0.5 : row.chosen.length > row.rejected.length ? 1 : 0,
      form: formOnly(good) === formOnly(bad) ? 0.5 : formOnly(good) > formOnly(bad) ? 1 : 0,
      rules: good.score === bad.score ? 0.5 : good.score > bad.score ? 1 : 0,
      chosen_score: good.score,
      rejected_score: bad.score,
      rejected_failed: bad.failed,
      chosen_failed: good.failed,
    });
  }
  const rate = (arr, k) => (arr.length ? Number((arr.reduce((a, x) => a + x[k], 0) / arr.length).toFixed(3)) : null);
  const table = (arr) => {
    const kinds = [...new Set(arr.map((x) => x.kind))];
    return Object.fromEntries([["all", arr], ...kinds.map((k) => [k, arr.filter((x) => x.kind === k)])].map(([k, a]) => [k, { pairs: a.length, longer_answer: rate(a, "longer"), well_formed_only: rate(a, "form"), rule_checker: rate(a, "rules") }]));
  };
  const held = judged.filter((x) => x.split === "heldout");
  const misses = judged.filter((x) => x.rules < 1).map((x) => ({ line: x.line, kind: x.kind, chosen_score: x.chosen_score, rejected_score: x.rejected_score, chosen_failed: x.chosen_failed, rejected_failed: x.rejected_failed }));
  report.packs[intent] = { rows: rows.length, held_out_rows: held.length, real_traffic_rows: judged.filter((x) => x.real).length, all_rows: table(judged), held_out: table(held), rule_checker_misses: misses };
  console.log(`\n${intent}: ${rows.length} rows (${held.length} held out)`);
  console.table(Object.fromEntries(Object.entries(table(judged)).map(([k, v]) => [k, { pairs: v.pairs, "longer answer": v.longer_answer, "well-formed only": v.well_formed_only, "rule checker": v.rule_checker }])));
  if (misses.length) console.log(`rule checker did not win ${misses.length} pair(s):`, JSON.stringify(misses.slice(0, 6), null, 0).slice(0, 1200));
}
writeFileSync(here(`../results/compare-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(report, null, 1));
