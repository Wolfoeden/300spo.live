import { addressBytesFromWallet } from "../cardano/address";
import { buildTransaction, cip20Message, minAdaForOutput, transactionHash, ttlFromNow, type ProtocolParams, type TxOutput, type Utxo } from "../cardano/tx";

export type PayoutRecipient = {
  stake: string;
  address: string;
  amounts: Record<string, string>;
  allocationIds: number[];
  firstEpoch: number;
  lastEpoch: number;
};

/**
 * One output per recipient with all its unpaid rewards. Outputs that carry
 * tokens need Cardano's minimum ADA; where the ADA reward is smaller, the
 * distribution wallet tops it up (reported as `topUp`).
 */
export const buildPayout = (recipients: PayoutRecipient[], utxos: Utxo[], changeAddressHex: string, params: ProtocolParams) => {
  let topUp = 0n;
  const totals = new Map<string, bigint>();
  const outputs: TxOutput[] = recipients.map((recipient) => {
    const assets = new Map<string, bigint>();
    for (const [unit, amount] of Object.entries(recipient.amounts)) {
      totals.set(unit, (totals.get(unit) ?? 0n) + BigInt(amount));
      if (unit !== "lovelace") assets.set(unit, BigInt(amount));
    }
    const output: TxOutput = { address: addressBytesFromWallet(recipient.address), value: { lovelace: 0n, assets } };
    const reward = BigInt(recipient.amounts.lovelace ?? "0");
    const minimum = minAdaForOutput(output, params);
    if (minimum > reward) topUp += minimum - reward;
    output.value.lovelace = reward > minimum ? reward : minimum;
    return output;
  });
  const firstEpoch = Math.min(...recipients.map((recipient) => recipient.firstEpoch));
  const lastEpoch = Math.max(...recipients.map((recipient) => recipient.lastEpoch));
  const built = buildTransaction({
    utxos,
    changeAddress: addressBytesFromWallet(changeAddressHex),
    outputs,
    metadata: cip20Message(["300spo.live drip", firstEpoch === lastEpoch ? `epoch ${firstEpoch}` : `epochs ${firstEpoch}-${lastEpoch}`]),
    params,
    ttl: ttlFromNow(),
  });
  return {
    built,
    txHash: transactionHash(built.body),
    totals,
    topUp,
    allocationIds: recipients.flatMap((recipient) => recipient.allocationIds),
  };
};
