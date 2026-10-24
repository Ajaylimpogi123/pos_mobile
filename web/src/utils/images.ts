/**
 * Prepares a picked image for upload (Global Conventions → File uploads):
 * `jpeg`, `png` or `webp`, at most 5 MB, at least 100×100 px, and downscaled
 * in the browser to about 1024 px on the long edge before it goes up.
 */

export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_BYTES = 5 * 1024 * 1024;
const MIN_SIDE = 100;
const LONG_EDGE = 1024;

export type PreparedImage = { blob: Blob; name: string };

const EXTENSIONS: Record<(typeof ALLOWED_TYPES)[number], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function isAllowed(type: string): type is (typeof ALLOWED_TYPES)[number] {
  return (ALLOWED_TYPES as readonly string[]).includes(type);
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
}

/** Returns the image to send, or throws an `Error` with a message for the form. */
export async function prepareImage(file: File, baseName: string): Promise<PreparedImage> {
  if (!isAllowed(file.type)) throw new Error('Choose a JPEG, PNG or WebP image.');

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This image couldn't be read. Choose another file.");
  }

  try {
    const { width, height } = bitmap;
    if (width < MIN_SIDE || height < MIN_SIDE) throw new Error(`The image must be at least ${MIN_SIDE}×${MIN_SIDE} pixels.`);

    const longest = Math.max(width, height);
    if (longest <= LONG_EDGE && file.size <= MAX_BYTES) {
      return { blob: file, name: `${baseName}.${EXTENSIONS[file.type as keyof typeof EXTENSIONS]}` };
    }

    const scale = Math.min(1, LONG_EDGE / longest);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(MIN_SIDE, Math.round(width * scale));
    canvas.height = Math.max(MIN_SIDE, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error("This image couldn't be resized. Choose a smaller file.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    // PNG stays PNG unless it is still too big; then (and for photos) a compressed format is used.
    const preferred = file.type === 'image/png' ? 'image/png' : file.type;
    let blob = await toBlob(canvas, preferred);
    let type = preferred;
    if (!blob || blob.size > MAX_BYTES) {
      type = 'image/webp';
      blob = await toBlob(canvas, type);
    }
    if (!blob || blob.type !== type || blob.size > MAX_BYTES) {
      type = 'image/jpeg';
      blob = await toBlob(canvas, type);
    }
    if (!blob || blob.size > MAX_BYTES) throw new Error('The image is larger than 5 MB. Choose a smaller file.');
    return { blob, name: `${baseName}.${EXTENSIONS[type as keyof typeof EXTENSIONS]}` };
  } finally {
    bitmap.close();
  }
}
