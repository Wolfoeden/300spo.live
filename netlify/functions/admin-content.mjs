import { isAuthenticated, json } from "./_shared/admin-auth.mjs";
import { readContent, writeContent } from "./_shared/content-store.mjs";
export default async (request) => {
  if (!isAuthenticated(request)) return json({ error: "Unauthorized." }, 401);
  if (request.method === "GET") return json(await readContent());
  if (request.method === "PUT") return json(await writeContent(await request.json().catch(() => ({}))));
  return json({ error: "Method not allowed." }, 405, { allow: "GET, PUT" });
};
export const config = { path: "/api/admin/content" };
