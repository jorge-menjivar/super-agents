import { naceConfig } from '@api/ai-providers/nace';
import { drexImages, withImageOrdinals } from '@api/ai-providers/nace/images';
import { typesafeConfig } from '@api/ai-providers/typesafe';
import { transformUsingProviderConfig } from '@api/services/transform-to-provider-request';
import type { AIProviderFunctionConfig } from '@shared/types/ai-providers/config';
import { FunctionName } from '@shared/types/api/request';
import type {
  SuperAgentsRequestBody,
  SuperAgentsRequestData,
} from '@shared/types/api/request/body';
import type { SuperAgentsTarget } from '@shared/types/api/request/headers';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';

/**
 * Images in a System One request, as the gateway takes them -- Jev's named
 * `assets`, each reference written where its image belongs -- and as each
 * vendor is sent them.
 */
const assets = {
  'door-cam': {
    type: 'image' as const,
    format: 'jpg' as const,
    data_base64: '/9j/door',
  },
  'door-cam-2': {
    type: 'image' as const,
    format: 'png' as const,
    data_base64: 'iVBORdoor2',
  },
};

const body = {
  model: 'drex-latest',
  state: { photo: 'door-cam', later: 'then door-cam-2, an hour on' },
  questions: {
    'door-cam': {
      type: 'choice',
      instructions: 'Is anyone at the door in door-cam?',
      criteria: { 'door-cam-2': 'Only in door-cam-2', nobody: null },
    },
  },
  assets,
};

const sent = (config: AIProviderFunctionConfig) =>
  transformUsingProviderConfig(
    config,
    body as unknown as SuperAgentsRequestBody,
    {} as SuperAgentsTarget,
  );

describe('drexImages', () => {
  it('lists the images as data URLs, in the order they were given', () => {
    expect(drexImages(assets)).toEqual([
      'data:image/jpeg;base64,/9j/door',
      'data:image/png;base64,iVBORdoor2',
    ]);
  });

  it('is nothing without images', () => {
    expect(drexImages(undefined)).toBeUndefined();
    expect(drexImages({})).toBeUndefined();
  });
});

describe('withImageOrdinals', () => {
  // Longest first: `door-cam-2` contains `door-cam`, and is renamed whole.
  it('names each image as Drex does, wherever its reference is written', () => {
    expect(withImageOrdinals(body.state, assets)).toEqual({
      photo: 'Image 1',
      later: 'then Image 2, an hour on',
    });
  });

  it('leaves keys alone: an id or an option name is not text the model reads', () => {
    expect(withImageOrdinals(body.questions, assets)).toEqual({
      'door-cam': {
        type: 'choice',
        instructions: 'Is anyone at the door in Image 1?',
        criteria: { 'door-cam-2': 'Only in Image 2', nobody: null },
      },
    });
  });

  it('leaves everything alone without images', () => {
    expect(withImageOrdinals(body.state, undefined)).toBe(body.state);
  });

  // Every reference is renamed in one pass over the text as written, so no
  // reference is ever found inside the name another one was given.
  describe('never renames a name it has just written', () => {
    const image = {
      type: 'image' as const,
      format: 'png' as const,
      data_base64: 'iVBOR',
    };

    it('when a reference is part of a name', () => {
      expect(
        withImageOrdinals('compare 0 with 1', { '0': image, '1': image }),
      ).toBe('compare Image 1 with Image 2');
    });

    it('when a reference is itself a name', () => {
      expect(
        withImageOrdinals('Image 2 before Image 1', {
          'Image 2': image,
          'Image 1': image,
        }),
      ).toBe('Image 1 before Image 2');
    });

    it('when a name contains a longer reference', () => {
      expect(withImageOrdinals('2 then 10', { '2': image, '10': image })).toBe(
        'Image 1 then Image 2',
      );
    });

    it('when a reference reads as a pattern', () => {
      expect(withImageOrdinals('see a.b, not axb', { 'a.b': image })).toBe(
        'see Image 1, not axb',
      );
    });
  });
});

describe('a System One request with images, on its way out', () => {
  it('goes to Drex as numbered images, the references renamed', () => {
    const forwarded = sent(
      naceConfig[FunctionName.SYSTEM_ONE] as AIProviderFunctionConfig,
    );

    expect(forwarded.images).toEqual([
      'data:image/jpeg;base64,/9j/door',
      'data:image/png;base64,iVBORdoor2',
    ]);
    expect(forwarded.state).toEqual({
      photo: 'Image 1',
      later: 'then Image 2, an hour on',
    });
    expect(forwarded).not.toHaveProperty('assets');
  });

  it('goes to Jev as it came', () => {
    const forwarded = sent(
      typesafeConfig[FunctionName.SYSTEM_ONE] as AIProviderFunctionConfig,
    );

    expect(forwarded.assets).toEqual(assets);
    expect(forwarded.state).toEqual(body.state);
    expect(forwarded).not.toHaveProperty('images');
  });

  // Jev refuses an image it was not told to expect.
  it('turns images on for Jev when there are any, and only then', async () => {
    const headersFor = (requestBody: Record<string, unknown>) =>
      typesafeConfig.api.headers({
        c: {} as Context,
        saTarget: { api_key: 'key' } as SuperAgentsTarget,
        saRequestData: {
          functionName: FunctionName.SYSTEM_ONE,
          requestBody,
        } as unknown as SuperAgentsRequestData,
      });

    expect(await headersFor(body)).toMatchObject({
      'TypeSafe-Danger-Zone-Images': 'true',
    });
    expect(
      await headersFor({ state: 'x', questions: body.questions }),
    ).not.toHaveProperty('TypeSafe-Danger-Zone-Images');
  });
});
