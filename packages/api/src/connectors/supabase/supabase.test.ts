import {
  supabaseLogsStorageConnector,
  supabaseUserDataStorageConnector,
} from '@api/connectors/supabase';
import { createMockContext } from '@api/test-utils/mock-context';
import type {
  ToolCreateParams,
  ToolQueryParams,
} from '@shared/types/data/tool';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockContext = createMockContext();

// Mock environment variables - constants are now functions that take AppContext
vi.mock('@api/constants', () => ({
  getPostgrestServiceRoleKey: () => 'test-service-role-key',
  getPostgrestUrl: () => 'https://test.supabase.co/rest/v1',
  getSupabaseSecretKey: () => 'test-secret-key',
  getAiProviderApiKeyEncryptionKey: () => 'test-encryption-key-32-bytes-long',
}));

// Mock fetch globally
global.fetch = vi.fn();

describe('supabaseUserDataStorageConnector - Tool Operations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getTools', () => {
    it('should fetch tools with basic query parameters', async () => {
      const mockResponse = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          agent_id: '123e4567-e89b-12d3-a456-426614174001',
          hash: 'abcd1234',
          type: 'function',
          name: 'test_function',
          raw_data: { test: 'data' },
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const queryParams: ToolQueryParams = {
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
      };

      const result = await supabaseUserDataStorageConnector.getTools(
        mockContext,
        queryParams,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        new URL(
          'https://test.supabase.co/rest/v1/tools?agent_id=eq.123e4567-e89b-12d3-a456-426614174001',
        ),
        {
          method: 'GET',
          headers: {
            Authorization: 'Bearer test-service-role-key',
            apiKey: 'test-secret-key',
          },
        },
      );
      expect(result).toEqual(mockResponse);
    });

    it('should handle all query parameters', async () => {
      const mockResponse: unknown[] = [];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const queryParams: ToolQueryParams = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
        hash: 'abcd1234',
        type: 'function',
        name: 'test_function',
        limit: 10,
        offset: 5,
      };

      await supabaseUserDataStorageConnector.getTools(mockContext, queryParams);

      const expectedUrl = new URL('https://test.supabase.co/rest/v1/tools');
      expectedUrl.searchParams.set(
        'id',
        'eq.123e4567-e89b-12d3-a456-426614174000',
      );
      expectedUrl.searchParams.set(
        'agent_id',
        'eq.123e4567-e89b-12d3-a456-426614174001',
      );
      expectedUrl.searchParams.set('hash', 'eq.abcd1234');
      expectedUrl.searchParams.set('type', 'eq.function');
      expectedUrl.searchParams.set('name', 'eq.test_function');
      expectedUrl.searchParams.set('limit', '10');
      expectedUrl.searchParams.set('offset', '5');

      expect(mockFetch).toHaveBeenCalledWith(expectedUrl, expect.any(Object));
    });

    it('should handle empty query parameters', async () => {
      const mockResponse: unknown[] = [];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      await supabaseUserDataStorageConnector.getTools(mockContext, {});

      expect(mockFetch).toHaveBeenCalledWith(
        new URL('https://test.supabase.co/rest/v1/tools'),
        expect.any(Object),
      );
    });

    it('should handle API errors', async () => {
      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Database connection failed',
      } as Response);

      await expect(
        supabaseUserDataStorageConnector.getTools(mockContext, {}),
      ).rejects.toThrow('Failed to fetch from PostgREST');
    });

    it('should handle schema validation errors', async () => {
      const invalidResponse = [
        {
          id: 'invalid-uuid',
          agent_id: '123e4567-e89b-12d3-a456-426614174001',
          // Missing required fields
        },
      ];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => invalidResponse,
      } as Response);

      await expect(
        supabaseUserDataStorageConnector.getTools(mockContext, {}),
      ).rejects.toThrow('Failed to parse data from PostgREST');
    });
  });

  describe('createTool', () => {
    it('should create a tool successfully', async () => {
      const createParams: ToolCreateParams = {
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
        hash: 'abcd1234',
        type: 'function',
        name: 'test_function',
        raw_data: { function: { name: 'test_function' } },
      };

      const mockResponse = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          ...createParams,
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await supabaseUserDataStorageConnector.createTool(
        mockContext,
        createParams,
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        new URL('https://test.supabase.co/rest/v1/tools'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-service-role-key',
            apiKey: 'test-secret-key',
            Prefer: 'return=representation',
          },
          body: JSON.stringify(createParams),
        },
      );
      expect(result).toEqual(mockResponse[0]);
    });

    it('should handle creation errors', async () => {
      const createParams: ToolCreateParams = {
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
        hash: 'abcd1234',
        type: 'function',
        name: 'test_function',
        raw_data: {},
      };

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid data provided',
      } as Response);

      await expect(
        supabaseUserDataStorageConnector.createTool(mockContext, createParams),
      ).rejects.toThrow('Failed to insert into PostgREST');
    });

    it('should handle duplicate tools gracefully', async () => {
      const createParams: ToolCreateParams = {
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
        hash: 'abcd1234',
        type: 'function',
        name: 'test_function',
        raw_data: {},
      };

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        text: async () => 'duplicate key value violates unique constraint',
      } as Response);

      await expect(
        supabaseUserDataStorageConnector.createTool(mockContext, createParams),
      ).rejects.toThrow('Failed to insert into PostgREST');
    });
  });

  describe('deleteTool', () => {
    it('should delete a tool successfully', async () => {
      const toolId = '123e4567-e89b-12d3-a456-426614174000';

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
      } as Response);

      await supabaseUserDataStorageConnector.deleteTool(mockContext, toolId);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        new URL(
          'https://test.supabase.co/rest/v1/tools?id=eq.123e4567-e89b-12d3-a456-426614174000',
        ),
        {
          method: 'DELETE',
          headers: {
            Authorization: 'Bearer test-service-role-key',
            apiKey: 'test-secret-key',
          },
        },
      );
    });

    it('should handle deletion errors', async () => {
      const toolId = '123e4567-e89b-12d3-a456-426614174000';

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        text: async () => 'Database error',
      } as Response);

      await expect(
        supabaseUserDataStorageConnector.deleteTool(mockContext, toolId),
      ).rejects.toThrow('Failed to delete from PostgREST');
    });
  });

  describe('environment variable validation', () => {
    it('should throw error when POSTGREST_SERVICE_ROLE_KEY is missing', async () => {
      // Reset modules to ensure fresh import
      vi.resetModules();

      // Mock the constants to return undefined for service role key
      vi.doMock('@api/constants', () => ({
        getPostgrestServiceRoleKey: () => {
          throw new Error('POSTGREST_SERVICE_ROLE_KEY is not set');
        },
        getPostgrestUrl: () => 'https://test.supabase.co/rest/v1',
        getSupabaseSecretKey: () => 'test-secret-key',
        getAiProviderApiKeyEncryptionKey: () =>
          'test-encryption-key-32-bytes-long',
      }));

      // Re-import to get the mocked version
      const { supabaseUserDataStorageConnector: mockedConnector } =
        await import('@api/connectors/supabase');

      await expect(
        mockedConnector.getTools(createMockContext(), {}),
      ).rejects.toThrow('POSTGREST_SERVICE_ROLE_KEY');

      // Reset after test
      vi.doUnmock('@api/constants');
    });

    it('should throw error when POSTGREST_URL is missing', async () => {
      // Reset modules to ensure fresh import
      vi.resetModules();

      vi.doMock('@api/constants', () => ({
        getPostgrestServiceRoleKey: () => 'test-key',
        getPostgrestUrl: () => {
          throw new Error('POSTGREST_URL is not set');
        },
        getSupabaseSecretKey: () => 'test-secret-key',
        getAiProviderApiKeyEncryptionKey: () =>
          'test-encryption-key-32-bytes-long',
      }));

      const { supabaseUserDataStorageConnector: mockedConnector } =
        await import('@api/connectors/supabase');

      await expect(
        mockedConnector.getTools(createMockContext(), {}),
      ).rejects.toThrow('POSTGREST_URL');

      // Reset after test
      vi.doUnmock('@api/constants');
    });
  });

  describe('complex tool data handling', () => {
    it('should handle tools with complex raw_data', async () => {
      const createParams: ToolCreateParams = {
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
        hash: 'complex_hash',
        type: 'function',
        name: 'complex_function',
        raw_data: {
          function: {
            name: 'complex_function',
            description: 'A complex function with nested data',
            parameters: {
              type: 'object',
              properties: {
                input: { type: 'string' },
                options: {
                  type: 'object',
                  properties: {
                    verbose: { type: 'boolean' },
                    format: { type: 'string', enum: ['json', 'xml'] },
                  },
                },
              },
            },
          },
          metadata: {
            version: '1.0',
            tags: ['complex', 'nested'],
            configuration: {
              timeout: 30000,
              retries: 3,
            },
          },
        },
      };

      const mockResponse = [
        {
          id: '123e4567-e89b-12d3-a456-426614174000',
          ...createParams,
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        },
      ];

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const result = await supabaseUserDataStorageConnector.createTool(
        mockContext,
        createParams,
      );

      expect(result.raw_data).toEqual(createParams.raw_data);
      expect(result.name).toBe('complex_function');
    });

    it('should handle tool queries with pagination', async () => {
      const mockResponse = Array.from({ length: 5 }, (_, i) => ({
        id: `123e4567-e89b-12d3-a456-42661417400${i}`,
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
        hash: `hash_${i}`,
        type: 'function',
        name: `function_${i}`,
        raw_data: { index: i },
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }));

      const mockFetch = vi.mocked(fetch);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as Response);

      const queryParams: ToolQueryParams = {
        agent_id: '123e4567-e89b-12d3-a456-426614174001',
        limit: 5,
        offset: 10,
      };

      const result = await supabaseUserDataStorageConnector.getTools(
        mockContext,
        queryParams,
      );

      expect(result).toHaveLength(5);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining('limit=5'),
        }),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenCalledWith(
        expect.objectContaining({
          href: expect.stringContaining('offset=10'),
        }),
        expect.any(Object),
      );
    });
  });
});

