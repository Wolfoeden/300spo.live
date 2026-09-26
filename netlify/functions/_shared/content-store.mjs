export const defaults = {
  heroAnnouncement: "300 SPO is now powered by Midnight and RealFi.",
  partnerKicker: "Our partners",
  partnerHeading: "300 SPO, powered by Midnight and RealFi.",
  partnerBody: "Building a stronger, more useful stake pool together across the Cardano ecosystem.",
  buyImage: "/300-hero.jpg",
  spoImage: "/300-logo.jpg",
  drepImage: "/300-logo.jpg",
};

const connection = () => {
  const encoded = Netlify.env.get("NETLIFY_BLOBS_CONTEXT");
  if (!encoded) throw new Error("Content storage is unavailable.");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
};

const request = async (method, body) => {
  const context = connection();
  const endpoint = context.edgeURL || context.url;
  const url = new URL(`/${context.siteID}/site:site-content/homepage`, endpoint);
  return fetch(url, {
    method,
    body,
    headers: {
      authorization: `Bearer ${context.token}`,
      ...(body ? { "content-type": "application/json", "cache-control": "max-age=0, stale-while-revalidate=60" } : {}),
    },
  });
};

export const readContent = async () => {
  const response = await request("GET");
  if (response.status === 404) return defaults;
  if (!response.ok) throw new Error(`Content storage returned ${response.status}.`);
  return { ...defaults, ...(await response.json()) };
};
export const writeContent = async (content) => {
  const clean = Object.fromEntries(Object.keys(defaults).map((key) => [key, String(content[key] ?? defaults[key]).trim()]));
  const response = await request("PUT", JSON.stringify(clean));
  if (!response.ok) throw new Error(`Content storage returned ${response.status}.`);
  return clean;
};
