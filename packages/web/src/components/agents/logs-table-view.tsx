'use client';

import type { LogSummary } from '@shared/types/data';
import {
  isRunning,
  LogDuration,
  LogEvalScore,
  LogFunction,
  LogModel,
  LogRowHandle,
} from '@web/components/agents/log-cells';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@web/components/ui/card';
import { Input } from '@web/components/ui/input';
import { PageHeader } from '@web/components/ui/page-header';
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@web/components/ui/pagination';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@web/components/ui/select';
import { Skeleton } from '@web/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@web/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { useLogs } from '@web/providers/logs';
import { getStringHashColor } from '@web/utils/http-method-colors';
import { formatLogTimestamp } from '@web/utils/time';
import { CalendarIcon, InfoIcon, SearchIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { ReactElement, ReactNode } from 'react';
import { useState } from 'react';

/**
 * The request-logs page. The caller wires the fetch scope into the logs
 * provider, says what its middle column is (the skill across an agent, the
 * partition within one skill) and adds any filter of its own; everything
 * else -- search, status, table, pagination -- renders the provider's
 * current page.
 */
export interface LogsTableViewProps {
  description: string;
  emptyText: string;
  onBack: () => void;
  onLogClick: (log: LogSummary) => void;
  extraColumn: {
    header: string;
    render: (log: LogSummary) => ReactNode;
  };
  /** The caller's own filter controls, beside the status filter */
  filters?: ReactNode;
}

/**
 * The temperature the request was sent with.
 *
 * Three answers, not two: a number; `null` when the provider was asked
 * without one, which is what "not supported" means; and `undefined` while the
 * request is still running, when there is no provider exchange to read yet.
 * Collapsing the last two claims the model does not support temperature and
 * then corrects itself when the request finishes.
 */
const getTemperature = (log: LogSummary): number | null | undefined => {
  const requestBody = log.provider_request_params;
  if (!requestBody || typeof requestBody !== 'object') {
    return undefined;
  }
  if ('temperature' in requestBody) {
    return requestBody.temperature as number;
  }
  return null;
};

const getThinkingEffort = (log: LogSummary): string | null => {
  const requestBody = log.provider_request_params;
  if (requestBody && typeof requestBody === 'object') {
    // Check for thinking.type (Anthropic extended thinking)
    if (
      'thinking' in requestBody &&
      typeof requestBody.thinking === 'object' &&
      requestBody.thinking !== null &&
      'type' in requestBody.thinking
    ) {
      return requestBody.thinking.type as string;
    }
    // Check for reasoning_effort (OpenAI o1/o3 models)
    if ('reasoning_effort' in requestBody) {
      return requestBody.reasoning_effort as string;
    }
  }
  return null;
};

export function LogsTableView({
  description,
  emptyText,
  onBack,
  onLogClick,
  extraColumn,
  filters,
}: LogsTableViewProps): ReactElement {
  const { logs, isLoading, page, pageSize, totalPages, setPage, setPageSize } =
    useLogs();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [goToPageInput, setGoToPageInput] = useState('');

  const runningCount = logs.filter(
    (log: LogSummary) => log.end_time === null,
  ).length;

  const filteredLogs = logs.filter((log: LogSummary) => {
    if (statusFilter !== 'all') {
      // A request still running has no status to match yet.
      if (log.status === null) {
        return false;
      }
      const rangeStart = Number(statusFilter);
      if (log.status < rangeStart || log.status >= rangeStart + 100) {
        return false;
      }
    }
    if (searchQuery) {
      const searchLower = searchQuery.toLowerCase();
      return (
        log.function_name?.toLowerCase().includes(searchLower) ||
        log.endpoint?.toLowerCase().includes(searchLower) ||
        log.method?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  return (
    <>
      <PageHeader title="Logs" description={description} onBack={onBack} />
      <div className="p-6 space-y-6">
        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Filters</CardTitle>
            <CardDescription>Filter and search through logs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by function name, endpoint, method..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              {filters}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="200">Success (2xx)</SelectItem>
                  <SelectItem value="400">Client Error (4xx)</SelectItem>
                  <SelectItem value="500">Server Error (5xx)</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline">
                <CalendarIcon className="h-4 w-4 mr-2" />
                Date Range
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Logs Table */}
        <Card>
          <CardHeader>
            <div className="flex justify-between items-center">
              <div>
                <CardTitle>Request Logs</CardTitle>
                <CardDescription>
                  {filteredLogs.length} logs found
                  {runningCount > 0 && `, ${runningCount} running`}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 5 }).map(() => (
                  <div key={nanoid()} className="flex space-x-4">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="text-center py-12">
                <h3 className="text-lg font-semibold mb-2">No logs found</h3>
                <p className="text-muted-foreground">
                  {searchQuery || statusFilter !== 'all'
                    ? 'No logs match your current filters.'
                    : emptyText}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Eval</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Function</TableHead>
                    <TableHead>Endpoint</TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Trace ID</TableHead>
                    <TableHead>{extraColumn.header}</TableHead>
                    <TableHead>Temp</TableHead>
                    <TableHead>Reasoning</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredLogs.map((log) => {
                    const running = isRunning(log);
                    const temperature = getTemperature(log);
                    const thinkingEffort = getThinkingEffort(log);

                    return (
                      <TableRow
                        key={log.id}
                        className={
                          running
                            ? 'cursor-pointer bg-muted/30 hover:bg-muted/50'
                            : 'cursor-pointer hover:bg-muted/50'
                        }
                        data-testid={running ? 'running-log-row' : undefined}
                        onClick={() => onLogClick(log)}
                      >
                        <TableCell>
                          <LogRowHandle
                            log={log}
                            onSelect={() => onLogClick(log)}
                          />
                        </TableCell>
                        <TableCell>
                          <LogEvalScore log={log} />
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.method}</Badge>
                        </TableCell>
                        <TableCell>
                          <LogFunction log={log} />
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {log.endpoint}
                        </TableCell>
                        <TableCell>
                          <LogModel log={log} />
                        </TableCell>
                        <TableCell>
                          {log.trace_id ? (
                            <Badge
                              variant="outline"
                              className={`font-mono text-xs ${getStringHashColor(log.trace_id)}`}
                            >
                              {log.trace_id}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{extraColumn.render(log)}</TableCell>
                        <TableCell>
                          {typeof temperature === 'number' ? (
                            <span className="font-mono text-xs">
                              {temperature.toFixed(2)}
                            </span>
                          ) : temperature === undefined ? (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <InfoIcon className="h-3 w-3 text-muted-foreground/50" />
                                </TooltipTrigger>
                                <TooltipContent>
                                  <p className="text-xs">
                                    Temperature not supported for this model
                                  </p>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </TableCell>
                        <TableCell>
                          {thinkingEffort ? (
                            <Badge variant="secondary" className="text-xs">
                              {thinkingEffort}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">
                              —
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          {formatLogTimestamp(log.start_time)}
                        </TableCell>
                        <TableCell>
                          <LogDuration log={log} />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Pagination Controls */}
        {filteredLogs.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-4">
                {/* Pagination Info and Controls */}
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                  {/* Page Size Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Rows per page:
                    </span>
                    <Select
                      value={String(pageSize)}
                      onValueChange={(value) => setPageSize(Number(value))}
                    >
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Page Info */}
                  <div className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </div>

                  {/* Go to Page */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Go to page:
                    </span>
                    <Input
                      type="number"
                      min="1"
                      max={totalPages}
                      value={goToPageInput}
                      onChange={(e) => setGoToPageInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const pageNum = Number(goToPageInput);
                          if (pageNum >= 1 && pageNum <= totalPages) {
                            setPage(pageNum);
                            setGoToPageInput('');
                          }
                        }
                      }}
                      className="w-20"
                      placeholder={String(page)}
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        const pageNum = Number(goToPageInput);
                        if (pageNum >= 1 && pageNum <= totalPages) {
                          setPage(pageNum);
                          setGoToPageInput('');
                        }
                      }}
                      disabled={!goToPageInput}
                    >
                      Go
                    </Button>
                  </div>
                </div>

                {/* Pagination Buttons */}
                <Pagination>
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        onClick={() => setPage(Math.max(1, page - 1))}
                        disabled={page === 1}
                      />
                    </PaginationItem>

                    {/* Page Numbers */}
                    {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                      let pageNum: number;
                      if (totalPages <= 5) {
                        // Show all pages if 5 or fewer
                        pageNum = i + 1;
                      } else if (page <= 3) {
                        // Near the start
                        pageNum = i + 1;
                      } else if (page >= totalPages - 2) {
                        // Near the end
                        pageNum = totalPages - 4 + i;
                      } else {
                        // In the middle
                        pageNum = page - 2 + i;
                      }

                      return (
                        <PaginationItem key={pageNum}>
                          <PaginationLink
                            isActive={page === pageNum}
                            onClick={() => setPage(pageNum)}
                          >
                            {pageNum}
                          </PaginationLink>
                        </PaginationItem>
                      );
                    })}

                    {totalPages > 5 && page < totalPages - 2 && (
                      <PaginationItem>
                        <PaginationEllipsis />
                      </PaginationItem>
                    )}

                    <PaginationItem>
                      <PaginationNext
                        onClick={() => setPage(Math.min(totalPages, page + 1))}
                        disabled={page === totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
