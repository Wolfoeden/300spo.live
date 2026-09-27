// Types for admin-auth.mjs so TypeScript functions can reuse the admin session.
export function adminWallet(request: Request): string | null;
export function isAuthenticated(request: Request): boolean;
export function isConfigured(): boolean;
export function passwordLoginEnabled(): boolean;
export function json(body: unknown, status?: number, headers?: Record<string, string>): Response;
