import type { NextConfig } from 'next';

/**
 * NEXT_PUBLIC_API_BASE_URL is inlined into the browser bundle at build time, so it is
 * validated here, before the build starts. On Vercel the build fails if it is missing,
 * rather than shipping a frontend that silently calls localhost.
 */
function validateApiBaseUrl(): void {
  const value = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();

  if (!value) {
    if (process.env.VERCEL) {
      throw new Error(
        'NEXT_PUBLIC_API_BASE_URL must be set in the Vercel project (e.g. https://metaflow-api.onrender.com).',
      );
    }
    return; // Local development falls back to http://localhost:4000 (see src/lib/config.ts).
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('NEXT_PUBLIC_API_BASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must use http or https.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'NEXT_PUBLIC_API_BASE_URL must be the API origin only, e.g. https://api.example.com (no /api path).',
    );
  }
  if (process.env.VERCEL_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_API_BASE_URL must use https in production.');
  }
}

validateApiBaseUrl();

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The shared package ships TypeScript source; Next compiles it with the app.
  transpilePackages: ['@metaflow/shared'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
