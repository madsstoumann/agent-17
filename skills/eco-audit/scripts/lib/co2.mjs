/**
 * The Sustainable Web Design model, version 4 (SWDM v4), as CO2.js 0.19 implements it, and the
 * digital carbon rating (A+ to F) on top. No dependency on CO2.js itself: the constants are
 * small, and keeping them here means the skill runs offline.
 *
 *   https://sustainablewebdesign.org/estimating-digital-emissions/
 *   https://developers.thegreenwebfoundation.org/co2js/explainer/methodologies-for-calculating-website-carbon/
 *
 * Zero dependencies. Node >= 22. Pure.
 */
import fs from 'node:fs';

const GB = 1e9; // SWDM counts decimal gigabytes
export const SWDM4 = {
  operational: { dataCenter: 0.055, network: 0.059, device: 0.080 }, // kWh/GB
  embodied: { dataCenter: 0.012, network: 0.013, device: 0.081 }, // kWh/GB
  globalGrid: 494, // gCO2e/kWh, the model's own global figure
};
// Upper bounds in grams per page view (CO2.js SWDMV4_RATINGS).
export const RATINGS = [['A+', 0.040], ['A', 0.079], ['B', 0.145], ['C', 0.209], ['D', 0.278], ['E', 0.359]];

const GRID = JSON.parse(fs.readFileSync(new URL('./grid-intensity.json', import.meta.url), 'utf8'));
export const GRID_SOURCE = GRID.source;

/** Yearly average grid intensity for an ISO 3166 alpha-3 code ("DNK"), or a 2-letter one ("DK"). null when unknown. */
export function gridIntensity(code) {
  if (!code) return null;
  const c = String(code).trim().toUpperCase();
  if (GRID.data[c] != null) return GRID.data[c];
  const a3 = ALPHA2[c];
  return a3 && GRID.data[a3] != null ? GRID.data[a3] : null;
}

// The countries an agency in Scandinavia is most likely to ask about; any alpha-3 code works.
const ALPHA2 = { DK: 'DNK', SE: 'SWE', NO: 'NOR', FI: 'FIN', IS: 'ISL', DE: 'DEU', NL: 'NLD', BE: 'BEL', FR: 'FRA', GB: 'GBR', UK: 'GBR', IE: 'IRL', ES: 'ESP', PT: 'PRT', IT: 'ITA', PL: 'POL', AT: 'AUT', CH: 'CHE', EE: 'EST', LV: 'LVA', LT: 'LTU', US: 'USA', CA: 'CAN', AU: 'AUS', JP: 'JPN', CN: 'CHN', IN: 'IND', BR: 'BRA', EU: 'EU' };

export function rating(grams) {
  for (const [r, max] of RATINGS) if (grams <= max) return r;
  return 'F';
}

/**
 * perView(bytes, { green, deviceGrid, networkGrid, dataCenterGrid }) ->
 *   { grams, rating, segments: { dataCenter, network, device }, operational, embodied, kWh }
 * One first-time page view, as CO2.js `perVisit` with its v4 defaults (no returning-visitor
 * discount). Green hosting removes the data centre's operational emissions; embodied stay.
 * Grid values are gCO2e/kWh and default to the model's global 494.
 */
export function perView(bytes, { green = false, deviceGrid, networkGrid, dataCenterGrid } = {}) {
  const gb = Math.max(0, bytes) / GB;
  const grid = { dataCenter: dataCenterGrid ?? SWDM4.globalGrid, network: networkGrid ?? SWDM4.globalGrid, device: deviceGrid ?? SWDM4.globalGrid };
  const op = {}; const emb = {}; const seg = {};
  for (const k of ['dataCenter', 'network', 'device']) {
    op[k] = gb * SWDM4.operational[k] * grid[k];
    emb[k] = gb * SWDM4.embodied[k] * SWDM4.globalGrid; // embodied emissions always use the global figure
    seg[k] = (k === 'dataCenter' && green ? 0 : op[k]) + emb[k];
  }
  const grams = seg.dataCenter + seg.network + seg.device;
  const kWh = gb * (Object.values(SWDM4.operational).reduce((a, b) => a + b, 0) + Object.values(SWDM4.embodied).reduce((a, b) => a + b, 0));
  return { grams, rating: rating(grams), segments: seg, operational: op, embodied: emb, kWh };
}

/** Grams per view: three decimals below 0.1 g, so a light page does not read as 0.00. */
export const fmtG = (g) => (g < 0.1 ? g.toFixed(3) : g.toFixed(2));

/** "0.21 g", "1.4 kg" etc. for yearly totals. */
export function formatMass(grams) {
  if (grams >= 1e6) return `${(grams / 1e6).toFixed(grams >= 1e7 ? 0 : 1)} t`;
  if (grams >= 1e3) return `${(grams / 1e3).toFixed(grams >= 1e4 ? 0 : 1)} kg`;
  return `${grams.toFixed(grams >= 10 ? 0 : 2)} g`;
}
