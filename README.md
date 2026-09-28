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

## Game balance and games (`/play`)

Players deposit 300 tokens as game credit and bet it on three games. Winnings
are game credit too. **There are no withdrawals**: nothing ever leaves the
treasury towards a player.

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
4. A bet (`/api/game/play` with game, bet and pick) is settled in one database
   transaction by `game.play()`: the bet is deducted, the outcome drawn and a
   correct pick credited with bet × payout. The balance can never go negative.

| Game | Outcomes | Payout |
| --- | --- | --- |
| `coin-flip` — Xerxes or 300 | 2 | 2× |
| `card-race` — horse race with playing cards | 4 | odds of the dealt track |
| `xerxes-vs-robot` — Xerxes against the AI robot | 2 | 2× |

The fixed payouts are fair odds (no house edge). Bets run from 300 to 3,000 in
steps of 300. Limits, payouts and per-game switches are set in `/admin/`.
What each outcome index means lives in `lib/game/catalog.ts`; the animations
in `components/game/arena.tsx` only replay the outcome the server returned.
The retired five-horse `horse-race` stays in the database for old rounds.

`/play` is a lobby of game tiles (live: horse race, coin flip; announced as
coming soon: Xerxes vs AI robot, Chicken, Dice, Sparta Board, Wheel of 300 —
`LOBBY_LIVE` / `LOBBY_SOON` in `lib/game/catalog.ts`). The open game lives in
the URL hash (`#horse-race`, `#horse-race/4`, `#coin-flip`).

**Horse race (cards).** The four aces are the horses. Seven cards from the
shuffled 48 lie face up as the track; the player sees them and the odds before
betting (`/api/game/race`). The dealer turns the rest one by one: each card
moves the ace of its suit one step. When every ace has reached track card k,
the ace of that card's suit steps back once. The first ace to reach step 8
wins. The odds are the exact fair payout 1/p for each ace (rounded down,
capped at 100×, "—" when an ace cannot win), computed over all orders of the
remaining 41 cards (`lib/game/card-race.ts`) and stored per track pattern in
`game.race_odds` (`scripts/race-odds.ts` generates it; a test checks the
table's checksum). A bet names the deal it was placed on (nonce and server seed
hash), so nobody bets on odds they did not see. Every card wears art from the
300 DEGEN NFT collection on its suit colour (`lib/game/card-art.ts`,
`public/cards`, built with `scripts/card-art.cjs`).

**4× mode** (like the four games of a "Pharao" machine): `/api/game/race?count=4`
deals the wallet's next four nonces; `/api/game/play-races` plays the picked
ones in one transaction (`game.play_race_multi`, same bet each, skipped deals
use up their nonce without a bet, the whole stake must be covered up front).

**Provably fair.** Every wallet has a secret server seed whose SHA-256 is shown
in advance, a client seed it can choose, and a nonce counting its bets:

```
outcome = floor(u32(HMAC-SHA256(server seed, "<client seed>:<nonce>")[0..4]) × outcomes / 2^32)
```

The horse race shuffles its deck with Fisher–Yates driven by
HMAC-SHA256(server seed, "<client seed>:<nonce>:race:<block>").

"Reveal seed & start new" (`/api/game/seed`) publishes the old server seed;
the page then checks its hash and recomputes every listed round in the browser
(`lib/game/fair.ts`).

Data lives in the Supabase project `300` (schema `game`, see
`supabase/migrations`). The tables are only reachable through `SECURITY
DEFINER` functions; Netlify connects as the role `game_api`, which may execute
those functions and nothing else. Treasury address, bet limits, minimum
deposit, games and the on/off switch are set in `/admin/`.

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
| `ADMIN_WALLETS` | Comma-separated stake (or payment) addresses that may open `/admin/` after the wallet sign-in; an admin session lasts at most 12 hours. |
| `ADMIN_PASSWORD` | Optional fallback password login for `/admin/`. Remove it once the wallet login works; the password form then disappears. |
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
