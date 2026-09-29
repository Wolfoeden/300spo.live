/** Small gold ribbon for things that are announced but not released. */
export function SoonBadge() {
  return (
    <span className="rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 font-mono text-[0.55rem] font-semibold uppercase tracking-[0.12em] text-gold">
      Soon
    </span>
  );
}

/** The 300 Wallet button while the wallet is not released: visible, but blocked. */
export function WalletSoonButton() {
  return (
    <span aria-disabled="true" title="The 300 Wallet is coming soon" className="btn btn-ghost cursor-not-allowed opacity-60">
      300 Wallet <SoonBadge />
    </span>
  );
}
