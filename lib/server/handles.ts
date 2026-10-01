import { shortName } from "../game/blackjack";
import { koios } from "./koios";

// The name a wallet has at a game table: its ADA Handle ($name) when the stake
// address holds one, otherwise the last five characters of the address.
const HANDLE_POLICY = "f0ff48bbb7bbe9d59a40f1ce90e9e9d0ff5002ec48f232b49ca0fb9a";
// CIP-68 handles carry the (222) user-token label in front of the name; (100) reference tokens are not the holder's.
const CIP68_USER = "000de140";
const CIP68_REFERENCE = "000643b0";
const VALID = /^[a-z0-9._@-]{1,28}$/;

const decode = (assetName: string) => {
  if (assetName.startsWith(CIP68_REFERENCE)) return null;
  const hex = assetName.startsWith(CIP68_USER) ? assetName.slice(CIP68_USER.length) : assetName;
  const name = Buffer.from(hex, "hex").toString("utf8");
  return VALID.test(name) ? name : null;
};

/** Of several handles: a root handle before a sub-handle (name@root), then the shortest, then A–Z. */
const preferred = (names: string[]) =>
  [...names].sort((a, b) => Number(a.includes("@")) - Number(b.includes("@")) || a.length - b.length || a.localeCompare(b))[0];

export async function tableName(wallet: string) {
  if (!wallet.startsWith("stake1")) return shortName(wallet);
  try {
    const assets = await koios<{ asset_name: string | null }[]>(`account_assets?policy_id=eq.${HANDLE_POLICY}&select=asset_name`, { _stake_addresses: [wallet] }, 4000);
    const names = assets.flatMap((asset) => (asset.asset_name ? [decode(asset.asset_name)] : [])).filter((name): name is string => !!name);
    if (names.length) return `$${preferred(names)}`;
  } catch (error) {
    console.warn("[handles] lookup failed, using the short address", error instanceof Error ? error.message : error);
  }
  return shortName(wallet);
}
