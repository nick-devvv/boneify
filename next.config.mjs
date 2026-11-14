/** @type {import('next').NextConfig} */
const nextConfig = {
  // Samples, fixtures and benchmark results are read from disk at runtime.
  // Without this include they work locally but are missing on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
  // Adobe PDF Embed API client ID, inlined into the browser bundle at build time. Not a secret: Adobe locks it to
  // boneify.vercel.app, and the page shows it anyway. A NEXT_PUBLIC_ADOBE_CLIENT_ID set in the environment wins.
  env: {
    NEXT_PUBLIC_ADOBE_CLIENT_ID: process.env.NEXT_PUBLIC_ADOBE_CLIENT_ID || "4bf47e89c35e4d7ab727e7b91d0d3c57",
  },
};

export default nextConfig;
