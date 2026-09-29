import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { JsonLd } from "@/components/json-ld";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import { PAGES, SITE_NAME, SITE_URL, pageMetadata, siteSchema } from "@/lib/seo";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

// The landing page's search and preview data are the defaults; other pages set their own (lib/seo.ts).
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  category: "technology",
  authors: [{ name: "300", url: SITE_URL }],
  creator: "300",
  publisher: "300",
  icons: { icon: "/300-logo.jpg", apple: "/300-logo.jpg" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  ...pageMetadata(PAGES.home),
};

export const viewport: Viewport = {
  themeColor: "#050506",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans">
        <JsonLd data={siteSchema} />
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
