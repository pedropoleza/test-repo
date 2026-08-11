/** @type {import('next').NextConfig} */

// Allow embedding as an iframe inside the GHL CRM (white-label + native).
const FRAME_ANCESTORS = [
  "'self'",
  "https://app.sparkleads.pro",
  "https://*.gohighlevel.com",
  "https://*.leadconnectorhq.com",
  "https://*.msgsndr.com",
  ...(process.env.EXTRA_FRAME_ANCESTORS?.split(/\s+/).filter(Boolean) ?? []),
].join(" ");

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${FRAME_ANCESTORS};`,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
