import type { SystemOneImageAsset } from '@shared/types/api/routes/system-one-api';

/**
 * Drex's images, from the gateway's named assets.
 *
 * The gateway takes images as Jev does: a map of reference to image, the
 * reference written wherever the image belongs. Drex's JSON form takes an
 * ordered list instead, shown before the state, and names its images "Image
 * 1", "Image 2" in the text -- which is what its own multipart form does with
 * named images. So the images go in the order they were given, and each
 * reference becomes the name Drex knows its image by.
 */

type Assets = Record<string, SystemOneImageAsset> | undefined;

const MIME_TYPES: Record<SystemOneImageAsset['format'], string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/** The images as Drex takes them: data URLs, in the order they were given. */
export function drexImages(assets: Assets): string[] | undefined {
  if (!assets || Object.keys(assets).length === 0) {
    return undefined;
  }
  return Object.values(assets).map(
    (image) => `data:${MIME_TYPES[image.format]};base64,${image.data_base64}`,
  );
}

/**
 * What finds the references in a text, and the name each one becomes.
 *
 * One pattern for all of them, so every reference is replaced in a single
 * pass over the text as it was written. Renaming them one after another lets
 * a later reference match inside an earlier one's replacement: with the
 * references "0" and "1", "compare 0 with 1" would become "compare Image
 * Image 2 with Image 2", and a reference written "Image 2" would take over
 * whichever image had been renamed to that before it. The alternatives go
 * longest first, so a reference that contains another is matched whole.
 */
interface Ordinals {
  pattern: RegExp;
  names: Map<string, string>;
}

function ordinalsOf(assets: Assets): Ordinals | undefined {
  const references = Object.keys(assets ?? {});
  if (references.length === 0) {
    return undefined;
  }
  const names = new Map(
    references.map((reference, index) => [reference, `Image ${index + 1}`]),
  );
  const alternatives = [...references]
    .sort((a, b) => b.length - a.length)
    .map(escapeForPattern);
  return { pattern: new RegExp(alternatives.join('|'), 'g'), names };
}

/** The text as a pattern that matches it literally. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rename(value: unknown, ordinals: Ordinals): unknown {
  if (typeof value === 'string') {
    return value.replace(
      ordinals.pattern,
      (reference) => ordinals.names.get(reference) ?? reference,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => rename(item, ordinals));
  }
  if (value && typeof value === 'object') {
    // Values only: a key -- a question id, an option's name -- is not text
    // the model reads as a reference, on either vendor.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rename(item, ordinals)]),
    );
  }
  return value;
}

/**
 * The value with every image reference in its text replaced by the name
 * Drex gives that image. Returns new values; the caller's are left alone.
 */
export function withImageOrdinals<T>(value: T, assets: Assets): T {
  const ordinals = ordinalsOf(assets);
  return ordinals ? (rename(value, ordinals) as T) : value;
}
