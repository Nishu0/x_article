import { mkdir, copyFile, readdir } from "fs/promises";
import { join } from "path";

async function build() {
  // Ensure directories exist
  await mkdir("./dist", { recursive: true });
  await mkdir("./icons", { recursive: true });

  // Bundle TypeScript files
  const entrypoints = [
    "./src/content.ts",
    "./src/popup.ts",
    "./src/background.ts"
  ];

  const result = await Bun.build({
    entrypoints,
    outdir: "./dist",
    target: "browser",
    minify: false,
  });

  if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Copy HTML file
  await copyFile("./src/popup.html", "./dist/popup.html");

  // Generate simple SVG icons if they don't exist
  await generateIcons();

  console.log("Build successful! Output in ./dist/");
  console.log("Files built:", result.outputs.map(o => o.path));
}

async function generateIcons() {
  const sizes = [16, 48, 128];

  for (const size of sizes) {
    const iconPath = `./icons/icon${size}.png`;

    // Create a simple icon using SVG -> PNG
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#1d9bf0;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1a8cd8;stop-opacity:1" />
          </linearGradient>
        </defs>
        <rect width="100" height="100" rx="20" fill="url(#grad)"/>
        <text x="50" y="68" font-size="50" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-weight="bold">📖</text>
      </svg>
    `;

    // Write SVG as fallback (Chrome can use SVG icons in some cases)
    await Bun.write(`./icons/icon${size}.svg`, svg.trim());

    // For PNG, we'll create a simple placeholder
    // In production, you'd use sharp or canvas to convert SVG to PNG
    // For now, write a simple 1x1 PNG placeholder that Chrome will scale
    const pngPlaceholder = createSimplePng(size);
    await Bun.write(iconPath, pngPlaceholder);
  }
}

function createSimplePng(size: number): Uint8Array {
  // Create a minimal valid PNG with blue color
  // This is a simplified PNG - in production use a proper image library

  // PNG signature
  const signature = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

  // IHDR chunk (image header)
  const width = size;
  const height = size;
  const bitDepth = 8;
  const colorType = 2; // RGB
  const compression = 0;
  const filter = 0;
  const interlace = 0;

  const ihdrData = [
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    bitDepth, colorType, compression, filter, interlace
  ];

  // Simple blue color for all pixels
  const pixels: number[] = [];
  for (let y = 0; y < height; y++) {
    pixels.push(0); // Filter byte for each row
    for (let x = 0; x < width; x++) {
      pixels.push(29, 155, 240); // RGB - X blue color
    }
  }

  // Use pako-style deflate compression (simplified)
  const compressed = simpleDeflate(pixels);

  // Build chunks
  const chunks: number[] = [];

  // Add IHDR
  chunks.push(...createChunk('IHDR', ihdrData));

  // Add IDAT
  chunks.push(...createChunk('IDAT', compressed));

  // Add IEND
  chunks.push(...createChunk('IEND', []));

  return new Uint8Array([...signature, ...chunks]);
}

function createChunk(type: string, data: number[]): number[] {
  const length = data.length;
  const typeBytes = type.split('').map(c => c.charCodeAt(0));

  const chunk = [
    (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff,
    ...typeBytes,
    ...data
  ];

  // Calculate CRC32
  const crc = crc32([...typeBytes, ...data]);
  chunk.push((crc >> 24) & 0xff, (crc >> 16) & 0xff, (crc >> 8) & 0xff, crc & 0xff);

  return chunk;
}

function simpleDeflate(data: number[]): number[] {
  // Minimal zlib wrapper with uncompressed deflate
  // CMF: compression method 8 (deflate), window size 7 (32K)
  // FLG: no dict, compression level 0
  const cmf = 0x78;
  const flg = 0x01;

  // Split into blocks of max 65535 bytes
  const result = [cmf, flg];
  let offset = 0;

  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockSize = Math.min(remaining, 65535);
    const isLast = offset + blockSize >= data.length;

    result.push(isLast ? 0x01 : 0x00); // BFINAL and BTYPE
    result.push(blockSize & 0xff, (blockSize >> 8) & 0xff);
    result.push((~blockSize) & 0xff, ((~blockSize) >> 8) & 0xff);

    for (let i = 0; i < blockSize; i++) {
      result.push(data[offset + i]);
    }
    offset += blockSize;
  }

  // Adler32 checksum
  const adler = adler32(data);
  result.push((adler >> 24) & 0xff, (adler >> 16) & 0xff, (adler >> 8) & 0xff, adler & 0xff);

  return result;
}

function adler32(data: number[]): number {
  let a = 1, b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (b << 16) | a;
}

function crc32(data: number[]): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return crc ^ 0xffffffff;
}

build();
