# LuCASA — Lucas's house hunt

A single-page app that ranks home listings by the drive to the Sacramento
Sheriff's Training Academy in Carmichael. You do two things in the Google Sheet:
**paste a Redfin link** and **type a comment**. Everything else — photos, price,
beds/baths/sqft, year, map commute — is automatic.

## How it works

```
Google Sheet (Redfin link + your comment)
        │
        ▼
/api/listings.js ── for each row, fetch + parse ──►  Redfin listing page
        │                                            (price, specs, remarks,
        │                                             full-res photo gallery)
        ▼
index.html ── renders cards, loads photos from ──►  ssl.cdn-redfin.com (open CDN)
```

There is **no manual enrichment step** and **no API key**. Add a row, and within
a few minutes the card is fully populated.

### Why Redfin (not Zillow)

Zillow protects its pages with PerimeterX bot detection — every server request
(Vercel, curl, proxies) gets a 403 + "Press & Hold", so it can never be read
from a server. Redfin's listing pages return normally to a server and embed
everything we need (price, beds/baths/sqft, year, coordinates, the listing
remarks, and the full-resolution photo gallery) right in the page HTML and its
JSON-LD. Redfin's image CDN is open. So the app fetches the page, parses it, and
renders photos straight from the CDN.

### Staying reliable (not getting throttled)

Redfin uses a light AWS WAF that will show a JS challenge to an IP that makes
many rapid requests. The app avoids that by **scraping rarely**:

- **In-memory cache** (`api/listings.js`) — a warm instance reuses a listing's
  data for 6 hours, so each home is scraped at most a few times a day.
- **Edge cache** — `/api/listings` is cached at Vercel's edge for 10 minutes
  with a 1-day `stale-while-revalidate`, so the site serves the last good copy
  instantly and only refreshes in the background. A transient challenge never
  blanks a home that already loaded.
- **Retries + real browser headers** (`api/redfin.js`) — a challenged request is
  retried a few times; at the app's low request rate it almost always passes.

If a brand-new listing is challenged on its very first fetch, it shows a
"photos pending" placeholder and fills in automatically on the next refresh.

For zero-miss reliability at higher volume, add a Vercel KV store (a few clicks
in the Vercel dashboard) and cache each URL there permanently — the code is
structured so this is a small change.

## Adding a home

1. Open the home on **redfin.com**.
2. Copy the page URL (looks like
   `https://www.redfin.com/CA/Sacramento/3224-San-Jose-Way-95817/home/19422463`).
3. Paste it in column A of the sheet, and your note in column B. Done.

Old Zillow links already in the sheet still work: two are mapped to their Redfin
listing in `api/listings.js`, and `api/enrich-data.js` holds baked-in data for
one more as a fallback. Swap any Zillow link for its Redfin link to get live
photos.

## Files

| File | Role |
| --- | --- |
| `index.html` | The whole UI (cards, commute meter, carousel, filters). |
| `api/listings.js` | Reads the sheet, enriches each row from Redfin, caches. |
| `api/redfin.js` | Fetches + parses a Redfin listing page. |
| `api/enrich-data.js` | Fallback data for legacy Zillow rows. |
| `_devserver.js` | Local dev only: `node _devserver.js` serves the app + API at :4599. |

## Local development

```
node _devserver.js   # http://localhost:4599
```
