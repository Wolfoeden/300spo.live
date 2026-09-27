import type { Metadata } from "next";
import { AdminLogin } from "@/components/admin/admin-login";
import { SiteHeader } from "@/components/site-header";
import { WalletDialog } from "@/components/wallet/wallet-dialog";

export const metadata: Metadata = {
  title: "Admin sign-in | 300",
  robots: { index: false, follow: false },
};

export default function AdminLoginRoute() {
  return (
    <>
      <SiteHeader />
      <main className="container-site pb-24 pt-32">
        <AdminLogin />
      </main>
      <WalletDialog />
    </>
  );
}
