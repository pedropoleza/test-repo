// Env is validated fail-fast via src/env.ts, which is imported by the server
// module graph (db client, tRPC context), so `next build` and the first server
// request both surface a missing/invalid variable. We intentionally do NOT
// import it here to avoid needing a TS loader (jiti) in the config itself.

/**
 * The app is embedded as an iframe inside GoHighLevel locations, so we must
 * allow GHL (and agency white-label domains) to frame us, and forbid everyone
 * else. `frame-ancestors` is the modern replacement for X-Frame-Options.
 *
 * NOTE (Stage 1 blocker): the exact white-label domains used by the agency
 * must be confirmed by the team before go-live. Until then only the canonical
 * GHL domains are whitelisted. Do not widen this to `*`.
 */
const GHL_FRAME_ANCESTORS = [
  "https://app.gohighlevel.com",
  "https://*.gohighlevel.com",
  "https://*.leadconnectorhq.com",
  "https://*.msgsndr.com",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors 'self' ${GHL_FRAME_ANCESTORS.join(" ")};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
