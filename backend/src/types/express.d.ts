import type { AuthContext } from '../services/auth.service';

declare global {
  namespace Express {
    interface Locals {
      /** Correlation ID set by the request-id middleware for every request. */
      requestId: string;
      /** Verified caller, set only by the requireAuth middleware. */
      auth?: AuthContext;
    }
  }
}

export {};
