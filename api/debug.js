// TEMP diagnostic: what does Vercel's IP actually get from Redfin?
module.exports = async (req, res) => {
  const url = "https://www.redfin.com/CA/Sacramento/2041-Bowling-Green-Dr-95825/home/19138793";
  try {
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document", "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Site": "none"
      }
    });
    const html = await r.text();
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      httpStatus: r.status,
      len: html.length,
      title: (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "",
      challenged: /awsWaf|challenge|202/i.test(html) || r.status === 202,
      hasPrice: /"price":\d{5,}/.test(html),
      snippet: html.slice(0, 220)
    });
  } catch (e) {
    res.status(200).json({ error: String(e) });
  }
};
