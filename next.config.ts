import type { NextConfig } from "next";

// Production is a static export served by Netlify; /api/* is handled by the
// functions in netlify/functions. During `next dev` those requests are proxied
// to `pnpm dev:api`, which runs the same function modules locally.
const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  trailingSlash: true,
  images: { unoptimized: true },
  ...(isDev
    ? {
        async rewrites() {
          return [{ source: "/api/:path*", destination: "http://localhost:5177/api/:path*" }];
        },
      }
    : { output: "export" }),
};

export default nextConfig;
