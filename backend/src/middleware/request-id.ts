import { randomUUID } from 'node:crypto';
import { REQUEST_ID_HEADER } from '@metaflow/shared';
import type { RequestHandler } from 'express';

/** Accept a caller-supplied ID only if it is short and contains no unusual characters. */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

/** Assigns every request a correlation ID, echoed in the X-Request-Id response header. */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    const id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.set(REQUEST_ID_HEADER, id);
    next();
  };
}
