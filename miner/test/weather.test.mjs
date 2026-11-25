import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assess, bandScore, levelOf, conditionOver, BANDS } from "../src/risk.mjs";
import { readWindowHours, readDate, wettest, isStormAlert, RequestError } from "../src/weather.mjs";

test("risk bands: each factor maps onto the same four grades", () => {
  assert.equal(bandScore(0, BANDS.gust_kmh), 0);
  assert.equal(bandScore(40, BANDS.gust_kmh), 0.25);
  assert.equal(bandScore(62, BANDS.gust_kmh), 0.5);
  assert.equal(bandScore(89, BANDS.gust_kmh), 0.75);
  assert.equal(bandScore(300, BANDS.gust_kmh), 1);
  assert.equal(bandScore(null, BANDS.gust_kmh), null);
  assert.equal(levelOf(0.249), "LOW");
  assert.equal(levelOf(0.25), "MODERATE");
  assert.equal(levelOf(0.5), "HIGH");
  assert.equal(levelOf(0.75), "SEVERE");
});

test("the grade is the worst factor, and every factor is shown", () => {
  const calm = assess({ peakGust: 14.8, precip24h: 0, precip1h: 0, snow24h: 0, thunderCodes: [], alerts: [] });
  assert.equal(calm.risk_level, "LOW");
  assert.ok(calm.risk_score < 0.1);
  const gale = assess({ peakGust: 70, precip24h: 2, precip1h: 1, snow24h: 0, thunderCodes: [], alerts: [] });
  assert.equal(gale.risk_level, "HIGH");
  assert.equal(gale.drivers[0].factor, "peak wind gust");
  const wet = assess({ peakGust: 20, precip24h: 95, precip1h: 12, snow24h: 0, thunderCodes: [], alerts: [] });
  assert.equal(wet.risk_level, "SEVERE");
  assert.equal(wet.drivers[0].factor, "wettest 24 hours");
});

test("a thunderstorm or an official warning raises a calm-looking forecast", () => {
  assert.equal(assess({ peakGust: 10, precip24h: 1, precip1h: 1, thunderCodes: [95], alerts: [] }).risk_level, "MODERATE");
  assert.equal(assess({ peakGust: 10, precip24h: 1, precip1h: 1, thunderCodes: [96], alerts: [] }).risk_level, "HIGH");
  const warned = assess({ peakGust: 10, precip24h: 1, precip1h: 1, thunderCodes: [], alerts: [{ event: "Hurricane Warning", severity: "Extreme" }] });
  assert.equal(warned.risk_level, "SEVERE");
  assert.match(warned.drivers[0].factor, /Hurricane Warning/);
});

test("no data is not a calm day: missing gusts never score zero", () => {
  const r = assess({ peakGust: null, precip24h: null, precip1h: null, snow24h: null, thunderCodes: [], alerts: [] });
  assert.equal(r.risk_score, null);
  assert.equal(r.risk_level, null);
});

test("a real forecast (Miami, 25 Nov 2026) grades HIGH on gusts and rain", () => {
  const h = JSON.parse(readFileSync(new URL("./fixtures/forecast-miami-2026-11-25.json", import.meta.url), "utf8")).hourly;
  const gust = h.wind_gusts_10m_best_match.slice(1);
  const rain = h.precipitation_best_match.slice(1);
  const r = assess({ peakGust: Math.max(...gust), precip24h: wettest(rain, 24), precip1h: Math.max(...rain), snow24h: 0, thunderCodes: [], alerts: [] });
  assert.ok(["HIGH", "SEVERE"].includes(r.risk_level), `got ${r.risk_level}`);
  assert.ok(Math.max(...gust) > 40);
});

test("wettest 24 hours is a rolling window, not the first 24", () => {
  const dry = Array(24).fill(0);
  const wet = Array(24).fill(2);
  assert.equal(wettest([...dry, ...wet], 24), 48);
  assert.equal(wettest([1, 2, 3], 24), 6);
  assert.equal(wettest([null, null], 24), null);
  assert.equal(wettest([...Array(12).fill(0), ...Array(24).fill(1), ...Array(12).fill(0)], 24), 24);
});

test("window: the number wins, then the question, then 24 hours; out of range is refused", () => {
  assert.equal(readWindowHours("6"), 6);
  assert.equal(readWindowHours(undefined, "storm risk in Chennai in the next 48 hours?"), 48);
  assert.equal(readWindowHours(undefined, "any storms in Miami over the next 3 days"), 72);
  assert.equal(readWindowHours(undefined, "will it storm tonight"), 12);
  assert.equal(readWindowHours(undefined, "storm risk in Miami?"), 24);
  assert.throws(() => readWindowHours(0), (e) => e instanceof RequestError && e.code === "window_out_of_range");
  assert.throws(() => readWindowHours(500), (e) => e.code === "window_out_of_range");
});

test("dates: ISO and written-out dates are read; ambiguous or impossible ones are refused", () => {
  assert.equal(readDate("2026-11-15"), "2026-11-15");
  assert.equal(readDate(undefined, "London's high on 10 September 2026 was forecast at 21°C"), "2026-09-10");
  assert.equal(readDate(undefined, "Did it rain in St. Louis on November 3, 2026?"), "2026-11-03");
  assert.equal(readDate("yesterday", undefined, "2026-11-25"), "2026-11-24");
  assert.throws(() => readDate("03/04/2026"), (e) => e.code === "missing_date", "day/month order is never guessed");
  assert.throws(() => readDate("2026-02-30"), (e) => e.code === "bad_date");
  assert.throws(() => readDate("1890-01-01"), (e) => e.code === "date_out_of_range");
  assert.throws(() => readDate(undefined, undefined), (e) => e.code === "missing_date");
});

test("conditions: what the sky mostly does, plus the worst thing that happens", () => {
  assert.equal(conditionOver([0, 0, 0, 1]), "Clear sky");
  assert.equal(conditionOver([3, 3, 3, 3, 61]), "Overcast, with light rain at times");
  assert.equal(conditionOver([95, 95, 95, 3]), "Thunderstorm");
  assert.equal(conditionOver([]), null);
});

test("only storm alerts raise a storm grade: a Freeze Warning is listed, not scored", () => {
  for (const e of ["Tornado Warning", "Severe Thunderstorm Watch", "High Wind Warning", "Wind Advisory", "Flash Flood Warning", "Flood Watch", "Winter Storm Warning", "Blizzard Warning", "Hurricane Warning", "Tropical Storm Watch", "Storm Surge Warning", "Dust Storm Warning", "Coastal Flood Statement"]) assert.ok(isStormAlert(e), e);
  for (const e of ["Freeze Warning", "Frost Advisory", "Heat Advisory", "Dense Fog Advisory", "Air Quality Alert", "Red Flag Warning", "Wind Chill Advisory", "Rip Current Statement", "Small Craft Advisory"]) assert.ok(!isStormAlert(e), e);
});
