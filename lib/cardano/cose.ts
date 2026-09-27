import { decode, encode } from "cborg";
import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { hexToBytes, ownerKeyHash } from "./address";

// COSE header and key labels (RFC 8152) used by CIP-8 / CIP-30 signData.
const ALG = 1;
const ALG_EDDSA = -8;
const KEY_TYPE = 1;
const KEY_TYPE_OKP = 1;
const KEY_CURVE = -1;
const CURVE_ED25519 = 6;
const KEY_X = -2;

const tags: ((inner: unknown) => unknown)[] = [];
tags[18] = (inner) => inner; // COSE_Sign1 may arrive tagged or untagged

const decodeMap = (bytes: Uint8Array): Map<unknown, unknown> => {
  const value: unknown = decode(bytes, { useMaps: true, tags });
  if (!(value instanceof Map)) throw new Error("Expected a CBOR map");
  return value;
};

const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);

export type DataSignature = { signature: string; key: string };

export type VerifiedSignature = {
  /** Raw bytes of the address the wallet signed with. */
  address: Uint8Array;
  payload: Uint8Array;
};

/**
 * Verifies a CIP-30 `signData` result and returns the signed address and
 * payload. Throws when the signature, key or address binding does not hold.
 */
export const verifyDataSignature = ({ signature, key }: DataSignature): VerifiedSignature => {
  const sign1: unknown = decode(hexToBytes(signature), { useMaps: true, tags });
  if (!Array.isArray(sign1) || sign1.length !== 4) throw new Error("Malformed COSE_Sign1");
  const [protectedBytes, unprotectedHeader, payload, signatureBytes] = sign1 as unknown[];
  if (!(protectedBytes instanceof Uint8Array) || !(payload instanceof Uint8Array) || !(signatureBytes instanceof Uint8Array)) {
    throw new Error("Malformed COSE_Sign1");
  }

  const protectedHeader = decodeMap(protectedBytes);
  if (protectedHeader.get(ALG) !== ALG_EDDSA) throw new Error("Unsupported signature algorithm");
  const address = protectedHeader.get("address");
  if (!(address instanceof Uint8Array)) throw new Error("Signature is not bound to an address");
  if (unprotectedHeader instanceof Map && unprotectedHeader.get("hashed") === true) {
    throw new Error("Hashed payloads are not accepted");
  }

  const coseKey = decodeMap(hexToBytes(key));
  const publicKey = coseKey.get(KEY_X);
  if (
    coseKey.get(KEY_TYPE) !== KEY_TYPE_OKP ||
    coseKey.get(KEY_CURVE) !== CURVE_ED25519 ||
    !(publicKey instanceof Uint8Array) ||
    publicKey.length !== 32
  ) {
    throw new Error("Unsupported signing key");
  }

  const signedData = encode(["Signature1", protectedBytes, new Uint8Array(0), payload]);
  if (!ed25519.verify(signatureBytes, signedData, publicKey)) throw new Error("Invalid signature");

  const expectedKeyHash = ownerKeyHash(address);
  if (!expectedKeyHash || !equalBytes(blake2b(publicKey, { dkLen: 28 }), expectedKeyHash)) {
    throw new Error("Signing key does not control the address");
  }

  return { address, payload };
};
