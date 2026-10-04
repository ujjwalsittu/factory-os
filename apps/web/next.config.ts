import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@factoryos/ui'],
  poweredByHeader: false,
  // The monorepo root, so standalone output includes workspace packages.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
