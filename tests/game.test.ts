import { beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "cborg";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { blake2b } from "@noble/hashes/blake2.js";
import { addressToBech32, bytesToHex, hexToBytes } from "../lib/cardano/address";
import { assembleSignedTx, buildTransaction, minAdaForOutput, parseUtxo, type ProtocolParams, type Utxo } from "../lib/cardano/tx";
import { DEPOSIT_MESSAGE, analyseTreasuryTx, depositMetadata, depositReference, type KoiosTx } from "../lib/game/treasury";
import { TOKEN_300 } from "../lib/site";

const PARAMS: ProtocolParams = { minFeeA: 44n, minFeeB: 155381n, keyDeposit: 2_000_000n, coinsPerUtxoByte: 4310n, maxTxSize: 16384 };
const UNIT_300 = TOKEN_300.policyId + TOKEN_300.assetNameHex;
const REFERENCE = "3e73977c-3a03-43e4-b91f-ca2ff23409e1";

const paymentKey = CSL.PrivateKey.generate_ed25519();
const stakeKey = CSL.PrivateKey.generate_ed25519();
const player = new Uint8Array([0x01, ...hexToBytes(paymentKey.to_public().hash().to_hex()), ...hexToBytes(stakeKey.to_public().hash().to_hex())]);
const treasuryBytes = new Uint8Array([0x61, ...blake2b(new Uint8Array([7]), { dkLen: 28 })]);
const TREASURY = addressToBech32(treasuryBytes);

const utxo = (seed: number, lovelace: number, tokens = 0): Utxo => {
  const amount = tokens ? [lovelace, new Map([[hexToBytes(TOKEN_300.policyId), new Map([[hexToBytes(TOKEN_300.assetNameHex), tokens]])]])] : lovelace;
  return parseUtxo(bytesToHex(encode([[blake2b(new Uint8Array([seed]), { dkLen: 32 }), 0], new Map<number, unknown>([[0, player], [1, amount]])])))!;
};

describe("deposit transaction", () => {
  it("pays the treasury with a CIP-20 reference that CSL reads back and hashes identically", () => {
    const payment = { address: treasuryBytes, value: { lovelace: 0n, assets: new Map([[UNIT_300, 1_000n]]) } };
    payment.value.lovelace = minAdaForOutput(payment, PARAMS);
    const built = buildTransaction({
      utxos: [utxo(1, 10_000_000), utxo(2, 1_500_000, 5_000)],
      changeAddress: player,
      outputs: [payment],
      metadata: depositMetadata(REFERENCE),
      params: PARAMS,
      ttl: 1,
    });

    const hash = CSL.FixedTransaction.from_bytes(assembleSignedTx(built.body, "a0", built.auxiliaryData)).transaction_hash();
    const witnesses = CSL.Vkeywitnesses.new();
    witnesses.add(CSL.make_vkey_witness(hash, paymentKey));
    const witnessSet = CSL.TransactionWitnessSet.new();
    witnessSet.set_vkeys(witnesses);
    const signed = assembleSignedTx(built.body, witnessSet.to_hex(), built.auxiliaryData);
    const tx = CSL.Transaction.from_bytes(signed);

    expect(tx.body().auxiliary_data_hash()?.to_hex()).toBe(CSL.hash_auxiliary_data(tx.auxiliary_data()!).to_hex());
    const message = JSON.parse(CSL.decode_metadatum_to_json_str(tx.auxiliary_data()!.metadata()!.get(CSL.BigNum.from_str("674"))!, CSL.MetadataJsonSchema.BasicConversions));
    expect(message).toEqual({ msg: [DEPOSIT_MESSAGE, REFERENCE] });
    expect(built.fee).toBeGreaterThanOrEqual(44n * BigInt(signed.length) + 155381n);
    expect(built.change!.value.assets.get(UNIT_300)).toBe(4_000n);
  });

  it("rejects malformed references before they reach the chain", () => {
    expect(() => depositMetadata("not-a-uuid")).toThrow();
  });
});

const koiosTx = (overrides: Partial<KoiosTx> = {}): KoiosTx => ({
  tx_hash: "ab".repeat(32),
  block_height: 100,
  inputs: [{ payment_addr: { bech32: "addr1qsomeoneelse" } }],
  outputs: [
    { payment_addr: { bech32: TREASURY }, asset_list: [{ policy_id: TOKEN_300.policyId, asset_name: TOKEN_300.assetNameHex, quantity: "700" }] },
    { payment_addr: { bech32: TREASURY }, asset_list: [{ policy_id: TOKEN_300.policyId, asset_name: TOKEN_300.assetNameHex, quantity: "300" }] },
    { payment_addr: { bech32: "addr1qchange" }, asset_list: [{ policy_id: TOKEN_300.policyId, asset_name: TOKEN_300.assetNameHex, quantity: "9999" }] },
  ],
  metadata: { "674": { msg: [DEPOSIT_MESSAGE, REFERENCE] } },
  ...overrides,
});

describe("analyseTreasuryTx", () => {
  it("sums every 300 output to the treasury and reads the reference", () => {
    expect(analyseTreasuryTx(koiosTx(), TREASURY)).toEqual({ kind: "receipt", quantity: 1000n, reference: REFERENCE });
  });

  it("ignores the treasury's own spending and transfers without 300 tokens", () => {
    expect(analyseTreasuryTx(koiosTx({ inputs: [{ payment_addr: { bech32: TREASURY } }] }), TREASURY)).toEqual({ kind: "ignored", reason: "outgoing" });
    const otherToken = koiosTx({ outputs: [{ payment_addr: { bech32: TREASURY }, asset_list: [{ policy_id: "ff".repeat(28), asset_name: TOKEN_300.assetNameHex, quantity: "5" }] }] });
    expect(analyseTreasuryTx(otherToken, TREASURY)).toEqual({ kind: "ignored", reason: "no_tokens" });
  });

  it("keeps receipts without a usable reference for manual assignment", () => {
    expect(analyseTreasuryTx(koiosTx({ metadata: null }), TREASURY)).toMatchObject({ kind: "receipt", reference: null });
    expect(depositReference({ "674": { msg: [DEPOSIT_MESSAGE, "1; drop table"] } })).toBeNull();
  });
});

const db = vi.hoisted(() => ({
  watcherState: vi.fn(),
  confirmDeposit: vi.fn(),
  recordUnmatched: vi.fn(),
  setScannedBlockHeight: vi.fn(),
}));
const chain = vi.hoisted(() => ({ koios: vi.fn(), tipHeight: vi.fn(), txInfo: vi.fn() }));
vi.mock("../lib/server/game-db", () => ({ gameDb: db }));
vi.mock("../lib/server/koios", () => chain);

describe("scanTreasury", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    db.watcherState.mockResolvedValue({ treasuryAddress: TREASURY, scannedBlockHeight: 50 });
  });

  it("credits deep deposits, reports unmatched ones and resumes before pending ones", async () => {
    const { scanTreasury } = await import("../lib/server/game-scan");
    const deep = koiosTx({ tx_hash: "01".repeat(32), block_height: 90 });
    const anonymous = koiosTx({ tx_hash: "02".repeat(32), block_height: 91, metadata: null });
    const fresh = koiosTx({ tx_hash: "03".repeat(32), block_height: 99 });
    chain.koios.mockResolvedValue([deep, anonymous, fresh].map(({ tx_hash, block_height }) => ({ tx_hash, block_height })));
    chain.tipHeight.mockResolvedValue(100);
    chain.txInfo.mockResolvedValue([deep, anonymous, fresh]);
    db.confirmDeposit.mockResolvedValue({ status: "confirmed" });

    const result = await scanTreasury();

    expect(result).toMatchObject({ credited: 1, unmatched: 1, pending: 1 });
    expect(db.confirmDeposit).toHaveBeenCalledWith(REFERENCE, deep.tx_hash, 1000n, 90);
    expect(db.recordUnmatched).toHaveBeenCalledWith(anonymous.tx_hash, 1000n, 91);
    // Progress never passes tip - 5 blocks (block 99 is still pending); rescans are idempotent.
    expect(db.setScannedBlockHeight).toHaveBeenCalledWith(TREASURY, 95);
  });

  it("does nothing until a treasury is configured", async () => {
    const { scanTreasury } = await import("../lib/server/game-scan");
    db.watcherState.mockResolvedValue({ treasuryAddress: null, scannedBlockHeight: 0 });
    expect(await scanTreasury()).toMatchObject({ skipped: "no_treasury" });
    expect(chain.koios).not.toHaveBeenCalled();
  });
});
