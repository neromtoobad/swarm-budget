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

test("questions with no lead word, a date after the place, or a state code that is also a country code", () => {
  const cases = {
    "How windy and how wet will Berlin, New Jersey be within the next 2 days? Grade the storm risk as LOW, MODERATE, HIGH or SEVERE.": "Berlin, New Jersey",
    "Will Rio de Janeiro see gale-force gusts or flooding rain in the next 3 days?": "Rio de Janeiro",
    "Recorded conditions in Hamilton, Ohio for 20 August 2026, please: high, low, rainfall.": "Hamilton, Ohio",
    "Recorded conditions in Gloucester City, New Jersey, USA for September 16, 2026, please: high, low, rainfall.": "Gloucester City, New Jersey, USA",
    "Recorded conditions in Sandy, Oregon for 2026-10-22, please: high, low, rainfall.": "Sandy, Oregon",
    "A crop-spraying drone is scheduled near Trinidad, CO. How strong will gusts get in the next 5 days?": "Trinidad, CO",
    "Should outdoor work in Auburn, New South Wales be postponed because of wind or heavy rain during the next 120 hours?": "Auburn, New South Wales",
    "Santa Cruz, Bolivia: forecast high and low temperature and the likelihood of precipitation within the next 72 hours.": "Santa Cruz, Bolivia",
    "We have a roofing job booked. For El Paso, Spain: forecast high and low temperature within the next 12 hours. No commentary, just the values.": "El Paso, Spain",
    "School sports day is planned. A forecast said Rochester, New York would reach 29 °C on 2026-08-26. What was actually recorded? Answer for that exact town.": "Rochester, New York",
    "Fleet control here. Will gale-force gusts or flooding rain hit Trenton, Ohio in the next 48 hours?": "Trenton, Ohio",
    "Our crane crew needs a go or no-go. How windy will Leeds be tonight?": "Leeds",
    "Site safety briefing. An irrigation rover near Ramnagar, India must decide whether to stay out.": "Ramnagar, India",
    "Should outdoor work in Marion, IN be postponed because of wind or heavy rain during the next 48 hours?": "Marion, IN",
    "Is it stormy in Portland, OR right now?": "Portland, OR",
    "Forecast for London, ON for the next 24 hours.": "London, ON",
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(placeFromQuestion(q), want, q);
});

test("Town, CO means Colorado when a town of that name is there, not Colombia", () => {
  const trinidad = [
    { name: "Trinidad", admin1: "Colorado", country: "United States", country_code: "US", lat: 37.1695, lon: -104.5005, population: 8211, feature_code: "PPLA2" },
    { name: "Trinidad", admin1: "Casanare", country: "Colombia", country_code: "CO", lat: 5.4089, lon: -71.6622, population: 6599, feature_code: "PPL" },
    { name: "Trinidad", admin1: "Sancti Spíritus Province", country: "Cuba", country_code: "CU", lat: 21.7996, lon: -79.9835, population: 60206, feature_code: "PPL" },
  ];
  assert.equal(choose("Trinidad", ["CO"], trinidad).admin1, "Colorado");
  assert.equal(choose("Trinidad", ["Colombia"], trinidad).country_code, "CO");
  assert.equal(choose("Trinidad", ["Cuba"], trinidad).country_code, "CU");
});
