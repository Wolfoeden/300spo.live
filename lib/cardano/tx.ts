import { decode, encode } from "cborg";
import { addressType, bytesToHex, hexToBytes, type DrepCredential } from "./address";

/**
 * A deliberately small transaction builder for the two things this site
 * signs through CIP-30 wallets: stake/vote delegation certificates and plain
 * payments. Tests cross-check every shape against cardano-serialization-lib.
 */

export type Assets = Map<string, bigint>; // unit = policyIdHex + assetNameHex
export type Value = { lovelace: bigint; assets: Assets };
export type Utxo = { txHash: Uint8Array; index: number; address: Uint8Array; value: Value };
export type TxOutput = { address: Uint8Array; value: Value };
export type ProtocolParams = {
  minFeeA: bigint;
  minFeeB: bigint;
  keyDeposit: bigint;
  coinsPerUtxoByte: bigint;
  maxTxSize: number;
};
export type Certificate = unknown[];

export class InsufficientFundsError extends Error {}

// Mainnet slots are one second long; slot 0 of this schedule is Unix time 1591566291.
const MAINNET_SLOT_ZERO_UNIX = 1591566291;
export const mainnetSlotAt = (unixMs: number) => Math.floor(unixMs / 1000) - MAINNET_SLOT_ZERO_UNIX;

const tags: ((inner: unknown) => unknown)[] = [];
tags[258] = (inner) => inner; // sets may arrive tagged
tags[24] = (inner) => inner; // inline datums / script refs (only skipped, never re-encoded)

// Payment-key controlled Shelley addresses; script and Byron inputs are skipped.
const KEY_PAYMENT_TYPES = new Set([0, 2, 4, 6]);

const toBigInt = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return BigInt(value);
  throw new Error("Unexpected amount in UTxO");
};

const decodeAmount = (amount: unknown): Value => {
  if (!Array.isArray(amount)) return { lovelace: toBigInt(amount), assets: new Map() };
  const [coin, multiAsset] = amount as [unknown, unknown];
  const assets: Assets = new Map();
  if (multiAsset instanceof Map) {
    for (const [policy, bundle] of multiAsset) {
      if (!(policy instanceof Uint8Array) || !(bundle instanceof Map)) continue;
      for (const [name, quantity] of bundle) {
        if (name instanceof Uint8Array) assets.set(bytesToHex(policy) + bytesToHex(name), toBigInt(quantity));
      }
    }
  }
  return { lovelace: toBigInt(coin), assets };
};

/**
 * Parses CIP-30 `getUtxos()` entries. Returns null for outputs this builder
 * does not spend (script or Byron addresses, datums, reference scripts).
 */
export const parseUtxo = (cborHex: string): Utxo | null => {
  const decoded: unknown = decode(hexToBytes(cborHex), { useMaps: true, tags });
  if (!Array.isArray(decoded) || decoded.length !== 2) throw new Error("Malformed UTxO");
  const [input, output] = decoded as [unknown, unknown];
  if (!Array.isArray(input) || !(input[0] instanceof Uint8Array)) throw new Error("Malformed UTxO input");

  let address: unknown;
  let amount: unknown;
  let extras = false;
  if (Array.isArray(output)) {
    [address, amount] = output;
    extras = output.length > 2;
  } else if (output instanceof Map) {
    address = output.get(0);
    amount = output.get(1);
    extras = output.has(2) || output.has(3);
  }
  if (!(address instanceof Uint8Array) || extras || !KEY_PAYMENT_TYPES.has(addressType(address))) return null;
  return { txHash: input[0], index: Number(input[1]), address, value: decodeAmount(amount) };
};

const compareBytes = (a: Uint8Array, b: Uint8Array) => {
  if (a.length !== b.length) return a.length - b.length;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
};

export const encodeValue = (value: Value): unknown => {
  const positive = [...value.assets].filter(([, quantity]) => quantity > 0n);
  if (!positive.length) return value.lovelace;
  const policies = new Map<string, [Uint8Array, bigint][]>();
  for (const [unit, quantity] of positive) {
    const policy = unit.slice(0, 56);
    policies.set(policy, [...(policies.get(policy) ?? []), [hexToBytes(unit.slice(56)), quantity]]);
  }
  const multiAsset = new Map(
    [...policies]
      .map(([policy, names]) => [hexToBytes(policy), new Map(names.sort(([a], [b]) => compareBytes(a, b)))] as const)
      .sort(([a], [b]) => compareBytes(a, b)),
  );
  return [value.lovelace, multiAsset];
};

