export const POOL_ID = "pool1v8gvy6tjp8x8wg5h4jw20p9up04lxgw0l0lgery9mz4h7h9x25n";
export const POOL_ID_HEX = "61d0c2697209cc772297ac9ca784bc0bebf321cffbfe8c8c85d8ab7f";
export const DREP_ID = "drep1y293f6495fvld5zqv0uqsjpjt25zzdkjglys7ykc678jtkghet05n";

/** The 300 native token (registry ticker "EOO", no decimals). */
export const TOKEN_300 = {
  policyId: "8de0817b91cb94a0c69d5eaf63d306ad21012455d3e75b007c50ae06",
  assetNameHex: "333030",
  fingerprint: "asset15wfx27rlczlyxd760tz45kecszj8e5ps0hrsc0",
  decimals: 0,
} as const;

export const PARTNER_LINKS = {
  midnight: "https://midnight.network",
  realfi: "https://realfi.co",
} as const;

export const LINKS = {
  poolPm: `https://pool.pm/${POOL_ID_HEX}`,
  /** The pool's live data (stake, delegators, blocks) on an explorer. */
  poolLive: `https://cexplorer.io/pool/${POOL_ID}`,
  cardanoOrg: "https://cardano.org/",
  buyAda: "https://cardanomix.com",
  wallet: "/wallet/",
  play: "/play/",
  governance: "/governance/",
  rewards: "/rewards/",
  admin: "/admin/",
} as const;
