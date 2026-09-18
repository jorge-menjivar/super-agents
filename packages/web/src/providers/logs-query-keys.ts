/**
 * The query keys every read of a log is cached under.
 *
 * Their own module rather than the logs provider's, because the SSE provider
 * invalidates by the `all` prefix and several hooks key under it -- and a
 * hook that imported them from the provider dragged the whole provider in
 * with them.
 */
export const logsQueryKeys = {
  all: ['logs'] as const,
  lists: () => [...logsQueryKeys.all, 'list'] as const,
  list: (
    agentId: string | null,
    skillId: string | null,
    agentWide: boolean,
    page: number,
    pageSize: number,
  ) =>
    [
      ...logsQueryKeys.lists(),
      agentId,
      skillId,
      agentWide,
      page,
      pageSize,
    ] as const,
  detail: (logId: string | undefined) =>
    [...logsQueryKeys.all, 'detail', logId] as const,
  neighbors: (
    agentId: string | null,
    skillId: string | null,
    agentWide: boolean,
    logId: string | undefined,
  ) =>
    [
      ...logsQueryKeys.all,
      'neighbors',
      agentId,
      skillId,
      agentWide,
      logId,
    ] as const,
};
