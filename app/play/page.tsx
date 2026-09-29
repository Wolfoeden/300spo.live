import type { Metadata } from "next";
import { GamePage } from "@/components/game/game-page";
import { JsonLd } from "@/components/json-ld";
import { SiteFooter } from "@/components/sections";
import { SiteHeader } from "@/components/site-header";
import { DelegationProvider } from "@/components/wallet/delegation";
import { WalletDialog } from "@/components/wallet/wallet-dialog";
import { PAGES, gamesSchema, pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata(PAGES.games);

export default function PlayRoute() {
  return (
    <DelegationProvider>
      <JsonLd data={gamesSchema} />
      <SiteHeader />
      <main>
        <GamePage />
      </main>
      <SiteFooter />
      <WalletDialog />
    </DelegationProvider>
  );
}
