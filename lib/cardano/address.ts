import { base58, bech32, hex } from "@scure/base";

/** Shelley address types (CIP-19), taken from the upper nibble of the header byte. */
const PAYMENT_KEY_TYPES = new Set([0b0000, 0b0010, 0b0100, 0b0110]);
const REWARD_KEY_TYPE = 0b1110;
const REWARD_SCRIPT_TYPE = 0b1111;
const BYRON_TYPE = 0b1000;

export const hexToBytes = (value: string): Uint8Array => hex.decode(value.toLowerCase());
export const bytesToHex = (bytes: Uint8Array): string => hex.encode(bytes);

export const addressType = (bytes: Uint8Array) => bytes[0] >> 4;
export const addressNetworkId = (bytes: Uint8Array) => bytes[0] & 0x0f;
export const isRewardAddress = (bytes: Uint8Array) => {
  const type = addressType(bytes);
  return type === REWARD_KEY_TYPE || type === REWARD_SCRIPT_TYPE;
};

/** Human-readable form of raw address bytes: bech32 for Shelley, base58 for Byron. */
export const addressToBech32 = (bytes: Uint8Array): string => {
  const type = addressType(bytes);
  if (type === BYRON_TYPE) return base58.encode(bytes);
  const mainnet = addressNetworkId(bytes) === 1;
  const prefix = isRewardAddress(bytes) ? (mainnet ? "stake" : "stake_test") : mainnet ? "addr" : "addr_test";
  return bech32.encode(prefix, bech32.toWords(bytes), false);
};

/** CIP-30 returns hex-encoded address bytes; a few wallets return bech32 instead. */
export const addressBytesFromWallet = (value: string): Uint8Array => {
  if (/^(addr|stake)(_test)?1/.test(value)) {
    const decoded = bech32.decode(value as `${string}1${string}`, false);
    return bech32.fromWords(decoded.words);
  }
  return hexToBytes(value);
};

/**
 * The key hash a signature must match for an address to count as owned:
 * the stake key hash of a reward address or the payment key hash of a
 * payment address. Script-controlled and Byron addresses return null.
 */
export const ownerKeyHash = (bytes: Uint8Array): Uint8Array | null => {
  const type = addressType(bytes);
  if (type !== REWARD_KEY_TYPE && !PAYMENT_KEY_TYPES.has(type)) return null;
  if (bytes.length < 29) return null;
  return bytes.slice(1, 29);
};

export const shortenAddress = (address: string, head = 10, tail = 6) =>
  address.length <= head + tail + 1 ? address : `${address.slice(0, head)}…${address.slice(-tail)}`;
