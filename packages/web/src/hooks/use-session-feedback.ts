'use client';

import {
  FEEDBACK_LOG_IDS_LIMIT,
  type Feedback,
} from '@shared/types/data/feedback';
import type { LogSummary } from '@shared/types/data/log';
import { useQuery } from '@tanstack/react-query';
import { getFeedback } from '@web/api/v1/super-agents/feedbacks';
import { useMemo } from 'react';

const NO_FEEDBACK = new Map<string, Feedback>();

/**
 * The thumbs a reviewer gave the requests of a session, by log id.
 *
 * Asked for the whole window at once rather than one query per row, which is
 * what `log_ids` on the feedback query is for: a session rail is up to a
 * hundred requests, and a hundred requests must not be a hundred fetches.
 *
 * In batches of `FEEDBACK_LOG_IDS_LIMIT`, because the ids travel as a URL --
 * a uuid and its separator is 39 characters, so the list is the request. A
 * window of fifty either side of a request is 101 logs and so two batches
 * today; the batching is what keeps a wider window from quietly becoming a
 * request line no proxy will carry.
 *
 * The key starts with `feedback`, the prefix the stream invalidates when a
 * verdict is saved (`feedback:created`) and the one the composer invalidates
 * when a verdict is withdrawn, so the rail follows the thumb the reader just
 * gave without asking for it.
 */
export function useSessionFeedback(logs: LogSummary[]): Map<string, Feedback> {
  const ids = logs.map((log) => log.id);
  const { data } = useQuery({
    queryKey: ['feedback', 'logs', ids] as const,
    queryFn: async () => {
      const batches: string[][] = [];
      for (let from = 0; from < ids.length; from += FEEDBACK_LOG_IDS_LIMIT) {
        batches.push(ids.slice(from, from + FEEDBACK_LOG_IDS_LIMIT));
      }
      const answered = await Promise.all(
        batches.map((batch) => getFeedback({ log_ids: batch })),
      );
      return answered.flat();
    },
    enabled: ids.length > 0,
    // Stepping through a session re-centres the window, which changes the
    // ids and so the key. The verdicts are the same ones; keep showing them
    // rather than blanking the rail until the new query lands.
    placeholderData: (previous) => previous,
  });

  return useMemo(() => {
    if (!data || data.length === 0) return NO_FEEDBACK;
    // One verdict per log: the composer replaces rather than appends, and the
    // newest wins if an older deployment left two.
    const byLog = new Map<string, Feedback>();
    for (const feedback of [...data].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    )) {
      byLog.set(feedback.log_id, feedback);
    }
    return byLog;
  }, [data]);
}
