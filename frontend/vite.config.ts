/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type ProxyOptions } from 'vite';

const PORT = 3000;

/**
 * Where the dev and preview servers forward /api requests. Read only here, at build-tool
 * level: it is not a VITE_ variable, so it never reaches the browser bundle.
 */
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

/** VITE_* variables are embedded in the public bundle; refuse names that look like secrets. */
const SECRET_LIKE_NAME = /SECRET|PASSWORD|PRIVATE|TOKEN|CREDENTIAL|MONGODB|DATABASE|API_?KEY/i;

function validateClientEnv(env: Record<string, string>, isBuild: boolean): void {
  const secretLike = Object.keys(env).filter((name) => SECRET_LIKE_NAME.test(name));
  if (secretLike.length > 0) {
    throw new Error(
      `Refusing to expose secret-looking variables to the browser: ${secretLike.join(', ')}. ` +
        'VITE_* values are public. Keep secrets in the backend environment.',
    );
  }
  if (!isBuild) return;

  const apiBaseUrl = env.VITE_API_BASE_URL?.trim();
  if (!apiBaseUrl) {
    if (process.env.VERCEL) {
      throw new Error(
        'VITE_API_BASE_URL must be set in the Vercel project (e.g. https://metaflow-api.onrender.com).',
      );
    }
    console.warn(
      '[metaflow] VITE_API_BASE_URL is not set: this build calls /api on its own origin, ' +
        'which only works behind the `vite preview` proxy.',
    );
    return;
  }

  let url: URL;
  try {
    url = new URL(apiBaseUrl);
  } catch {
    throw new Error('VITE_API_BASE_URL is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('VITE_API_BASE_URL must use http or https.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error(
      'VITE_API_BASE_URL must be the API origin only, e.g. https://api.example.com (no /api path).',
    );
  }
  if (process.env.VERCEL_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('VITE_API_BASE_URL must use https in production.');
  }
}

export default defineConfig(({ command, mode }) => {
  const clientEnv = loadEnv(mode, process.cwd(), 'VITE_');
  validateClientEnv(clientEnv, command === 'build');

  // Same-origin /api in development: no CORS involved, and cookies are first-party.
  const proxy: Record<string, ProxyOptions> = {
    '/api': { target: API_PROXY_TARGET, changeOrigin: false },
  };

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: { port: PORT, strictPort: true, proxy },
    preview: { port: PORT, strictPort: true, proxy },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: false,
    },
    test: {
      // Component tests opt into jsdom with a `// @vitest-environment jsdom` comment.
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
    },
  };
});
