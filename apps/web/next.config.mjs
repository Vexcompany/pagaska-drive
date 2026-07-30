/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are already compiled to dist/ by `npm run prepare`.
  // We list them under transpilePackages as a defensive measure so the
  // Next.js compiler can still handle any in-progress source files.
  transpilePackages: ["@pagaska/shared", "@pagaska/upload-engine"],
  experimental: {
    typedRoutes: true,
  },
  // Don't fail builds on lint warnings during deploy.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
