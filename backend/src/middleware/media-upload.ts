import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RequestHandler } from 'express';
import multer from 'multer';
import { formatBytes } from '@metaflow/shared';
import { AppError } from '../utils/app-error';

/** The form field that carries the file. */
export const MEDIA_FILE_FIELD = 'file';

/** Multipart overhead allowed on top of the largest file before the request is refused. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/**
 * Parses a single-file multipart upload into a temporary file (never into memory, never into
 * media storage directly). The temporary name is random; the client's file name is only kept
 * as metadata. The controller removes the temporary file once it has been handled.
 *
 * `maxFileBytes` is the largest size of any accepted kind; the service applies the per-kind
 * limit after identifying the content.
 */
export function createMediaUploadParser({
  maxFileBytes,
  tempDir,
}: {
  maxFileBytes: number;
  tempDir?: string | undefined;
}): RequestHandler {
  const upload = multer({
    storage: multer.diskStorage({
      destination: tempDir ?? join(tmpdir(), 'metaflow-uploads'),
      filename: (_req, _file, callback) => callback(null, randomBytes(16).toString('hex')),
    }),
    // File names sent without an explicit charset are UTF-8 in every current browser.
    defParamCharset: 'utf8',
    limits: {
      fileSize: maxFileBytes,
      files: 1,
      fields: 4,
      fieldSize: 4 * 1024,
      fieldNameSize: 50,
      parts: 6,
      headerPairs: 50,
    },
  }).single(MEDIA_FILE_FIELD);

  return (req, res, next) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxFileBytes + FORM_OVERHEAD_BYTES) {
      // Refuse before reading the body. The connection is closed so the client stops sending.
      res.set('Connection', 'close');
      next(tooLarge(maxFileBytes));
      return;
    }
    if (!req.is('multipart/form-data')) {
      next(new AppError('BAD_REQUEST', 'Send the file as multipart/form-data in a "file" field.'));
      return;
    }
    upload(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
          res.set('Connection', 'close');
          next(tooLarge(maxFileBytes));
          return;
        }
        next(new AppError('BAD_REQUEST', uploadErrorMessage(error.code), { cause: error }));
        return;
      }
      // Malformed multipart bodies (bad boundary, truncated parts) are client errors.
      if (error instanceof Error && !(error as { code?: string }).code?.startsWith('E')) {
        next(
          new AppError('BAD_REQUEST', 'The upload could not be read. Try again.', { cause: error }),
        );
        return;
      }
      next(error);
    });
  };
}

const tooLarge = (maxFileBytes: number) =>
  new AppError('PAYLOAD_TOO_LARGE', `Files can be at most ${formatBytes(maxFileBytes)}.`);

function uploadErrorMessage(code: multer.ErrorCode): string {
  switch (code) {
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return `Upload one file at a time, in the "${MEDIA_FILE_FIELD}" field.`;
    default:
      return 'The upload form is not valid.';
  }
}
