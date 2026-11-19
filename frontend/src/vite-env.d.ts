/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Public backend origin. See src/lib/config.ts. */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
