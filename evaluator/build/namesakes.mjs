// Step 1: find real towns that share a name with a bigger place somewhere else.
// For each seed name, ask the public GeoNames geocoder for every place with exactly that name, keep the
// ones with at least 2,000 people, and pair each smaller one with the largest ("the trap").
// Output: data/namesakes.json, frozen, so the packs can be rebuilt without the geocoder changing them.
//   node build/namesakes.mjs
import { writeFileSync } from "node:fs";
import { nameKey, km, canonical, label, US_STATES } from "../../miner/src/places.mjs";

const SEEDS = `Paris London Rome Athens Berlin Moscow Cairo Delhi Dublin Lima Naples Melbourne Manchester Toledo Odessa Vienna Geneva
Florence Venice Cambridge Oxford Bristol Alexandria Lebanon Peru Mexico Warsaw Amsterdam Sydney Kingston Perth Hyderabad Tripoli
Valencia Cordoba Santiago Newcastle Hamilton Georgetown Barcelona Granada Merida Cartagena Kerman Birmingham Portland Richmond
Columbus Jackson Salem Madison Franklin Clinton Arlington Aurora Lancaster Lincoln Newport Plymouth Windsor York Durham Glasgow
Aberdeen Belfast Canton Troy Sparta Corinth Carthage Memphis Syracuse Ithaca Utica Rochester Dover Boston Worcester Gloucester
Chester Halifax Wellington Havana Lagos Victoria Trinidad Concord Columbia Bethlehem Jericho Nazareth Hebron Damascus Palestine
Milan Verona Genoa Parma Palermo Turin Stockholm Hanover Hamburg Bremen Frankfort Heidelberg Dresden Stuttgart Zurich Lucerne
Bern Orleans Versailles Calais Madrid Seville Lisbon Brazil Cuba Panama Holland Poland Norway Sweden Denmark Scotland
Bangor Brighton Cleveland Sheffield Lexington Norfolk Suffolk Reading Stratford Stirling Inverness Dundee Hastings Exeter Derby
Lancaster Marlborough Nelson Napier Blenheim Waterloo Wellington Ontario Monroe Marion Greenville Fairfield Auburn Burlington
Dayton Decatur Fayetteville Jacksonville Kingsport Marietta Mansfield Newark Oakland Pasadena Quincy Riverside Salisbury Trenton
Vernon Wilmington Winchester Albany Athens Augusta Bedford Bloomington Bowling Carlisle Charleston Charlotte Cumberland Danville
Douglas Eureka Farmington Florence Gainesville Glendale Hudson Kent Lafayette Lakewood Laredo Medina Milford Monterrey Montevideo
Naples Orange Oxford Princeton Roseville Sandy Santa\\ Cruz Santa\\ Fe San\\ Juan San\\ Fernando San\\ Miguel San\\ Pedro San\\ Carlos
San\\ Luis Santa\\ Rosa Santa\\ Maria Santa\\ Ana La\\ Paz La\\ Union El\\ Paso Los\\ Angeles St.\\ Petersburg Fort\\ William
Saint\\ John Santo\\ Domingo Puerto\\ Rico Buena\\ Vista Bella\\ Vista Rio\\ Grande Alta\\ Vista Tripoli Batavia Bandung Goa Kandy
Kochi Salem Hyderabad Aurangabad Bilaspur Udaipur Ramnagar Fatehpur Rampur Sultanpur Islamabad Nagar Faisalabad Kota Suzhou Taizhou
Fuzhou Yulin Jining Yichun Suining Changzhi Leon Guadalupe Victoria Trujillo Toledo Guadalajara Cordoba Merida Valencia Linares
Santa\\ Barbara San\\ Jose San\\ Francisco San\\ Antonio San\\ Diego`.replace(/\\\n/g, " ").split(/(?<!\\)\s+/).map((s) => s.replace(/\\ /g, " ").replace(/\\/g, "").trim()).filter(Boolean);

const names = [...new Set(SEEDS)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stateCode = Object.fromEntries(Object.entries(US_STATES).map(([k, v]) => [v, k]));
const cases = [];
const majors = [];
for (const name of names) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=40&language=en&format=json`;
  let data;
  try {
    data = await (await fetch(url)).json();
  } catch {
    console.error("skip", name);
    continue;
  }
  const all = (data.results ?? [])
    .filter((r) => nameKey(r.name) === nameKey(name) && (r.population ?? 0) >= 2000 && /^PPL/.test(r.feature_code ?? ""))
    .map((r) => ({ name: r.name, admin1: r.admin1 ?? null, country: r.country, country_code: r.country_code, lat: r.latitude ?? 0, lon: r.longitude ?? 0, population: r.population, timezone: r.timezone }))
    .sort((a, b) => b.population - a.population);
  if (!all.length) continue;
  const top = all[0];
  majors.push({ ask: top.country_code === "US" && top.admin1 ? `${top.name}, ${top.admin1}` : `${top.name}, ${top.country}`, place: { ...top, location: canonical(top) } });
  let taken = 0;
  for (const c of all.slice(1)) {
    if (taken >= 3) break;
    if (km(c, top) < 300) continue; // a suburb or the same metro area is not a different place
    // The words the buyer would add to mean this one. It must single it out among the namesakes.
    const byRegion = c.admin1 && all.filter((o) => o.admin1 === c.admin1 && o.country_code === c.country_code).length === 1;
    const byCountry = all.filter((o) => o.country_code === c.country_code).length === 1;
    let ask = null;
    if (["US", "CA", "AU", "GB", "IN", "BR", "MX"].includes(c.country_code) ? byRegion : false) ask = `${c.name}, ${c.admin1}`;
    else if (byCountry) ask = `${c.name}, ${c.country}`;
    else if (byRegion) ask = `${c.name}, ${c.admin1}, ${c.country}`;
    if (!ask) continue;
    const variants = [ask];
    if (c.country_code === "US" && stateCode[c.admin1]) variants.push(`${c.name}, ${stateCode[c.admin1]}`, `${c.name}, ${c.admin1}, USA`);
    cases.push({ ask, ask_variants: variants, place: { ...c, location: canonical(c) }, trap: { ...top, location: canonical(top) }, apart_km: Math.round(km(c, top)) });
    taken++;
  }
  await sleep(120);
}
writeFileSync(new URL("../data/namesakes.json", import.meta.url), JSON.stringify({ frozen_on: new Date().toISOString().slice(0, 10), source: "Open-Meteo geocoding API (GeoNames), exact-name matches with population of 2,000 or more", cases, majors }, null, 1));
console.log(`${names.length} names -> ${cases.length} namesake cases, ${majors.length} largest places`);
console.log(cases.slice(0, 12).map((c) => `${c.ask}  (not ${label(c.trap)}, ${c.apart_km} km away)`).join("\n"));
