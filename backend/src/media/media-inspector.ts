import { open } from 'node:fs/promises';
import {
  MEDIA_FORMATS,
  MEDIA_TEXT_LIMITS,
  type MediaKind,
  type MediaMimeType,
} from '@metaflow/shared';

/**
 * Identifies an uploaded file from its content (its signature, or "magic bytes"), never from
 * the name or the type the browser claimed. Only the formats in MEDIA_FORMATS are recognized;
 * everything else (SVG, HTML, PDF, HEIC, QuickTime, audio, archives...) is unknown.
 *
 * Image dimensions are read from the file header when the format allows it reliably. Video
 * duration is not read (it needs a container parser); it stays null.
 */
export interface InspectedMedia {
  mimeType: MediaMimeType;
  kind: MediaKind;
  extension: string;
  width: number | null;
  height: number | null;
}

/** Enough for every signature, and for JPEG headers behind typical EXIF blocks. */
const HEAD_BYTES = 256 * 1024;

export async function readFileHead(path: string, bytes = HEAD_BYTES): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

const startsWith = (head: Buffer, signature: number[], offset = 0) =>
  head.length >= offset + signature.length &&
  signature.every((byte, index) => head[offset + index] === byte);
const ascii = (head: Buffer, start: number, end: number) =>
  head.length >= end ? head.toString('latin1', start, end) : '';

type Dimensions = { width: number; height: number } | null;
const dimensions = (width: number, height: number): Dimensions =>
  width > 0 && height > 0 && width <= 100_000 && height <= 100_000 ? { width, height } : null;

function pngDimensions(head: Buffer): Dimensions {
  if (head.length < 24 || ascii(head, 12, 16) !== 'IHDR') return null;
  return dimensions(head.readUInt32BE(16), head.readUInt32BE(20));
}

function gifDimensions(head: Buffer): Dimensions {
  if (head.length < 10) return null;
  return dimensions(head.readUInt16LE(6), head.readUInt16LE(8));
}

function webpDimensions(head: Buffer): Dimensions {
  const chunk = ascii(head, 12, 16);
  if (chunk === 'VP8 ' && head.length >= 30 && startsWith(head, [0x9d, 0x01, 0x2a], 23)) {
    return dimensions(head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff);
  }
  if (chunk === 'VP8L' && head.length >= 25 && head[20] === 0x2f) {
    const bits = head.readUInt32LE(21);
    return dimensions((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === 'VP8X' && head.length >= 30) {
    return dimensions(head.readUIntLE(24, 3) + 1, head.readUIntLE(27, 3) + 1);
  }
  return null;
}

/** Walks the JPEG segments up to the first start-of-frame marker. */
function jpegDimensions(head: Buffer): Dimensions {
  let offset = 2;
  while (offset + 9 < head.length) {
    if (head[offset] !== 0xff) return null;
    const marker = head[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = head.readUInt16BE(offset + 2);
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return dimensions(head.readUInt16BE(offset + 7), head.readUInt16BE(offset + 5));
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** ISO base media brands of MP4 video. HEIF/AVIF images, QuickTime and audio-only are not MP4 video. */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso3',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'M4V ',
  'M4VH',
  'M4VP',
  'dash',
  'mmp4',
  'MSNV',
  'NDAS',
  'f4v ',
]);
const NOT_MP4_VIDEO_BRANDS = new Set([
  'qt  ',
  'heic',
  'heix',
  'hevc',
  'heim',
  'heis',
  'mif1',
  'msf1',
  'avif',
  'avis',
  'crx ',
  'M4A ',
  'M4B ',
  'M4P ',
  'F4A ',
  'F4B ',
]);

function isMp4(head: Buffer): boolean {
  if (ascii(head, 4, 8) !== 'ftyp' || head.length < 16) return false;
  const boxSize = Math.min(head.readUInt32BE(0), head.length);
  if (boxSize < 16) return false;
  const major = ascii(head, 8, 12);
  const compatible: string[] = [];
  for (let offset = 16; offset + 4 <= boxSize; offset += 4) {
    compatible.push(ascii(head, offset, offset + 4));
  }
  const brands = [major, ...compatible];
  if (brands.some((brand) => NOT_MP4_VIDEO_BRANDS.has(brand))) return false;
  return brands.some((brand) => MP4_BRANDS.has(brand));
}

/** WebM is Matroska with the DocType "webm"; other Matroska files (.mkv) are refused. */
function isWebm(head: Buffer): boolean {
  if (!startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return false;
  const searchEnd = Math.min(head.length - 2, 64);
  for (let offset = 4; offset < searchEnd; offset += 1) {
    if (head[offset] !== 0x42 || head[offset + 1] !== 0x82) continue;
    const sizeByte = head[offset + 2] ?? 0;
    // One-byte EBML size: 1xxxxxxx.
    if ((sizeByte & 0x80) === 0) return false;
    const size = sizeByte & 0x7f;
    return ascii(head, offset + 3, offset + 3 + size) === 'webm';
  }
  return false;
}

function detect(head: Buffer): { mimeType: MediaMimeType; dimensions: Dimensions } | null {
  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return { mimeType: 'image/jpeg', dimensions: jpegDimensions(head) };
  }
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mimeType: 'image/png', dimensions: pngDimensions(head) };
  }
  const gif = ascii(head, 0, 6);
  if (gif === 'GIF87a' || gif === 'GIF89a') {
    return { mimeType: 'image/gif', dimensions: gifDimensions(head) };
  }
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') {
    return { mimeType: 'image/webp', dimensions: webpDimensions(head) };
  }
  if (isMp4(head)) return { mimeType: 'video/mp4', dimensions: null };
  if (isWebm(head)) return { mimeType: 'video/webm', dimensions: null };
  return null;
}

