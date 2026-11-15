/**
 * Image dimensions without native dependencies.
 *
 * The core path stays pure JavaScript so the tool installs cleanly on
 * Windows, macOS and Linux with no build step.
 */

export type ImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "svg";

export interface ImageSize {
  width: number;
  height: number;
  format: ImageFormat;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Read the pixel size of an image, or undefined when the format is unknown. */
export function readImageSize(data: Uint8Array): ImageSize | undefined {
  if (data.length < 8) {
    return undefined;
  }
  const svg = readSvgSize(data);
  if (svg !== undefined) {
    return svg;
  }
  if (data.length < 16) {
    return undefined;
  }
  if (hasPrefix(data, PNG_SIGNATURE)) {
    return readPng(data);
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    return readJpeg(data);
  }
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return readGif(data);
  }
  if (data[0] === 0x42 && data[1] === 0x4d) {
    return readBmp(data);
  }
  if (
    data.length >= 16 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return readWebp(data);
  }
  return undefined;
}

function readSvgSize(data: Uint8Array): ImageSize | undefined {
  if (data[0] !== 0x3c) {
    return undefined;
  }
  const head = new TextDecoder().decode(data.subarray(0, 2048));
  if (!/<svg[\s>]/i.test(head)) {
    return undefined;
  }
  const width = /\bwidth="([\d.]+)"/i.exec(head);
  const height = /\bheight="([\d.]+)"/i.exec(head);
  if (width !== null && height !== null) {
    return {
      width: Math.round(Number(width[1])),
      height: Math.round(Number(height[1])),
      format: "svg",
    };
  }
  const viewBox = /\bviewBox="([^"]+)"/i.exec(head);
  if (viewBox !== null) {
    const parts = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return { width: Math.round(parts[2]), height: Math.round(parts[3]), format: "svg" };
    }
  }
  return undefined;
}

function hasPrefix(data: Uint8Array, prefix: number[]): boolean {
  for (let index = 0; index < prefix.length; index += 1) {
    if (data[index] !== prefix[index]) {
      return false;
    }
  }
  return true;
}

function readPng(data: Uint8Array): ImageSize | undefined {
  if (data.length < 24) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20), format: "png" };
}

function readJpeg(data: Uint8Array): ImageSize | undefined {
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    const length = (data[offset + 2] << 8) + data[offset + 3];
    const isStartOfFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isStartOfFrame) {
      return {
        height: (data[offset + 5] << 8) + data[offset + 6],
        width: (data[offset + 7] << 8) + data[offset + 8],
        format: "jpeg",
      };
    }
    offset += 2 + length;
  }
  return undefined;
}

function readGif(data: Uint8Array): ImageSize | undefined {
  if (data.length < 10) {
    return undefined;
  }
  return {
    width: data[6] + (data[7] << 8),
    height: data[8] + (data[9] << 8),
    format: "gif",
  };
}

function readBmp(data: Uint8Array): ImageSize | undefined {
  if (data.length < 26) {
    return undefined;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    width: view.getInt32(18, true),
    height: Math.abs(view.getInt32(22, true)),
    format: "bmp",
  };
}

function readWebp(data: Uint8Array): ImageSize | undefined {
  const chunk = String.fromCharCode(data[12], data[13], data[14], data[15]);
  if (chunk === "VP8 ") {
    if (data.length < 30) {
      return undefined;
    }
    return {
      width: data[26] + (data[27] << 8),
      height: data[28] + (data[29] << 8),
      format: "webp",
    };
  }
  if (chunk === "VP8L") {
    if (data.length < 25) {
      return undefined;
    }
    const bits = data[21] | (data[22] << 8) | (data[23] << 16) | (data[24] << 24);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      format: "webp",
    };
  }
  if (chunk === "VP8X") {
    if (data.length < 30) {
      return undefined;
    }
    const width = 1 + data[24] + (data[25] << 8) + (data[26] << 16);
    const height = 1 + data[27] + (data[28] << 8) + (data[29] << 16);
    return { width, height, format: "webp" };
  }
  return undefined;
}
