import { describe, expect, it } from "vitest";
import { encode } from "cborg";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, drepCredential, hexToBytes, poolKeyHash } from "../lib/cardano/address";
import {
  InsufficientFundsError,
  assembleSignedTx,
  buildTransaction,
  delegationCertificates,
  minAdaForOutput,
  parseUtxo,
  type ProtocolParams,
  type Utxo,
} from "../lib/cardano/tx";
import { DREP_ID, POOL_ID, POOL_ID_HEX, TOKEN_300 } from "../lib/site";

const PARAMS: ProtocolParams = { minFeeA: 44n, minFeeB: 155381n, keyDeposit: 2_000_000n, coinsPerUtxoByte: 4310n, maxTxSize: 16384 };
const UNIT_300 = TOKEN_300.policyId + TOKEN_300.assetNameHex;
const OTHER_UNIT = "ab".repeat(28) + "4f54484552";

// A real wallet's keys, so the signed transaction can be verified by CSL.
const paymentKey = CSL.PrivateKey.generate_ed25519();
const stakeKey = CSL.PrivateKey.generate_ed25519();
const paymentHash = hexToBytes(paymentKey.to_public().hash().to_hex());
const stakeHash = hexToBytes(stakeKey.to_public().hash().to_hex());
const baseAddress = new Uint8Array([0x01, ...paymentHash, ...stakeHash]);

let counter = 0;
const utxoHex = (lovelace: bigint, assets: Record<string, bigint> = {}, legacy = false) => {
  counter += 1;
  const txHash = blake2b(new Uint8Array([counter]), { dkLen: 32 });
  const units = Object.entries(assets);
  const multiAsset = new Map<Uint8Array, Map<Uint8Array, bigint>>();
  for (const [unit, quantity] of units) multiAsset.set(hexToBytes(unit.slice(0, 56)), new Map([[hexToBytes(unit.slice(56)), quantity]]));
  const amount = units.length ? [lovelace, multiAsset] : lovelace;
  const output = legacy ? [baseAddress, amount] : new Map<number, unknown>([[0, baseAddress], [1, amount]]);
  return bytesToHex(encode([[txHash, counter % 3], output]));
};
const utxo = (...args: Parameters<typeof utxoHex>) => parseUtxo(utxoHex(...args)) as Utxo;

const cslValue = (utxos: Utxo[]) =>
  utxos.reduce((total, entry) => total + entry.value.lovelace, 0n);

/** Signs like a CIP-30 wallet would and returns the finished transaction. */
const signLikeWallet = (body: Uint8Array, keys: CSL.PrivateKey[]) => {
  const hash = CSL.FixedTransaction.from_bytes(assembleSignedTx(body, "a0")).transaction_hash();
  const witnesses = CSL.Vkeywitnesses.new();
  for (const key of keys) witnesses.add(CSL.make_vkey_witness(hash, key));
  const witnessSet = CSL.TransactionWitnessSet.new();
  witnessSet.set_vkeys(witnesses);
  const bytes = assembleSignedTx(body, witnessSet.to_hex());
  return Object.assign(CSL.Transaction.from_bytes(bytes), { submittedSize: bytes.length });
};

/** The ledger prices the bytes that are actually submitted. */
const minFeeFor = (tx: { submittedSize: number }) => 44n * BigInt(tx.submittedSize) + 155381n;

describe("identifiers", () => {
  it("decodes the 300 pool and DRep ids", () => {
    expect(bytesToHex(poolKeyHash(POOL_ID))).toBe(POOL_ID_HEX);
    const drep = drepCredential(DREP_ID);
    expect(drep.kind).toBe("key");
    expect(drep.hash).toHaveLength(28);
    expect(CSL.DRep.from_bech32(DREP_ID).to_key_hash()?.to_hex()).toBe(bytesToHex(drep.hash));
  });
});

describe("parseUtxo", () => {
  it("reads map and legacy outputs and skips what it cannot spend", () => {
    expect(parseUtxo(utxoHex(5_000_000n, {}, true))?.value.lovelace).toBe(5_000_000n);
    expect(parseUtxo(utxoHex(2_000_000n, { [UNIT_300]: 10n }))?.value.assets.get(UNIT_300)).toBe(10n);
    const scriptAddress = new Uint8Array([0x11, ...paymentHash, ...stakeHash]);
    expect(parseUtxo(bytesToHex(encode([[new Uint8Array(32), 0], [scriptAddress, 5_000_000]])))).toBeNull();
    expect(parseUtxo(bytesToHex(encode([[new Uint8Array(32), 0], [baseAddress, 5_000_000, new Uint8Array(32)]])))).toBeNull();
  });
});

