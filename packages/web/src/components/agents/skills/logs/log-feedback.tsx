'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createFeedback,
  deleteFeedback,
  getFeedback,
} from '@web/api/v1/super-agents/feedbacks';
import { Button } from '@web/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@web/components/ui/popover';
import { Textarea } from '@web/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@web/components/ui/tooltip';
import { useToast } from '@web/hooks/use-toast';
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';

type Verdict = 'good' | 'bad';

/**
 * Thumbs up / thumbs down on one log. This is an evaluation, but a special
 * one: the verdict is stored as feedback (score 1 or 0) and the server
 * re-runs every evaluation of the log with the judges told a human verified
 * the output as good or bad, so their scores and reasoning get re-anchored.
 *
 * A thumb opens a composer rather than writing straight away, because the
 * reviewer may also type *why* -- the one piece of the judges' prompt that
 * says what is actually wrong with the response instead of that something
 * is. Collecting it before the write matters: each write re-runs every
 * judge on the log, so saving the verdict and the reason separately would
 * pay for two rounds of judging and throw the first one away.
 *
 * Choosing the thumb already carrying the verdict re-opens its note for
 * editing, and offers to withdraw the feedback entirely.
 */
export function LogFeedback({ logId }: { logId: string }): ReactElement {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [composing, setComposing] = useState<Verdict | null>(null);
  const [reason, setReason] = useState('');

  const { data: feedbackList = [] } = useQuery({
    queryKey: ['feedback', logId],
    queryFn: () => getFeedback({ log_id: logId }),
  });
  const existing = feedbackList[0];
  const currentVerdict: Verdict | null =
    existing === undefined ? null : existing.score >= 0.5 ? 'good' : 'bad';

  const mutation = useMutation({
    mutationFn: async ({
      verdict,
      note,
    }: {
      verdict: Verdict | null;
      note: string;
    }) => {
      // One verdict per log: saving replaces whatever was there, and a null
      // verdict withdraws it.
      for (const feedback of feedbackList) {
        await deleteFeedback(feedback.id);
      }
      if (verdict === null) {
        return null;
      }
      const trimmed = note.trim();
      return await createFeedback({
        log_id: logId,
        score: verdict === 'good' ? 1 : 0,
        ...(trimmed ? { feedback: trimmed } : {}),
      });
    },
    onSuccess: (created) => {
      // The whole resource, not just this log's verdict: the session rail
      // asks for a window of logs at once, and withdrawing a verdict emits
      // no event of its own for the stream to invalidate it by.
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
      setComposing(null);
      if (created) {
        toast({
          title:
            created.score >= 0.5
              ? 'Marked as a good output'
              : 'Marked as a bad output',
          description: created.feedback
            ? 'Re-running the evaluations with your verdict and reason as context.'
            : 'Re-running the evaluations with your verdict as context.',
        });
      }
    },
    onError: () => {
      toast({
        title: 'Could not save feedback',
        description: 'Please try again later',
      });
    },
  });

  // Opening the composer for the verdict already stored starts from the note
  // it was saved with, so editing a reason does not mean retyping it.
  const openComposer = (verdict: Verdict): void => {
    setReason(verdict === currentVerdict ? (existing?.feedback ?? '') : '');
    setComposing(verdict);
  };

  const renderThumb = (verdict: Verdict): ReactElement => {
    const isCurrent = currentVerdict === verdict;
    const label = verdict === 'good' ? 'Good output' : 'Bad output';
    const Icon = verdict === 'good' ? ThumbsUpIcon : ThumbsDownIcon;

    return (
      <Popover
        open={composing === verdict}
        onOpenChange={(open) => {
          if (open) {
            openComposer(verdict);
          } else if (!mutation.isPending) {
            setComposing(null);
          }
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant={
                  isCurrent
                    ? verdict === 'good'
                      ? 'default'
                      : 'destructive'
                    : 'outline'
                }
                size="icon"
                aria-label={label}
                aria-pressed={isCurrent}
                disabled={mutation.isPending}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          {/* Nothing to explain once the composer is open, and a tooltip
              hovering over it only covers what the reviewer is reading. */}
          {composing !== verdict && (
            <TooltipContent>
              <p className="text-xs">
                Verify as a {verdict} output, optionally saying why, and re-run
                the evaluations with that context
              </p>
            </TooltipContent>
          )}
        </Tooltip>
        <PopoverContent align="end" className="w-80">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="font-medium text-sm">
                {verdict === 'good'
                  ? 'Verify as a good output'
                  : 'Verify as a bad output'}
              </p>
              <p className="text-muted-foreground text-xs">
                The judges re-score this log with your verdict as ground truth.
                A reason tells them what to look at.
              </p>
            </div>
            {/* Radix traps focus into the popover and lands on the first
                tabbable element, which is this textarea -- the composer
                opens ready to type in without an autoFocus of its own. */}
            <Textarea
              aria-label="Reason for this verdict"
              placeholder={
                verdict === 'good'
                  ? 'What makes this a good output? (optional)'
                  : "What's wrong with this output? (optional)"
              }
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              onKeyDown={(event) => {
                // The composer is a textarea, so plain Enter has to stay a
                // newline; the usual modifier submits.
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  mutation.mutate({ verdict, note: reason });
                }
              }}
              className="min-h-[80px] text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              {isCurrent ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate({ verdict: null, note: '' })}
                >
                  Remove
                </Button>
              ) : (
                <span />
              )}
              <Button
                size="sm"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ verdict, note: reason })}
              >
                Save
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    );
  };

  return (
    <TooltipProvider>
      <div className="flex items-center gap-1">
        {renderThumb('good')}
        {renderThumb('bad')}
      </div>
    </TooltipProvider>
  );
}
