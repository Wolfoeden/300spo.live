import type { Config, Context } from "@netlify/functions";
import { addressBytesFromWallet, addressToBech32, drepCredential, isRewardAddress, sameBytes } from "../../lib/cardano/address";
import { DREP_ID, POOL_ID } from "../../lib/site";

// The public Koios tier answers in 1–8 s, so each request makes exactly one
// upstream call and stays inside Netlify's 10 s function limit.
const KOIOS = "https://api.koios.rest/api/v1";
const UPSTREAM_TIMEOUT_MS = 8500;

const koios = async (path: string, body?: unknown) => {
  const response = await fetch(`${KOIOS}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Koios ${path} returned ${response.status}`);
  return response.json();
};

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

  const accounts = await koios("account_info", { _stake_addresses: [stakeAddress] });
  const info = Array.isArray(accounts) ? accounts[0] : undefined;
  const registered = info?.status === "registered";
  return json(
    {
      stakeAddress,
      registered,
      delegatedPool: registered ? (info.delegated_pool ?? null) : null,
      delegatedDrep: registered ? (info.delegated_drep ?? null) : null,
      delegatedTo300: { pool: registered && info.delegated_pool === POOL_ID, drep: registered && isOurDrep(info.delegated_drep) },
    },
    200,
    { "netlify-cdn-cache-control": "public, durable, max-age=20", "netlify-vary": "query=stake" },
  );
};

/** GET /api/chain/params — protocol parameters; they only change at epoch boundaries. */
const params = async () => {
  const cli = await koios("cli_protocol_params");
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
