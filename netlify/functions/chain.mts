import type { Config, Context } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, drepCredential, isRewardAddress, sameBytes } from "../../lib/cardano/address";
import { koios } from "../../lib/server/koios";
import { DREP_ID, POOL_ID } from "../../lib/site";

// Each request makes exactly one Koios call to stay inside Netlify's 10 s limit.

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

const isOurDrep = (value: unknown) => {
  if (typeof value !== "string" || !value.startsWith("drep")) return false;
  try {
    return sameBytes(drepCredential(value).hash, drepCredential(DREP_ID).hash);
  } catch {
    return false;
  }
};

/** GET /api/chain/account?stake=<stake address> — registration and delegation state. */
const account = async (request: Request) => {
  const stake = new URL(request.url).searchParams.get("stake") ?? "";
  let stakeAddress: string;
  try {
    const bytes = addressBytesFromWallet(stake);
    if (!isRewardAddress(bytes)) throw new Error("not a reward address");
    stakeAddress = addressToBech32(bytes);
  } catch {
    return json({ error: "invalid_stake_address" }, 400);
  }
  if (!stakeAddress.startsWith("stake1")) return json({ error: "mainnet_only" }, 400);

  type AccountInfo = { status?: string; delegated_pool?: string | null; delegated_drep?: string | null };
  const accounts = await koios<AccountInfo[]>("account_info", { _stake_addresses: [stakeAddress] });
  const info = Array.isArray(accounts) ? accounts[0] : undefined;
  const registered = info?.status === "registered";
  return json(
    {
      stakeAddress,
      registered,
      delegatedPool: registered ? (info?.delegated_pool ?? null) : null,
      delegatedDrep: registered ? (info?.delegated_drep ?? null) : null,
      delegatedTo300: { pool: registered && info?.delegated_pool === POOL_ID, drep: registered && isOurDrep(info?.delegated_drep) },
    },
    200,
    { "netlify-cdn-cache-control": "public, durable, max-age=20", "netlify-vary": "query=stake" },
  );
};

/** GET /api/chain/params — protocol parameters; they only change at epoch boundaries. */
const params = async () => {
  type CliParams = { txFeePerByte: number; txFeeFixed: number; stakeAddressDeposit: number; utxoCostPerByte: number; maxTxSize: number };
  const cli = await koios<CliParams>("cli_protocol_params");
  return json(
    {
      minFeeA: String(cli.txFeePerByte),
      minFeeB: String(cli.txFeeFixed),
      keyDeposit: String(cli.stakeAddressDeposit),
      coinsPerUtxoByte: String(cli.utxoCostPerByte),
      maxTxSize: Number(cli.maxTxSize),
    },
    200,
    { "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, durable, max-age=3600, stale-while-revalidate=86400" },
  );
};

export default async (request: Request, context: Context) => {
  try {
    if (context.params.resource === "params") return await params();
    if (context.params.resource === "account") return await account(request);
    return json({ error: "not_found" }, 404);
  } catch (error) {
    console.error("[chain]", error);
    return json({ error: "chain_unavailable" }, 502);
  }
};

export const config: Config = { path: "/api/chain/:resource" };
