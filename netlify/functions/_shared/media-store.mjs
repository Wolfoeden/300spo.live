const connection = () => {
  const encoded = Netlify.env.get("NETLIFY_BLOBS_CONTEXT");
  if (!encoded) throw new Error("Media storage is unavailable.");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
};

const endpoint = (key) => {
  const context = connection();
  const base = context.edgeURL || context.url;
  return { context, url: new URL(`/${context.siteID}/site:site-media/${key}`, base) };
};

export const saveImage = async ({ dataUrl, slot }) => {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) throw new Error("Use a PNG, JPG, WebP, or GIF image.");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 5 * 1024 * 1024) throw new Error("Image must be smaller than 5 MB.");
  const cleanSlot = ["buy", "spo", "drep"].includes(slot) ? slot : "image";
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[match[1]];
  const key = `${cleanSlot}-${Date.now()}.${extension}`;
  const { context, url } = endpoint(key);
  const response = await fetch(url, { method: "PUT", body: bytes, headers: { authorization: `Bearer ${context.token}`, "content-type": match[1], "cache-control": "max-age=31536000" } });
  if (!response.ok) throw new Error(`Media storage returned ${response.status}.`);
  return { key, url: `/api/media/${encodeURIComponent(key)}` };
};

export const readImage = async (key) => {
  if (!/^[a-z0-9._-]+$/i.test(key || "")) return null;
  const { context, url } = endpoint(key);
  const response = await fetch(url, { headers: { authorization: `Bearer ${context.token}` } });
  return response.status === 404 ? null : response;
};
