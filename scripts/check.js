import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";

const required = [
  "public/index.html",
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
  "public/site-content.js",
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
  "/wallet-app/index.html",
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

for (const script of ["public/wallet/wallet.js", "scripts/integrate-wallet-web.mjs", "scripts/local-server.mjs"]) {
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

  const appIndex = readFileSync(walletBuildIndex, "utf8");
  const rootReferences = [...appIndex.matchAll(/(?:src|href)=["'](\/[^"']*)["']/g)].map((match) => match[1]);
  const invalidReferences = rootReferences.filter((reference) => reference !== "/wallet-app" && !reference.startsWith("/wallet-app/"));
  if (invalidReferences.length) {
    console.error(`Integrated wallet build contains root-relative paths outside /wallet-app:\n${[...new Set(invalidReferences)].join("\n")}`);
    process.exit(1);
  }
}

console.log("Public deploy package is ready.");