/** Null when the content is not one of the supported formats. */
export function inspectMediaHead(head: Buffer): InspectedMedia | null {
  const found = detect(head);
  if (!found) return null;
  const format = MEDIA_FORMATS.find((candidate) => candidate.mimeType === found.mimeType);
  if (!format) return null;
  return {
    mimeType: format.mimeType,
    kind: format.kind,
    extension: format.extensions[0],
    width: found.dimensions?.width ?? null,
    height: found.dimensions?.height ?? null,
  };
}

/** The lower-case extension of a file name, without the dot; '' when there is none. */
export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName);
  return match?.[1]?.toLowerCase() ?? '';
}

/** Types browsers commonly send for the supported formats, besides the canonical one. */
const CLAIMED_TYPE_ALIASES: Record<string, MediaMimeType> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/x-png': 'image/png',
};
const UNSPECIFIC_TYPES = new Set(['', 'application/octet-stream']);

/**
 * The browser's claimed type is not trusted, but when it names a specific different type the
 * upload is refused: a mismatch means the file is not what the user thinks it is.
 */
export function claimedTypeMatches(claimed: string, detected: MediaMimeType): boolean {
  const type = claimed.split(';')[0]?.trim().toLowerCase() ?? '';
  if (UNSPECIFIC_TYPES.has(type)) return true;
  return (CLAIMED_TYPE_ALIASES[type] ?? type) === detected;
}

const UNSAFE_NAME_CHARACTERS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f<>:"/\\|?*\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * A display name for the upload: no directories, control or bidirectional-override characters,
 * reserved punctuation or leading dots, at most MEDIA_TEXT_LIMITS.filename characters, and
 * always ending in the extension of the detected format. Never used to locate the file.
 */
export function sanitizeFileName(fileName: string, extension: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(UNSAFE_NAME_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim();
  const stem = cleaned
    .replace(/\.[A-Za-z0-9]{1,10}$/, '')
    .replace(/^[.\s]+/, '')
    .trim();
  const maxStem = MEDIA_TEXT_LIMITS.filename - extension.length - 1;
  // By code point, so a character outside the BMP (an emoji) is never cut in half.
  const name = Array.from(stem || 'upload')
    .slice(0, maxStem)
    .join('')
    .trim();
  return `${name}.${extension}`;
}
