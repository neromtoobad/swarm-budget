// One-off: freeze the ground truth for the place-trap benchmark.
// Truth comes from OpenStreetMap (a structured city + state/country query), not from the GeoNames data
// the miner resolves with, so the benchmark does not grade the miner against its own source.
// Run: node bench/build-cases.mjs   (about one request a second, as Nominatim asks)
import { writeFileSync } from "node:fs";

const QUALIFIED = [
  // [what the buyer writes, city, state, country, the bigger namesake it gets confused with]
  ["Kerman, California", "Kerman", "California", "United States", "Kerman, Iran"],
  ["Paris, Texas", "Paris", "Texas", "United States", "Paris, France"],
  ["Cairo, Illinois", "Cairo", "Illinois", "United States", "Cairo, Egypt"],
  ["Delhi, New York", "Delhi", "New York", "United States", "Delhi, India"],
  ["Birmingham, Alabama", "Birmingham", "Alabama", "United States", "Birmingham, England"],
  ["Moscow, Idaho", "Moscow", "Idaho", "United States", "Moscow, Russia"],
  ["Rome, Georgia", "Rome", "Georgia", "United States", "Rome, Italy"],
  ["Athens, Georgia", "Athens", "Georgia", "United States", "Athens, Greece"],
  ["Dublin, Ohio", "Dublin", "Ohio", "United States", "Dublin, Ireland"],
  ["Lima, Ohio", "Lima", "Ohio", "United States", "Lima, Peru"],
  ["Naples, Florida", "Naples", "Florida", "United States", "Naples, Italy"],
  ["Melbourne, Florida", "Melbourne", "Florida", "United States", "Melbourne, Australia"],
  ["Manchester, New Hampshire", "Manchester", "New Hampshire", "United States", "Manchester, England"],
  ["Toledo, Ohio", "Toledo", "Ohio", "United States", "Toledo, Spain"],
  ["Odessa, Texas", "Odessa", "Texas", "United States", "Odesa, Ukraine"],
  ["St. Petersburg, Florida", "St. Petersburg", "Florida", "United States", "Saint Petersburg, Russia"],
  ["Vienna, Virginia", "Vienna", "Virginia", "United States", "Vienna, Austria"],
  ["Geneva, New York", "Geneva", "New York", "United States", "Geneva, Switzerland"],
  ["Berlin, New Hampshire", "Berlin", "New Hampshire", "United States", "Berlin, Germany"],
  ["Florence, South Carolina", "Florence", "South Carolina", "United States", "Florence, Italy"],
  ["Venice, Florida", "Venice", "Florida", "United States", "Venice, Italy"],
  ["Cambridge, Massachusetts", "Cambridge", "Massachusetts", "United States", "Cambridge, England"],
  ["Oxford, Mississippi", "Oxford", "Mississippi", "United States", "Oxford, England"],
  ["Bristol, Tennessee", "Bristol", "Tennessee", "United States", "Bristol, England"],
  ["Alexandria, Virginia", "Alexandria", "Virginia", "United States", "Alexandria, Egypt"],
  ["Lebanon, New Hampshire", "Lebanon", "New Hampshire", "United States", "Lebanon (country)"],
  ["Peru, Indiana", "Peru", "Indiana", "United States", "Peru (country)"],
  ["Mexico, Missouri", "Mexico", "Missouri", "United States", "Mexico (country)"],
  ["Warsaw, Indiana", "Warsaw", "Indiana", "United States", "Warsaw, Poland"],
  ["Amsterdam, New York", "Amsterdam", "New York", "United States", "Amsterdam, Netherlands"],
  ["London, Ontario", "London", "Ontario", "Canada", "London, England"],
  ["Sydney, Nova Scotia", "Sydney", "Nova Scotia", "Canada", "Sydney, Australia"],
  ["Kingston, Ontario", "Kingston", "Ontario", "Canada", "Kingston, Jamaica"],
  ["Perth, Scotland", "Perth", "Scotland", "United Kingdom", "Perth, Australia"],
  ["Hyderabad, Pakistan", "Hyderabad", "", "Pakistan", "Hyderabad, India"],
  ["Tripoli, Lebanon", "Tripoli", "", "Lebanon", "Tripoli, Libya"],
  ["Valencia, Venezuela", "Valencia", "", "Venezuela", "Valencia, Spain"],
  ["Cordoba, Argentina", "Córdoba", "", "Argentina", "Córdoba, Spain"],
  ["San Jose, Costa Rica", "San José", "", "Costa Rica", "San Jose, California"],
  ["Santiago, Dominican Republic", "Santiago de los Caballeros", "", "Dominican Republic", "Santiago, Chile"],
  ["Newcastle, Australia", "Newcastle", "New South Wales", "Australia", "Newcastle upon Tyne, England"],
  ["Hamilton, New Zealand", "Hamilton", "", "New Zealand", "Hamilton, Ontario"],
  ["Georgetown, Guyana", "Georgetown", "", "Guyana", "George Town, Malaysia"],
  ["La Paz, Mexico", "La Paz", "Baja California Sur", "Mexico", "La Paz, Bolivia"],
  ["Barcelona, Venezuela", "Barcelona", "", "Venezuela", "Barcelona, Spain"],
  ["Granada, Nicaragua", "Granada", "", "Nicaragua", "Granada, Spain"],
  ["Merida, Venezuela", "Mérida", "", "Venezuela", "Mérida, Mexico"],
  ["Cartagena, Spain", "Cartagena", "", "Spain", "Cartagena, Colombia"],
];
const NOT_REAL = [
  ["Xyzzyville", "no such town anywhere"],
  ["Qwertyburg, Ohio", "no such town anywhere"],
  ["Tokyo, France", "there is no Tokyo in France"],
  ["Chennai, Brazil", "there is no Chennai in Brazil"],
  ["Nairobi, Canada", "there is no Nairobi in Canada"],
  ["Reykjavik, Australia", "there is no Reykjavik in Australia"],
  ["Karachi, Germany", "there is no Karachi in Germany"],
  ["Lagos, Japan", "there is no Lagos in Japan"],
];
const POINTS = [
  ["36.7236,-120.0599", 36.7236, -120.0599, "a field near Kerman, California"],
  ["-33.8688,151.2093", -33.8688, 151.2093, "central Sydney, Australia"],
  ["64.1466,-21.9426", 64.1466, -21.9426, "Reykjavik, Iceland"],
  ["6.5244,3.3792", 6.5244, 3.3792, "Lagos, Nigeria"],
  ["-0.1807,-78.4678", -0.1807, -78.4678, "Quito, Ecuador"],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cases = [];
for (const [ask, city, state, country, trap] of QUALIFIED) {
  const qs = new URLSearchParams({ city, country, format: "jsonv2", limit: "1", "accept-language": "en" });
  if (state) qs.set("state", state);
  const url = `https://nominatim.openstreetmap.org/search?${qs}`;
  const res = await fetch(url, { headers: { "User-Agent": "pinpoint-weather-miner benchmark (+https://github.com/neromtoobad/swarm-budget)" } });
  const rows = await res.json();
  if (!rows.length) {
    console.error("NO TRUTH FOR", ask);
  } else {
    cases.push({ kind: "namesake", ask, truth: { lat: Number(Number(rows[0].lat).toFixed(4)), lon: Number(Number(rows[0].lon).toFixed(4)), label: rows[0].display_name, source: url }, confused_with: trap });
    console.log(ask, "->", rows[0].lat, rows[0].lon, rows[0].display_name.slice(0, 70));
  }
  await sleep(1100);
}
for (const [ask, why] of NOT_REAL) cases.push({ kind: "not_real", ask, why });
for (const [ask, lat, lon, label] of POINTS) cases.push({ kind: "point", ask, truth: { lat, lon, label } });
writeFileSync(new URL("./place-trap-cases.json", import.meta.url), JSON.stringify({ frozen_on: new Date().toISOString().slice(0, 10), truth_source: "OpenStreetMap Nominatim structured search (city + state + country)", cases }, null, 1));
console.log(cases.length, "cases written");
