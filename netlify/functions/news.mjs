const items = [
  {
    title: "CF and SENAI deepen blockchain education in Brazil",
    date: "2026-06-25",
    summary: "Cardano Foundation coverage on education, adoption, and ecosystem growth.",
    url: "https://cardano.org/news/2026-06-25-cf-senai-partnership/",
  },
  {
    title: "Cardano Community Digest",
    date: "2026-06-24",
    summary: "A roundup of ecosystem updates, governance notes, and community activity.",
    url: "https://cardano.org/news/2026-06-24-community-digest/",
  },
  {
    title: "Cardano data without infrastructure",
    date: "2026-06-22",
    summary: "A technical update for builders working with Cardano data access.",
    url: "https://cardano.org/news/2026-06-22-cardano-data-without-infrastructure/",
  },
];

export default async () =>
  new Response(JSON.stringify({ items, updatedAt: new Date().toISOString() }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=600, stale-while-revalidate=3600",
    },
  });

export const config = {
  path: "/api/news",
};
