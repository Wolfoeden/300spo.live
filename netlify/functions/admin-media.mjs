import { isAuthenticated, json } from "./_shared/admin-auth.mjs";
import { saveImage } from "./_shared/media-store.mjs";

export default async (request) => {
  if (!isAuthenticated(request)) return json({ error: "Unauthorized." }, 401);
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, { allow: "POST" });
  try { return json(await saveImage(await request.json())); }
  catch (error) { return json({ error: error.message || "Upload failed." }, 400); }
};
export const config = { path: "/api/admin/media" };
