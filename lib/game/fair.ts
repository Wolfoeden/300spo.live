// Provably fair outcomes, computed exactly like game.play() in the database:
// outcome = floor(u32(HMAC-SHA256(serverSeed, "<clientSeed>:<nonce>")[0..4]) × outcomes / 2^32)
import { bytesToHex, hexToBytes } from "../cardano/address";

export const outcomeFromHmac = (hmac: Uint8Array, outcomes: number) => {
  const value = ((hmac[0] << 24) | (hmac[1] << 16) | (hmac[2] << 8) | hmac[3]) >>> 0;
  return Math.floor((value * outcomes) / 2 ** 32);
};

export const hmacSha256 = async (keyHex: string, message: string) => {
  const key = await crypto.subtle.importKey("raw", Uint8Array.from(hexToBytes(keyHex)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
};

export const sha256Hex = async (hex: string) => bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(hexToBytes(hex)))));

/**
 * Fisher–Yates shuffle of 0 … size-1. Random numbers are big-endian 32-bit
 * words from HMAC-SHA256(serverSeed, "<clientSeed>:<nonce>:<domain>:<block>"),
 * block = 0, 1, …; a word ≥ the largest multiple of n below 2^32 is skipped,
 * so every position is equally likely. Mirrors game.race_deck and
 * game.chicken_crash_lane in the database.
 */
export const hmacShuffle = async (serverSeedHex: string, clientSeed: string, nonce: number, domain: string, size: number) => {
  const items = Array.from({ length: size }, (_, index) => index);
  let block = 0;
  let buffer = new Uint8Array(0);
  let offset = 0;
  const nextWord = async () => {
    if (offset >= buffer.length) {
      buffer = await hmacSha256(serverSeedHex, `${clientSeed}:${nonce}:${domain}:${block}`);
      block += 1;
      offset = 0;
    }
    const word = ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
    offset += 4;
    return word;
  };
  for (let i = size - 1; i >= 1; i -= 1) {
    const n = i + 1;
    const limit = Math.floor(2 ** 32 / n) * n;
    let word = await nextWord();
    while (word >= limit) word = await nextWord();
    const j = word % n;
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
};

/** Recomputes a round's outcome from a revealed server seed. */
export const verifyOutcome = async (round: { serverSeed: string; clientSeed: string; nonce: number; outcomes: number }) =>
  outcomeFromHmac(await hmacSha256(round.serverSeed, `${round.clientSeed}:${round.nonce}`), round.outcomes);
