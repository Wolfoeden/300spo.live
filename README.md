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

## Environment variables (Netlify)

| Name | Used by |
| --- | --- |
| `ADMIN_PASSWORD` | Admin CMS login |
| `WALLET_SESSION_SECRET` | Signs wallet sign-in challenges and sessions; at least 32 random characters. Without it `/api/wallet-auth/*` answers `503 not_configured`. |

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
