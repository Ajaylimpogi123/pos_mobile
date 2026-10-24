import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };

/**
 * Q-038: when `VITE_IMAGE_ORIGIN` is set (an S3-compatible image disk), the build
 * adds that origin to the CSP `img-src`. Only a bare origin (scheme + host[:port]) is accepted.
 */
function imageOriginCsp(origin: string): Plugin {
  return {
    name: 'pos-image-origin-csp',
    apply: 'build',
    transformIndexHtml(html) {
      if (origin === '') return html;
      const parsed = new URL(origin);
      if (parsed.origin !== origin.replace(/\/+$/, '')) {
        throw new Error(`VITE_IMAGE_ORIGIN must be an origin like https://images.example.com, got ${origin}`);
      }
      return html.replace("img-src 'self' data: blob:", `img-src 'self' data: blob: ${parsed.origin}`);
    },
  };
}

/**
 * index.html carries a strict CSP <meta> (docs/api-contract.md → Web POS §B).
 * The dev server needs inline scripts (React Refresh) and a websocket (HMR),
 * so the tag is removed while serving; `npm run build` keeps it.
 */
function devCspRelax(): Plugin {
  return {
    name: 'pos-dev-csp-relax',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(/<meta\s+http-equiv="Content-Security-Policy"[^>]*>\s*/i, '');
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, '');
  // Never a hardcoded host: the target comes from web/.env (see .env.example) or the shell.
  const imageOrigin = (env.VITE_IMAGE_ORIGIN || '').trim();
  const proxyTarget = env.VITE_API_PROXY_TARGET || process.env.VITE_API_PROXY_TARGET || '';

  return {
    base: '/pos/',
    plugins: [react(), tailwindcss(), devCspRelax(), imageOriginCsp(imageOrigin)],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: { '@': path.join(root, 'src') },
    },
    build: {
      outDir: '../public/pos',
      emptyOutDir: true,
      // The cashier's Sell screen (React, Radix, TanStack, the printing documents) is one ~160 kB gzip
      // chunk on purpose: it is served from the same LAN server and cached; the back-office pages load lazily.
      chunkSizeWarningLimit: 600,
    },
    server: {
      host: '0.0.0.0',
      // @pos/core is linked from ../packages/pos-core (outside this folder): let the dev server read it.
      fs: { allow: [root, path.join(root, '..', 'packages', 'pos-core')] },
      proxy: proxyTarget
        ? {
            '/api': { target: proxyTarget, changeOrigin: true },
            '/storage': { target: proxyTarget, changeOrigin: true },
          }
        : undefined,
    },
  };
});
