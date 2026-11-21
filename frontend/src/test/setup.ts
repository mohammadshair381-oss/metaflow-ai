// DOM assertions such as toBeVisible() and toHaveAttribute() for Vitest.
import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// `findBy…`/`waitFor` give up after 1 s by default. Pages are lazy-loaded routes; when
// `pnpm test` runs the backend and frontend suites side by side, the first render in a file
// (which compiles the route modules) can take slightly longer than that. 3 s stays well within
// Vitest's 5 s test timeout and changes no assertion.
configure({ asyncUtilTimeout: 3000 });
