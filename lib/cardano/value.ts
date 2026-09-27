import { decode } from "cborg";
import { bytesToHex, hexToBytes } from "./address";

export type WalletValue = {
  lovelace: bigint;
  /** Keyed by `${policyIdHex}${assetNameHex}`. */
  assets: Map<string, bigint>;
};

const toBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  throw new Error("Unexpected amount in wallet balance");
};

// Tag 258 (set) is not part of a Value, but some serialisers wrap arrays in it;
// accept it rather than failing the whole balance.
const tags: ((inner: unknown) => unknown)[] = [];
tags[258] = (inner) => inner;

/**
 * Decodes the CBOR `value` returned by CIP-30 `getBalance()`:
 * either a plain coin or `[coin, { policyId: { assetName: quantity } }]`.
 */
export const decodeWalletValue = (cborHex: string): WalletValue => {
  const decoded: unknown = decode(hexToBytes(cborHex), { useMaps: true, tags });
  if (!Array.isArray(decoded)) return { lovelace: toBigInt(decoded), assets: new Map() };

  const [coin, multiAsset] = decoded as [unknown, unknown];
  const assets = new Map<string, bigint>();
  if (multiAsset instanceof Map) {
    for (const [policyId, bundle] of multiAsset) {
      if (!(policyId instanceof Uint8Array) || !(bundle instanceof Map)) continue;
      for (const [assetName, quantity] of bundle) {
        if (!(assetName instanceof Uint8Array)) continue;
        const unit = bytesToHex(policyId) + bytesToHex(assetName);
        assets.set(unit, (assets.get(unit) ?? 0n) + toBigInt(quantity));
      }
    }
  }
  return { lovelace: toBigInt(coin), assets };
};

export const assetQuantity = (value: WalletValue, policyId: string, assetNameHex: string) =>
  value.assets.get(policyId + assetNameHex) ?? 0n;