const encodeOutput = (output: TxOutput) => new Map<number, unknown>([[0, output.address], [1, encodeValue(output.value)]]);

/** Babbage/Conway minimum ADA for an output: coinsPerUtxoByte × (160 + size). */
export const minAdaForOutput = (output: TxOutput, params: ProtocolParams) => {
  // Size the coin field at its 9-byte maximum so the result never undershoots.
  const sized = encode(encodeOutput({ ...output, value: { ...output.value, lovelace: 2n ** 63n } })).length;
  return params.coinsPerUtxoByte * BigInt(160 + sized);
};

const addAssets = (target: Assets, source: Assets, sign: 1n | -1n = 1n) => {
  for (const [unit, quantity] of source) target.set(unit, (target.get(unit) ?? 0n) + sign * quantity);
};

const sumValues = (values: Value[]): Value => {
  const assets: Assets = new Map();
  let lovelace = 0n;
  for (const value of values) {
    lovelace += value.lovelace;
    addAssets(assets, value.assets);
  }
  return { lovelace, assets };
};

// One vkey witness: [bytes .size 32, bytes .size 64] = 101 bytes of CBOR.
const VKEY_WITNESS_SIZE = 101;
// Wallets wrap the witness list in set tag 258 (3 bytes); the rest is headroom
// for encoding differences between wallets (costs < 0.001 ADA).
const WITNESS_SET_OVERHEAD = 3 + 12;

const txSize = (body: Uint8Array, witnesses: number) => {
  const witnessArrayHeader = witnesses < 24 ? 1 : 2;
  const witnessSet = 2 + WITNESS_SET_OVERHEAD + witnessArrayHeader + witnesses * VKEY_WITNESS_SIZE;
  return 1 + body.length + witnessSet + 2;
};

export type BuildRequest = {
  utxos: Utxo[];
  changeAddress: Uint8Array;
  outputs?: TxOutput[];
  certificates?: Certificate[];
  /** Deposits taken by the certificates (e.g. stake key registration). */
  deposit?: bigint;
  /** Extra signatures beyond the payment keys of the inputs (e.g. the stake key). */
  extraSigners?: number;
  params: ProtocolParams;
  ttl: number;
};

export type BuiltTransaction = {
  body: Uint8Array;
  unsignedTx: Uint8Array;
  fee: bigint;
  inputs: Utxo[];
  change: TxOutput | null;
};

const encodeBody = (inputs: Utxo[], outputs: TxOutput[], fee: bigint, ttl: number, certificates: Certificate[]) => {
  const body = new Map<number, unknown>([
    [0, [...inputs].sort((a, b) => compareBytes(a.txHash, b.txHash) || a.index - b.index).map((utxo) => [utxo.txHash, utxo.index])],
    [1, outputs.map(encodeOutput)],
    [2, fee],
    [3, ttl],
  ]);
  if (certificates.length) body.set(4, certificates);
  return encode(body);
};

/**
 * Selects inputs (ADA-only UTxOs first, token UTxOs only when needed),
 * computes the fee from the final size including the expected witnesses and
 * returns all leftover value — tokens included — to the change address.
 */
