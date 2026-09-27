import type { Metadata } from "next";
import { GamePage } from "@/components/game/game-page";
import { SiteFooter } from "@/components/sections";
import { SiteHeader } from "@/components/site-header";
import { DelegationProvider } from "@/components/wallet/delegation";
import { WalletDialog } from "@/components/wallet/wallet-dialog";

// Not linked from the landing page yet and kept out of search engines.
export const metadata: Metadata = {
  title: "Play | 300",
  description: "Spend 300 tokens on game rounds and earn drip rewards for holding and staking with 300.",
  robots: { index: false, follow: false },
  alternates: { canonical: "/play/" },
};

export default function PlayRoute() {
  return (
    <DelegationProvider>
      <SiteHeader />
      <main>
        <GamePage />
      </main>
      <SiteFooter />
      <WalletDialog />
    </DelegationProvider>
  );
}
