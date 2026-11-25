import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { choose, parseCoords, placeFromQuestion, readPlaceRequest, splitPlace, qualifierMatches, canonical, PlaceError, km } from "../src/places.mjs";

// Recorded answers from the Open-Meteo geocoder (GeoNames), 25 Nov 2026, so these tests run offline.
const geo = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/geocode-${name}.json`, import.meta.url), "utf8")).results.map((r) => ({ ...r, lat: r.latitude, lon: r.longitude }));
const refused = (fn, code) => assert.throws(fn, (e) => e instanceof PlaceError && e.code === code);

test("a region is never dropped: Kerman, California is the one in California", () => {
  const p = choose("Kerman", ["California"], geo("Kerman"));
  assert.equal(p.country_code, "US");
  assert.equal(p.admin1, "California");
  assert.equal(canonical(p), "Kerman, California, United States (36.7236, -120.0599)");
  assert.equal(p.matched, "name and region");
});

test("Kerman alone is the far larger Kerman in Iran, and says the California one exists", () => {
  const p = choose("Kerman", [], geo("Kerman"));
  assert.equal(p.country_code, "IR");
  assert.match(p.matched, /largest place/);
  assert.ok(p.also_matches.some((m) => m.location.startsWith("Kerman, California")));
});

test("Paris, Texas / Paris, TX / Paris, USA resolve inside the US; Paris alone is France", () => {
  assert.equal(choose("Paris", ["Texas"], geo("Paris")).admin1, "Texas");
  assert.equal(choose("Paris", ["TX"], geo("Paris")).admin1, "Texas");
  assert.equal(choose("Paris", ["Texas", "USA"], geo("Paris")).admin1, "Texas");
  assert.equal(choose("Paris", [], geo("Paris")).country_code, "FR");
  assert.equal(choose("Paris", ["France"], geo("Paris")).country_code, "FR");
});

test("a region with no such town is refused, never swapped for a namesake", () => {
  refused(() => choose("Paris", ["Kansas"], geo("Paris")), "place_not_found");
  refused(() => choose("Kerman", ["Texas"], geo("Kerman")), "place_not_found");
  try {
    choose("Paris", ["Kansas"], geo("Paris"));
  } catch (e) {
    assert.ok(e.extra.other_places_with_this_name.length > 0, "the refusal lists the places that do exist");
  }
});

test("towns of similar size with one name are refused with the candidates", () => {
  try {
    choose("Springfield", [], geo("Springfield"));
    assert.fail("should refuse");
  } catch (e) {
    assert.equal(e.code, "ambiguous_location");
    assert.equal(e.status, 422);
    assert.ok(e.extra.candidates.length >= 3);
  }
  assert.equal(choose("Springfield", ["IL"], geo("Springfield")).admin1, "Illinois");
});

test("a country is not a point", () => {
  refused(() => choose("Georgia", [], geo("Georgia")), "place_too_broad");
});

test("similar spellings are not the same place", () => {
  // The geocoder also returns Kermanshah and Kernam for "Kerman". Neither may be picked.
  const names = new Set(geo("Kerman").map((c) => c.name));
  assert.ok(names.has("Kermanshah"));
  refused(() => choose("Kermansha", [], geo("Kerman")), "place_not_found");
});

test("Cairo, Illinois and Cairo, Egypt are 10,000 km apart and both resolve correctly", () => {
  const il = choose("Cairo", ["Illinois"], geo("Cairo"));
  const eg = choose("Cairo", ["Egypt"], geo("Cairo"));
  assert.equal(il.country_code, "US");
  assert.equal(eg.country_code, "EG");
  assert.ok(km(il, eg) > 9000);
});

test("London, England / London, UK / London, Ontario", () => {
  assert.equal(choose("London", ["England"], geo("London")).country_code, "GB");
  assert.equal(choose("London", ["UK"], geo("London")).country_code, "GB");
  assert.equal(choose("London", ["Ontario"], geo("London")).country_code, "CA");
  assert.equal(choose("London", [], geo("London")).country_code, "GB");
});

test("coordinates in the common spellings", () => {
  assert.deepEqual(parseCoords("36.7236,-120.0599"), { lat: 36.7236, lon: -120.0599 });
  assert.deepEqual(parseCoords("(36.7236, -120.0599)"), { lat: 36.7236, lon: -120.0599 });
  assert.deepEqual(parseCoords("36.72N 120.06W"), { lat: 36.72, lon: -120.06 });
  assert.deepEqual(parseCoords("lat 36.72, lon -120.06"), { lat: 36.72, lon: -120.06 });
  assert.equal(parseCoords("Kerman"), null);
  assert.equal(parseCoords("95.2, 10"), null, "latitude above 90 is not a coordinate");
  assert.equal(parseCoords("29 Palms"), null);
});

test("the place is read out of a whole question", () => {
  const cases = {
    "Is there a storm risk in Paris, Texas in the next 6 hours?": "Paris, Texas",
    "What is the current air temperature in Karachi, in degrees Celsius?": "Karachi",
    "London's high on 10 September 2026 was forecast at 21°C - did it verify?": "London",
    "Will gusts exceed 60 km/h in Miami tonight?": "Miami",
    "Will Chicago see storms tonight?": "Chicago",
    "Yesterday's forecast called for 12 mm of rain in Lisbon: how much fell, and did it verify?": "Lisbon",
    "Should the spray drone near Kerman, California, USA fly in the next 6 hours?": "Kerman, California, USA",
    "Did it rain in St. Louis, Missouri on November 3, 2026?": "St. Louis, Missouri",
    "Forecast high in Washington, D.C. tomorrow": "Washington, D.C.",
    "Storm risk in Port-au-Prince. Reply in JSON.": "Port-au-Prince",
    "Storm outlook for The Hague over the next 72 hours": "The Hague",
    "How windy will it be in Frankfurt am Main during the next 12 hours": "Frankfurt am Main",
    "How much rain fell at 36.7236, -120.0599 on 2026-11-15?": "36.7236, -120.0599",
    "weather in paris, texas tomorrow": "paris, texas",
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(placeFromQuestion(q), want, q);
});

test("the location field wins; a question inside it is still understood", () => {
  assert.deepEqual(readPlaceRequest({ location: "Kerman, California", question: "Is there a storm in Paris?" }), { text: "Kerman, California", from: "location" });
  assert.equal(readPlaceRequest({ location: "Is it stormy in Delhi, New York?" }).text, "Delhi, New York");
  assert.deepEqual(readPlaceRequest({ location: "36.7236,-120.0599" }).coords, { lat: 36.7236, lon: -120.0599 });
  assert.equal(readPlaceRequest({ question: "Storm risk in Chennai in the next 48 hours?" }).text, "Chennai");
  assert.equal(readPlaceRequest({}), null);
});

test("splitting a place into name and qualifiers", () => {
  assert.deepEqual(splitPlace("Kerman, California, USA"), { name: "Kerman", qualifiers: ["California", "USA"] });
  assert.deepEqual(splitPlace("Austin TX"), { name: "Austin", qualifiers: ["TX"] });
  assert.deepEqual(splitPlace("New York"), { name: "New York", qualifiers: [] });
  assert.deepEqual(splitPlace("Los Angeles"), { name: "Los Angeles", qualifiers: [] });
});

test("qualifiers: state codes, country names and aliases, but no loose matches", () => {
  const kerman = { admin1: "California", admin2: "Fresno", country: "United States", country_code: "US" };
  for (const q of ["California", "CA", "USA", "US", "United States", "Fresno County", "america"]) assert.ok(qualifierMatches(q, kerman), q);
  for (const q of ["Texas", "Iran", "IR", "Canada", "TX"]) assert.ok(!qualifierMatches(q, kerman), q);
  const wv = { admin1: "West Virginia", country: "United States", country_code: "US" };
  assert.ok(!qualifierMatches("Virginia", wv), "Virginia is not West Virginia");
  const nl = { admin1: "Newfoundland and Labrador", country: "Canada", country_code: "CA" };
  assert.ok(qualifierMatches("Newfoundland", nl));
  assert.ok(qualifierMatches("England", { admin1: "England", country: "United Kingdom", country_code: "GB" }));
});
