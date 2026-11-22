import {
  liftImages,
  MAX_REVIEW_IMAGES,
} from '@api/connectors/hooks/review-images';
import { describe, expect, it } from 'vitest';

const png = (bytes: string) => `data:image/png;base64,${bytes}`;

/** A chat message with an image, the way a client sends one. */
const withImage = (url: string) => ({
  role: 'user',
  content: [
    { type: 'text', text: 'Is this safe to post?' },
    { type: 'image_url', image_url: { url } },
  ],
});

describe('liftImages', () => {
  it('lifts an inline image out as an asset, leaving a reference', () => {
    const lifted = liftImages({
      request: { messages: [withImage(png('iVBORw0KGgo='))] },
    });

    expect(lifted.material).toEqual({
      request: { messages: [withImage('<image-1>')] },
    });
    expect(lifted.assets).toEqual({
      '<image-1>': {
        type: 'image',
        format: 'png',
        data_base64: 'iVBORw0KGgo=',
      },
    });
  });

  it('numbers the images in the order they appear, JPEG included', () => {
    const lifted = liftImages({
      request: {
        messages: [
          withImage('data:image/jpeg;base64,/9j/4AAQ'),
          withImage(png('iVBOR')),
        ],
      },
      response: { choices: [] },
    });

    expect(lifted.assets).toEqual({
      '<image-1>': { type: 'image', format: 'jpg', data_base64: '/9j/4AAQ' },
      '<image-2>': { type: 'image', format: 'png', data_base64: 'iVBOR' },
    });
  });

  // A decision model would read anything else as base64 text, and neither
  // vendor takes it as an image.
  it('says what another inline file was, without the bytes', () => {
    const lifted = liftImages({
      request: { messages: [withImage('data:image/webp;base64,UklGRg==')] },
    });

    expect(lifted.assets).toBeUndefined();
    expect(JSON.stringify(lifted.material)).toContain(
      '[an inline image/webp file, not shown]',
    );
    expect(JSON.stringify(lifted.material)).not.toContain('UklGRg');
  });

  // The newest are what the review is about -- the last turn's, the
  // response's -- and what survives when its budget drops the oldest turns.
  it('lifts no more images than Drex takes: the newest', () => {
    const messages = Array.from({ length: MAX_REVIEW_IMAGES + 2 }, (_, i) =>
      withImage(png(`image${i}`)),
    );

    const lifted = liftImages({ request: { messages } });

    const liftedBytes = Object.values(lifted.assets ?? {}).map(
      (asset) => asset.data_base64,
    );
    expect(liftedBytes).toHaveLength(MAX_REVIEW_IMAGES);
    expect(liftedBytes).not.toContain('image0');
    expect(liftedBytes).not.toContain('image1');
    expect(liftedBytes.at(-1)).toBe(`image${MAX_REVIEW_IMAGES + 1}`);
    expect(JSON.stringify(lifted.material)).toContain(
      `[an earlier image, not shown: only the newest ${MAX_REVIEW_IMAGES} are]`,
    );
  });

  it('leaves material without images exactly as it was', () => {
    const material = {
      request: { messages: [{ role: 'user', content: 'hello' }] },
      response: null,
    };

    expect(liftImages(material)).toEqual({ material });
  });

  // `<image-1>` is not the start of `<image-10>`: both vendors match the
  // references as plain text.
  it('writes references no other reference begins', () => {
    const messages = Array.from({ length: MAX_REVIEW_IMAGES }, (_, i) =>
      withImage(png(`image${i}`)),
    );
    const references = Object.keys(
      liftImages({ request: { messages } }).assets ?? {},
    );

    for (const a of references) {
      for (const b of references) {
        if (a !== b) {
          expect(b.startsWith(a)).toBe(false);
        }
      }
    }
  });
});
