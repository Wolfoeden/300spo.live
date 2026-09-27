import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { WalletProvider } from "@/components/wallet/wallet-provider";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://300spo.live"),
  title: "Stake Cardano with 300 | SPO & DRep",
  description:
    "Delegate ADA to the independent 300 stake pool and choose 300 as your Cardano DRep. Live pool data, clear Cardano education and transparent governance.",
  alternates: { canonical: "/" },
  icons: { icon: "/300-logo.jpg" },
  openGraph: {
    title: "Stake Cardano with 300",
    description: "Independent Cardano infrastructure, non-custodial delegation and responsible on-chain governance.",
    url: "https://300spo.live/",
    siteName: "300 SPO & DRep",
    images: ["/300-hero.jpg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Stake Cardano with 300",
    description: "Independent Cardano infrastructure and responsible governance.",
    images: ["/300-hero.jpg"],
  },
};

export const viewport: Viewport = {
  themeColor: "#050506",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body className="font-sans">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
