import { readImage } from "./_shared/media-store.mjs";

export default async (_request, context) => {
  const response = await readImage(context.params.key);
  if (!response) return new Response("Not found", { status: 404 });
  return new Response(response.body, { status: response.status, headers: { "content-type": response.headers.get("content-type") || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
};
export const config = { path: "/api/media/:key" };
