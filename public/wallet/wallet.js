const previewStatus = document.querySelector("[data-wallet-preview-status]");
const previewFrame = document.querySelector("[data-wallet-frame]");
const previewOpenLinks = [...document.querySelectorAll("[data-wallet-open]")];
const apkDownload = document.querySelector("[data-apk-download]");
const apkStatus = document.querySelector("[data-apk-status]");

const showIntegratedWallet = () => {
  previewFrame.src = "/wallet-app/index.html";
  previewFrame.hidden = false;
  previewOpenLinks.forEach((link) => { link.hidden = false; });
  previewStatus.hidden = true;
};

const showPendingState = (message) => {
  const paragraph = previewStatus?.querySelector("p");
  if (paragraph && message) paragraph.textContent = message;
  if (previewStatus) previewStatus.hidden = false;
  if (previewFrame) {
    previewFrame.removeAttribute("src");
    previewFrame.hidden = true;
  }
  previewOpenLinks.forEach((link) => { link.hidden = true; });
};

const detectWalletBuild = async () => {
  if (!previewStatus || !previewFrame || previewOpenLinks.length === 0) return;

  try {
    const response = await fetch("/wallet-app/build-manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Manifest returned ${response.status}`);

    const manifest = await response.json();
    if (manifest.schemaVersion !== 1 || manifest.basePath !== "/wallet-app") {
      throw new Error("Unexpected wallet build manifest");
    }

    showIntegratedWallet();
  } catch {
    showPendingState("Sobald der geprüfte Export vorliegt, erscheint die Wallet automatisch in diesem Bereich.");
  }
};

const detectAndroidBuild = async () => {
  if (!apkDownload || !apkStatus) return;

  try {
    const response = await fetch(apkDownload.href, { method: "HEAD", cache: "no-store" });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/(?:application\/vnd\.android\.package-archive|application\/octet-stream)/i.test(contentType)) {
      throw new Error("Android build is not available");
    }

    apkDownload.hidden = false;
    apkStatus.textContent = "Preprod-Testversion";
  } catch {
    apkDownload.hidden = true;
    apkStatus.textContent = "Preprod-Testversion · APK wird bereitgestellt";
  }
};

detectWalletBuild();
detectAndroidBuild();
