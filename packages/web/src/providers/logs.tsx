'use client';
import {
  type Log,
  type LogSummary,
  LogsQueryParams,
} from '@shared/types/data/log';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  queryLogSummaries,
  queryLogs,
} from '@web/api/v1/super-agents/observability/logs';
import { useToast } from '@web/hooks/use-toast';
import { logsQueryKeys } from '@web/providers/logs-query-keys';
import { useNavigation } from '@web/providers/navigation';

export { logsQueryKeys };

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface LogsContextType {
  /**
   * The current page, as summaries: what a table of requests draws. The
   * conversation is not here -- `selectedLog` is the row read whole.
   */
  logs: LogSummary[];
  selectedLog?: Log;
  /**
   * The logs on either side of the selected one in the list's order (newest
   * first): `newerLog` is the row above it, `olderLog` the row below. Looked
   * up by time within the current scope, so they are found across pages and
   * from a deep link.
   */
  newerLog?: LogSummary;
  olderLog?: LogSummary;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;

  // Agent/Skill IDs
  agentId: string | null;
  setAgentId: (agentId: string | null) => void;
  skillId: string | null;
  setSkillId: (skillId: string | null) => void;
  /**
   * When true, logs are fetched for the whole agent and skillId is ignored.
   * The logs page sets it on mount: on for the whole agent, off when
   * narrowed to a skill; a skill's dashboard turns it off for its recent
   * logs. The log detail view leaves it as it found it, so stepping between
   * logs follows the list the log was opened from.
   */
  agentWide: boolean;
  setAgentWide: (agentWide: boolean) => void;

  // Pagination
  page: number;
  pageSize: number;
  totalPages: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;

  // Helper functions
  getLogById: (id: string) => LogSummary | undefined;
  refreshLogs: () => void;
}

const LogsContext = createContext<LogsContextType | undefined>(undefined);

export const LogsProvider = ({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement => {
  const { toast } = useToast();
  const { navigationState } = useNavigation();
  const queryClient = useQueryClient();

  const [agentId, setAgentId] = useState<string | null>(null);
  const [skillId, setSkillId] = useState<string | null>(null);
  const [agentWide, setAgentWide] = useState(false);
  const [page, setPage] = useState(1); // Pages are 1-indexed for display
  const [pageSize, setPageSize] = useState(50);

  // Agent-wide, the skill is not part of the scope: the detail view still
  // names the skill of the log it shows, and that must not count as a scope
  // change, or going back to the agent's logs would land on page 1
  const scopedSkillId = agentWide ? null : skillId;

  // Reset page to 1 when the scope changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: We intentionally reset page when the scope changes
  useEffect(() => {
    setPage(1);
  }, [agentId, scopedSkillId, agentWide]);

  // The filter the list and the neighbor lookups share: a skill, or the
  // whole agent when the view asks for it; null until a view has set one
  const scope = useMemo(() => {
    if (!agentId || (!scopedSkillId && !agentWide)) return null;
    return {
      agent_id: agentId,
      ...(scopedSkillId ? { skill_id: scopedSkillId } : {}),
    };
  }, [agentId, scopedSkillId, agentWide]);

  // Logs query with pagination
  const {
    data: logs = [],
    isLoading: isListLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: logsQueryKeys.list(
      agentId,
      scopedSkillId,
      agentWide,
      page,
      pageSize,
    ),
    queryFn: async () => {
      if (!scope) return [];
      const offset = (page - 1) * pageSize;
      return await queryLogSummaries(
        LogsQueryParams.parse({
          ...scope,
          limit: String(pageSize),
          offset: String(offset),
        }),
      );
    },
    enabled: !!scope,
  });

  // Calculate total pages (approximate based on current page results)
  const totalPages = useMemo(() => {
    if (logs.length < pageSize) {
      // If we got fewer results than pageSize, this is the last page
      return page;
    }
    // We don't know the exact total, but we know there's at least one more page
    // This is a limitation of offset-based pagination without total count
    return page + 1;
  }, [logs.length, page, pageSize]);

  // The log the detail view shows, always fetched whole by its id. The list
  // holds summaries, which is every column a table draws and none of the
  // conversation, so there is no row in it to open -- and one row read whole
  // costs a fraction of what a page of them did.
  const { data: fetchedLog, isLoading: isDetailLoading } = useQuery({
    queryKey: logsQueryKeys.detail(navigationState.logId),
    queryFn: async () => {
      if (!navigationState.logId) return null;
      const found = await queryLogs(
        LogsQueryParams.parse({ id: navigationState.logId }),
      );
      return found[0] ?? null;
    },
    enabled: !!navigationState.logId,
  });

  const selectedLog = fetchedLog ?? undefined;
  // A log still being fetched by id is loading, not missing
  const isLoading = isListLoading || isDetailLoading;

  // The selected log's neighbors: the nearest log strictly after it, oldest
  // first, and the nearest strictly before it, newest first. Strictly, so a
  // log sharing its start_time with another is stepped over rather than
  // looped back to. Summaries, because the arrows need a log's id and not its
  // conversation; stepping to one fetches that row whole.
  const { data: neighbors } = useQuery({
    queryKey: logsQueryKeys.neighbors(
      agentId,
      scopedSkillId,
      agentWide,
      selectedLog?.id,
    ),
    queryFn: async (): Promise<{
      newerLog?: LogSummary;
      olderLog?: LogSummary;
    }> => {
      if (!selectedLog || !scope) return {};
      const [newerRows, olderRows] = await Promise.all([
        queryLogSummaries(
          LogsQueryParams.parse({
            ...scope,
            after: String(selectedLog.start_time + 1),
            order: 'asc',
            limit: '1',
          }),
        ),
        queryLogSummaries(
          LogsQueryParams.parse({
            ...scope,
            before: String(selectedLog.start_time - 1),
            limit: '1',
          }),
        ),
      ]);
      const newerLog: LogSummary | undefined = newerRows[0];
      const olderLog: LogSummary | undefined = olderRows[0];
      return { newerLog, olderLog };
    },
    enabled: !!selectedLog && !!scope,
  });

  useEffect(() => {
    if (error) {
      console.error('Error fetching logs:', error);
      toast({
        title: 'Error fetching logs',
        description: 'Please try again later',
      });
    }
  }, [error, toast]);

  const refreshLogs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: logsQueryKeys.all });
  }, [queryClient]);

  // Helper functions
  const getLogById = useCallback(
    (id: string): LogSummary | undefined => {
      return logs?.find((log: LogSummary) => log.id === id);
    },
    [logs],
  );

  const contextValue: LogsContextType = {
    // Query state
    logs,
    selectedLog,
    newerLog: neighbors?.newerLog,
    olderLog: neighbors?.olderLog,
    isLoading,
    error,
    refetch,

    // Agent/Skill IDs
    agentId,
    setAgentId,
    skillId,
    setSkillId,
    agentWide,
    setAgentWide,

    // Pagination
    page,
    pageSize,
    totalPages,
    setPage,
    setPageSize,

    // Helper functions
    getLogById,
    refreshLogs,
  };

  return (
    <LogsContext.Provider value={contextValue}>{children}</LogsContext.Provider>
  );
};

export const useLogs = (): LogsContextType => {
  const context = useContext(LogsContext);
  if (!context) {
    throw new Error('useLogs must be used within a LogsProvider');
  }
  return context;
};
