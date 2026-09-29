import { isOurDrep, isOurPool } from "../delegation";
import { gameDb } from "./game-db";
import { koios } from "./koios";

type AccountInfo = { status?: string; delegated_pool?: string | null; delegated_drep?: string | null; total_balance?: string | null };

/**
 * The one-time starting credit for a stake address delegated to the 300 stake
 * pool (the pool amount) or only to the 300 DRep (the base amount). The chain
 * says whether and where it delegates and how much ADA it holds; the database
 * applies its minimum, books the credit once and tops up an earlier, smaller one.
 */
export async function claimWelcome(wallet: string) {
  if (!wallet.startsWith("stake1")) return { status: "not_delegated" as const };
  const [info] = await koios<AccountInfo[]>("account_info", { _stake_addresses: [wallet] });
  const registered = info?.status === "registered";
  const pool = registered && isOurPool(info.delegated_pool);
  const drep = registered && isOurDrep(info.delegated_drep);
  if (!pool && !drep) return { status: "not_delegated" as const };
  return gameDb.claimWelcome(wallet, BigInt(info.total_balance ?? "0"), pool);
}
