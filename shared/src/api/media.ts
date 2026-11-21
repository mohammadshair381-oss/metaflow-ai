import { z } from 'zod';
import { recordIdSchema } from './workspaces';

export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/**
 * The formats the media library accepts. The server identifies every upload by its content
 * (file signature), never by the browser's claim; the extension must agree with it. SVG, HTML
 * and anything else are rejected.
 */
export const MEDIA_FORMATS = [
  { mimeType: 'image/jpeg', extensions: ['jpg', 'jpeg'], kind: 'image', label: 'JPEG' },
  { mimeType: 'image/png', extensions: ['png'], kind: 'image', label: 'PNG' },
  { mimeType: 'image/webp', extensions: ['webp'], kind: 'image', label: 'WebP' },
  { mimeType: 'image/gif', extensions: ['gif'], kind: 'image', label: 'GIF' },
  { mimeType: 'video/mp4', extensions: ['mp4'], kind: 'video', label: 'MP4' },
  { mimeType: 'video/webm', extensions: ['webm'], kind: 'video', label: 'WebM' },
] as const;
export type MediaMimeType = (typeof MEDIA_FORMATS)[number]['mimeType'];
export const MEDIA_MIME_TYPES = MEDIA_FORMATS.map((format) => format.mimeType) as [
  MediaMimeType,
  ...MediaMimeType[],
];

/** For `<input type="file" accept>`. A convenience only: the server decides. */
export const MEDIA_ACCEPT = MEDIA_FORMATS.flatMap((format) =>
  format.extensions.map((extension) => `.${extension}`),
).join(',');

export const mediaFormatLabel = (mimeType: string) =>
  MEDIA_FORMATS.find((format) => format.mimeType === mimeType)?.label ?? mimeType;

/** Defaults; the server's own limits (configurable) are returned with every media list. */
export const DEFAULT_MEDIA_LIMITS = {
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
} as const;

export const MEDIA_TEXT_LIMITS = { altText: 300, description: 1000, filename: 200 } as const;

export const mediaSchema = z.object({
  id: z.string(),
  kind: z.enum(MEDIA_KINDS),
  mimeType: z.enum(MEDIA_MIME_TYPES),
  /** The uploaded file's name, cleaned for display. Never used to locate the file. */
  originalName: z.string(),
  size: z.number().int(),
  /** Null when it could not be read reliably from the file. */
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSeconds: z.number().nullable(),
  altText: z.string(),
  description: z.string(),
  uploadedBy: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Media = z.infer<typeof mediaSchema>;

export const mediaResponseSchema = z.object({ media: mediaSchema });
export type MediaResponse = z.infer<typeof mediaResponseSchema>;

export const MEDIA_PAGE_SIZE = { default: 24, max: 60 } as const;

export const mediaListQuerySchema = z.object({
  kind: z.enum(MEDIA_KINDS).optional(),
  /** Searches the file name, alt text and description. */
  q: z.string().trim().max(100).optional(),
  before: recordIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(MEDIA_PAGE_SIZE.max).default(MEDIA_PAGE_SIZE.default),
});
export type MediaListQuery = z.input<typeof mediaListQuerySchema>;

export const mediaLimitsSchema = z.object({
  imageBytes: z.number().int(),
  videoBytes: z.number().int(),
  /** False when the server has no media storage configured (uploads are then refused). */
  uploadsEnabled: z.boolean(),
});
export type MediaLimits = z.infer<typeof mediaLimitsSchema>;

export const mediaListResponseSchema = z.object({
  media: z.array(mediaSchema),
  nextCursor: z.string().nullable(),
  limits: mediaLimitsSchema,
});
export type MediaListResponse = z.infer<typeof mediaListResponseSchema>;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const editableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .refine((value) => !CONTROL_CHARACTERS.test(value.replace(/\n/g, '')), {
      error: 'Remove special characters',
    });

/** Only these fields can be changed after upload. */
export const updateMediaRequestSchema = z
  .strictObject({
    altText: editableText(MEDIA_TEXT_LIMITS.altText).optional(),
    description: editableText(MEDIA_TEXT_LIMITS.description).optional(),
  })
  .refine((value) => value.altText !== undefined || value.description !== undefined, {
    error: 'Nothing to update',
  });
export type UpdateMediaRequest = z.input<typeof updateMediaRequestSchema>;

/** Optional text fields sent with an upload (multipart form fields). */
export const uploadMediaFieldsSchema = z.strictObject({
  altText: editableText(MEDIA_TEXT_LIMITS.altText).default(''),
  description: editableText(MEDIA_TEXT_LIMITS.description).default(''),
});

/** Owner only. `null` removes the logo; the media item itself is kept. */
export const setWorkspaceLogoRequestSchema = z.strictObject({
  mediaId: recordIdSchema.nullable(),
});
export type SetWorkspaceLogoRequest = z.input<typeof setWorkspaceLogoRequestSchema>;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
