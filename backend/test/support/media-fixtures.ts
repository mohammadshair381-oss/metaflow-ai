/**
 * Minimal files with real signatures and headers, built in memory. They are not complete,
 * decodable images or videos; the server only reads signatures and headers, and these are
 * exactly what real encoders write there.
 */

const padding = (bytes: number) => Buffer.alloc(bytes, 0x11);

export function pngFile(width = 640, height = 480, extra = 64): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, padding(extra)]);
}

export function jpegFile(width = 1080, height = 1350, exifBytes = 200): Buffer {
  const app1 = Buffer.alloc(4 + exifBytes);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exifBytes + 2, 2);
  const sof = Buffer.alloc(19);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(17, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, padding(64)]);
}

export function gifFile(width = 320, height = 240): Buffer {
  const header = Buffer.alloc(13);
  header.write('GIF89a', 0, 'latin1');
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  return Buffer.concat([header, padding(32)]);
}

export function webpFile(width = 800, height = 600): Buffer {
  const file = Buffer.alloc(40);
  file.write('RIFF', 0, 'latin1');
  file.writeUInt32LE(32, 4);
  file.write('WEBP', 8, 'latin1');
  file.write('VP8X', 12, 'latin1');
  file.writeUInt32LE(10, 16);
  file.writeUIntLE(width - 1, 24, 3);
  file.writeUIntLE(height - 1, 27, 3);
  return file;
}

function ftyp(major: string, compatible: string[], extra = 256): Buffer {
  const box = Buffer.alloc(16 + compatible.length * 4);
  box.writeUInt32BE(box.length, 0);
  box.write('ftyp', 4, 'latin1');
  box.write(major, 8, 'latin1');
  box.writeUInt32BE(0x200, 12);
  compatible.forEach((brand, index) => box.write(brand, 16 + index * 4, 'latin1'));
  return Buffer.concat([box, padding(extra)]);
}

export const mp4File = (extra = 256) => ftyp('isom', ['isom', 'iso2', 'avc1', 'mp41'], extra);
export const heicFile = () => ftyp('heic', ['mif1', 'heic']);
export const quickTimeFile = () => ftyp('qt  ', ['qt  ']);
export const m4aFile = () => ftyp('M4A ', ['M4A ', 'mp42', 'isom']);

function ebml(docType: string): Buffer {
  const body = Buffer.concat([
    Buffer.from([0x42, 0x86, 0x81, 0x01]),
    Buffer.from([0x42, 0x82, 0x80 | docType.length]),
    Buffer.from(docType, 'latin1'),
  ]);
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80 | body.length]),
    body,
    padding(64),
  ]);
}

export const webmFile = () => ebml('webm');
export const matroskaFile = () => ebml('matroska');

export const svgFile = () =>
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
export const htmlFile = () => Buffer.from('<!doctype html><html><script>alert(1)</script></html>');
export const pdfFile = () => Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n');
