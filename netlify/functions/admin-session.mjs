import { clearCookie, isAuthenticated, isConfigured, json, passwordMatches, sessionCookie } from "./_shared/admin-auth.mjs";

export default async (request) => {
  if (request.method === "GET") return json({ configured: isConfigured(), authenticated: isAuthenticated(request) });
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!isConfigured()) return json({ error: "Admin password is not configured." }, 503);
    if (!passwordMatches(body.password)) return json({ error: "Invalid password." }, 401);
    return json({ configured: true, authenticated: true }, 200, { "set-cookie": sessionCookie(request) });
  }
  if (request.method === "DELETE") return json({ configured: isConfigured(), authenticated: false }, 200, { "set-cookie": clearCookie() });
  return json({ error: "Method not allowed." }, 405, { allow: "GET, POST, DELETE" });
};
export const config = { path: "/api/admin/session" };