describe("delegation transaction", () => {
  it("registers, delegates to the pool and to the DRep in one balanced, correctly priced tx", () => {
    const utxos = [utxo(5_000_000n), utxo(100_000_000n), utxo(3_000_000n, { [UNIT_300]: 7n })];
    const { certificates, deposit } = delegationCertificates({
      stakeKeyHash: stakeHash,
      registered: false,
      keyDeposit: PARAMS.keyDeposit,
      poolKeyHash: poolKeyHash(POOL_ID),
      drep: drepCredential(DREP_ID),
    });
    const built = buildTransaction({ utxos, changeAddress: baseAddress, certificates, deposit, extraSigners: 1, params: PARAMS, ttl: 200_000_000 });

    expect(built.inputs.map((input) => input.value.lovelace)).toEqual([100_000_000n]);
    expect(cslValue(built.inputs)).toBe(built.change!.value.lovelace + built.fee + deposit);

    const tx = signLikeWallet(built.body, [paymentKey, stakeKey]);
    const certs = tx.body().certs()!;
    expect(certs.len()).toBe(3);
    expect(certs.get(0).as_stake_registration()?.coin()?.to_str()).toBe("2000000");
    expect(certs.get(1).as_stake_delegation()?.pool_keyhash().to_hex()).toBe(POOL_ID_HEX);
    expect(certs.get(2).as_vote_delegation()?.drep().to_key_hash()?.to_hex()).toBe(bytesToHex(drepCredential(DREP_ID).hash));
    expect(tx.body().ttl_bignum()?.to_str()).toBe("200000000");

    const minimum = minFeeFor(tx);
    expect(built.fee).toBeGreaterThanOrEqual(minimum);
    expect(built.fee - minimum).toBeLessThan(1_000n);
  });

  it("only delegates when the stake key is already registered", () => {
    const { certificates, deposit } = delegationCertificates({
      stakeKeyHash: stakeHash,
      registered: true,
      keyDeposit: PARAMS.keyDeposit,
      drep: drepCredential(DREP_ID),
    });
    expect(deposit).toBe(0n);
    const built = buildTransaction({ utxos: [utxo(4_000_000n)], changeAddress: baseAddress, certificates, deposit, extraSigners: 1, params: PARAMS, ttl: 1 });
    const tx = signLikeWallet(built.body, [paymentKey, stakeKey]);
    expect(tx.body().certs()!.len()).toBe(1);
    expect(built.fee).toBeGreaterThanOrEqual(minFeeFor(tx));
  });

  it("reports missing funds instead of building an invalid tx", () => {
    const { certificates, deposit } = delegationCertificates({ stakeKeyHash: stakeHash, registered: false, keyDeposit: PARAMS.keyDeposit, poolKeyHash: poolKeyHash(POOL_ID) });
    expect(() => buildTransaction({ utxos: [utxo(2_100_000n)], changeAddress: baseAddress, certificates, deposit, extraSigners: 1, params: PARAMS, ttl: 1 })).toThrow(
      InsufficientFundsError,
    );
  });
});

describe("token payment", () => {
  it("sends 300 tokens and returns every other token and ADA as valid change", () => {
    const treasury = new Uint8Array([0x61, ...blake2b(new Uint8Array([9]), { dkLen: 28 })]);
    const utxos = [utxo(3_000_000n), utxo(1_500_000n, { [UNIT_300]: 5_000_000n, [OTHER_UNIT]: 42n })];
    const payment = { address: treasury, value: { lovelace: 0n, assets: new Map([[UNIT_300, 1_000_000n]]) } };
    payment.value.lovelace = minAdaForOutput(payment, PARAMS);

    const built = buildTransaction({ utxos, changeAddress: baseAddress, outputs: [payment], params: PARAMS, ttl: 1 });
    expect(built.change!.value.assets.get(UNIT_300)).toBe(4_000_000n);
    expect(built.change!.value.assets.get(OTHER_UNIT)).toBe(42n);

    const tx = signLikeWallet(built.body, [paymentKey]);
    const dataCost = CSL.DataCost.new_coins_per_byte(CSL.BigNum.from_str("4310"));
    let outputsTotal = 0n;
    for (let index = 0; index < tx.body().outputs().len(); index += 1) {
      const output = tx.body().outputs().get(index);
      const coin = BigInt(output.amount().coin().to_str());
      expect(coin).toBeGreaterThanOrEqual(BigInt(CSL.min_ada_for_output(output, dataCost).to_str()));
      outputsTotal += coin;
    }
    expect(cslValue(built.inputs)).toBe(outputsTotal + built.fee);
    expect(built.fee).toBeGreaterThanOrEqual(minFeeFor(tx));
  });

  it("refuses to send more tokens than the wallet holds", () => {
    const payment = { address: baseAddress, value: { lovelace: 2_000_000n, assets: new Map([[UNIT_300, 10n]]) } };
    expect(() => buildTransaction({ utxos: [utxo(50_000_000n, { [UNIT_300]: 9n })], changeAddress: baseAddress, outputs: [payment], params: PARAMS, ttl: 1 })).toThrow(
      InsufficientFundsError,
    );
  });
});
