/** CIP-30 dApp–wallet bridge, as injected under `window.cardano`. */
export type Cip30Api = {
  getNetworkId(): Promise<number>;
  getBalance(): Promise<string>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  getUsedAddresses(): Promise<string[]>;
  signData(address: string, payloadHex: string): Promise<{ signature: string; key: string }>;
};

export type Cip30Provider = {
  name?: string;
  icon?: string;
  apiVersion?: string;
  enable(): Promise<Cip30Api>;
  isEnabled?(): Promise<boolean>;
};

export type InstalledWallet = {
  key: string;
  name: string;
  icon: string | null;
  provider: Cip30Provider;
};

declare global {
  interface Window {
    cardano?: Record<string, unknown>;
  }
}

/** Preferred order in the picker; everything else follows alphabetically. */
const PREFERRED = ["vespr", "lace", "eternl", "yoroi", "typhoncip30", "gerowallet", "begin", "nufi"];
/** Keys that are aliases of another wallet's injection. */
const ALIASES = new Set(["ccvault", "typhon"]);

const isProvider = (value: unknown): value is Cip30Provider =>
  typeof value === "object" && value !== null && typeof (value as Cip30Provider).enable === "function";

const safeIcon = (icon: unknown) =>
  typeof icon === "string" && /^(data:image\/(png|svg\+xml|jpeg|webp|gif)[;,]|https:\/\/)/.test(icon) ? icon : null;

export const listInstalledWallets = (): InstalledWallet[] => {
  if (typeof window === "undefined" || !window.cardano) return [];
  const seen = new Set<Cip30Provider>();
  const wallets: InstalledWallet[] = [];
  for (const [key, value] of Object.entries(window.cardano)) {
    if (ALIASES.has(key) || !isProvider(value) || seen.has(value)) continue;
    seen.add(value);
    wallets.push({ key, name: value.name?.trim() || key, icon: safeIcon(value.icon), provider: value });
  }
  const rank = (key: string) => {
    const index = PREFERRED.indexOf(key);
    return index === -1 ? PREFERRED.length : index;
  };
  return wallets.sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name));
};

/** Wallet extensions inject asynchronously; wait briefly for them to appear. */
export const waitForWallets = async (timeoutMs = 1500, stepMs = 150) => {
  const start = Date.now();
  let wallets = listInstalledWallets();
  while (wallets.length === 0 && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    wallets = listInstalledWallets();
  }
  return wallets;
};

export const utf8ToHex = (text: string) =>
  Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const walletErrorCode = (error: unknown) =>
  error && typeof error === "object" && typeof (error as { code?: unknown }).code === "number" ? (error as { code: number }).code : null;

/** CIP-30 errors are plain objects `{ code, info }`; normalise them for display. */
export const walletErrorMessage = (error: unknown): string => {
  if (error && typeof error === "object") {
    const { info, message } = error as { info?: unknown; message?: unknown };
    const code = walletErrorCode(error);
    // -3: APIError.Refused (enable), 3: DataSignError.UserDeclined (signData)
    if (code === -3 || code === 3 || /declin|reject|cancel|refus/i.test(String(info ?? message ?? ""))) {
      return "The request was declined in your wallet.";
    }
    if (typeof info === "string" && info) return info;
    if (typeof message === "string" && message) return message;
  }
  return "The wallet did not respond. Unlock it and try again.";
};
