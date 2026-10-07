import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import type { UploadFile } from '@/services/types';

/** Contract (File uploads): the client downscales to about 1024 px on the long edge. */
export const UPLOAD_MAX_EDGE = 1024;
/** Contract: images must be at least 100×100 px. */
export const UPLOAD_MIN_EDGE = 100;
/** JPEG quality after downscaling: small files, no visible loss on a menu card. */
export const UPLOAD_JPEG_QUALITY = 0.8;

/** A picked image, downscaled and re-encoded as JPEG, ready to upload. */
export type PreparedImage = {
  uri: string;
  width: number;
  height: number;
  mimeType: 'image/jpeg';
};

export class ImageTooSmallError extends Error {
  constructor() {
    super(`The image is too small. Choose one at least ${UPLOAD_MIN_EDGE}×${UPLOAD_MIN_EDGE} pixels.`);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ImageTooSmallError';
  }
}

/** Target size that fits `maxEdge` on the long edge, or `null` when the image is already small enough. */
export function fitWithin(width: number, height: number, maxEdge: number = UPLOAD_MAX_EDGE) {
  if (Math.max(width, height) <= maxEdge) return null;
  return width >= height ? { width: maxEdge } : { height: maxEdge };
}

/**
 * Downscales a picked image to ≤ 1024 px on the long edge (keeping its aspect
 * ratio) and re-encodes it as a compressed JPEG, using the SDK 57 contextual
 * `ImageManipulator.manipulate()` API. Throws `ImageTooSmallError` below 100×100.
 */
export async function prepareImageForUpload(source: { uri: string; width: number; height: number }): Promise<PreparedImage> {
  if (source.width > 0 && source.height > 0 && Math.min(source.width, source.height) < UPLOAD_MIN_EDGE) {
    throw new ImageTooSmallError();
  }

  const context = ImageManipulator.manipulate(source.uri);
  try {
    const target = fitWithin(source.width, source.height);
    if (target) context.resize(target);
    const rendered = await context.renderAsync();
    try {
      const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: UPLOAD_JPEG_QUALITY });
      return { uri: result.uri, width: result.width, height: result.height, mimeType: 'image/jpeg' };
    } finally {
      rendered.release();
    }
  } finally {
    context.release();
  }
}

/** The multipart file part for a prepared image, e.g. `{ uri, name: 'product-7.jpg', type: 'image/jpeg' }`. */
export function toUploadFile(image: PreparedImage, baseName: string): UploadFile {
  return { uri: image.uri, name: `${baseName}.jpg`, type: image.mimeType };
}
