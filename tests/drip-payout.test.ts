import { beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "cborg";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { blake2b } from "@noble/hashes/blake2.js";
import { addressToBech32, bytesToHex, hexToBytes } from "../lib/cardano/address";
import { assembleSignedTx, parseUtxo, type ProtocolParams, type Utxo } from "../lib/cardano/tx";
import { buildPayout, type PayoutRecipient } from "../lib/drip/payout";

const PARAMS: ProtocolParams = { minFeeA: 44n, minFeeB: 155381n, keyDeposit: 2_000_000n, coinsPerUtxoByte: 4310n, maxTxSize: 16384 };
const NIGHT = "0691b2fecca1ac4f53cb6dfb00b7013e561d1f34403b957cbb5af1fa4e49474854";

const distributor = CSL.PrivateKey.generate_ed25519();
const distributorAddress = new Uint8Array([0x61, ...hexToBytes(distributor.to_public().hash().to_hex())]);
const recipientAddress = (seed: number) => addressToBech32(new Uint8Array([0x01, ...blake2b(new Uint8Array([seed]), { dkLen: 56 })]));

const utxo = (seed: number, lovelace: number, night = 0): Utxo => {
  const amount = night ? [lovelace, new Map([[hexToBytes(NIGHT.slice(0, 56)), new Map([[hexToBytes(NIGHT.slice(56)), night]])]])] : lovelace;
  return parseUtxo(bytesToHex(encode([[blake2b(new Uint8Array([seed, 9]), { dkLen: 32 }), 0], new Map<number, unknown>([[0, distributorAddress], [1, amount]])])))!;
};

describe("buildPayout", () => {
  it("pays every wallet its rewards in one balanced, signed-by-one-key transaction", () => {
    const recipients: PayoutRecipient[] = [
      { stake: "stake1a", address: recipientAddress(1), amounts: { lovelace: "2000000", [NIGHT]: "200000000" }, allocationIds: [1, 2], firstEpoch: 658, lastEpoch: 659 },
      { stake: "stake1b", address: recipientAddress(2), amounts: { [NIGHT]: "50000000" }, allocationIds: [3], firstEpoch: 659, lastEpoch: 659 },
    ];
    const payout = buildPayout(recipients, [utxo(1, 20_000_000), utxo(2, 1_500_000, 900_000_000)], bytesToHex(distributorAddress), PARAMS);

    const unsigned = CSL.FixedTransaction.from_bytes(payout.built.unsignedTx);
    expect(unsigned.transaction_hash().to_hex()).toBe(payout.txHash);

    const witnesses = CSL.Vkeywitnesses.new();
    witnesses.add(CSL.make_vkey_witness(unsigned.transaction_hash(), distributor));
    const set = CSL.TransactionWitnessSet.new();
    set.set_vkeys(witnesses);
    const signed = assembleSignedTx(payout.built.body, set.to_hex(), payout.built.auxiliaryData);
    const tx = CSL.Transaction.from_bytes(signed);
    const outputs = tx.body().outputs();
    const nightOf = (index: number) =>
      outputs.get(index).amount().multiasset()?.get_asset(CSL.ScriptHash.from_hex(NIGHT.slice(0, 56)), CSL.AssetName.new(hexToBytes(NIGHT.slice(56))))?.to_str();

    expect(outputs.get(0).address().to_bech32()).toBe(recipients[0].address);
    expect(outputs.get(0).amount().coin().to_str()).toBe("2000000");
    expect(nightOf(0)).toBe("200000000");
    expect(nightOf(1)).toBe("50000000");
    // The second wallet earned no ADA; the distributor adds Cardano's minimum.
    expect(BigInt(outputs.get(1).amount().coin().to_str())).toBe(payout.topUp);
    expect(nightOf(2)).toBe("650000000"); // change keeps the rest of the NIGHT

    const dataCost = CSL.DataCost.new_coins_per_byte(CSL.BigNum.from_str("4310"));
    let coins = 0n;
    for (let index = 0; index < outputs.len(); index += 1) {
      expect(BigInt(outputs.get(index).amount().coin().to_str())).toBeGreaterThanOrEqual(BigInt(CSL.min_ada_for_output(outputs.get(index), dataCost).to_str()));
      coins += BigInt(outputs.get(index).amount().coin().to_str());
    }
    expect(coins + payout.built.fee).toBe(21_500_000n);
    expect(payout.built.fee).toBeGreaterThanOrEqual(44n * BigInt(signed.length) + 155381n);
    expect(payout.allocationIds).toEqual([1, 2, 3]);
    expect(JSON.parse(CSL.decode_metadatum_to_json_str(tx.auxiliary_data()!.metadata()!.get(CSL.BigNum.from_str("674"))!, CSL.MetadataJsonSchema.BasicConversions))).toEqual({
      msg: ["300spo.live drip", "epochs 658-659"],
    });
  });
});

const db = vi.hoisted(() => ({ pendingPayouts: vi.fn(), confirmPayout: vi.fn(), releasePayout: vi.fn() }));
const chain = vi.hoisted(() => ({ koios: vi.fn() }));
vi.mock("../lib/server/drip-db", () => ({ dripDb: db }));
vi.mock("../lib/server/koios", () => chain);

describe("settlePayouts", () => {
  beforeEach(() => vi.resetAllMocks());

  it("confirms deep payouts, keeps fresh ones and releases expired ones", async () => {
    const { settlePayouts } = await import("../lib/server/drip-run");
    const now = Date.parse("2026-09-27T12:00:00Z");
    db.pendingPayouts.mockResolvedValue([
      { txHash: "a".repeat(64), status: "submitted", createdAt: "2026-09-27T11:50:00Z" },
      { txHash: "b".repeat(64), status: "submitted", createdAt: "2026-09-27T11:58:00Z" },
      { txHash: "c".repeat(64), status: "built", createdAt: "2026-09-27T09:00:00Z" },
    ]);
    chain.koios.mockResolvedValue([
      { tx_hash: "a".repeat(64), num_confirmations: 12 },
      { tx_hash: "b".repeat(64), num_confirmations: null },
      { tx_hash: "c".repeat(64), num_confirmations: null },
    ]);

    expect(await settlePayouts(now)).toEqual({ confirmed: 1, released: 1, waiting: 1 });
    expect(db.confirmPayout).toHaveBeenCalledWith("a".repeat(64), null);
    expect(db.releasePayout).toHaveBeenCalledWith("c".repeat(64));
  });
});