describe('supabaseUserDataStorageConnector - skill creation lease', () => {
  const agentId = '123e4567-e89b-12d3-a456-426614174000';
  const holder = 'holder-token';
  const now = '2026-08-29T10:00:00.000Z';
  const until = '2026-08-29T10:00:45.000Z';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const claimWith = (holderAfter: string | null) => {
    const mockFetch = vi.mocked(fetch);
    mockFetch
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => [] } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ holder: holderAfter }],
      } as Response);
    return supabaseUserDataStorageConnector.claimSkillCreationLease(
      mockContext,
      agentId,
      holder,
      now,
      until,
    );
  };

  it('claims with an insert-if-missing, a conditional patch and a read-back', async () => {
    expect(await claimWith(holder)).toBe(true);

    const mockFetch = vi.mocked(fetch);
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const [insertUrl, insertInit] = mockFetch.mock.calls[0] as [
      URL,
      RequestInit,
    ];
    expect(insertUrl.href).toBe(
      'https://test.supabase.co/rest/v1/skill_creation_leases',
    );
    expect(insertInit.method).toBe('POST');
    expect((insertInit.headers as Record<string, string>).Prefer).toBe(
      'resolution=ignore-duplicates',
    );
    expect(JSON.parse(insertInit.body as string)).toEqual({
      agent_id: agentId,
      holder: null,
      lease_until: null,
    });

    const [patchUrl, patchInit] = mockFetch.mock.calls[1] as [URL, RequestInit];
    expect(patchInit.method).toBe('PATCH');
    expect(patchUrl.searchParams.get('agent_id')).toBe(`eq.${agentId}`);
    expect(patchUrl.searchParams.get('or')).toBe(
      `(lease_until.is.null,lease_until.lt.${now})`,
    );
    expect(JSON.parse(patchInit.body as string)).toEqual({
      holder,
      lease_until: until,
    });

    const [readUrl] = mockFetch.mock.calls[2] as [URL, RequestInit];
    expect(readUrl.searchParams.get('agent_id')).toBe(`eq.${agentId}`);
    expect(readUrl.searchParams.get('select')).toBe('holder');
  });

  it('is not claimed when another holder has the lease', async () => {
    expect(await claimWith('someone-else')).toBe(false);
  });

  it('releases only the lease it holds', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await supabaseUserDataStorageConnector.releaseSkillCreationLease(
      mockContext,
      agentId,
      holder,
    );

    const [url, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(url.searchParams.get('agent_id')).toBe(`eq.${agentId}`);
    expect(url.searchParams.get('holder')).toBe(`eq.${holder}`);
    expect(JSON.parse(init.body as string)).toEqual({
      holder: null,
      lease_until: null,
    });
  });
});

