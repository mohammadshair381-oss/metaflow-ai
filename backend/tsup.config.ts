import { defineConfig } from 'tsup';

/**
 * Production bundle for Render.
 * - `@metaflow/shared` ships as TypeScript source, so it is bundled into the output.
 * - Every npm dependency stays external and is loaded from node_modules at runtime.
 */
export default defineConfig({
  entry: ['src/server.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  sourcemap: true,
  clean: true,
  splitting: false,
  skipNodeModulesBundle: true,
  noExternal: ['@metaflow/shared'],
  // NODE_ENV must be read at runtime from the host environment, never baked into the bundle.
  replaceNodeEnv: false,
});
