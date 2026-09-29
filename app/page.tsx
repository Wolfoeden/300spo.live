import { LiveDataProvider } from "@/components/data/live-data";
import { DripSection } from "@/components/drip/drip-section";
import { Guide } from "@/components/guide";
import { Hero } from "@/components/hero";
import { Faq, FinalCta, Partners, SiteFooter } from "@/components/sections";
import { SiteHeader } from "@/components/site-header";
import { DelegationProvider } from "@/components/wallet/delegation";
import { WalletDialog } from "@/components/wallet/wallet-dialog";
import { WelcomeCredit } from "@/components/welcome-credit";

export default function HomePage() {
  return (
    <LiveDataProvider>
      <DelegationProvider>
      <SiteHeader />
      <main>
        <Hero />
        <Guide />
        <DripSection />
        <Partners />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
      <WalletDialog />
      <WelcomeCredit />
      </DelegationProvider>
    </LiveDataProvider>
  );
}
