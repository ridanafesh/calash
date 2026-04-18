/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@calash/shared'],
  experimental: {
    typedRoutes: true,
  },
};

module.exports = nextConfig;
