import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/*': ['../../packages/review-store/drizzle/**/*'],
  },
  serverExternalPackages: ['better-sqlite3'],
};

export default nextConfig;
