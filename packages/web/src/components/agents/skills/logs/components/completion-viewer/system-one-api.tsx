'use client';

import type {
  SystemOneAnswer,
  SystemOneImageAsset,
  SystemOneQuestion,
  SystemOneRequestBody,
  SystemOneResponseBody,
} from '@shared/types/api/routes/system-one-api';
import { GenericViewer } from '@web/components/agents/skills/logs/components/generic-viewer';
import { Badge } from '@web/components/ui/badge';
import { cn } from '@web/utils/ui/utils';

/**
 * A decision model's exchange: the material it was asked about, then each
 * question with the answer it got. The answers are probabilities, so they are
 * drawn as bars rather than printed as the JSON they arrive in.
 */

const MIME_TYPES: Record<SystemOneImageAsset['format'], string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

/**
 * The images the model was shown, each under the reference the text uses
 * for it -- which is how a reader of the state knows which is which.
 */
function Images({
  assets,
}: {
  assets: Record<string, SystemOneImageAsset>;
}): React.ReactElement {
  return (
    <section
      aria-label="Images"
      className="rounded-md border bg-card p-3 space-y-2"
    >
      <div className="text-sm font-medium">Images</div>
      <div className="flex flex-wrap gap-3">
        {Object.entries(assets).map(([reference, image]) => (
          <figure key={reference} className="space-y-1">
            <img
              src={`data:${MIME_TYPES[image.format]};base64,${image.data_base64}`}
              alt={`Shown to the model as ${reference}`}
              className="max-h-48 max-w-xs rounded border object-contain"
            />
            <figcaption className="font-mono text-xs text-muted-foreground">
              {reference}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const percent = (probability: number): string =>
  `${(probability * 100).toFixed(1)}%`;

function ProbabilityBar({
  label,
  probability,
  emphasised = false,
}: {
  label: string;
  probability: number;
  emphasised?: boolean;
}): React.ReactElement {
  const width = Math.min(Math.max(probability, 0), 1) * 100;
  return (
    <div className="grid grid-cols-[minmax(0,10rem)_1fr_4rem] items-center gap-2 text-sm">
      <span className={cn('truncate', emphasised && 'font-medium')}>
        {label}
      </span>
      <div className="h-2 rounded-full bg-muted" aria-hidden="true">
        <div
          className={cn(
            'h-2 rounded-full',
            emphasised ? 'bg-primary' : 'bg-muted-foreground/40',
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      <span
        className={cn(
          'text-right tabular-nums text-muted-foreground',
          emphasised && 'font-medium text-foreground',
        )}
      >
        {percent(probability)}
      </span>
    </div>
  );
}

/** A score level's description, from a legend sent as an array or a map. */
function levelName(
  legend: string[] | Record<string, string> | undefined,
  level: number,
): string {
  const name = Array.isArray(legend) ? legend[level] : legend?.[String(level)];
  return name ? name : `Level ${level}`;
}

function Answer({
  question,
  answer,
}: {
  question: SystemOneQuestion | undefined;
  answer: SystemOneAnswer;
}): React.ReactElement {
  switch (answer.type) {
    case 'noul': {
      const yes = answer.noul >= 0.5;
      return (
        <div className="space-y-2">
          <div className="text-sm">
            Answered <span className="font-medium">{yes ? 'yes' : 'no'}</span>
          </div>
          <ProbabilityBar label="Yes" probability={answer.noul} emphasised />
        </div>
      );
    }
    case 'choice': {
      const probabilities = answer.probabilities ?? {
        [answer.choice]: answer.confidence ?? 1,
      };
      // In the order the options were offered, which is the order they mean.
      const offered =
        question?.type === 'choice' ? Object.keys(question.criteria) : [];
      const options = [
        ...offered,
        ...Object.keys(probabilities).filter((o) => !offered.includes(o)),
      ];
      return (
        <div className="space-y-2">
          <div className="text-sm">
            Chose <span className="font-medium">{answer.choice}</span>
          </div>
          {options.map((option) => (
            <ProbabilityBar
              key={option}
              label={option}
              probability={probabilities[option] ?? 0}
              emphasised={option === answer.choice}
            />
          ))}
        </div>
      );
    }
    case 'score': {
      const probabilities = answer.probabilities ?? {};
      const levels = Object.keys(probabilities)
        .map(Number)
        .sort((a, b) => a - b);
      const nearest = Math.round(answer.score);
      return (
        <div className="space-y-2">
          <div className="text-sm">
            Scored{' '}
            <span className="font-medium tabular-nums">
              {answer.score.toFixed(2)}
            </span>
            , nearest{' '}
            <span className="font-medium">
              {levelName(answer.legend, nearest)}
            </span>
          </div>
          {levels.map((level) => (
            <ProbabilityBar
              key={level}
              label={levelName(answer.legend, level)}
              probability={probabilities[String(level)] ?? 0}
              emphasised={level === nearest}
            />
          ))}
        </div>
      );
    }
  }
}

function Decision({
  id,
  question,
  answer,
}: {
  id: string;
  question: SystemOneQuestion | undefined;
  answer: SystemOneAnswer | undefined;
}): React.ReactElement {
  const instructions = question?.instructions;
  return (
    <section
      aria-label={`Question ${id}`}
      className="rounded-md border bg-card p-3 space-y-3"
    >
      <header className="flex items-center gap-2">
        <span className="font-mono text-sm">{id}</span>
        <Badge variant="outline">{answer?.type ?? question?.type}</Badge>
      </header>
      {instructions !== undefined && instructions !== null && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {typeof instructions === 'string'
            ? instructions
            : JSON.stringify(instructions, null, 2)}
        </p>
      )}
      {answer ? (
        <Answer question={question} answer={answer} />
      ) : (
        <div className="text-sm text-muted-foreground">No answer</div>
      )}
    </section>
  );
}

/**
 * The policy a skill asked its questions under: its served system prompt,
 * which the gateway put ahead of every question's instructions. A skill the
 * gateway created starts with none, and says so rather than drawing nothing.
 */
export interface DecisionPolicy {
  /** The policy as served; empty or null when the skill has none yet. */
  text: string | null;
  /** Which configuration served it, when the page knows. */
  servedBy?: string | null;
}

function Policy({
  logId,
  policy,
}: {
  logId: string;
  policy: DecisionPolicy;
}): React.ReactElement {
  const servedBy = policy.servedBy && (
    <Badge
      variant="outline"
      className="text-xs text-muted-foreground"
      title="The configuration the optimizer served this request with, whose policy was put ahead of every question"
    >
      {policy.servedBy}
    </Badge>
  );
  if (!policy.text) {
    return (
      <section
        aria-label="Policy"
        className="rounded-md border bg-card p-3 space-y-1"
      >
        <div className="flex flex-row items-center gap-2">
          <div className="text-sm font-medium">Policy</div>
          {servedBy}
        </div>
        <p className="text-sm text-muted-foreground">
          None yet. The questions reached the model as the caller wrote them;
          the optimizer writes a policy from the skill's first requests.
        </p>
      </section>
    );
  }
  return (
    <section aria-label="Policy">
      <GenericViewer
        path={`${logId}-policy`}
        language="text"
        defaultValue={policy.text}
        readOnly
      >
        <div className="flex flex-row items-center gap-2">
          <div className="text-sm font-normal">Policy</div>
          {servedBy}
        </div>
      </GenericViewer>
    </section>
  );
}

export function SystemOneAPIViewer({
  logId,
  saRequestBody,
  saResponseBody,
  policy,
}: {
  logId: string;
  /**
   * The request. Given the caller's own, with a `policy` beside it, each
   * question reads as the caller wrote it rather than with the policy
   * repeated ahead of every one.
   */
  saRequestBody: SystemOneRequestBody;
  /** Null while the model has not answered. */
  saResponseBody: SystemOneResponseBody | null;
  /** The policy the questions were asked under; no panel when absent. */
  policy?: DecisionPolicy;
}): React.ReactElement {
  const { state } = saRequestBody;
  const questions = saRequestBody.questions ?? {};
  const answers = saResponseBody?.answers ?? {};
  // Every question asked, then any answer to a question this log no longer
  // has, so nothing the model said goes undrawn.
  const ids = [
    ...Object.keys(questions),
    ...Object.keys(answers).filter((id) => !(id in questions)),
  ];

  return (
    <div className="flex flex-col gap-3">
      {policy && <Policy logId={logId} policy={policy} />}
      <GenericViewer
        path={`${logId}-state`}
        language={typeof state === 'string' ? 'text' : 'json'}
        defaultValue={
          typeof state === 'string' ? state : JSON.stringify(state, null, 2)
        }
        readOnly
      >
        <div className="text-sm font-normal text-right">State</div>
      </GenericViewer>
      {saRequestBody.assets && Object.keys(saRequestBody.assets).length > 0 && (
        <Images assets={saRequestBody.assets} />
      )}
      {ids.map((id) => (
        <Decision
          key={id}
          id={id}
          question={questions[id]}
          answer={answers[id]}
        />
      ))}
    </div>
  );
}
