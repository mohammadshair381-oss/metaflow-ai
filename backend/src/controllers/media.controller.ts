import { unlink } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  mediaListQuerySchema,
  recordIdSchema,
  setWorkspaceLogoRequestSchema,
  updateMediaRequestSchema,
  uploadMediaFieldsSchema,
  type MediaListResponse,
  type MediaResponse,
  type WorkspaceResponse,
} from '@metaflow/shared';
import type { Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { toMedia, type MediaService } from '../services/media.service';
import { toWorkspace } from '../services/workspace.service';
import { AppError } from '../utils/app-error';
import type { Logger } from '../utils/logger';
import { parseRequest } from '../validators/parse-request';

export interface MediaController {
  list: RequestHandler;
  /** Runs before the body is read: refuses non-members without accepting a single byte. */
  authorizeUpload: RequestHandler;
  upload: RequestHandler;
  get: RequestHandler;
  update: RequestHandler;
  remove: RequestHandler;
  file: RequestHandler;
  setLogo: RequestHandler;
}

const workspaceParams = z.object({ workspaceId: recordIdSchema });
const mediaParams = z.object({ workspaceId: recordIdSchema, mediaId: recordIdSchema });
const fileQuery = z.object({ download: z.enum(['1']).optional() });

/** RFC 6266 / RFC 5987: an ASCII fallback plus the exact UTF-8 name. */
export function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function createMediaController(service: MediaService, logger: Logger): MediaController {
  const callerId = (res: Response) => {
    const auth = res.locals.auth;
    if (!auth) throw new AppError('UNAUTHENTICATED', 'Sign in to continue');
    return auth.user.id;
  };

  const removeTemporaryFile = async (req: Request) => {
    const path = req.file?.path;
    if (!path) return;
    await unlink(path).catch((error: unknown) => {
      if ((error as { code?: string }).code !== 'ENOENT') {
        logger.error('media.temp_cleanup_failed', { error });
      }
    });
  };

  return {
    list: async (req, res) => {
      const { params, query } = parseRequest(req, {
        params: workspaceParams,
        query: mediaListQuerySchema,
      });
      const page = await service.list(callerId(res), params.workspaceId, query);
      const payload: MediaListResponse = {
        media: page.media.map(toMedia),
        nextCursor: page.nextCursor,
        limits: service.limits,
      };
      res.status(200).json(payload);
    },

    authorizeUpload: async (req, res, next) => {
      const { params } = parseRequest(req, { params: workspaceParams });
      await service.assertCanUpload(callerId(res), params.workspaceId);
      next();
    },

    upload: async (req, res) => {
      let record;
      try {
        const { params, body } = parseRequest(req, {
          params: workspaceParams,
          body: uploadMediaFieldsSchema,
        });
        if (!req.file) {
          throw new AppError('BAD_REQUEST', 'Choose a file to upload.');
        }
        record = await service.upload(
          callerId(res),
          params.workspaceId,
          {
            path: req.file.path,
            originalName: req.file.originalname,
            claimedMimeType: req.file.mimetype,
            size: req.file.size,
          },
          body,
        );
      } finally {
        // The temporary upload never outlives the request, accepted or not.
        await removeTemporaryFile(req);
      }
      const payload: MediaResponse = { media: toMedia(record) };
      res.status(201).json(payload);
    },

    get: async (req, res) => {
      const { params } = parseRequest(req, { params: mediaParams });
      const record = await service.get(callerId(res), params.workspaceId, params.mediaId);
      const payload: MediaResponse = { media: toMedia(record) };
      res.status(200).json(payload);
    },

    update: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: mediaParams,
        body: updateMediaRequestSchema,
      });
      const record = await service.update(callerId(res), params.workspaceId, params.mediaId, body);
      const payload: MediaResponse = { media: toMedia(record) };
      res.status(200).json(payload);
    },

    remove: async (req, res) => {
      const { params } = parseRequest(req, { params: mediaParams });
      await service.remove(callerId(res), params.workspaceId, params.mediaId);
      res.status(204).end();
    },

    /**
     * Streams the file with headers that keep a browser from treating it as anything but the
     * detected media type: nosniff, a sandboxing CSP, and the stored content type.
     */
    file: async (req, res) => {
      const { params, query } = parseRequest(req, { params: mediaParams, query: fileQuery });
      let totalSize = 0;
      const result = await service.openFile(
        callerId(res),
        params.workspaceId,
        params.mediaId,
        (size) => {
          totalSize = size;
          const ranges = req.range(size, { combine: true });
          if (ranges === -1) return 'unsatisfiable';
          // No Range header, a malformed one (-2) or several ranges: send the whole file.
          if (ranges === undefined || ranges === -2 || ranges.length !== 1) return null;
          const [range] = ranges;
          return range ? { start: range.start, end: range.end } : null;
        },
      );

      res.set({
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, max-age=300',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'X-Content-Type-Options': 'nosniff',
        // The web app may run on another origin of the same site (app. and api. subdomains).
        'Cross-Origin-Resource-Policy': 'same-site',
      });

      if (result === 'unsatisfiable') {
        res.status(416).set('Content-Range', `bytes */${totalSize}`).end();
        return;
      }

      const { media, stream, size, range } = result;
      res.set({
        'Content-Type': media.mimeType,
        'Content-Disposition': contentDisposition(
          query.download ? 'attachment' : 'inline',
          media.originalName,
        ),
      });
      if (range) {
        res.status(206);
        res.set({
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Content-Length': String(range.end - range.start + 1),
        });
      } else {
        res.status(200);
        res.set('Content-Length', String(size));
      }
      try {
        await pipeline(stream, res);
      } catch (error) {
        // Usually the viewer navigated away mid-download; nothing to send any more.
        if (
          !res.writableEnded &&
          (error as { code?: string }).code !== 'ERR_STREAM_PREMATURE_CLOSE'
        ) {
          logger.warn('media.stream_failed', { mediaId: params.mediaId, error });
        }
      }
    },

    setLogo: async (req, res) => {
      const { params, body } = parseRequest(req, {
        params: workspaceParams,
        body: setWorkspaceLogoRequestSchema,
      });
      const access = await service.setWorkspaceLogo(
        callerId(res),
        params.workspaceId,
        body.mediaId,
      );
      const payload: WorkspaceResponse = { workspace: toWorkspace(access) };
      res.status(200).json(payload);
    },
  };
}
