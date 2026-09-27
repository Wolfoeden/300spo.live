// Local preview of the production layout: serves the static export from out/
// and routes /api/* to the Netlify function modules (run with `tsx`, so the
// TypeScript functions load too). `--api-only` skips static files for use
// behind `next dev`.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(process.cwd(), "out");
const functionsDir = join(process.cwd(), "netlify", "functions");
const port = Number(process.env.PORT || 5177);
const apiOnly = process.argv.includes("--api-only");

globalThis.Netlify ??= { env: { get: (key) => process.env[key] } };

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".zip": "application/zip",
};

const toMatcher = (pattern) => {
  const names = [];
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:(\w+)/g, (_, name) => {
    names.push(name);
    return "([^/]+)";
  });
  const regex = new RegExp(`^${source}/?$`);
  return (pathname) => {
    const match = regex.exec(pathname);
    return match ? Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(match[index + 1])])) : null;
  };
};

const routes = [];
for (const file of await readdir(functionsDir)) {
  if (!/\.(mjs|mts)$/.test(file)) continue;
  const fn = await import(pathToFileURL(join(functionsDir, file)).href);
  const paths = [fn.config?.path].flat().filter(Boolean);
  for (const path of paths) routes.push({ match: toMatcher(path), handler: fn.default, file });
}

const readBody = (req) =>
  new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(chunks.length ? Buffer.concat(chunks) : undefined));
  });

const resolveStaticFile = (pathname) => {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const direct = join(root, clean);
  if (existsSync(direct) && statSync(direct).isFile()) return direct;
  const index = join(root, clean, "index.html");
  if (existsSync(index)) return index;
  return null;
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    for (const route of routes) {
      const params = route.match(url.pathname);
      if (!params) continue;
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const request = new Request(url, { method: req.method, headers: req.headers, body });
      const response = await route.handler(request, { params });
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }

    const file = apiOnly ? null : resolveStaticFile(url.pathname);
    if (!file) {
      const notFound = join(root, "404.html");
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end(!apiOnly && existsSync(notFound) ? await readFile(notFound) : "Not found");
      return;
    }
    res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    res.end(await readFile(file));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error.stack || error.message);
  }
}).listen(port, () => {
  console.log(`${apiOnly ? "API" : "Preview"} listening on http://localhost:${port} (${routes.length} function routes)`);
});
