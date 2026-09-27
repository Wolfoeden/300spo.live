# 300spo.live

Website of the 300 Cardano stake pool and DRep: landing page, live pool data,
wallet connection, admin CMS and the 300 Wallet preview.

## Stack

- Next.js (App Router) as a static export (`out/`), Tailwind CSS 4, Motion
- Netlify Functions in `netlify/functions` for everything under `/api/*`
- Live chain data from [Koios](https://koios.rest)

## Layout

| Path | Purpose |
| --- | --- |
| `app/`, `components/` | Landing page |
| `components/wallet/` | CIP-30 wallet connection (VESPR, Lace, Eternl, …) and sign-in |
| `lib/cardano/` | Address encoding, CIP-30 balance decoding, CIP-8 signature verification |
| `netlify/functions/` | `/api/metrics`, `/api/site-content`, admin CMS, `/api/wallet-auth/*` |
| `public/admin/` | Admin CMS (password in `ADMIN_PASSWORD`) |
| `public/wallet/`, `public/wallet-app/` | 300 Wallet page and its web build (see `WALLET-WEB-INTEGRATION.md`) |
| `public/discover/`, `public/content/` | Older static pages, still linked externally |

## Wallet connection

Wallets are reached through the CIP-30 bridge (`window.cardano.<wallet>`).
The header shows the connected wallet's 300 balance, decoded from
`getBalance()`; the token is identified by policy
`8de0817b91cb94a0c69d5eaf63d306ad21012455d3e75b007c50ae06` and asset name
`300` (`lib/site.ts`).

"Verify ownership" signs a server-issued challenge with CIP-30 `signData`.
`/api/wallet-auth/verify` checks the COSE signature and that the key hashes to
the stake (or payment) credential of the signed address, then sets an HttpOnly
session cookie for seven days. The session identifies a wallet for future
features such as token-based games.

On phones without wallet extensions the dialog explains how to open the site
in a wallet app's built-in browser.

## Game balance (`/play`)

Players deposit 300 tokens and spend them on rounds. **There are no winnings
and no withdrawals**; deposits are game credit only.

1. `/play` (not linked from the landing page, `noindex`) requires the wallet
   sign-in. The session's stake address is the account.
2. A deposit asks `/api/game/deposit` for a reference, then the wallet signs a
   transfer of the tokens to the treasury address with a CIP-20 message
   (`300spo.live game deposit`, reference).
3. `game-watcher` (scheduled, every 2 minutes, production only) scans the
   treasury via Koios and credits transfers that are 5 blocks deep. The
   reference in the metadata decides the account; transfers without one are
   listed in `/admin/` for manual assignment. While a player waits,
   `/api/game/deposit-check` settles their transaction directly.
4. A round (`/api/game/round`) deducts the configured cost in one database
   transaction; the balance can never go negative.

Data lives in the Supabase project `300` (schema `game`, see
`supabase/migrations`). The tables are only reachable through `SECURITY
DEFINER` functions; Netlify connects as the role `game_api`, which may execute
those functions and nothing else. Treasury address, round cost, minimum
deposit and the on/off switch are set in `/admin/`.

## Drip rewards

Wallets that are delegated to the 300 pool and hold at least the minimum
amount of 300 tokens (default 3,000,000, summed per stake key) share
per-epoch reward budgets in ADA, NIGHT or other tokens.

- `drip-run` (scheduled hourly, production only) takes one snapshot per epoch
  from Koios (`asset_addresses`, `pool_delegators`), computes the shares
  (`lib/drip/allocate.ts`: equal, by 300 held or by ADA delegated) and stores
  them in the Supabase schema `drip`. It also confirms payouts that reached 5
  blocks and releases reserved payouts that never landed.
- `/admin/drip/` (admin session): budgets, minimum, split, "Run now",
  snapshots and payouts. A payout pays up to 40 wallets in one transaction
  built in the browser and signed by the connected distribution wallet; the
  rewards are reserved under the transaction hash before signing, so they are
  never paid twice. Token outputs below Cardano's minimum ADA are topped up
  from the distribution wallet.
- `/play` shows each wallet whether it qualifies and its waiting and paid
  rewards (`/api/drip/status`).

## Environment variables (Netlify)

| Name | Used by |
| --- | --- |
| `ADMIN_PASSWORD` | Admin CMS login |
| `WALLET_SESSION_SECRET` | Signs wallet sign-in challenges and sessions; at least 32 random characters. Without it `/api/wallet-auth/*` answers `503 not_configured`. |
| `GAME_DATABASE_URL` | Pooler connection string for the `game_api` role (`aws-1-eu-west-1.pooler.supabase.com:6543`). Locally in `.env.local`, which `pnpm preview` reads. |

## Development

```bash
corepack pnpm@10.20.0 install
corepack pnpm@10.20.0 dev:api   # functions on :5177
corepack pnpm@10.20.0 dev       # Next.js on :3000, proxies /api to :5177
corepack pnpm@10.20.0 test
corepack pnpm@10.20.0 build     # static export + package checks
corepack pnpm@10.20.0 preview   # serves out/ and the functions like production
```

`/api/site-content` needs Netlify Blobs and fails locally; the page then uses
its built-in defaults.

`package.json` pins `rolldown` to 1.2.2 because newer Windows builds of its
native binary are blocked by Smart App Control on the maintainer's machine.
