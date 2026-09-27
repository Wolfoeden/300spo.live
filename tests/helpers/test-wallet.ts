import { encode } from "cborg";
import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex } from "../../lib/cardano/address";

/**
 * A minimal signer that produces CIP-30 `signData` output the way wallets do
 * (untagged COSE_Sign1, address in the protected header, unhashed payload).
 */
export const createTestWallet = (seed = ed25519.utils.randomSecretKey()) => {
  const publicKey = ed25519.getPublicKey(seed);
  const keyHash = blake2b(publicKey, { dkLen: 28 });
  const rewardAddress = new Uint8Array([0xe1, ...keyHash]);

  const signData = (address: Uint8Array, payload: Uint8Array) => {
    const protectedBytes = encode(new Map<unknown, unknown>([[1, -8], ["address", address]]));
    const sigStructure = encode(["Signature1", protectedBytes, new Uint8Array(0), payload]);
    const signature = ed25519.sign(sigStructure, seed);
    const sign1 = encode([protectedBytes, new Map([["hashed", false]]), payload, signature]);
    const key = encode(new Map<number, unknown>([[1, 1], [3, -8], [-1, 6], [-2, publicKey]]));
    return { signature: bytesToHex(sign1), key: bytesToHex(key) };
  };

  return { publicKey, rewardAddress, signData };
};
