import {
  adminWallet,
  clearCookie,
  clearWalletCookie,
  isAuthenticated,
  isConfigured,
  json,
  passwordLoginEnabled,
  passwordMatches,
  sessionCookie,
} from "./_shared/admin-auth.mjs";

export default async (request) => {
  if (request.method === "GET") {
    return json({
      configured: isConfigured(),
      authenticated: isAuthenticated(request),
      wallet: adminWallet(request),
      passwordLogin: passwordLoginEnabled(),
    });
  }
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (!passwordLoginEnabled()) return json({ error: "Password login is disabled. Sign in with the admin wallet." }, 403);
    if (!passwordMatches(body.password)) return json({ error: "Invalid password." }, 401);
    return json({ configured: true, authenticated: true }, 200, { "set-cookie": sessionCookie(request) });
  }
  if (request.method === "DELETE") {
    // Signs out of both the password session and the wallet session.
    const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    headers.append("set-cookie", clearCookie());
    headers.append("set-cookie", clearWalletCookie(request));
    return new Response(JSON.stringify({ configured: isConfigured(), authenticated: false }), { status: 200, headers });
  }
  return json({ error: "Method not allowed." }, 405, { allow: "GET, POST, DELETE" });
};
export const config = { path: "/api/admin/session" };
