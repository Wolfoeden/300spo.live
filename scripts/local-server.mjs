import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import price from "../netlify/functions/price.mjs";
import metrics from "../netlify/functions/metrics.mjs";
import news from "../netlify/functions/news.mjs";

const root = join(process.cwd(), "public");
const port = Number(process.env.PORT || 5177);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".apk": "application/vnd.android.package-archive",
};

const functions = {
  "/api/price": price,
  "/api/metrics": metrics,
  "/api/news": news,
};

const sendFunction = async (handler, req, res) => {
  const response = await handler(new Request(`http://localhost:${port}${req.url}`), {});
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
};

const resolvePublicFile = (pathname) => {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const direct = join(root, clean);
  if (existsSync(direct) && !direct.endsWith("\\")) return direct;
  const index = join(root, clean, "index.html");
  if (existsSync(index)) return index;
  return join(root, "index.html");
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    if (functions[url.pathname]) {
      await sendFunction(functions[url.pathname], req, res);
      return;
    }

    const file = resolvePublicFile(url.pathname);
    const contentType = types[extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": contentType });
    res.end(await readFile(file));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error.stack || error.message);
  }
}).listen(port, () => {
  console.log(`Preview listening on http://localhost:${port}`);
});
