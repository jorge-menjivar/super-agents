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

/** Each reference and the name Drex gives its image, longest first. */
function ordinalsOf(assets: Assets): [string, string][] {
  return Object.keys(assets ?? {})
    .map((reference, index): [string, string] => [
      reference,
      `Image ${index + 1}`,
    ])
    .sort(([a], [b]) => b.length - a.length);
}

function rename(value: unknown, ordinals: [string, string][]): unknown {
  if (typeof value === 'string') {
    // Longest first, so a reference that contains another is renamed whole.
    return ordinals.reduce(
      (text, [reference, name]) => text.split(reference).join(name),
      value,
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
  return ordinals.length === 0 ? value : (rename(value, ordinals) as T);
}
