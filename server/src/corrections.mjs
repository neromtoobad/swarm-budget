// Decisions later found wrong. History is never rewritten: the decision stays as it was made,
// and the page shows the correction next to it. Matched by farm + time, so it holds across database ids.
const CORRECTIONS = [
  {
    farm: "kerman-ca",
    at: "2026-11-25T05:14:17.888Z",
    note: "Correction: this verdict was wrong. The drone held and did not spray. The guard accepted it because it only checked that a verdict was present. Since Nov 25 it also refuses a verdict whose reason contradicts what the machine did (packages/checked-ask/guard.mjs, TASK_EXECUTION_QUALITY_GENERAL).",
  },
];

export function annotate(decisions) {
  return decisions.map((d) => {
    const c = CORRECTIONS.find((x) => x.farm === d.farm && x.at === d.at);
    return c ? { ...d, correction: c.note } : d;
  });
}
