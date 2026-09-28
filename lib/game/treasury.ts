import { addressBytesFromWallet, sameBytes } from "../cardano/address";
import { cip20Message } from "../cardano/tx";
import { TOKEN_300 } from "../site";

/** First line of the CIP-20 message every deposit carries; the second line is the reference. */
export const DEPOSIT_MESSAGE = "300spo.live game deposit";
const REFERENCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A transfer to the treasury is credited once it is this many blocks deep. */
export const REQUIRED_CONFIRMATIONS = 5;

export const depositMetadata = (reference: string) => {
  if (!REFERENCE.test(reference)) throw new Error("Invalid deposit reference");
  return cip20Message([DEPOSIT_MESSAGE, reference]);
};

/** The subset of Koios `tx_info` this module reads. */
export type KoiosTx = {
  tx_hash: string;
  block_height: number | null;
  inputs?: { payment_addr?: { bech32?: string } | null }[];
  outputs: { payment_addr?: { bech32?: string } | null; asset_list?: { policy_id: string; asset_name: string; quantity: string }[] | null }[];
  metadata?: Record<string, unknown> | null;
};

export type TreasuryTransfer =
  | { kind: "ignored"; reason: "outgoing" | "no_tokens" }
  | { kind: "receipt"; quantity: bigint; reference: string | null };

export const depositReference = (metadata: KoiosTx["metadata"]): string | null => {
  const message = (metadata?.["674"] as { msg?: unknown } | undefined)?.msg;
  if (!Array.isArray(message)) return null;
  const index = message.indexOf(DEPOSIT_MESSAGE);
  const candidate = index >= 0 ? message[index + 1] : undefined;
  return typeof candidate === "string" && REFERENCE.test(candidate) ? candidate : null;
};

/**
 * Classifies a transaction touching the treasury. Transactions the treasury
 * itself signed (it appears among the inputs) are its own movements, not
 * deposits, even though their change comes back to the same address.
 */
export const analyseTreasuryTx = (tx: KoiosTx, treasuryAddress: string): TreasuryTransfer => {
  if (tx.inputs?.some((input) => input.payment_addr?.bech32 === treasuryAddress)) return { kind: "ignored", reason: "outgoing" };
  let quantity = 0n;
  for (const output of tx.outputs) {
    if (output.payment_addr?.bech32 !== treasuryAddress) continue;
    for (const asset of output.asset_list ?? []) {
      if (asset.policy_id === TOKEN_300.policyId && asset.asset_name === TOKEN_300.assetNameHex) quantity += BigInt(asset.quantity);
    }
  }
  if (quantity === 0n) return { kind: "ignored", reason: "no_tokens" };
  return { kind: "receipt", quantity, reference: depositReference(tx.metadata) };
};

/**
 * True when the connected wallet holds the treasury: the same address, or a
 * base address sharing the treasury's stake key. Its "deposits" never leave it.
 */
export const ownsTreasury = (treasury: string, wallet: { changeAddress: string; stakeAddress: string | null }) => {
  if (wallet.changeAddress === treasury) return true;
  try {
    const bytes = addressBytesFromWallet(treasury);
    const stake = bytes.length === 57 && bytes[0] >> 4 <= 3 ? bytes.slice(29) : null;
    return !!stake && !!wallet.stakeAddress && sameBytes(stake, addressBytesFromWallet(wallet.stakeAddress).slice(1));
  } catch {
    return false;
  }
};

export const confirmations = (blockHeight: number | null, tipHeight: number) =>
  blockHeight === null ? 0 : Math.max(0, tipHeight - blockHeight + 1);
