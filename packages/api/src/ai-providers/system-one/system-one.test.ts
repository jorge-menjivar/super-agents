import { naceConfig } from '@api/ai-providers/nace';
import { typesafeConfig } from '@api/ai-providers/typesafe';
import { handleTextResponse } from '@api/handlers/stream-handler';
import { transformUsingProviderConfig } from '@api/services/transform-to-provider-request';
import type {
  AIProviderConfig,
  AIProviderFunctionConfig,
  ResponseTransformFunction,
} from '@shared/types/ai-providers/config';
import { FunctionName } from '@shared/types/api/request';
import type {
  SuperAgentsRequestBody,
  SuperAgentsRequestData,
} from '@shared/types/api/request/body';
import type { SuperAgentsTarget } from '@shared/types/api/request/headers';
import { AIProvider } from '@shared/types/constants';
import type { Context } from 'hono';
import { describe, expect, it } from 'vitest';

const questions = {
  withhold: {
    type: 'noul',
    instructions: 'Should the client be kept from receiving this?',
  },
};

const systemOneRequest = {
  functionName: FunctionName.SYSTEM_ONE,
  requestBody: { state: 'hello', questions },
} as unknown as SuperAgentsRequestData;

const target = (fields: Partial<SuperAgentsTarget> = {}) =>
  fields as SuperAgentsTarget;

function sent(
  config: AIProviderConfig,
  body: Record<string, unknown>,
): Record<string, unknown> {
  return transformUsingProviderConfig(
    config[FunctionName.SYSTEM_ONE] as AIProviderFunctionConfig,
    body as unknown as SuperAgentsRequestBody,
    target(),
  );
}

function answer(
  config: AIProviderConfig,
  body: Record<string, unknown>,
  status = 200,
) {
  const transform = config.responseTransforms?.[
    FunctionName.SYSTEM_ONE
  ] as ResponseTransformFunction;
  return transform(body, status, new Headers(), false, systemOneRequest);
}

describe('a System One request on its way to the provider', () => {
  it('goes as the caller sent it, and nothing else does', () => {
    expect(
      sent(typesafeConfig, {
        model: 'jev-1.13.0',
        state: { response: 'ok' },
        questions,
        temperature: 0.2,
        stream: true,
      }),
    ).toEqual({
      model: 'jev-1.13.0',
      state: { response: 'ok' },
      questions,
    });
  });

  it('keeps a null state, which is a state', () => {
    expect(sent(naceConfig, { state: null, questions })).toEqual({
      state: null,
      questions,
    });
  });

  it('asks TypeSafe for jev-latest when no model is named', () => {
    expect(sent(typesafeConfig, { state: 'x', questions }).model).toBe(
      'jev-latest',
    );
  });

  // Drex serves a request without one as drex-latest, which is its own
  // decision to make.
  it('leaves the model out for Nace when none is named', () => {
    expect(sent(naceConfig, { state: 'x', questions })).not.toHaveProperty(
      'model',
    );
  });
});

describe('a System One answer on its way back', () => {
  const drexAnswer = {
    model: 'drex-max-v1.1',
    answers: { withhold: { type: 'noul', noul: 0.93, confidence: 0.93 } },
    usage: { input_tokens: 41, output_tokens: 3 },
    request_id: 'req_0123456789abcdef0123456789abcdef',
    evaluation_time_ms: 142.6,
  };

  it('comes back whole, stamped with the provider that gave it', () => {
    expect(answer(naceConfig, drexAnswer)).toEqual({
      ...drexAnswer,
      provider: AIProvider.NACE,
    });
    expect(
      answer(typesafeConfig, {
        model: 'jev-1.13.0',
        answers: { withhold: { type: 'noul', noul: 0.12 } },
      }),
    ).toEqual({
      model: 'jev-1.13.0',
      answers: { withhold: { type: 'noul', noul: 0.12 } },
      provider: AIProvider.TYPESAFE,
    });
  });

  it('is reported as invalid when it is not an answer', () => {
    const result = answer(typesafeConfig, { hello: 'world' }) as {
      error: { message: string };
    };
    expect(result.error.message).toContain('Invalid response received');
  });
});

