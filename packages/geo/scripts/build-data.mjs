// Builds dist/cities.tsv from the GeoNames-based `all-the-cities` package
// (places with population >= 1000; data © GeoNames, CC BY 4.0).
// Columns: geonameId, name, countryCode, population, lat, lon
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const cities = require('all-the-cities');

// Skip sections of cities, historical/abandoned/destroyed places and other
// non-city settlements, so photos snap to real towns and cities.
const SKIP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLF', 'PPLR', 'PPLS', 'PPLCH']);

const clean = (s) => String(s).replace(/[\t\r\n]+/g, ' ').trim();
const lines = [];
for (const c of cities) {
  if (SKIP.has(c.featureCode)) continue;
  const [lon, lat] = c.loc.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !c.name) continue;
  lines.push([c.cityId, clean(c.name), c.country, c.population || 0, lat.toFixed(5), lon.toFixed(5)].join('\t'));
}
mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/cities.tsv', import.meta.url), lines.join('\n') + '\n');
console.log(`cities.tsv: ${lines.length} places`);
