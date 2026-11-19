import { API_ROUTES } from '@metaflow/shared';
import type { RequestHandler } from 'express';
import type { Logger } from '../utils/logger';

/**
 * Logs one line per completed request. Logs the path only — never the query string,
 * headers, cookies or body, which may carry credentials.
 * Health checks run every few seconds on Render, so they are logged at debug level.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = performance.now();
    // Capture now: mounted routers rewrite req.path to be relative by the time 'finish' fires.
    const path = req.path;
    const isHealthCheck = path === API_ROUTES.health || path.startsWith(`${API_ROUTES.health}/`);

    res.on('finish', () => {
      logger[isHealthCheck ? 'debug' : 'info']('http.request', {
        requestId: res.locals.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      });
    });
    next();
  };
}
