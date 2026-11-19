import { test } from "node:test";
import assert from "node:assert/strict";
import { readImagery } from "../server/src/fleet.mjs";

test("cloud-covered imagery is inconclusive even when it repeats the question", () => {
  // Real answer from the PREFLIGHT miner for Kerman, CA on 2026-11-18.
  const sat = {
    findings: ["Dense white cloud cover obscures the entire area", "No land features or fields are visible due to clouds"],
    summary: "The satellite image is completely obscured by a thick layer of dense white clouds covering the entire region. Consequently, it is impossible to observe the fields below to determine if there is standing water or flooding.",
  };
  assert.equal(readImagery(sat), "inconclusive");
});

test("clear imagery with water is wet, without is dry", () => {
  assert.equal(readImagery({ summary: "Imagery shows standing water across the eastern fields." }), "wet");
  assert.equal(readImagery({ summary: "Fields are bare soil; no standing water or flooding." }), "dry");
});
