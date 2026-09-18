'use client';

import type { LogSummary } from '@shared/types/data/log';
import { Button } from '@web/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactElement } from 'react';

/**
 * Steps to the log before or after this one in the list it was opened from,
 * which is newest first: previous is the newer log, next the older. A side
 * without a log -- the end of the list, or neighbors not looked up yet -- is
 * disabled. Stepping through a session is the rail's own job.
 */
export function LogNavigation({
  newerLog,
  olderLog,
  onNavigate,
}: {
  newerLog?: LogSummary;
  olderLog?: LogSummary;
  onNavigate: (log: LogSummary) => void;
}): ReactElement {
  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous log"
              disabled={!newerLog}
              onClick={() => newerLog && onNavigate(newerLog)}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Previous log in the list (newer)</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next log"
              disabled={!olderLog}
              onClick={() => olderLog && onNavigate(olderLog)}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">Next log in the list (older)</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
