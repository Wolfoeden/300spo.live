import { BlockArrivals } from "@/components/block-arrivals";
import { LiveDataProvider } from "@/components/data/live-data";
import { Guide } from "@/components/guide";
import { Hero } from "@/components/hero";
import { Faq, FinalCta, Participate, Partners, SiteFooter } from "@/components/sections";
import { SiteHeader } from "@/components/site-header";
import { DelegationProvider } from "@/components/wallet/delegation";
import { WalletDialog } from "@/components/wallet/wallet-dialog";

export default function HomePage() {
  return (
    <LiveDataProvider>
      <DelegationProvider>
      <SiteHeader />
      <main>
        <Hero />
        <Guide />
        <BlockArrivals />
        <Partners />
        <Participate />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <WalletDialog />
      </DelegationProvider>
    </LiveDataProvider>
  );
}
