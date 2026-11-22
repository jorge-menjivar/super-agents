import type { SystemOneImageAsset } from '@shared/types/api/routes/system-one-api';

/**
 * The images in what a decision-model reviewer is shown, as images.
 *
 * A chat request carries an image inline, as a `data:` URL inside a message
 * part. Left there, a decision model reads it as megabytes of base64 text --
 * and never sees the picture it was sent. Lifted out as a System One asset,
 * it sees the image, and the text keeps a reference where the image was.
 *
 * Only PNG and JPEG are lifted, the formats both vendors take, and at most
 * eight, which is all Drex takes: the newest eight, which are the ones the
 * review is about -- the image in the last turn, the one in the response --
 * and the ones that survive when the review's budget drops the oldest turns.
 * Any other inline file -- WebP, a PDF, an older image past the eight -- is
 * replaced by a note saying what was there, so the review still says
 * something was, without the bytes.
 */

/** As many images as Drex takes; Jev takes more, but the reviewer may be Drex. */
export const MAX_REVIEW_IMAGES = 8;

const INLINE_FILE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i;

const LIFTED_FORMATS: Record<string, SystemOneImageAsset['format']> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
};

/**
 * How a lifted image is referred to in the text. Bracketed, so that no
 * reference is the beginning of another -- `<image-1>` is not the start of
 * `<image-10>` -- since both vendors match references as plain text.
 */
const referenceTo = (index: number) => `<image-${index}>`;

export interface LiftedImages<T> {
  material: T;
  assets?: Record<string, SystemOneImageAsset>;
}

/** The format an inline image is lifted as, or null when it is not one. */
function liftedFormat(value: unknown): SystemOneImageAsset['format'] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const inline = INLINE_FILE.exec(value);
  return inline ? (LIFTED_FORMATS[inline[1].toLowerCase()] ?? null) : null;
}

/** How many images the material carries inline, in the formats lifted. */
function countImages(value: unknown): number {
  if (liftedFormat(value)) {
    return 1;
  }
  if (Array.isArray(value)) {
    return value.reduce((total: number, item) => total + countImages(item), 0);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce(
      (total: number, item) => total + countImages(item),
      0,
    );
  }
  return 0;
}

/** The material with its inline images replaced by references to assets. */
export function liftImages<T>(material: T): LiftedImages<T> {
  const assets: Record<string, SystemOneImageAsset> = {};
  // The material is walked oldest first, so the images past the eight are
  // the first ones met.
  let older = Math.max(0, countImages(material) - MAX_REVIEW_IMAGES);
  let count = 0;

  const lift = (value: unknown): unknown => {
    if (typeof value === 'string') {
      const inline = INLINE_FILE.exec(value);
      if (!inline) {
        return value;
      }
      const mimeType = inline[1].toLowerCase();
      const format = LIFTED_FORMATS[mimeType];
      if (!format) {
        return `[an inline ${mimeType} file, not shown]`;
      }
      if (older > 0) {
        older -= 1;
        return `[an earlier image, not shown: only the newest ${MAX_REVIEW_IMAGES} are]`;
      }
      count += 1;
      const reference = referenceTo(count);
      assets[reference] = {
        type: 'image',
        format,
        data_base64: inline[2].replace(/\s+/g, ''),
      };
      return reference;
    }
    if (Array.isArray(value)) {
      return value.map(lift);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, lift(item)]),
      );
    }
    return value;
  };

  const lifted = lift(material) as T;
  return count > 0 ? { material: lifted, assets } : { material: lifted };
}
