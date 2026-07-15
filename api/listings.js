const { fetchRedfin, isRedfinUrl } = require("./redfin.js");
const ENRICH = require("./enrich-data.js");

const SHEET_ID = "169phqWqJRChwTGkQxZShAUgdW0oAYVT5BQ8oye9wqkI";
const SHEET_NAME = "Sheet1";

// Legacy convenience: the sheet still holds a few Zillow links from before we
// switched to Redfin. Map those to their Redfin listing so they enrich live
// without anyone editing the sheet. New rows should just be Redfin links.
const ZILLOW_TO_REDFIN = {
  "25800015": "https://www.redfin.com/CA/Sacramento/3224-San-Jose-Way-95817/home/19422463",
  "26091272": "https://www.redfin.com/CA/Sacramento/2041-Bowling-Green-Dr-95825/home/19138793"
};

// In-memory cache of successful Redfin enrichments, keyed by URL. A warm
// serverless instance reuses this across requests, so each listing is scraped at
// most once every few hours per instance — a second layer under the edge cache
// that keeps Redfin request volume far below its WAF threshold.
const CACHE = new Map();
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6h — refresh price/photos occasionally
const cacheGet = (k) => { const v = CACHE.get(k); return v && Date.now() - v.ts < CACHE_TTL ? v.data : null; };
const cacheSet = (k, data) => CACHE.set(k, { data, ts: Date.now() });

// Read the sheet, enrich every row from Redfin, hand the front-end finished
// listings. The only manual inputs are the two sheet columns: URL + comment.
module.exports = async (req, res) => {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) { res.status(502).json({ error: "sheet fetch failed", status: r.status }); return; }

    const rows = parseCSV(await r.text()).slice(1)
      .map((row, i) => ({ link: (row[0] || "").trim(), comment: (row[1] || "").trim(), row: i + 1 }))
      .filter((x) => x.link);

    const out = await Promise.all(rows.map(enrichRow));

    // Cache the finished JSON at Vercel's edge so Redfin is scraped at most a few
    // times per 10 minutes (well under its WAF threshold), and keep serving the
    // last good copy for a day while revalidating — so a transient challenge
    // never blanks a home that already loaded.
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=86400");
    res.status(200).json({
      listings: out,
      count: out.length,
      enriched: out.filter((l) => l.enriched).length
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

async function enrichRow({ link, comment, row }) {
  const zpid = zpidOf(link);
  const base = { row, link, comment, zpid, enriched: false, source: null };

  // Which Redfin page describes this row?
  const redfinUrl = isRedfinUrl(link) ? link : ZILLOW_TO_REDFIN[zpid];

  if (redfinUrl) {
    let d = cacheGet(redfinUrl);
    if (!d) {
      const res = await fetchRedfin(redfinUrl);
      if (res.ok) { d = res.data; cacheSet(redfinUrl, d); }
    }
    if (d) {
      return {
        ...base, enriched: true, source: "redfin", redfinUrl,
        address: d.address || slugAddr(link) || "Address unavailable",
        price: d.price, beds: d.beds, baths: d.baths, sqft: d.sqft,
        lot: d.lot, year: d.year, coords: d.coords, summary: d.summary,
        photos: d.photos
      };
    }
  }

  // Fallback: baked-in data for a couple of old Zillow rows, else "pending".
  const e = (zpid && ENRICH[zpid]) || {};
  return {
    ...base,
    enriched: !!e.address,
    source: e.address ? "stored" : null,
    address: e.address || slugAddr(link) || "Address unavailable",
    price: e.price ?? null, beds: e.beds ?? null, baths: e.baths ?? null,
    sqft: e.sqft ?? null, lot: e.lot || null, year: e.year ?? null,
    coords: e.coords || null, summary: e.summary || "",
    photos: Array.isArray(e.photos) ? e.photos : []
  };
}

function zpidOf(u) { return (u.match(/(\d+)_zpid/) || [])[1] || ""; }
function slugAddr(u) {
  const m = u.match(/homedetails\/([^/]+)\/\d+_zpid/) ||          // zillow
            u.match(/redfin\.com\/[A-Z]{2}\/[^/]+\/([^/]+)-\d{5}\/home/); // redfin
  return m ? decodeURIComponent(m[1]).replace(/-/g, " ").trim() : "";
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
