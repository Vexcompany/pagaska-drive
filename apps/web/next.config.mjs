/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are already compiled to dist/ by `npm run prepare`.
  // We list them under transpilePackages as a defensive measure so the
  // Next.js compiler can still handle any in-progress source files.
  transpilePackages: ["@pagaska/shared", "@pagaska/upload-engine"],
  // Next 15.5 promoted `experimental.typedRoutes` to a top-level
  // stable option. Keeping it off until the project adopts typed
  // Link routes.
  typedRoutes: false,
  // Don't fail builds on lint warnings during deploy.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
