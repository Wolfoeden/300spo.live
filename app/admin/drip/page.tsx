import type { Metadata } from "next";
import { DripAdmin } from "@/components/drip/drip-admin";
import { SiteHeader } from "@/components/site-header";
import { WalletDialog } from "@/components/wallet/wallet-dialog";

export const metadata: Metadata = {
  title: "Drip admin | 300",
  robots: { index: false, follow: false },
};

export default function DripAdminRoute() {
  return (
    <>
      <SiteHeader />
      <main className="container-site pb-24 pt-28">
        <p className="kicker">Admin</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em]">Drip rewards</h1>
        <p className="mt-3 max-w-2xl text-muted">
          Wallets delegated to the 300 pool that hold the minimum amount of 300 tokens share the per-epoch rewards. A snapshot is taken once per epoch;
          rewards accumulate until you pay them out.
        </p>
        <div className="mt-10">
          <DripAdmin />
        </div>
      </main>
      <WalletDialog />
    </>
  );
}
