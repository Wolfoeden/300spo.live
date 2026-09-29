import type { Metadata } from "next";
import { FAQ } from "./faq";
import { LOBBY_LIVE } from "./game/catalog";
import { DREP_ID, LINKS, POOL_ID } from "./site";

// Search and link previews for the public pages: titles and descriptions that
// name what Cardano holders search for (stake pool, DRep, governance, games),
// a 1200×630 preview image per page (public/og, made from the site's own art),
// and schema.org data so search engines know who runs the site and what each
// page is.

export const SITE_URL = "https://300spo.live";
export const SITE_NAME = "300 · Cardano SPO & DRep";

type Page = { path: string; title: string; description: string; image: string; imageAlt: string; keywords: string[] };

const BRAND = ["300", "300 SPO", "300 DRep", "300 token", "300 DEGEN", "Cardano"];

export const PAGES = {
  home: {
    path: "/",
    title: "300 Cardano Stake Pool & DRep – Delegate ADA, Vote, Play",
    description:
      "Stake ADA with 300, an independent Cardano stake pool and DRep: non-custodial delegation, live pool data, transparent governance votes and 300 Games.",
    image: "/og/home.jpg",
    imageAlt: "Stake Cardano with 300 – independent stake pool and DRep",
    keywords: [
      "Cardano stake pool",
      "Cardano SPO",
      "stake ADA",
      "delegate ADA",
      "ADA staking rewards",
      "Cardano DRep",
      "Cardano governance",
      "non-custodial staking",
      ...BRAND,
    ],
  },
  games: {
    path: "/play/",
    title: "300 Games · Provably Fair Cardano Mini-Games",
    description:
      "Play provably fair mini-games on Cardano: a horse race with 300 DEGEN NFT cards and Chicken. Delegate to the 300 stake pool and start with 30,000 game credit.",
    image: "/og/games.jpg",
    imageAlt: "300 Games – provably fair Cardano mini-games with NFT card art",
    keywords: [
      "Cardano games",
      "Cardano gamification",
      "provably fair games",
      "Cardano NFT game",
      "NFT card game",
      "horse race game",
      "chicken road game",
      "stake pool rewards",
      ...BRAND,
    ],
  },
  governance: {
    path: "/governance/",
    title: "300 DRep Votes & Rationales · Cardano Governance",
    description:
      "Every vote of the 300 DRep on Cardano governance actions, from treasury withdrawals to parameter changes, with its rationale. Delegate your voting power to 300.",
    image: "/og/governance.jpg",
    imageAlt: "Every vote, every reason – the 300 DRep on Cardano governance",
    keywords: [
      "Cardano DRep",
      "Cardano governance",
      "CIP-1694",
      "DRep votes",
      "DRep rationale",
      "delegate voting power",
      "Cardano treasury",
      "Voltaire",
      ...BRAND,
    ],
  },
} satisfies Record<string, Page>;

export const pageMetadata = ({ path, title, description, image, imageAlt, keywords }: Page): Metadata => ({
  title,
  description,
  keywords,
  alternates: { canonical: path },
  openGraph: {
    type: "website",
    url: path,
    siteName: SITE_NAME,
    locale: "en_US",
    title,
    description,
    images: [{ url: image, width: 1200, height: 630, alt: imageAlt }],
  },
  twitter: { card: "summary_large_image", title, description, images: [{ url: image, alt: imageAlt }] },
});

const ORG = `${SITE_URL}/#organization`;
const WEBSITE = `${SITE_URL}/#website`;

/** Who runs the site: on every page. */
export const siteSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": ORG,
      name: "300",
      alternateName: ["300 SPO", "300 DRep", "300 Cardano stake pool"],
      url: `${SITE_URL}/`,
      logo: `${SITE_URL}/300-logo.jpg`,
      description: "Independent Cardano stake pool operator and delegated representative (DRep).",
      sameAs: [LINKS.poolLive, LINKS.poolPm, `https://gov.tools/drep_directory/${DREP_ID}`],
      identifier: [
        { "@type": "PropertyValue", propertyID: "Cardano pool ID", value: POOL_ID },
        { "@type": "PropertyValue", propertyID: "Cardano DRep ID", value: DREP_ID },
      ],
    },
    { "@type": "WebSite", "@id": WEBSITE, url: `${SITE_URL}/`, name: SITE_NAME, publisher: { "@id": ORG }, inLanguage: "en" },
  ],
};

const breadcrumbs = (name: string, path: string) => ({
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "300", item: `${SITE_URL}/` },
    { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
  ],
});

/** The landing page: the page itself and its Cardano FAQ. */
export const homeSchema = {
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebPage", "@id": `${SITE_URL}/#webpage`, url: `${SITE_URL}/`, name: PAGES.home.title, isPartOf: { "@id": WEBSITE }, about: { "@id": ORG } },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map(([question, answer]) => ({ "@type": "Question", name: question, acceptedAnswer: { "@type": "Answer", text: answer } })),
    },
  ],
};

/** /play: the games it offers. */
export const gamesSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": `${SITE_URL}/play/#webpage`,
      url: `${SITE_URL}/play/`,
      name: PAGES.games.title,
      description: PAGES.games.description,
      isPartOf: { "@id": WEBSITE },
      mainEntity: {
        "@type": "ItemList",
        itemListElement: LOBBY_LIVE.map((tile, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: {
            "@type": "VideoGame",
            name: `${tile.title} – 300 Games`,
            description: tile.tagline,
            url: `${SITE_URL}/play/#${tile.slug}`,
            gamePlatform: "Web browser",
            applicationCategory: "Game",
            playMode: "SinglePlayer",
            publisher: { "@id": ORG },
          },
        })),
      },
    },
    breadcrumbs("Games", "/play/"),
  ],
};

/** /governance: the DRep's voting record. */
export const governanceSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${SITE_URL}/governance/#webpage`,
      url: `${SITE_URL}/governance/`,
      name: PAGES.governance.title,
      description: PAGES.governance.description,
      isPartOf: { "@id": WEBSITE },
      about: [{ "@type": "Thing", name: "Cardano governance (CIP-1694)" }, { "@id": ORG }],
    },
    breadcrumbs("Governance", "/governance/"),
  ],
};
