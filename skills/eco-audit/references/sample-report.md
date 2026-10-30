# Eco audit — browser.style

**Site:** https://browser.style/ · **Date:** 2026-10-30 · **Tool:** eco-audit 1.0.0

**Result:** 0 fail, 1 warn, 11 pass, 2 info, 0 skipped · start page 0.003 g CO2e per view (rating A+), 24 kB · median of 2 pages 0.003 g (A+), 21 kB

**Method:** Sustainable Web Design model v4 (as CO2.js 0.19), global grid intensity 494 g/kWh, green hosting counted for the data centre; bytes from a first visit with an empty cache in headless Chrome, desktop viewport 1366×900.

## Notes

Demo site; heavy pages are expected.

## Since last run

Compared with `~/Downloads/eco-audit/browser.style/last-report.json` (2026-10-30).

Start page: 0.003 g → 0.003 g CO2e per view, 23 kB → 24 kB. Median: 0.003 g → 0.003 g.

No check changed status.

## Pages

| Page | Weight | CO2e / view | Rating | Images | Video | JS | Fonts | CSS | Third party | Requests |
|---|---|---|---|---|---|---|---|---|---|---|
| browser.style | 24 kB | 0.003 g | A+ | 1 kB | 0 kB | 17 kB | 0 kB | 2 kB | 0% | 7 |
| /ui/ | 18 kB | 0.002 g | A+ | 0 kB | 0 kB | 0 kB | 0 kB | 12 kB | 0% | 11 |

Ratings follow the Sustainable Web Design digital carbon rating: A+ up to 0.040 g, A 0.079, B 0.145, C 0.209, D 0.278, E 0.359, F above.

## Fix list

| # | Status | Check | Finding |
|---|---|---|---|
| 1 | ⚠️ Warn | Browser caching | 11 of 11 own CSS, JS, image and font files are cached for less than a day |

## 1. Carbon and page weight

| Status | Check | Evidence |
|---|---|---|
| ℹ️ Info | Loaded only after scrolling | nothing more loads on scroll |
| ✅ Pass | Carbon rating | start page 0.003 g CO2e per view (A+); median of 2 pages 0.003 g (A+), green hosting counted |
| ✅ Pass | Page weight | start page 24 kB, median 21 kB transferred on first load |

## 2. Images and video

| Status | Check | Evidence |
|---|---|---|
| ✅ Pass | Image weight | median 0 kB of images per page; 0 images over 200 kB |
| ✅ Pass | Modern image formats | every image over 30 kB is AVIF, WebP or SVG |
| ✅ Pass | Oversized images | images are served close to the size they are shown at |
| ✅ Pass | Lazy loading | images below the first screen wait for the visitor |
| ✅ Pass | Video and audio on load | no video or audio loads with the page |

## 3. Fonts, scripts and third parties

| Status | Check | Evidence |
|---|---|---|
| ℹ️ Info | Third parties | 0% of the bytes come from 0 other hosts (median) |
| ✅ Pass | JavaScript | median 9 kB of JavaScript per page on the wire, 2 files in all |
| ✅ Pass | Web fonts | no web fonts |

## 4. Delivery and hosting

| Status | Check | Evidence |
|---|---|---|
| ⚠️ Warn | Browser caching | 11 of 11 own CSS, JS, image and font files are cached for less than a day |
| ✅ Pass | Text compression | HTML, CSS, JS, JSON and SVG are compressed |
| ✅ Pass | Green hosting | browser.style is on verified green hosting (Cloudflare) |

### Browser caching

**Fix:** Fingerprinted files (name contains a hash) can be cached a year: "Cache-Control: public, max-age=31536000, immutable". Every repeat view then skips them.

- `https://browser.style/ui/base/core.css` — max-age=1800
- `https://browser.style/cdn-cgi/challenge-platform/h/g/scripts/jsd/c787ce48cf6b/main.js?ray=a529f0d2ac72cd88` — max-age=14400, stale-if-error=10800, stale-while-revalidate=10800, public
- `https://browser.style/favicon.ico` — max-age=1800
- `https://browser.style/ui/base/index.css` — max-age=1800
- `https://browser.style/ui/grid/ui-grid.css` — max-age=1800
- `https://browser.style/ui/base/form.css` — max-age=1800
- `https://browser.style/ui/base/utility.css` — max-age=1800
- `https://browser.style/ui/base/webcomponents.css` — max-age=1800
- `https://browser.style/ui/grid/ui-grid-cols.css` — max-age=1800
- `https://browser.style/ui/grid/ui-grid-gap.css` — max-age=1800
- …and 1 more (all in `findings.json`)

## Method and limits

- Sustainable Web Design model v4 (as CO2.js 0.19), global grid intensity 494 g/kWh, green hosting counted for the data centre; bytes from a first visit with an empty cache in headless Chrome, desktop viewport 1366×900.
- The model turns bytes into energy (data centre, network, device; operational and embodied) and energy into CO2e. It is an estimate for comparing pages and tracking change, not a measurement of this site's real footprint.
- Grid intensity: CO2.js 0.19.0 average-intensities (Ember, yearly average grid intensity, gCO2e/kWh), Apache-2.0, https://github.com/thegreenwebfoundation/co2.js.
- Green hosting from the Green Web Foundation (verified green); it covers the site host only, not third parties.
- Video and other streams download for as long as the page is open. The audit stops once the network goes quiet (at most about 15 seconds after load), so video bytes can vary between runs.
- Speed and caching in detail are in launch-audit; this audit looks at weight.

Files: `report.json` (every request of every page), `findings.json` (the fix list).