export const buildTransaction = (request: BuildRequest): BuiltTransaction => {
  const { utxos, changeAddress, params, ttl } = request;
  const outputs = request.outputs ?? [];
  const certificates = request.certificates ?? [];
  const deposit = request.deposit ?? 0n;
  const required = sumValues(outputs.map((output) => output.value));

  for (const output of outputs) {
    if (output.value.lovelace < minAdaForOutput(output, params)) throw new Error("An output is below the minimum ADA value");
  }

  const byLovelace = (a: Utxo, b: Utxo) => (b.value.lovelace > a.value.lovelace ? 1 : b.value.lovelace < a.value.lovelace ? -1 : 0);
  const pureAda = utxos.filter((utxo) => utxo.value.assets.size === 0).sort(byLovelace);
  const withAssets = utxos.filter((utxo) => utxo.value.assets.size > 0).sort(byLovelace);

  const selected: Utxo[] = [];
  const take = (utxo: Utxo) => {
    if (!selected.includes(utxo)) selected.push(utxo);
  };

  // 1. Cover every native asset the outputs need.
  for (const [unit, quantity] of required.assets) {
    let covered = sumValues(selected.map((utxo) => utxo.value)).assets.get(unit) ?? 0n;
    const holders = withAssets.filter((utxo) => utxo.value.assets.has(unit)).sort((a, b) => (b.value.assets.get(unit)! > a.value.assets.get(unit)! ? 1 : -1));
    for (const utxo of holders) {
      if (covered >= quantity) break;
      take(utxo);
      covered += utxo.value.assets.get(unit)!;
    }
    if (covered < quantity) throw new InsufficientFundsError("The wallet does not hold enough of the requested token.");
  }

  // 2. Add ADA until the fee, deposit and a valid change output are covered.
  const candidates = [...pureAda, ...withAssets];
  const signers = () => new Set(selected.map((utxo) => bytesToHex(utxo.address.slice(1, 29)))).size + (request.extraSigners ?? 0);

  for (;;) {
    const input = sumValues(selected.map((utxo) => utxo.value));
    const changeAssets: Assets = new Map(input.assets);
    addAssets(changeAssets, required.assets, -1n);
    for (const [unit, quantity] of changeAssets) if (quantity === 0n) changeAssets.delete(unit);

    const attempt = (fee: bigint, withChange: boolean) => {
      const changeLovelace = input.lovelace - required.lovelace - deposit - fee;
      const change: TxOutput | null = withChange ? { address: changeAddress, value: { lovelace: changeLovelace, assets: changeAssets } } : null;
      const body = encodeBody(selected, change ? [...outputs, change] : outputs, fee, ttl, certificates);
      return { body, change, changeLovelace };
    };

    if (selected.length) {
      // Iterate the fee to a fixed point; each pass can only grow the size.
      let fee = 0n;
      let result = attempt(fee, true);
      for (let pass = 0; pass < 4; pass += 1) {
        const next = params.minFeeA * BigInt(txSize(result.body, signers())) + params.minFeeB;
        if (next === fee) break;
        fee = next;
        result = attempt(fee, true);
      }
      const changeMin = minAdaForOutput(result.change!, params);
      if (result.changeLovelace >= changeMin) return finish(result.body, fee, selected, result.change);

      // Leftover too small for its own output: fold it into the fee, but only
      // when no tokens would be lost and the extra is modest (< 1 ADA).
      const leftover = input.lovelace - required.lovelace - deposit;
      if (changeAssets.size === 0 && leftover >= fee && leftover - fee < 1_000_000n) {
        const noChange = attempt(leftover, false);
        const minimum = params.minFeeA * BigInt(txSize(noChange.body, signers())) + params.minFeeB;
        if (leftover >= minimum) return finish(noChange.body, leftover, selected, null);
      }
    }

    const next = candidates.find((utxo) => !selected.includes(utxo));
    if (!next) throw new InsufficientFundsError("Not enough ADA in this wallet to cover the transaction, fee and deposit.");
    take(next);
  }

  function finish(body: Uint8Array, fee: bigint, inputs: Utxo[], change: TxOutput | null): BuiltTransaction {
    if (txSize(body, signers()) > params.maxTxSize) throw new Error("Transaction too large; consolidate the wallet's UTxOs first.");
    const unsignedTx = concat([new Uint8Array([0x84]), body, new Uint8Array([0xa0, 0xf5, 0xf6])]);
    return { body, unsignedTx, fee, inputs: [...inputs], change };
  }
};

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/**
 * Combines the body we built with the witness set returned by CIP-30
 * `signTx(tx, partialSign)`, keeping the signed body bytes untouched.
 */
export const assembleSignedTx = (body: Uint8Array, witnessSetHex: string) =>
  concat([new Uint8Array([0x84]), body, hexToBytes(witnessSetHex), new Uint8Array([0xf5, 0xf6])]);

const encodeDrep = (drep: DrepCredential) => [drep.kind === "key" ? 0 : 1, drep.hash];

/**
 * Conway certificates that register the stake key if needed and delegate its
 * stake to a pool and/or its vote to a DRep. All need the stake key witness.
 */
export const delegationCertificates = (options: {
  stakeKeyHash: Uint8Array;
  registered: boolean;
  keyDeposit: bigint;
  poolKeyHash?: Uint8Array;
  drep?: DrepCredential;
}) => {
  const credential = [0, options.stakeKeyHash];
  const certificates: Certificate[] = [];
  if (!options.registered) certificates.push([7, credential, options.keyDeposit]);
  if (options.poolKeyHash) certificates.push([2, credential, options.poolKeyHash]);
  if (options.drep) certificates.push([9, credential, encodeDrep(options.drep)]);
  return { certificates, deposit: options.registered ? 0n : options.keyDeposit };
};
