import path from 'node:path';
import type { NextConfig } from 'next';

const dev = process.env.NODE_ENV !== 'production';

// Next.js needs inline scripts for hydration; a nonce-based policy is the stricter follow-up.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${dev ? ' ws:' : ''}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Types are checked once, across app, scripts and tests, by `npm run typecheck` (a required CI step).
  typescript: { ignoreBuildErrors: true },
  // Database drivers load native/WASM assets and must not be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'postgres'],
  outputFileTracingRoot: path.resolve(import.meta.dirname),
  turbopack: { root: path.resolve(import.meta.dirname) },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: csp },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }];
  },
};

export default config;
