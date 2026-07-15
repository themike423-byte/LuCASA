// Server-side enrichment from Redfin.
//
// WHY REDFIN (and not Zillow): Zillow blocks every datacenter/serverless request
// with PerimeterX (403 + "Press & Hold"), so it can never be read from Vercel.
// Redfin's *listing pages* return a normal 200 to a server with a browser
// User-Agent, and they embed everything we need — price, beds/baths/sqft, year,
// coordinates, the listing remarks, and the full-resolution photo gallery — in
// the page HTML and its JSON-LD. Redfin's image CDN (ssl.cdn-redfin.com) is open.
// So we fetch the page once, parse it, and the app renders photos from the CDN.
// No API key, no proxy, nothing to maintain per-listing.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Look like a real top-level navigation from Chrome. This lifts how many
// requests Redfin's AWS WAF lets through before it shows a JS challenge.
const HEADERS = {
  "User-Agent": UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Upgrade-Insecure-Requests": "1",
  "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1"
};

const isRedfinUrl = (u) => /(^|\.)redfin\.com\//i.test(u || "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Detect Redfin's AWS WAF interstitial. It is a tiny page (~2.5 KB) served with
// HTTP 202 and no real listing content. NOTE: real Redfin pages also embed the
// AWS WAF SDK script, so we must NOT key off the string "awswaf" — only off the
// interstitial's actual shape (202 status, or a tiny body with no price).
const isChallenge = (status, html) =>
  status === 202 || (html.length < 8000 && !/"price"\s*:\s*"?\d{4,}/.test(html));

// Fetch a Redfin listing page and return normalized data, or { ok:false }.
// Retries a couple of times because the WAF challenge is usually transient at
// low request rates.
async function fetchRedfin(url, attempts = 3) {
  let last = { ok: false, status: "unknown" };
  for (let i = 0; i < attempts; i++) {
    if (i) await sleep(600 + i * 900);
    last = await fetchOnce(url);
    if (last.ok || (last.status !== "challenge" && last.status !== "timeout")) return last;
  }
  return last;
}

async function fetchOnce(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(url, { headers: HEADERS, redirect: "follow", signal: ctrl.signal });
    const html = await r.text();
    if (isChallenge(r.status, html)) return { ok: false, status: "challenge" };
    if (!r.ok) return { ok: false, status: r.status };
    const data = parseRedfin(html, url);
    return data.address || data.photos.length ? { ok: true, data } : { ok: false, status: "unparsed" };
  } catch (e) {
    return { ok: false, status: e && e.name === "AbortError" ? "timeout" : "error", error: String(e) };
  } finally {
    clearTimeout(timer);
  }
}

function parseRedfin(html, url) {
  const g = (re) => { const m = html.match(re); return m ? m[1] : null; };
  const desc = g(/<meta name="description" content="([^"]+)"/) || "";
  const ogTitle = g(/og:title"?\s*content="([^"]+)"/) || "";

  // MLS id drives which photos belong to THIS home (Redfin pages also embed
  // comps/nearby homes, each under its own MLS id).
  const mls =
    g(/og:image"?\s*content="[^"]*?gen\w*\.(\d{5,})_/) ||
    g(/MLS#?\s*(\d{5,})/) ||
    g(/bigphoto\/\d+\/(\d{5,})_\d+/);

  // Price: JSON-LD offer first (most reliable), then the "$xxx,xxx" in the meta.
  let price = null;
  const ld = parseListingLd(html);
  if (ld && ld.offers && ld.offers.price) price = parseInt(String(ld.offers.price).replace(/[^\d]/g, ""));
  if (!price) { const m = desc.match(/\$([\d,]{4,})/); if (m) price = parseInt(m[1].replace(/,/g, "")); }

  const numFrom = (re, s) => { const m = (s || desc).match(re); return m ? parseFloat(m[1].replace(/,/g, "")) : null; };

  // Address: og:title is "ADDRESS - 3 beds/2 baths"; fall back to the meta line.
  let address = ogTitle.split(/\s+-\s+\d/)[0].trim();
  if (!address) { const m = desc.match(/(?:located at|∙)\s*([^∙$]+?,\s*[A-Z]{2}\s*\d{5})/); if (m) address = m[1].trim(); }

  const photos = mls ? extractPhotos(html, mls) : [];

  return {
    address: address || "",
    status: (desc.match(/^\s*(For Sale|Sold|Pending|Contingent|Off Market)/i) || [])[1] || "",
    price: price || null,
    beds: numFrom(/([\d.]+)\s*beds?/i),
    baths: numFrom(/([\d.]+)\s*baths?/i),
    sqft: numFrom(/([\d,]+)\s*sq\.?\s*ft/i),
    year: parseInt(g(/"yearBuilt":\s*"?(\d{4})/)) || null,
    lot: lotSize(html),
    coords: coords(html),
    summary: cleanSummary(ld && ld.description),
    mls: mls || null,
    photos
  };
}

// Pull the one JSON-LD block that describes the listing itself.
function parseListingLd(html) {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
  for (const b of blocks) {
    const json = b.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    try {
      const j = JSON.parse(json);
      const t = [].concat(j["@type"]).join(",");
      if (/RealEstateListing|Product|House|SingleFamily|Residence/i.test(t)) return j;
    } catch (e) { /* ignore malformed block */ }
  }
  return null;
}

// Full-resolution gallery for THIS listing, in order. Redfin serves these as
// protocol-relative URLs (//ssl.cdn-redfin.com/...), so tolerate that.
function extractPhotos(html, mls) {
  const re = new RegExp(
    "ssl\\.cdn-redfin\\.com(?:\\\\?/)+photo(?:\\\\?/)+\\d+(?:\\\\?/)+bigphoto(?:\\\\?/)+\\d+(?:\\\\?/)+" +
    mls + "_(\\d+)(?:_\\d+)?\\.jpg",
    "g"
  );
  const byIndex = new Map();
  let m;
  while ((m = re.exec(html))) {
    const clean = "https://" + m[0].replace(/\\\//g, "/");
    byIndex.set(parseInt(m[1], 10), clean);
  }
  return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).slice(0, 40);
}

function coords(html) {
  const lat = html.match(/"latitude":\s*(-?\d+\.\d+)/);
  const lng = html.match(/"longitude":\s*(-?\d+\.\d+)/);
  return lat && lng ? { lat: parseFloat(lat[1]), lng: parseFloat(lng[1]) } : null;
}

function lotSize(html) {
  const m = html.match(/"lotSize":\s*"?([\d,]{3,})/);
  if (!m) return null;
  return parseInt(m[1].replace(/,/g, "")).toLocaleString("en-US") + " sqft";
}

function cleanSummary(s) {
  if (!s) return "";
  s = String(s).replace(/\s+/g, " ").trim();
  return s.length > 480 ? s.slice(0, 477).replace(/\s+\S*$/, "") + "…" : s;
}

module.exports = { fetchRedfin, isRedfinUrl, parseRedfin };
