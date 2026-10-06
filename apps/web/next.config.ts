import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@factoryos/ui'],
  poweredByHeader: false,
  async headers(){return ['/invite/:path*','/forgot-password','/reset-password','/verify-email'].map(source=>({source,headers:[{key:'Referrer-Policy',value:'no-referrer'},{key:'Cache-Control',value:'no-store'}]}));},
  // The monorepo root, so standalone output includes workspace packages.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
