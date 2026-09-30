import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { RewardsPage } from "@/components/rewards/rewards-page";
import { SiteFooter } from "@/components/sections";
import { SiteHeader } from "@/components/site-header";
import { DelegationProvider } from "@/components/wallet/delegation";
import { WalletDialog } from "@/components/wallet/wallet-dialog";
import { PAGES, pageMetadata, rewardsSchema } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(PAGES.rewards);

export default function RewardsRoute() {
  return (
    <DelegationProvider>
      <JsonLd data={rewardsSchema} />
      <SiteHeader />
      <main>
        <RewardsPage />
      </main>
      <SiteFooter />
      <WalletDialog />
    </DelegationProvider>
  );
}
