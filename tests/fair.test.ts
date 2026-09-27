import { describe, expect, it } from "vitest";
import { bytesToHex } from "../lib/cardano/address";
import { hmacSha256, outcomeFromHmac, sha256Hex, verifyOutcome } from "../lib/game/fair";

describe("provably fair outcomes", () => {
  it("matches the database's HMAC (pgcrypto reference vector)", async () => {
    // select encode(extensions.hmac(convert_to('client:1','UTF8'), decode('000102','hex'), 'sha256'), 'hex')
    expect(bytesToHex(await hmacSha256("000102", "client:1"))).toBe("4017d43a361d873557c847ac14f8a81e2a53d1e3138d7fa15e48c51d2b6f760a");
  });

  it("maps the first 32 bits onto the outcomes", async () => {
    // 0x4017d43a = 1075303482 → coin: 0, five horses: 1
    expect(await verifyOutcome({ serverSeed: "000102", clientSeed: "client", nonce: 1, outcomes: 2 })).toBe(0);
    expect(await verifyOutcome({ serverSeed: "000102", clientSeed: "client", nonce: 1, outcomes: 5 })).toBe(1);
    expect(outcomeFromHmac(new Uint8Array([0xff, 0xff, 0xff, 0xff]), 5)).toBe(4);
    expect(outcomeFromHmac(new Uint8Array([0, 0, 0, 0]), 5)).toBe(0);
  });

  it("hashes the server seed like the committed hash", async () => {
    expect(await sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});
