'use client';

import { type AIProvider, PrettyAIProvider } from '@shared/types/constants';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { Badge } from '@web/components/ui/badge';
import { cn } from '@web/utils/ui/utils';
import { ChevronRight } from 'lucide-react';
import { type ReactElement, useState } from 'react';

/** The score an answer has to reach to read as a good one. */
export const GOOD_SCORE = 0.7;

const METHOD_NAMES: Record<EvaluationMethodName, string> = {
  [EvaluationMethodName.TASK_COMPLETION]: 'Task Completion',
  [EvaluationMethodName.ARGUMENT_CORRECTNESS]: 'Argument Correctness',
  [EvaluationMethodName.ROLE_ADHERENCE]: 'Role Adherence',
  [EvaluationMethodName.TURN_RELEVANCY]: 'Turn Relevancy',
  [EvaluationMethodName.TOOL_CORRECTNESS]: 'Tool Correctness',
  [EvaluationMethodName.KNOWLEDGE_RETENTION]: 'Knowledge Retention',
  [EvaluationMethodName.CONVERSATION_COMPLETENESS]: 'Conversation Completeness',
  [EvaluationMethodName.LATENCY]: 'Latency',
};

export interface EvaluationDetail {
  method: EvaluationMethodName;
  score: number;
  sections: Array<{ label: string; content: string }>;
  judgeModelName: string | null;
  judgeModelProvider: string | null;
}

/** Who scored it, where a model did rather than the gateway itself. */
function judgeOf(evaluation: EvaluationDetail): string | null {
  if (!evaluation.judgeModelName) return null;
  const provider = evaluation.judgeModelProvider;
  return provider
    ? `${PrettyAIProvider[provider as AIProvider] || provider}/${evaluation.judgeModelName}`
    : evaluation.judgeModelName;
}

/**
 * What the judges made of the answer: one line each, and what they wrote
 * underneath when asked for.
 *
 * Read the same way as the hooks beside them -- a name, a verdict, and the
 * reasoning against a rule -- because they are the same kind of thing, a
 * judgement of this request with an account behind it. Each used to be a
 * card whose sections were a second accordion inside the first, so reading
 * one judge's reasoning cost three clicks and drew four borders.
 */
export function EvaluationResults({
  evaluations,
}: {
  evaluations: EvaluationDetail[];
}): ReactElement {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  return (
    <div className="divide-y" data-testid="evaluations">
      {evaluations.map((evaluation, index) => {
        const key = `${evaluation.method}-${index}`;
        const isOpen = expanded.has(key);
        const judge = judgeOf(evaluation);
        const good = evaluation.score >= GOOD_SCORE;
        return (
          <div key={key} className="py-1 first:pt-0 last:pb-0">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setExpanded((was) => {
                  const next = new Set(was);
                  if (!next.delete(key)) next.add(key);
                  return next;
                })
              }
              className={cn(
                '-mx-2 flex w-full flex-row flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 text-left text-xs',
                'transition-colors hover:bg-muted/60 motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
              )}
            >
              {/* One chevron that turns, rather than two that swap: the
                  quarter turn is what says the row is opening. */}
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 shrink-0 text-muted-foreground',
                  'transition-transform duration-150 motion-reduce:transition-none',
                  isOpen && 'rotate-90',
                )}
              />
              <span className="font-medium">
                {METHOD_NAMES[evaluation.method] || evaluation.method}
              </span>
              <span
                className={cn(
                  'font-mono font-medium tabular-nums',
                  good
                    ? 'text-green-600 dark:text-green-500'
                    : 'text-amber-500',
                )}
              >
                {(evaluation.score * 100).toFixed(0)}%
              </span>
              {judge && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="font-mono text-muted-foreground">
                    {judge}
                  </span>
                </>
              )}
              {evaluation.sections.length > 0 && !isOpen && (
                <Badge
                  variant="outline"
                  className="h-5 px-2 py-0 text-xs font-normal text-muted-foreground"
                >
                  {evaluation.sections.length === 1
                    ? '1 note'
                    : `${evaluation.sections.length} notes`}
                </Badge>
              )}
            </button>
            {isOpen && (
              <div className="mt-1.5 flex flex-col gap-2 pl-5">
                {evaluation.sections.map((section) => (
                  <div key={section.label} className="flex flex-col gap-0.5">
                    <div className="text-xs text-muted-foreground">
                      {section.label}
                    </div>
                    <p className="whitespace-pre-wrap border-l-2 border-border pl-3 text-sm leading-relaxed">
                      {section.content}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
