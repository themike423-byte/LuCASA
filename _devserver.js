// Throwaway local dev server to verify api/listings.js + index.html together.
// Not part of the app. Run: node _devserver.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const listings = require("./api/listings.js");

http.createServer(async (req, res) => {
  if (req.url.startsWith("/api/listings")) {
    // adapt Node res to the Vercel-style handler
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (o) => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };
    return listings(req, res);
  }
  const file = req.url === "/" ? "index.html" : req.url.slice(1);
  const fp = path.join(__dirname, file);
  fs.readFile(fp, (e, buf) => {
    if (e) { res.statusCode = 404; res.end("not found"); return; }
    res.setHeader("Content-Type", file.endsWith(".html") ? "text/html" : "text/plain");
    res.end(buf);
  });
}).listen(4599, () => console.log("dev server on http://localhost:4599"));
