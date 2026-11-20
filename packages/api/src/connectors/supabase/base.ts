import {
  getPostgrestServiceRoleKey,
  getPostgrestUrl,
  getSupabaseSecretKey,
} from '@api/constants';
import type { AppContext } from '@api/types/hono';
import type { z } from 'zod';

export const selectFromSupabase = async <T extends z.ZodType>(
  c: AppContext,
  table: string,
  queryParams: Record<string, string | undefined>,
  schema: T,
): Promise<z.infer<T>> => {
  const postgrestUrl = getPostgrestUrl(c);
  const postgrestServiceRoleKey = getPostgrestServiceRoleKey(c);
  const supabaseSecretKey = getSupabaseSecretKey(c);

  const url = new URL(`${postgrestUrl}/${table}`);

  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${postgrestServiceRoleKey}`,
  };

  if (supabaseSecretKey) {
    headers.apiKey = supabaseSecretKey;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `\
Failed to fetch from PostgREST:
${response.status} - ${response.statusText}
${await response.text()}`,
    );
  }

  const data = await response.json();
  try {
    const parsedData = schema.parse(data);
    return parsedData;
  } catch (error) {
    throw new Error(`Failed to parse data from PostgREST: ${error}`);
  }
};

export const insertIntoSupabase = async <
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType | null,
>(
  c: AppContext,
  table: string,
  data: z.infer<InputSchema>,
  schema: OutputSchema,
  /**
   * What to do with a row whose primary key exists: `true` overwrites it,
   * `'ignore'` leaves it as it is, `false` (the default) fails.
   */
  upsert: boolean | 'ignore' = false,
): Promise<
  // If schema is not provided, return void
  OutputSchema extends z.ZodType ? z.infer<OutputSchema> : void
> => {
  const postgrestUrl = getPostgrestUrl(c);
  const postgrestServiceRoleKey = getPostgrestServiceRoleKey(c);
  const supabaseSecretKey = getSupabaseSecretKey(c);

  const url = new URL(`${postgrestUrl}/${table}`);

  const preferArr = [];

  if (upsert === 'ignore') {
    preferArr.push('resolution=ignore-duplicates');
  } else if (upsert) {
    preferArr.push('resolution=merge-duplicates');
  }

  if (schema) {
    preferArr.push('return=representation');
  }

  const prefer = preferArr.join(', ');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${postgrestServiceRoleKey}`,
    Prefer: prefer,
  };

  if (supabaseSecretKey) {
    headers.apiKey = supabaseSecretKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(
      `\
Failed to insert into PostgREST:
${response.status} - ${response.statusText}
${await response.text()}`,
    );
  }

  if (!schema) {
    return undefined as OutputSchema extends z.ZodType ? never : undefined;
  }

  const rawInsertedData = await response.json();
  try {
    return schema.parse(rawInsertedData) as OutputSchema extends z.ZodType
      ? never
      : undefined;
  } catch (error) {
    throw new Error(`Failed to parse data from PostgREST: ${error}`);
  }
};

export const updateInSupabase = async <
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(
  c: AppContext,
  table: string,
  id: string,
  data: z.infer<InputSchema>,
  schema: OutputSchema | null,
): Promise<
  // If schema is not provided, return void
  OutputSchema extends z.ZodType ? z.infer<OutputSchema> : void
> => patchInSupabase(c, table, { id: `eq.${id}` }, data, schema);

/**
 * PATCH the rows matching `params` (PostgREST filters, e.g. `{ id: 'eq.1' }`)
 * and return them as updated. With a filter that is part of the condition --
 * a lease that is still free -- the rows returned say whether anything
 * changed, which is what makes a conditional update atomic over HTTP.
 */
export const patchInSupabase = async <
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(
  c: AppContext,
  table: string,
  params: Record<string, string>,
  data: z.infer<InputSchema>,
  schema: OutputSchema | null,
): Promise<
  // If schema is not provided, return void
  OutputSchema extends z.ZodType ? z.infer<OutputSchema> : void
> => {
  const postgrestUrl = getPostgrestUrl(c);
  const postgrestServiceRoleKey = getPostgrestServiceRoleKey(c);
  const supabaseSecretKey = getSupabaseSecretKey(c);

  const url = new URL(`${postgrestUrl}/${table}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${postgrestServiceRoleKey}`,
    Prefer: 'return=representation',
  };
  if (supabaseSecretKey) {
    headers.apiKey = supabaseSecretKey;
  }

  const response = await fetch(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(
      `\
Failed to update in PostgREST:
${response.status} - ${response.statusText}
${await response.text()}`,
    );
  }

  const rawUpdatedData = await response.json();
  try {
    if (!schema) {
      return undefined as OutputSchema extends z.ZodType ? never : undefined;
    }
    return schema.parse(rawUpdatedData) as OutputSchema extends z.ZodType
      ? never
      : undefined;
  } catch (error) {
    throw new Error(`Failed to parse data from PostgREST: ${error}`);
  }
};

export const deleteFromSupabase = async (
  c: AppContext,
  table: string,
  params: Record<string, string>,
): Promise<void> => {
  const postgrestUrl = getPostgrestUrl(c);
  const postgrestServiceRoleKey = getPostgrestServiceRoleKey(c);
  const supabaseSecretKey = getSupabaseSecretKey(c);

  const url = new URL(`${postgrestUrl}/${table}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${postgrestServiceRoleKey}`,
  };

  if (supabaseSecretKey) {
    headers.apiKey = supabaseSecretKey;
  }

  const response = await fetch(url, {
    method: 'DELETE',
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `\
Failed to delete from PostgREST:
${response.status} - ${response.statusText}
${await response.text()}`,
    );
  }
};

export const rpcFunction = async (
  c: AppContext,
  functionName: string,
  params: Record<string, string>,
): Promise<void> => {
  const postgrestUrl = getPostgrestUrl(c);
  const postgrestServiceRoleKey = getPostgrestServiceRoleKey(c);
  const supabaseSecretKey = getSupabaseSecretKey(c);

  const url = new URL(`${postgrestUrl}/rpc/${functionName}`);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${postgrestServiceRoleKey}`,
  };

  if (supabaseSecretKey) {
    headers.apiKey = supabaseSecretKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
  });

  if (!response.ok) {
    throw new Error(
      `\
Failed to call RPC function:
${response.status} - ${response.statusText}
${await response.text()}`,
    );
  }
};

export const rpcFunctionWithResponse = async <T extends z.ZodType>(
  c: AppContext,
  functionName: string,
  params: Record<string, unknown>,
  schema: T,
): Promise<z.Infer<T>> => {
  const postgrestUrl = getPostgrestUrl(c);
  const postgrestServiceRoleKey = getPostgrestServiceRoleKey(c);
  const supabaseSecretKey = getSupabaseSecretKey(c);

  const url = new URL(`${postgrestUrl}/rpc/${functionName}`);

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${postgrestServiceRoleKey}`,
  };

  if (supabaseSecretKey) {
    headers.apiKey = supabaseSecretKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(
      `\
Failed to fetch from PostgREST:
${response.status} - ${response.statusText}
${await response.text()}`,
    );
  }

  const data = await response.json();
  try {
    const parsedData = schema.parse(data);
    return parsedData;
  } catch (error) {
    throw new Error(
      `Failed to parse data from PostgREST function ${functionName} output: ${error}`,
    );
  }
};
