const SHEET_ID = "169phqWqJRChwTGkQxZShAUgdW0oAYVT5BQ8oye9wqkI";
const SHEET_NAME = "Sheet1";

module.exports = async (req, res) => {
  const url =
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq` +
    `?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) {
      res.status(502).json({ error: "sheet fetch failed", status: r.status });
      return;
    }
    const csv = await r.text();
    const rows = parseCSV(csv);
    const out = [];
    for (let i = 1; i < rows.length; i++) {
      const link = (rows[i][0] || "").trim();
      const comment = (rows[i][1] || "").trim();
      if (!link) continue;
      out.push({ link, comment, row: i });
    }
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
    res.status(200).json({ listings: out, count: out.length });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += c;
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
