import { LiveDataProvider } from "@/components/data/live-data";
import { MidnightCityAd } from "@/components/ads";
import { DripSection } from "@/components/drip/drip-section";
import { Guide } from "@/components/guide";
import { Hero } from "@/components/hero";
import { Faq, FinalCta, Partners, SiteFooter } from "@/components/sections";
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
        <MidnightCityAd />
        <Guide />
        <DripSection />
        <Partners />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <WalletDialog />
      </DelegationProvider>
    </LiveDataProvider>
  );
}
