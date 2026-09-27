import { cp, lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

const projectRoot = resolve(process.cwd());
const publicRoot = join(projectRoot, "public");
const destination = join(publicRoot, "wallet-app");
const staging = join(publicRoot, `.wallet-app-stage-${process.pid}`);
const sourceArgument = process.argv[2];

const fail = (message) => {
  throw new Error(message);
};

const assertInside = (parent, child, label) => {
  const pathFromParent = relative(parent, child);
  if (!pathFromParent || pathFromParent.startsWith(`..${sep}`) || pathFromParent === ".." || isAbsolute(pathFromParent)) {
    fail(`${label} must stay inside ${parent}`);
  }
};

const walk = async (directory, base = directory) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const pathFromBase = relative(base, absolutePath).split(sep).join("/");
    const metadata = await lstat(absolutePath);

    if (metadata.isSymbolicLink()) fail(`Symbolic links are not accepted in wallet web exports: ${pathFromBase}`);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, base));
    else if (entry.isFile()) files.push({ absolutePath, pathFromBase });
  }
  return files;
};

const cleanReference = (value) => value.split("#")[0].split("?")[0];
const isRemoteReference = (value) => /^(?:https?:)?\/\//i.test(value);
const isIgnoredReference = (value) => !value || value.startsWith("#") || /^(?:data|blob|mailto|tel):/i.test(value);

const resolveArtifactReference = (reference, ownerPath, source) => {
  const clean = cleanReference(reference);
  if (clean === "/wallet-app") return source;
  if (clean.startsWith("/wallet-app/")) return join(source, clean.slice("/wallet-app/".length));
  return resolve(dirname(ownerPath), clean);
};

const validateLocalReference = async (reference, ownerPath, source, label) => {
  if (isIgnoredReference(reference)) return;
  if (isRemoteReference(reference)) fail(`${label} must be bundled locally: ${reference}`);
  if (reference.startsWith("/") && reference !== "/wallet-app" && !reference.startsWith("/wallet-app/")) {
    fail(`${label} escapes the required /wallet-app base path: ${reference}`);
  }

  const target = resolveArtifactReference(reference, ownerPath, source);
  const pathFromSource = relative(source, target);
  if (pathFromSource.startsWith(`..${sep}`) || pathFromSource === ".." || isAbsolute(pathFromSource)) {
    fail(`${label} resolves outside the exported artifact: ${reference}`);
  }

  try {
    await lstat(target);
  } catch {
    fail(`${label} points to a missing artifact file: ${reference}`);
  }
};