describe('supabaseLogsStorageConnector - getLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sentUrl = (): URL => {
    const [url] = vi.mocked(fetch).mock.calls[0];
    return new URL(String(url));
  };

  it('orders newest first by default', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await supabaseLogsStorageConnector.getLogs(mockContext, {});

    expect(sentUrl().searchParams.get('order')).toBe('start_time.desc');
  });

  it('orders oldest first when asked, so the nearest later log is first', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await supabaseLogsStorageConnector.getLogs(mockContext, {
      after: 2001,
      order: 'asc',
      limit: 1,
    });

    const params = sentUrl().searchParams;
    expect(params.get('order')).toBe('start_time.asc');
    expect(params.get('start_time')).toBe('gte.2001');
    expect(params.get('limit')).toBe('1');
  });

  it('filters on the trace', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await supabaseLogsStorageConnector.getLogs(mockContext, {
      trace_id: 'ses_1',
    });

    expect(sentUrl().searchParams.get('trace_id')).toBe('eq.ses_1');
  });

  it('lists the logs that have no evaluation run yet', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await supabaseLogsStorageConnector.getLogs(mockContext, {
      unjudged: true,
    });

    expect(sentUrl().searchParams.get('eval_run_count')).toBe('eq.0');
  });

  it('lists the logs that have a score', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    } as Response);

    await supabaseLogsStorageConnector.getLogs(mockContext, {
      judged: true,
    });

    expect(sentUrl().searchParams.get('avg_eval_score')).toBe('not.is.null');
  });
});
