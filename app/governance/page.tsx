import type { Metadata } from "next";
import { GovernancePage } from "@/components/governance/governance-page";
import { SiteFooter } from "@/components/sections";
import { SiteHeader } from "@/components/site-header";
import { DelegationProvider } from "@/components/wallet/delegation";
import { WalletDialog } from "@/components/wallet/wallet-dialog";

export const metadata: Metadata = {
  title: "Governance | 300",
  description: "Every vote of the 300 DRep on Cardano governance actions, with the rationale published on chain.",
  alternates: { canonical: "/governance/" },
};

export default function GovernanceRoute() {
  return (
    <DelegationProvider>
      <SiteHeader />
      <main>
        <GovernancePage />
      </main>
      <SiteFooter />
      <WalletDialog />
    </DelegationProvider>
  );
}
