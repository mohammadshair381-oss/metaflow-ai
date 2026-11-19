declare global {
  namespace Express {
    interface Locals {
      /** Correlation ID set by the request-id middleware for every request. */
      requestId: string;
    }
  }
}

export {};
