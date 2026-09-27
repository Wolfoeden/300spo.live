import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

// Runs after `next build`: out/ is what Netlify publishes.
const required = [
  "out/index.html",
  "out/404.html",
  "out/admin/index.html",
  "out/wallet/index.html",
  "out/discover/300-cardano-hub/index.html",
  "out/partners/midnight-logo-white.svg",
  "out/partners/realfi-logo-white.svg",
  "netlify/functions/wallet-auth.mts",
  "public/site.css",
  "public/assets/index-CIJTfFxp.css",
  "public/assets/TradePanel-CTD15WYE.css",
  "public/carpathian-hero.png",
  "public/admin/index.html",
  "public/admin/admin.js",
  "public/wallet/index.html",
  "public/wallet/manifest.webmanifest",
  "public/wallet/icons/apple-touch-icon.png",
  "public/wallet/icons/icon-192.png",
  "public/wallet/icons/icon-512.png",
  "public/wallet/wallet.css",
  "public/wallet/wallet.js",
  "netlify/functions/price.mjs",
  "netlify/functions/metrics.mjs",
  "netlify/functions/news.mjs",
  "netlify/functions/admin-session.mjs",
  "netlify/functions/admin-content.mjs",
  "netlify/functions/site-content.mjs",
  "netlify/functions/admin-media.mjs",
  "netlify/functions/media.mjs",
];

const missing = required.filter((file) => !existsSync(file));

if (missing.length) {
  console.error(`Missing required files:\n${missing.join("\n")}`);
  process.exit(1);
}

const walletPage = readFileSync("public/wallet/index.html", "utf8");
const requiredWalletMarkers = [
  "Wallet im Browser öffnen",
  "Auf Android testen",
  "Zum iPhone-Startbildschirm",
  "/downloads/300-wallet-android-preprod.apk",
  "/downloads/300-wallet-chrome-preprod-preview.zip",
  "Preprod-Testversion",
  "data-wallet-preview-status",
  "data-wallet-frame",
  "/wallet-app/",
];
const missingMarkers = requiredWalletMarkers.filter((marker) => !walletPage.includes(marker));

if (missingMarkers.length) {
  console.error(`Wallet page is missing required integration markers:\n${missingMarkers.join("\n")}`);
  process.exit(1);
}

const walletManifest = JSON.parse(readFileSync("public/wallet/manifest.webmanifest", "utf8"));
if (walletManifest.start_url !== "/wallet/" || walletManifest.scope !== "/wallet/" || walletManifest.display !== "standalone") {
  console.error("Wallet web app manifest must use /wallet/ for start_url and scope with standalone display");
  process.exit(1);
}

const androidBuild = "public/downloads/300-wallet-android-preprod.apk";
if (existsSync(androidBuild) && statSync(androidBuild).size < 1_000_000) {
  console.error("Android APK is unexpectedly small; refusing a likely placeholder artifact");
  process.exit(1);
}

const chromeBuild = "public/downloads/300-wallet-chrome-preprod-preview.zip";
if (existsSync(chromeBuild) && statSync(chromeBuild).size < 1_000_000) {
  console.error("Chrome preview ZIP is unexpectedly small; refusing a likely placeholder artifact");
  process.exit(1);
}

const landing = readFileSync("out/index.html", "utf8");
const requiredLandingMarkers = ["Stake Cardano", "pool1v8gvy6tjp8x8wg5h4jw20p9up04lxgw0l0lgery9mz4h7h9x25n", "Connect", "/admin/", "/wallet/"];
const missingLanding = requiredLandingMarkers.filter((marker) => !landing.includes(marker));
if (missingLanding.length) {
  console.error(`Landing page export is missing:\n${missingLanding.join("\n")}`);
  process.exit(1);
}

for (const script of ["public/wallet/wallet.js", "public/admin/admin.js", "scripts/integrate-wallet-web.mjs", "scripts/local-server.mjs"]) {
  execFileSync(process.execPath, ["--check", script], { stdio: "inherit" });
}

const walletBuildIndex = "public/wallet-app/index.html";
if (existsSync(walletBuildIndex)) {
  const manifestPath = "public/wallet-app/build-manifest.json";
  if (!existsSync(manifestPath)) {
    console.error("Integrated wallet build is missing public/wallet-app/build-manifest.json");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.basePath !== "/wallet-app") {
    console.error("Integrated wallet build manifest has an unexpected schemaVersion or basePath");
    process.exit(1);
  }

  // Every asset URL baked into the wallet bundle must exist and sit on a path
  // Netlify actually uploads (no node_modules or dot-directories).
  const bundleDirectory = "public/wallet-app/_expo/static/js/web";
  for (const bundle of readdirSync(bundleDirectory).filter((name) => name.endsWith(".js"))) {
    const code = readFileSync(`${bundleDirectory}/${bundle}`, "utf8");
    const assetUrls = [...new Set([...code.matchAll(/"(\/wallet-app\/assets\/[^"]+\.[a-z0-9]{2,5})"/gi)].map((match) => match[1]))];
    const broken = assetUrls.filter(
      (url) => /\/(?:node_modules|\.[^/]+)\//.test(url) || !existsSync(`public${decodeURIComponent(url)}`),
    );
    if (broken.length) {
      console.error(`Wallet bundle ${bundle} references assets that would not be served:\n${broken.join("\n")}`);
      process.exit(1);
    }
    if (code.includes("koios.rest")) {
      console.error(`Wallet bundle ${bundle} calls Koios directly; browsers block that (no CORS). Re-run wallet:web:integrate.`);
      process.exit(1);
    }
  }

  const appIndex = readFileSync(walletBuildIndex, "utf8");
  const rootReferences = [...appIndex.matchAll(/(?:src|href)=["'](\/[^"']*)["']/g)].map((match) => match[1]);
  const invalidReferences = rootReferences.filter((reference) => reference !== "/wallet-app" && !reference.startsWith("/wallet-app/"));
  if (invalidReferences.length) {
    console.error(`Integrated wallet build contains root-relative paths outside /wallet-app:\n${[...new Set(invalidReferences)].join("\n")}`);
    process.exit(1);
  }
}

console.log("Public deploy package is ready.");
