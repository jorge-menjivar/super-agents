import type { Log } from '@shared/types/data/log';
import { HOOK_DENIED_STATUS } from '@shared/types/middleware/hooks';
import { wentUnreviewed } from '@web/utils/hook-outcome';

/**
 * How a request ended, in the one word the page is titled by.
 *
 * It answers a single question -- did something go wrong -- and deliberately
 * says nothing about how good the answer was. That is the evaluation score,
 * which is a number and reads as one. Colouring by both at once is what made
 * a weak answer and a withheld request look alike in the session rail.
 */

export type LogOutcomeTone = 'running' | 'failed' | 'unreviewed' | 'served';

export interface LogOutcome {
  tone: LogOutcomeTone;
  label: string;
  /** Why it reads that way, where the word alone would not say. */
  title?: string;
}

export function outcomeOf(log: Log): LogOutcome {
  if (log.end_time === null || log.status === null) {
    return { tone: 'running', label: 'Running' };
  }
  if (log.status === HOOK_DENIED_STATUS) {
    return {
      tone: 'failed',
      label: 'Withheld',
      title: 'A hook withheld the response, and the client was given an error',
    };
  }
  if (log.status >= 400) {
    return {
      tone: 'failed',
      label: 'Failed',
      title: `The client was given ${log.status}`,
    };
  }
  if (wentUnreviewed(log.hook_logs)) {
    return {
      tone: 'unreviewed',
      label: 'Answered unreviewed',
      title:
        'A hook that was meant to check this request could not run, and it fails open',
    };
  }
  return { tone: 'served', label: 'Answered' };
}
