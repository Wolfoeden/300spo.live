const poolId = "pool1v8gvy6tjp8x8wg5h4jw20p9up04lxgw0l0lgery9mz4h7h9x25n";
const drepId = "drep1y293f6495fvld5zqv0uqsjpjt25zzdkjglys7ykc678jtkghet05n";
const tokenPolicy = "8de0817b91cb94a0c69d5eaf63d306ad21012455d3e75b007c50ae06";
const tokenName = "333030";

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120, stale-while-revalidate=600",
      ...(init.headers || {}),
    },
  });

const koiosPost = async (path, body) => {
  const response = await fetch(`https://api.koios.rest/api/v1/${path}`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
};

const koiosGet = async (path) => {
  const response = await fetch(`https://api.koios.rest/api/v1/${path}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
};

export default async () => {
  const [poolResult, drepResult, assetResult, tipResult] = await Promise.allSettled([
    koiosPost("pool_info", { _pool_bech32_ids: [poolId] }),
    koiosPost("drep_info", { _drep_ids: [drepId] }),
    koiosGet(`asset_info?_asset_policy=${tokenPolicy}&_asset_name=${tokenName}`),
    koiosGet("tip"),
  ]);

  const pool = poolResult.status === "fulfilled" ? poolResult.value?.[0] : null;
  const drep = drepResult.status === "fulfilled" ? drepResult.value?.[0] : null;
  const token = assetResult.status === "fulfilled" ? assetResult.value?.[0] : null;
  const tip = tipResult.status === "fulfilled" ? tipResult.value?.[0] : null;

  return json({
    pool: pool
      ? {
          liveStakeLovelace: pool.live_stake ?? null,
          liveDelegators: pool.live_delegators ?? null,
          liveSaturation: pool.live_saturation ?? null,
          blockCount: pool.block_count ?? null,
          status: pool.pool_status ?? null,
          margin: pool.margin ?? null,
          fixedCostLovelace: pool.fixed_cost ?? null,
          pledgeLovelace: pool.pledge ?? null,
        }
      : null,
    drep: drep
      ? {
          amountLovelace: drep.amount ?? null,
          status: drep.drep_status ?? null,
          active: drep.active ?? null,
        }
      : null,
    token: token
      ? {
          totalSupply: token.total_supply ?? null,
          ticker: token.token_registry_metadata?.ticker ?? token.asset_name_ascii ?? "300",
        }
      : null,
    nfts: {
      total: 300,
    },
    chain: tip
      ? {
          blockHeight: tip.block_height ?? tip.block_no ?? null,
          blockTime: tip.block_time ?? null,
        }
      : null,
    updatedAt: new Date().toISOString(),
  });
};

export const config = {
  path: "/api/metrics",
};
