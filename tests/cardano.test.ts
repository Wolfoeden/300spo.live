import { describe, expect, it } from "vitest";
import { encode } from "cborg";
import { addressBytesFromWallet, addressToBech32, bytesToHex, hexToBytes, ownerKeyHash } from "../lib/cardano/address";
import { verifyDataSignature } from "../lib/cardano/cose";
import { assetQuantity, decodeWalletValue } from "../lib/cardano/value";
import { TOKEN_300 } from "../lib/site";
import { createTestWallet } from "./helpers/test-wallet";

// Reference vector from cardano-foundation/cardano-verify-datasignature.
const CF_VECTOR = {
  signature:
    "84582aa201276761646472657373581de118987c1612069d4080a0eb247820cb987fea81bddeaafdd41f996281a166686173686564f458264175677573746120416461204b696e672c20436f756e74657373206f66204c6f76656c61636558401712458b19f606b322982f6290c78529a235b56c0f1cec4f24b12a8660b40cd37f4c5440a465754089c462ed4b0d613bffaee3d1833516569fda4852f42a4a0f",
  key: "a4010103272006215820b89526fd6bf4ba737c55ea90670d16a27f8de6cc1982349b3b676705a2f420c6",
  message: "Augusta Ada King, Countess of Lovelace",
  address: "stake1uyvfslqkzgrf6syq5r4jg7pqewv8l65phh024lw5r7vk9qgznhyty",
};

describe("verifyDataSignature", () => {
  it("accepts the Cardano Foundation reference signature", () => {
    const { address, payload } = verifyDataSignature(CF_VECTOR);
    expect(addressToBech32(address)).toBe(CF_VECTOR.address);
    expect(new TextDecoder().decode(payload)).toBe(CF_VECTOR.message);
  });

  it("rejects a tampered signature", () => {
    const tampered = CF_VECTOR.signature.slice(0, -2) + (CF_VECTOR.signature.endsWith("0f") ? "0e" : "0f");
    expect(() => verifyDataSignature({ ...CF_VECTOR, signature: tampered })).toThrow("Invalid signature");
  });

  it("rejects a valid signature from a key that does not own the address", () => {
    const owner = createTestWallet();
    const intruder = createTestWallet();
    const forged = intruder.signData(owner.rewardAddress, new TextEncoder().encode("hello"));
    expect(() => verifyDataSignature(forged)).toThrow("Signing key does not control the address");
  });

  it("accepts signatures produced like a CIP-30 wallet", () => {
    const wallet = createTestWallet();
    const result = verifyDataSignature(wallet.signData(wallet.rewardAddress, new TextEncoder().encode("hello")));
    expect(bytesToHex(result.address)).toBe(bytesToHex(wallet.rewardAddress));
  });
});

describe("addresses", () => {
  it("round-trips bech32 and hex wallet formats", () => {
    const bytes = addressBytesFromWallet(CF_VECTOR.address);
    expect(addressToBech32(addressBytesFromWallet(bytesToHex(bytes)))).toBe(CF_VECTOR.address);
  });

  it("only treats key-controlled addresses as ownable", () => {
    const reward = addressBytesFromWallet(CF_VECTOR.address);
    expect(ownerKeyHash(reward)).toHaveLength(28);
    const scriptReward = new Uint8Array([0xf1, ...reward.slice(1)]);
    expect(ownerKeyHash(scriptReward)).toBeNull();
  });
});

describe("decodeWalletValue", () => {
  it("reads lovelace-only balances", () => {
    const value = decodeWalletValue(bytesToHex(encode(12_500_000)));
    expect(value.lovelace).toBe(12_500_000n);
    expect(value.assets.size).toBe(0);
  });

  it("reads the 300 token from a multi-asset balance", () => {
    const multiAsset = new Map([
      [hexToBytes(TOKEN_300.policyId), new Map([[hexToBytes(TOKEN_300.assetNameHex), 1_234]])],
      [hexToBytes("ab".repeat(28)), new Map([[new Uint8Array([1, 2]), 9]])],
    ]);
    const value = decodeWalletValue(bytesToHex(encode([45_000_000_000_000_000n, multiAsset])));
    expect(value.lovelace).toBe(45_000_000_000_000_000n);
    expect(assetQuantity(value, TOKEN_300.policyId, TOKEN_300.assetNameHex)).toBe(1_234n);
    expect(value.assets.size).toBe(2);
  });
});
