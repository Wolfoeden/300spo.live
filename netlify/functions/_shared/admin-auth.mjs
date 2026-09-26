import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "spo_admin_session";
const tokenFor = (password) => createHmac("sha256", password).update("300spo-admin-v1").digest("hex");

const adminPassword = () => Netlify.env.get("ADMIN_PASSWORD");
export const isConfigured = () => Boolean(adminPassword());
export const isAuthenticated = (request) => {
  const expected = adminPassword();
  if (!expected) return false;
  const match = (request.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return false;
  const supplied = Buffer.from(decodeURIComponent(match[1]));
  const token = Buffer.from(tokenFor(expected));
  return supplied.length === token.length && timingSafeEqual(supplied, token);
};
export const passwordMatches = (password) => {
  const expected = adminPassword();
  if (!expected || typeof password !== "string") return false;
  const supplied = Buffer.from(password);
  const target = Buffer.from(expected);
  return supplied.length === target.length && timingSafeEqual(supplied, target);
};
export const sessionCookie = (request) => `${COOKIE_NAME}=${tokenFor(adminPassword())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
export const clearCookie = () => `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure`;
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
