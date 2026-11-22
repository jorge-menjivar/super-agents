import { HttpMethod } from '@api/types/http';
import { constructRequest } from '@api/utils/super-agents/requests';
import { produceSuperAgentsRequestData } from '@shared/utils/sa-request-data';
import { describe, expect, it } from 'vitest';

interface TestRequestInit extends RequestInit {
  duplex?: string;
}

describe('constructRequest', () => {
  describe('UPLOAD_FILE with multipart/form-data', () => {
    it('should preserve Content-Type header correctly', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/files',
        { 'content-type': 'multipart/form-data; boundary=test-boundary' },
        { file: new Blob(), purpose: 'batch' },
      );

      const result = constructRequest(
        saRequestData,
        { authorization: 'Bearer test' },
        {},
        {},
      ) as TestRequestInit;

      expect(result.duplex).toBe('half');
      expect((result.headers as Record<string, string>)['Content-Type']).toBe(
        'multipart/form-data; boundary=test-boundary',
      );
      expect(
        (result.headers as Record<string, string>)['content-type'],
      ).toBeUndefined();
    });

    it('should handle non-multipart UPLOAD_FILE', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/files',
        { 'content-type': 'application/json' },
        { file: new Blob(), purpose: 'batch' },
      );

      const result = constructRequest(
        saRequestData,
        {},
        {},
        {},
      ) as TestRequestInit;

      expect(result.duplex).toBe('half');
      expect((result.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    });
  });

  describe('Header handling', () => {
    it('should delete content-type for GET requests', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.GET,
        'https://api.openai.com/v1/files',
        { 'content-type': 'application/json' },
        {},
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect(
        (result.headers as Record<string, string>)['content-type'],
      ).toBeUndefined();
    });

    it('should delete content-type for multipart/form-data requests', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'multipart/form-data; boundary=test' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect(
        (result.headers as Record<string, string>)['content-type'],
      ).toBeUndefined();
    });

    it('should preserve content-type for non-GET, non-multipart requests', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect((result.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    });

    // The gateway reads such a body as JSON anyway, and sends it on as JSON,
    // so the provider has to be told that is what it is.
    it('labels as JSON a body the client sent without a content-type', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        {},
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect((result.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    });
  });

  describe('Header merging', () => {
    it('should merge provider config headers correctly', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const providerConfigHeaders = {
        Authorization: 'Bearer test-token',
        'X-Custom-Header': 'custom-value',
      };

      const result = constructRequest(
        saRequestData,
        providerConfigHeaders,
        {},
        {},
      );

      expect((result.headers as Record<string, string>).authorization).toBe(
        'Bearer test-token',
      );
      expect(
        (result.headers as Record<string, string>)['x-custom-header'],
      ).toBe('custom-value');
    });

    it('should merge forwarded headers correctly', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const forwardedHeaders = {
        'X-Forwarded-For': '192.168.1.1',
        'X-Real-IP': '192.168.1.1',
      };

      const result = constructRequest(saRequestData, {}, forwardedHeaders, {});

      expect(
        (result.headers as Record<string, string>)['X-Forwarded-For'],
      ).toBe('192.168.1.1');
      expect((result.headers as Record<string, string>)['X-Real-IP']).toBe(
        '192.168.1.1',
      );
    });

    it('should not merge proxy headers when function name is not proxy', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const proxyHeaders = {
        'X-Proxy-Header': 'proxy-value',
      };

      const result = constructRequest(saRequestData, {}, {}, proxyHeaders);

      expect(
        (result.headers as Record<string, string>)['x-proxy-header'],
      ).toBeUndefined();
    });
  });

  describe('Header precedence', () => {
    it('should apply header precedence correctly', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const providerConfigHeaders = {
        'content-type': 'application/xml',
        authorization: 'Bearer provider-token',
      };

      const forwardedHeaders = {
        authorization: 'Bearer forwarded-token',
        'x-forwarded-for': '192.168.1.1',
      };

      const result = constructRequest(
        saRequestData,
        providerConfigHeaders,
        forwardedHeaders,
        {},
      );

      // Forwarded headers should override provider config headers
      expect((result.headers as Record<string, string>).authorization).toBe(
        'Bearer forwarded-token',
      );
      expect(
        (result.headers as Record<string, string>)['x-forwarded-for'],
      ).toBe('192.168.1.1');
      // Base content-type should be preserved
      expect((result.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    });
  });

  describe('Content-Length header removal', () => {
    it('should remove content-length header', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const providerConfigHeaders = {
        'content-length': '123',
        authorization: 'Bearer test',
      };

      const result = constructRequest(
        saRequestData,
        providerConfigHeaders,
        {},
        {},
      );

      expect(
        (result.headers as Record<string, string>)['content-length'],
      ).toBeUndefined();
      expect((result.headers as Record<string, string>).authorization).toBe(
        'Bearer test',
      );
    });
  });

  describe('Method handling', () => {
    it('should set method correctly', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect(result.method).toBe('POST');
    });

    it('should handle different HTTP methods for valid endpoints', () => {
      // Test POST method
      const postSuperAgentsRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const postResult = constructRequest(
        postSuperAgentsRequestData,
        {},
        {},
        {},
      );
      expect(postResult.method).toBe('POST');

      // Test GET method for files endpoint
      const getSuperAgentsRequestData = produceSuperAgentsRequestData(
        HttpMethod.GET,
        'https://api.openai.com/v1/files',
        { 'content-type': 'application/json' },
        {},
      );

      const getResult = constructRequest(getSuperAgentsRequestData, {}, {}, {});
      expect(getResult.method).toBe('GET');
    });
  });

  describe('Edge cases', () => {
    it('should handle empty headers', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        {},
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect((result.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    });

    it('should handle case-insensitive header keys', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'Content-Type': 'application/json' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect((result.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    });

    it('should handle content-type with parameters', () => {
      const saRequestData = produceSuperAgentsRequestData(
        HttpMethod.POST,
        'https://api.openai.com/v1/chat/completions',
        { 'content-type': 'application/json; charset=utf-8' },
        {
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: 'Hello' }],
        },
      );

      const result = constructRequest(saRequestData, {}, {}, {});

      expect((result.headers as Record<string, string>)['content-type']).toBe(
        'application/json',
      );
    });
  });
});
