import { describe, expect, it } from 'vitest';
import {
  claimedTypeMatches,
  extensionOf,
  inspectMediaHead,
  sanitizeFileName,
} from '../src/media/media-inspector';
import {
  gifFile,
  heicFile,
  htmlFile,
  jpegFile,
  m4aFile,
  matroskaFile,
  mp4File,
  pdfFile,
  pngFile,
  quickTimeFile,
  svgFile,
  webmFile,
  webpFile,
} from './support/media-fixtures';

describe('inspectMediaHead (content sniffing)', () => {
  it.each([
    ['JPEG', jpegFile(1080, 1350), 'image/jpeg', 'image', 1080, 1350],
    ['JPEG behind a large EXIF block', jpegFile(64, 32, 60_000), 'image/jpeg', 'image', 64, 32],
    ['PNG', pngFile(640, 480), 'image/png', 'image', 640, 480],
    ['GIF', gifFile(320, 240), 'image/gif', 'image', 320, 240],
    ['WebP', webpFile(800, 600), 'image/webp', 'image', 800, 600],
    ['MP4', mp4File(), 'video/mp4', 'video', null, null],
    ['WebM', webmFile(), 'video/webm', 'video', null, null],
  ])('recognizes %s', (_label, file, mimeType, kind, width, height) => {
    expect(inspectMediaHead(file)).toMatchObject({ mimeType, kind, width, height });
  });

  it.each([
    ['SVG (can carry scripts)', svgFile()],
    ['HTML', htmlFile()],
    ['PDF', pdfFile()],
    ['HEIC photos', heicFile()],
    ['QuickTime (.mov)', quickTimeFile()],
    ['audio-only MP4 (.m4a)', m4aFile()],
    ['Matroska (.mkv)', matroskaFile()],
    ['an empty file', Buffer.alloc(0)],
    ['a truncated signature', Buffer.from([0x89, 0x50, 0x4e])],
    ['random bytes', Buffer.from('just some text, not an image')],
  ])('rejects %s', (_label, file) => {
    expect(inspectMediaHead(file)).toBeNull();
  });

  it('keeps the format but reports no size when the header is unreadable', () => {
    const truncatedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(inspectMediaHead(truncatedJpeg)).toMatchObject({
      mimeType: 'image/jpeg',
      width: null,
      height: null,
    });
  });
});

describe('file names and claimed types', () => {
  it.each([
    ['photo.JPG', 'jpg'],
    ['archive.tar.gz', 'gz'],
    ['no-extension', ''],
    ['trailing.', ''],
  ])('extensionOf(%s) is "%s"', (name, extension) => {
    expect(extensionOf(name)).toBe(extension);
  });

  it.each([
    ['', 'image/png', true],
    ['application/octet-stream', 'image/png', true],
    ['image/png', 'image/png', true],
    ['image/jpg', 'image/jpeg', true],
    ['IMAGE/JPEG; charset=binary', 'image/jpeg', true],
    ['image/svg+xml', 'image/png', false],
    ['text/html', 'image/jpeg', false],
    ['image/png', 'image/jpeg', false],
  ] as const)('claimed %s for %s: %s', (claimed, detected, matches) => {
    expect(claimedTypeMatches(claimed, detected)).toBe(matches);
  });

  it.each([
    ['../../etc/passwd.png', 'png', 'passwd.png'],
    ['C:\\Users\\me\\Desktop\\shop.png', 'png', 'shop.png'],
    ['..\\..\\secret.jpg', 'jpg', 'secret.jpg'],
    ['.hidden.png', 'png', 'hidden.png'],
    ['bad<name>:"|?*.png', 'png', 'badname.png'],
    ['line\nbreak\u0000.png', 'png', 'linebreak.png'],
    ['invoice\u202Egnp.exe.png', 'png', 'invoicegnp.exe.png'],
    ['   .png', 'png', 'upload.png'],
    ['Café crème.jpeg', 'jpeg', 'Café crème.jpeg'],
  ])('sanitizes %j', (name, extension, expected) => {
    expect(sanitizeFileName(name, extension)).toBe(expected);
  });

  it('shortens long names without splitting characters and keeps the extension', () => {
    const name = sanitizeFileName(`${'😀'.repeat(300)}.png`, 'png');
    expect(Array.from(name)).toHaveLength(200);
    expect(name.endsWith('😀.png')).toBe(true);
  });
});
