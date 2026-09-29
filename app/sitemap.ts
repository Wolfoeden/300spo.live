import type { MetadataRoute } from "next";
import { PAGES, SITE_URL } from "@/lib/seo";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const built = new Date();
  return [
    { page: PAGES.home, changeFrequency: "daily" as const, priority: 1 },
    { page: PAGES.games, changeFrequency: "weekly" as const, priority: 0.9 },
    { page: PAGES.governance, changeFrequency: "daily" as const, priority: 0.9 },
  ].map(({ page, changeFrequency, priority }) => ({
    url: `${SITE_URL}${page.path}`,
    lastModified: built,
    changeFrequency,
    priority,
    images: [`${SITE_URL}${page.image}`],
  }));
}