describe("a decision model's errors", () => {
  it("read Drex's envelope, issues included", () => {
    expect(
      answer(
        naceConfig,
        {
          error: {
            type: 'invalid_request_error',
            message: 'Invalid request body',
            issues: [
              { path: ['model'], message: 'unknown model "jev-latest"' },
            ],
          },
          request_id: 'req_1',
        },
        422,
      ),
    ).toEqual({
      error: {
        message:
          'nace error: Invalid request body (model: unknown model "jev-latest")',
        type: 'invalid_request_error',
        param: undefined,
        code: '422',
      },
      provider: AIProvider.NACE,
    });
  });

  it("read Jev's detail when it is a message", () => {
    const result = answer(
      typesafeConfig,
      { detail: 'Question ids must not be empty' },
      400,
    ) as { error: { message: string; code: string } };
    expect(result.error.message).toBe(
      'typesafe error: Question ids must not be empty',
    );
    expect(result.error.code).toBe('400');
  });

  it("read Jev's detail when it is a list of validation issues", () => {
    const result = answer(
      typesafeConfig,
      {
        detail: [
          {
            loc: ['body', 'questions', 'q', 'criteria'],
            msg: 'Field required',
            type: 'missing',
          },
        ],
      },
      422,
    ) as { error: { message: string } };
    expect(result.error.message).toBe(
      'typesafe error: body.questions.q.criteria: Field required',
    );
  });

  it('say something even when the vendor said nothing', () => {
    const result = answer(naceConfig, {}, 503) as {
      error: { message: string };
    };
    expect(result.error.message).toBe(
      'nace error: Request failed with status 503',
    );
    expect(
      (answer(naceConfig, { 'html-message': '  ' }, 503) as typeof result).error
        .message,
    ).toBe('nace error: Request failed with status 503');
  });

  // A self-hosted Drex, or the proxy in front of it, can answer in plain
  // text; the text is the only thing that says what went wrong.
  it('read an error that came as text', async () => {
    const response = await handleTextResponse(
      new Response('model not loaded\n', {
        status: 503,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      }),
      naceConfig.responseTransforms?.[
        FunctionName.SYSTEM_ONE
      ] as ResponseTransformFunction,
      systemOneRequest,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        message: 'nace error: model not loaded',
        type: undefined,
        param: undefined,
        code: '503',
      },
      provider: AIProvider.NACE,
    });
  });
});

describe('where each provider is asked', () => {
  const c = {} as Context;

  it('sends TypeSafe to its API with the key', async () => {
    const args = {
      c,
      saTarget: target({ api_key: 'ts-key' }),
      saRequestData: systemOneRequest,
    };
    expect(await typesafeConfig.api.getBaseURL(args)).toBe(
      'https://api.typesafe.ai',
    );
    expect(typesafeConfig.api.getEndpoint(args)).toBe('/v1/systemone');
    expect(await typesafeConfig.api.headers(args)).toEqual({
      Authorization: 'Bearer ts-key',
      'Content-Type': 'application/json',
    });
    expect(typesafeConfig.api.isAPIKeyRequired).not.toBe(false);
  });

  it('sends Nace to its hosted API with the key', async () => {
    const args = {
      c,
      saTarget: target({ api_key: 'nace_sk_abc' }),
      saRequestData: systemOneRequest,
    };
    expect(await naceConfig.api.getBaseURL(args)).toBe(
      'https://console.nace.ai',
    );
    expect(naceConfig.api.getEndpoint(args)).toBe('/v1/systemone');
    expect(await naceConfig.api.headers(args)).toEqual({
      Authorization: 'Bearer nace_sk_abc',
      'Content-Type': 'application/json',
    });
  });

  // A self-hosted Drex has no key to check; the gateway puts the custom host
  // in place of the base URL.
  it('lets Nace go keyless, for a self-hosted Drex', async () => {
    expect(naceConfig.api.isAPIKeyRequired).toBe(false);
    expect(
      naceConfig.api.customFieldsSchema?.safeParse({
        custom_host: 'http://localhost:8000',
      }).success,
    ).toBe(true);
    expect(
      await naceConfig.api.headers({
        c,
        saTarget: target(),
        saRequestData: systemOneRequest,
      }),
    ).toEqual({ 'Content-Type': 'application/json' });
  });

  it('answers nothing it does not serve', () => {
    const chat = {
      c,
      saTarget: target(),
      saRequestData: {
        ...systemOneRequest,
        functionName: FunctionName.CHAT_COMPLETE,
      } as SuperAgentsRequestData,
    };
    expect(typesafeConfig.api.getEndpoint(chat)).toBe('');
    expect(naceConfig.api.getEndpoint(chat)).toBe('');
    expect(typesafeConfig[FunctionName.CHAT_COMPLETE]).toBeUndefined();
    expect(naceConfig[FunctionName.CHAT_COMPLETE]).toBeUndefined();
  });
});
