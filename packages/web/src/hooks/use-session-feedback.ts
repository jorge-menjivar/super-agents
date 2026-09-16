'use client';

import type { Feedback } from '@shared/types/data/feedback';
import type { Log } from '@shared/types/data/log';
import { useQuery } from '@tanstack/react-query';
import { getFeedback } from '@web/api/v1/super-agents/feedbacks';
import { useMemo } from 'react';

const NO_FEEDBACK = new Map<string, Feedback>();

/**
 * The thumbs a reviewer gave the requests of a session, by log id.
 *
 * Asked for the whole window in one query rather than one per row, which is
 * what `log_ids` on the feedback query is for: a session rail is up to a
 * hundred requests, and a hundred requests must not be a hundred fetches.
 *
 * The key starts with `feedback`, the prefix the stream invalidates when a
 * verdict is saved (`feedback:created`) and the one the composer invalidates
 * when a verdict is withdrawn, so the rail follows the thumb the reader just
 * gave without asking for it.
 */
export function useSessionFeedback(logs: Log[]): Map<string, Feedback> {
  const ids = logs.map((log) => log.id);
  const { data } = useQuery({
    queryKey: ['feedback', 'logs', ids] as const,
    queryFn: () => getFeedback({ log_ids: ids }),
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