const validateHtml = async (file, source) => {
  const html = await readFile(file.absolutePath, "utf8");

  if (/\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\b/i.test(html)) {
    fail(`Development host found in ${file.pathFromBase}`);
  }

  const rootReferences = [...html.matchAll(/(?:src|href)=["'](\/[^"']*)["']/g)].map((match) => match[1]);
  for (const reference of rootReferences) {
    if (reference !== "/wallet-app" && !reference.startsWith("/wallet-app/")) {
      fail(`Root-relative reference in ${file.pathFromBase} escapes /wallet-app: ${reference}`);
    }
  }

  const resourceTags = [...html.matchAll(/<(script|img|source)\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi)];
  for (const match of resourceTags) {
    await validateLocalReference(match[2], file.absolutePath, source, `${match[1]} src in ${file.pathFromBase}`);
  }

  const stylesheetTags = [...html.matchAll(/<link\b(?=[^>]*\brel=["'][^"']*stylesheet[^"']*["'])[^>]*?\bhref=["']([^"']+)["'][^>]*>/gi)];
  for (const match of stylesheetTags) {
    await validateLocalReference(match[1], file.absolutePath, source, `stylesheet href in ${file.pathFromBase}`);
  }
};

const validateCss = async (file, source) => {
  const css = await readFile(file.absolutePath, "utf8");
  const references = [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((match) => match[1].trim());
  for (const reference of references) {
    await validateLocalReference(reference, file.absolutePath, source, `CSS url in ${file.pathFromBase}`);
  }
};

const validateArtifact = async (source) => {
  const sourceMetadata = await lstat(source).catch(() => null);
  if (!sourceMetadata?.isDirectory()) fail(`Wallet export directory not found: ${source}`);

  const sourceIndex = join(source, "index.html");
  const indexMetadata = await lstat(sourceIndex).catch(() => null);
  if (!indexMetadata?.isFile()) fail(`Wallet export must contain index.html: ${sourceIndex}`);

  const files = await walk(source);
  const blockedFiles = files.filter(({ pathFromBase }) => /(^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519)$|\.(?:pem|p12|pfx|key)$/i.test(pathFromBase));
  if (blockedFiles.length) fail(`Potential secret files found in wallet export:\n${blockedFiles.map((file) => file.pathFromBase).join("\n")}`);

  for (const file of files) {
    if (extname(file.pathFromBase).toLowerCase() === ".html") await validateHtml(file, source);
    if (extname(file.pathFromBase).toLowerCase() === ".css") await validateCss(file, source);
  }

  return files.length;
};

// Netlify never uploads node_modules or dot-directories, but Expo places
// package assets (e.g. the cardano-serialization-lib WASM) under
// assets/node_modules/.pnpm/... Move them to assets/vendor/ and rewrite
// the references so they are actually served.
const UNDEPLOYABLE_SEGMENT = /(^|\/)(?:node_modules|\.[^/]+)(?:\/|$)/;
const VENDOR_DIRECTORY = "assets/vendor";

const relocateUndeployableAssets = async (root) => {
  const files = await walk(root);
  const moves = files.filter(({ pathFromBase }) => UNDEPLOYABLE_SEGMENT.test(posix.dirname(pathFromBase)));
  if (!moves.length) return 0;

  const targets = new Set();
  const oldDirectories = new Set();
  await mkdir(join(root, VENDOR_DIRECTORY), { recursive: true });
  for (const file of moves) {
    const target = `${VENDOR_DIRECTORY}/${posix.basename(file.pathFromBase)}`;
    if (targets.has(target)) fail(`Two wallet assets would both move to ${target}`);
    targets.add(target);
    oldDirectories.add(posix.dirname(file.pathFromBase));
    await rename(file.absolutePath, join(root, target));
  }

  for (const file of await walk(root)) {
    if (!/\.(?:js|html|css|json)$/i.test(file.pathFromBase)) continue;
    const original = await readFile(file.absolutePath, "utf8");
    let text = original;
    for (const directory of oldDirectories) text = text.split(`/wallet-app/${directory}/`).join(`/wallet-app/${VENDOR_DIRECTORY}/`);
    if (text !== original) await writeFile(file.absolutePath, text, "utf8");
  }

  for (const directory of oldDirectories) {
    const firstUndeployable = directory.split("/").findIndex((segment) => segment === "node_modules" || segment.startsWith("."));
    await rm(join(root, ...directory.split("/").slice(0, firstUndeployable + 1)), { recursive: true, force: true });
  }

  const leftovers = (await walk(root)).filter(({ pathFromBase }) => UNDEPLOYABLE_SEGMENT.test(pathFromBase));
  if (leftovers.length) fail(`Undeployable wallet paths remain:\n${leftovers.map((file) => file.pathFromBase).join("\n")}`);
  return moves.length;
};

// Koios answers without CORS headers, so browsers block the wallet's direct
// calls. Point the web build at same-origin proxies (see netlify.toml).
const KOIOS_PROXIES = {
  "https://preprod.koios.rest/api/v1": "/api/koios/preprod",
  "https://api.koios.rest/api/v1": "/api/koios/mainnet",
};

const routeKoiosThroughProxy = async (root) => {
  let rewritten = 0;
  for (const file of await walk(root)) {
    if (!/\.(?:js|html|json)$/i.test(file.pathFromBase)) continue;
    const original = await readFile(file.absolutePath, "utf8");
    let text = original;
    for (const [upstream, proxy] of Object.entries(KOIOS_PROXIES)) text = text.split(upstream).join(proxy);
    if (text !== original) {
      await writeFile(file.absolutePath, text, "utf8");
      rewritten += 1;
    }
  }
  return rewritten;
};

const integrate = async () => {
  if (!sourceArgument) {
    fail("Usage: pnpm wallet:web:integrate -- <path-to-hotwallet-dist>");
  }

  const source = resolve(sourceArgument);
  assertInside(publicRoot, destination, "Wallet destination");
  assertInside(publicRoot, staging, "Wallet staging directory");
  if (source === destination || source.startsWith(`${destination}${sep}`)) {
    fail("Use the original hotwallet dist directory as the source, not public/wallet-app");
  }

  const fileCount = await validateArtifact(source);
  await rm(staging, { recursive: true, force: true });

  try {
    await cp(source, staging, { recursive: true, force: false, errorOnExist: true });
    const relocated = await relocateUndeployableAssets(staging);
    if (relocated) console.log(`Moved ${relocated} package assets to /wallet-app/${VENDOR_DIRECTORY}/.`);
    const proxied = await routeKoiosThroughProxy(staging);
    if (proxied) console.log(`Routed Koios calls through /api/koios/* in ${proxied} file(s).`);
    await writeFile(join(staging, "build-manifest.json"), `${JSON.stringify({
      schemaVersion: 1,
      name: "300 Wallet Web",
      basePath: "/wallet-app",
      source: "hotwallet-web-export",
    }, null, 2)}\n`, "utf8");

    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }

  console.log(`Integrated ${fileCount} wallet web files at public/wallet-app.`);
};

integrate().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
