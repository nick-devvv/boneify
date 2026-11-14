/** @type {import('next').NextConfig} */
const nextConfig = {
  // Samples, fixtures and benchmark results are read from disk at runtime.
  // Without this include they work locally but are missing on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
