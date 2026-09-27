import { REQUIRED_CONFIRMATIONS, analyseTreasuryTx, confirmations, type KoiosTx } from "../game/treasury";
import { gameDb } from "./game-db";
import { koios, tipHeight, txInfo } from "./koios";

type AddressTx = { tx_hash: string; block_height: number };

export type ScanOutcome = { credited: number; unmatched: number; pending: number; ignored: number };

/** Credits or records every treasury transaction in `txs` that is deep enough. */
const settle = async (txs: KoiosTx[], treasury: string, tip: number, outcome: ScanOutcome) => {
  let lowestPending = Number.POSITIVE_INFINITY;
  for (const tx of txs) {
    if (confirmations(tx.block_height, tip) < REQUIRED_CONFIRMATIONS) {
      outcome.pending += 1;
      lowestPending = Math.min(lowestPending, tx.block_height ?? tip);
      continue;
    }
    const transfer = analyseTreasuryTx(tx, treasury);
    if (transfer.kind === "ignored") {
      outcome.ignored += 1;
      continue;
    }
    const result = transfer.reference
      ? await gameDb.confirmDeposit(transfer.reference, tx.tx_hash, transfer.quantity, tx.block_height!)
      : null;
    if (result?.status === "confirmed") {
      outcome.credited += 1;
    } else if (result?.status !== "already_confirmed" && result?.status !== "tx_already_used") {
      // No reference, an unknown one, or a reused one: an admin assigns it by hand.
      await gameDb.recordUnmatched(tx.tx_hash, transfer.quantity, tx.block_height!);
      outcome.unmatched += 1;
    }
  }
  return lowestPending;
};

/**
 * Walks the treasury's transactions since the last scanned block and credits
 * deposits. Stops early when the time budget runs low; the next run resumes.
 */
export const scanTreasury = async (budgetMs = 20_000) => {
  const started = Date.now();
  const { treasuryAddress, scannedBlockHeight } = await gameDb.watcherState();
  const outcome: ScanOutcome = { credited: 0, unmatched: 0, pending: 0, ignored: 0 };
  if (!treasuryAddress) return { skipped: "no_treasury" as const, ...outcome };

  const [history, tip] = await Promise.all([
    koios<AddressTx[]>("address_txs", { _addresses: [treasuryAddress], _after_block_height: scannedBlockHeight }),
    tipHeight(),
  ]);
  const hashes = [...new Set(history.sort((a, b) => a.block_height - b.block_height).map((tx) => tx.tx_hash))];

  let safeHeight = Math.max(scannedBlockHeight, tip - REQUIRED_CONFIRMATIONS);
  for (let index = 0; index < hashes.length; index += 25) {
    if (Date.now() - started > budgetMs) {
      // Resume from the first unprocessed transaction next time.
      safeHeight = Math.min(safeHeight, history.find((tx) => tx.tx_hash === hashes[index])!.block_height - 1);
      break;
    }
    const lowestPending = await settle(await txInfo<KoiosTx>(hashes.slice(index, index + 25)), treasuryAddress, tip, outcome);
    safeHeight = Math.min(safeHeight, lowestPending - 1);
  }
  await gameDb.setScannedBlockHeight(treasuryAddress, Math.max(scannedBlockHeight, safeHeight));
  return { skipped: null, tip, ...outcome };
};

/** Settles one known deposit transaction right away (used while a player waits). */
export const checkDepositTx = async (txHash: string) => {
  const { treasuryAddress } = await gameDb.watcherState();
  if (!treasuryAddress) return { confirmations: 0, credited: false };
  const [tip, [tx]] = await Promise.all([tipHeight(4500), txInfo<KoiosTx>([txHash], 4500)]);
  if (!tx) return { confirmations: 0, credited: false };
  const outcome: ScanOutcome = { credited: 0, unmatched: 0, pending: 0, ignored: 0 };
  await settle([tx], treasuryAddress, tip, outcome);
  return { confirmations: confirmations(tx.block_height, tip), credited: outcome.credited > 0 };
};
