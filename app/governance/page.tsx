import type { Metadata } from "next";
import { GovernancePage } from "@/components/governance/governance-page";
import { JsonLd } from "@/components/json-ld";
import { SiteFooter } from "@/components/sections";
import { SiteHeader } from "@/components/site-header";
import { DelegationProvider } from "@/components/wallet/delegation";
import { WalletDialog } from "@/components/wallet/wallet-dialog";
import { PAGES, governanceSchema, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(PAGES.governance);

export default function GovernanceRoute() {
  return (
    <DelegationProvider>
      <JsonLd data={governanceSchema} />
      <SiteHeader />
      <main>
        <GovernancePage />
      </main>
      <SiteFooter />
      <WalletDialog />
    </DelegationProvider>
  );
}
