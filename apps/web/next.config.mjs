/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@pagaska/shared", "@pagaska/upload-engine"],
  experimental: {
    typedRoutes: false,
  },
  // Don't fail builds on lint warnings during deploy.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
