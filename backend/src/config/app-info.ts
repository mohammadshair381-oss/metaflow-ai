import packageJson from '../../package.json' with { type: 'json' };

/** Version of the running backend, taken from backend/package.json at build time. */
export const APP_VERSION: string = packageJson.version;
