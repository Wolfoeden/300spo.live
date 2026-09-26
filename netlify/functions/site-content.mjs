import { readContent } from "./_shared/content-store.mjs";
export default async () => new Response(JSON.stringify(await readContent()), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-cache" } });
export const config = { path: "/api/site-content" };
