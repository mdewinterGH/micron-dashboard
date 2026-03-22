const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

const NO_CACHE = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Pragma":        "no-cache",
  "Expires":       "0",
};

http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);

  // ── Force fresh load by redirecting bare / to /?v=2 ─────────────────────
  // The browser cannot have /?v=2 cached, so it must fetch it fresh.
  if (parsed.pathname === "/" && parsed.query.v !== "2") {
    res.writeHead(302, { "Location": "/?v=2" });
    res.end();
    return;
  }

  // ── Finnhub proxy ───────────────────────────────────────────────────────
  // Keeps the API key server-side; the browser never sees it.
  if (parsed.pathname === "/api/finnhub") {
    const finnhubKey = process.env.FINNHUB_KEY;
    if (!finnhubKey) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "FINNHUB_KEY environment variable is not set" }));
      return;
    }
    const finnhubPath = parsed.query.path || "";
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(parsed.query)) {
      if (k !== "path") params.set(k, v);
    }
    params.set("token", finnhubKey);
    const finnhubUrl = `https://finnhub.io/api/v1/${finnhubPath}?${params.toString()}`;

    console.log(`[proxy] Finnhub → /api/v1/${finnhubPath}`);
    const proxyReq = https.get(finnhubUrl, {
      headers: { "Accept": "application/json" },
    }, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        console.error(`[proxy] Finnhub returned HTTP ${proxyRes.statusCode} for /api/v1/${finnhubPath}`);
      }
      res.writeHead(proxyRes.statusCode, {
        "Content-Type":                "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("[proxy] Finnhub error:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // ── Yahoo Finance proxy ──────────────────────────────────────────────────
  // Browsers can't call Yahoo Finance directly (CORS). The server fetches it
  // and streams the response back to the client.
  if (parsed.pathname === "/api/yahoo-chart") {
    const symbol   = (parsed.query.symbol   || "MU").toUpperCase();
    const range    = parsed.query.range    || "3mo";
    const interval = parsed.query.interval || "1d";
    const yahooUrl =
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}` +
      `?interval=${interval}&range=${range}&includePrePost=false`;

    console.log(`[proxy] Yahoo Finance → ${yahooUrl}`);
    const proxyReq = https.get(yahooUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; micron-dashboard/1.0)",
        "Accept":     "application/json",
      },
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        "Content-Type":                "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      proxyRes.pipe(res);
    });

    proxyReq.on("error", (err) => {
      console.error("[proxy] Yahoo Finance error:", err.message);
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    });
    return;
  }

  // ── Static file handler ──────────────────────────────────────────────────
  const filePath = path.join(ROOT, parsed.pathname === "/" ? "index.html" : parsed.pathname);
  const ext      = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", ...NO_CACHE });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Micron dashboard running at http://localhost:${PORT}`);
  console.log(`[startup] FINNHUB_KEY: ${process.env.FINNHUB_KEY ? "set (" + process.env.FINNHUB_KEY.length + " chars)" : "NOT SET — Finnhub data will be unavailable"}`);
});
