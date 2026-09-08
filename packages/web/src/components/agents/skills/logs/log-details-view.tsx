'use client';

import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { type AIProvider, PrettyAIProvider } from '@shared/types/constants';
import type { Log } from '@shared/types/data/log';
import { EvaluationMethodName } from '@shared/types/evaluations';
import { produceSuperAgentsRequestData } from '@shared/utils/sa-request-data';
import { extractSystemPrompt } from '@shared/utils/system-prompt';
import { CompletionViewer } from '@web/components/agents/skills/logs/components/completion-viewer';
import { EmbeddingFingerprint } from '@web/components/agents/skills/logs/components/embedding-fingerprint';
import { GenericViewer } from '@web/components/agents/skills/logs/components/generic-viewer';
import { HookResults } from '@web/components/agents/skills/logs/components/hook-results';
import { LogStrip } from '@web/components/agents/skills/logs/components/log-strip';
import { MessagesView } from '@web/components/agents/skills/logs/components/messages-view';
import { RequestTrace } from '@web/components/agents/skills/logs/components/request-trace';
import { SessionMap } from '@web/components/agents/skills/logs/components/session-map';
import { LogFeedback } from '@web/components/agents/skills/logs/log-feedback';
import { LogNavigation } from '@web/components/agents/skills/logs/log-navigation';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import { Card, CardContent, CardHeader } from '@web/components/ui/card';
import { PageHeader } from '@web/components/ui/page-header';
import { Separator } from '@web/components/ui/separator';
import { Skeleton } from '@web/components/ui/skeleton';
import { useLogSession } from '@web/hooks/use-log-session';
import { usePinnedToBottom } from '@web/hooks/use-pinned-to-bottom';
import { useReviewsOf } from '@web/hooks/use-reviews';
import { useSmartBack } from '@web/hooks/use-smart-back';
import { useAgents } from '@web/providers/agents';
import { useLogs } from '@web/providers/logs';
import { useNavigation } from '@web/providers/navigation';
import { useSkillOptimizationClusters } from '@web/providers/skill-optimization-clusters';
import { useSkillOptimizationEvaluationRuns } from '@web/providers/skill-optimization-evaluation-runs';
import { useSkills } from '@web/providers/skills';
import {
  createAgentAvatar,
  createArmAvatar,
  createClusterAvatar,
  createSkillAvatar,
} from '@web/utils/avatars';
import { describeHookLog, summariseHooks } from '@web/utils/hook-outcome';
import { outcomeOf } from '@web/utils/log-outcome';
import { traceOf } from '@web/utils/log-trace';
import { reviewOf } from '@web/utils/reviews';
import {
  describeSkillRouting,
  readSkillRouting,
} from '@web/utils/skill-routing';
import {
  describeSystemPromptOrigin,
  readServedConfiguration,
} from '@web/utils/system-prompt-origin';
import { formatDuration, formatLogTimestamp } from '@web/utils/time';
import { cn } from '@web/utils/ui/utils';
import {
  AlertTriangle,
  ArrowLeftIcon,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

// Pretty names for evaluation methods
const EvaluationMethodNames: Record<EvaluationMethodName, string> = {
  [EvaluationMethodName.TASK_COMPLETION]: 'Task Completion',
  [EvaluationMethodName.ARGUMENT_CORRECTNESS]: 'Argument Correctness',
  [EvaluationMethodName.ROLE_ADHERENCE]: 'Role Adherence',
  [EvaluationMethodName.TURN_RELEVANCY]: 'Turn Relevancy',
  [EvaluationMethodName.TOOL_CORRECTNESS]: 'Tool Correctness',
  [EvaluationMethodName.KNOWLEDGE_RETENTION]: 'Knowledge Retention',
  [EvaluationMethodName.CONVERSATION_COMPLETENESS]: 'Conversation Completeness',
  [EvaluationMethodName.LATENCY]: 'Latency',
};

/**
 * A named thing on the log's header line, wearing the face the rest of the
 * dashboard gives it. The avatars are how an agent, a skill, a partition and
 * a configuration are recognised everywhere else, so the line that says which
 * ones served this request shows the same ones.
 */
function HeaderEntity({
  avatar,
  name,
  title,
  onClick,
}: {
  avatar: string;
  name: string;
  title?: string;
  onClick?: () => void;
}): ReactElement {
  const body = (
    <span className="flex items-center gap-1.5">
      <img src={avatar} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm" />
      <span className="font-medium">{name}</span>
    </span>
  );
  if (!onClick) {
    return (
      <span title={title} className="flex items-center">
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </button>
  );
}

/** What a value on the header line is, where the value cannot say itself. */
function HeaderLabel({ children }: { children: ReactNode }): ReactElement {
  return <span className="text-muted-foreground">{children}</span>;
}

/** A badge sized to the header's items, whatever its variant */
const HEADER_BADGE = 'h-5 px-2 py-0 text-xs';

/** The score an answer has to reach to read as a good one. */
const GOOD_SCORE = 0.7;

const HeaderDot = (): ReactElement => (
  <span aria-hidden="true" className="text-muted-foreground/60">
    ·
  </span>
);

/** The lamp beside the page's title: the request's outcome, as a colour. */
const OUTCOME_LAMP: Record<string, string> = {
  failed: 'bg-red-500',
  unreviewed: 'bg-amber-500',
  served: 'bg-green-500',
  running: 'bg-blue-500 animate-pulse',
};

/** The status code beside the request's other facts, in its outcome's colour. */
const OUTCOME_TEXT: Record<string, string> = {
  failed: 'text-red-500',
  unreviewed: 'text-amber-500',
  served: 'text-foreground',
  running: 'text-muted-foreground',
};

/** The verdict word in a shut strip takes the colour of what it decided. */
const SUMMARY_TONE: Record<string, string> = {
  denied: 'text-red-500',
  failed: 'text-amber-500',
  replaced: 'text-foreground',
  rewrote: 'text-foreground',
  allowed: 'text-green-600 dark:text-green-500',
  skipped: 'text-muted-foreground',
};

export function LogDetailsView(): ReactElement {
  const { selectedAgent } = useAgents();
  const { skills, setQueryParams: setSkillQueryParams } = useSkills();
  const { selectedLog, newerLog, olderLog, isLoading, setAgentId, setSkillId } =
    useLogs();
  const { replaceToLogDetail, navigateToLogDetail, navigateToSkillDashboard } =
    useNavigation();
  const session = useLogSession(selectedLog);
  // The reviews a reviewer hook's verdicts came from, under their agents
  const reviews = useReviewsOf(selectedLog);
  const { clusters, setSkillId: setClustersSkillId } =
    useSkillOptimizationClusters();
  const {
    evaluationRuns,
    setSkillId: setEvalSkillId,
    setLogId: setEvalLogId,
  } = useSkillOptimizationEvaluationRuns();
  const smartBack = useSmartBack();
  const [expandedEvaluations, setExpandedEvaluations] = useState<Set<string>>(
    new Set(),
  );
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  );

  // A log lives under its agent; its skill is a fact about the log, not
  // part of its address. The agent's skills are loaded to name it.
  useEffect(() => {
    if (selectedAgent) {
      setAgentId(selectedAgent.id);
      setSkillQueryParams({ agent_id: selectedAgent.id, limit: 100 });
    }
  }, [selectedAgent, setAgentId, setSkillQueryParams]);

  // Name the log's skill for the logs, clusters and evaluation runs
  // providers. Whether the logs scope is the skill or the whole agent is
  // left as the list the log was opened from set it, so the arrows follow
  // that list; agent-wide, the skill is not part of the scope anyway.
  const logSkillId = selectedLog?.skill_id;
  useEffect(() => {
    if (logSkillId) {
      setSkillId(logSkillId);
      setClustersSkillId(logSkillId);
      setEvalSkillId(logSkillId);
    }
  }, [logSkillId, setSkillId, setClustersSkillId, setEvalSkillId]);

  // A log opens on the agent's answer rather than on the top of a system
  // prompt that is several screens long.
  const conversation = usePinnedToBottom(selectedLog?.id);

  // Set log ID for evaluation runs provider
  useEffect(() => {
    if (selectedLog) {
      setEvalLogId(selectedLog.id);
    } else {
      setEvalLogId(null);
    }
  }, [selectedLog, setEvalLogId]);

  // Get cluster name
  const clusterName = useMemo(() => {
    if (!selectedLog?.cluster_id) return null;
    const cluster = clusters.find(
      (c: { id: string; name: string }) => c.id === selectedLog.cluster_id,
    );
    return cluster?.name ?? null;
  }, [selectedLog?.cluster_id, clusters]);

  // How the gateway picked the skill, when the caller named only the agent
  const skillRouting = useMemo(() => {
    const decision = readSkillRouting(selectedLog?.metadata);
    return decision ? describeSkillRouting(decision) : null;
  }, [selectedLog?.metadata]);

  // Extract temperature from request body
  const temperature = useMemo(() => {
    if (!selectedLog) return null;
    // Still running, or failed before a provider answered: there is no
    // exchange to render, and the view says so instead.
    if (!selectedLog.ai_provider_request_log) return null;
    const requestBody = selectedLog.ai_provider_request_log?.request_body;
    if (
      requestBody &&
      typeof requestBody === 'object' &&
      'temperature' in requestBody
    ) {
      return requestBody.temperature as number;
    }
    return null;
  }, [selectedLog]);

  // Extract thinking effort from request body
  const thinkingEffort = useMemo(() => {
    if (!selectedLog) return null;
    // Still running, or failed before a provider answered: there is no
    // exchange to render, and the view says so instead.
    if (!selectedLog.ai_provider_request_log) return null;
    const requestBody = selectedLog.ai_provider_request_log?.request_body;
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
  }, [selectedLog]);

  // Derived, not set in an effect, so a log switch never paints a frame of
  // the previous log's messages under the new log's header.
  const saRequestData = useMemo((): SuperAgentsRequestData | null => {
    if (!selectedLog) return null;
    // Still running, or failed before a provider answered: there is no
    // exchange to render, and the view says so instead.
    if (!selectedLog.ai_provider_request_log) return null;
    // A log recorded against a route or body shape this build no longer
    // knows how to parse should cost us this one view, not the whole
    // dashboard -- the error boundary above wraps every provider.
    try {
      return produceSuperAgentsRequestData(
        selectedLog.ai_provider_request_log.method,
        selectedLog.ai_provider_request_log.request_url,
        {},
        selectedLog.ai_provider_request_log.request_body,
        selectedLog.ai_provider_request_log.response_body,
      );
    } catch (error) {
      console.error('Failed to parse the log request data:', error);
      return null;
    }
  }, [selectedLog]);

  // What the model wrote when the client did not receive it. A hook keeps
  // the response it withheld or replaced on its own log, since the provider
  // log records what the client was given; drawn with the conversation, as
  // the answer it was.
  const judgedResponses = useMemo(() => {
    const provider = selectedLog?.ai_provider_request_log;
    if (!selectedLog || !provider) return [];
    return selectedLog.hook_logs.flatMap((hookLog) => {
      if (!hookLog.response_body) return [];
      try {
        return [
          {
            hookLog,
            outcome: describeHookLog(hookLog),
            saRequestData: produceSuperAgentsRequestData(
              provider.method,
              provider.request_url,
              {},
              provider.request_body,
              hookLog.response_body,
            ),
          },
        ];
      } catch (error) {
        console.error('Failed to parse the response a hook judged:', error);
        return [];
      }
    });
  }, [selectedLog]);

  // The request drawn to scale. Its stages come off marks the row already
  // carries, so no log had to be written differently to be read this way.
  const trace = useMemo(
    () => (selectedLog ? traceOf(selectedLog) : null),
    [selectedLog],
  );

  // The prompt the client sent. Only worth a panel of its own when it differs
  // from what reached the provider; otherwise it is the system message below.
  const originalSystemPrompt = useMemo(() => {
    const original = selectedLog?.original_system_prompt;
    if (!original || !saRequestData) return null;
    return original === extractSystemPrompt(saRequestData) ? null : original;
  }, [selectedLog?.original_system_prompt, saRequestData]);

  // The configuration that served the request, named on the header line
  // beside its partition.
  const servedConfiguration = useMemo(
    () => (selectedLog ? readServedConfiguration(selectedLog.metadata) : null),
    [selectedLog],
  );

  // Where the prompt that reached the provider came from: the configuration
  // the optimizer pulled, or the client, when the skill substituted nothing.
  const systemPromptOrigin = useMemo(() => {
    if (!selectedLog) return null;
    return describeSystemPromptOrigin({
      partition: clusterName,
      configuration: readServedConfiguration(selectedLog.metadata),
      clientPrompt: selectedLog.original_system_prompt,
      sentPrompt: saRequestData ? extractSystemPrompt(saRequestData) : null,
    });
  }, [selectedLog, clusterName, saRequestData]);

  // Use the weighted average score from the database view (logs_with_eval_scores)
  // This ensures consistency with the list view and handles orphaned evaluation runs correctly
  const averageScore = useMemo(() => {
    return selectedLog?.avg_eval_score ?? null;
  }, [selectedLog?.avg_eval_score]);

  // Get all evaluation details from evaluation runs using display_info
  const evaluationDetails = useMemo(() => {
    const allDetails: Array<{
      method: EvaluationMethodName;
      score: number;
      sections: Array<{ label: string; content: string }>;
      judgeModelName: string | null;
      judgeModelProvider: string | null;
    }> = [];

    evaluationRuns.forEach((run) => {
      run.results.forEach((result) => {
        allDetails.push({
          method: result.method,
          score: result.score,
          sections: result.display_info,
          judgeModelName: result.judge_model_name ?? null,
          judgeModelProvider: result.judge_model_provider ?? null,
        });
      });
    });
    return allDetails;
  }, [evaluationRuns]);

  const skillNameOf = (log: Log): string | null =>
    skills.find((skill) => skill.id === log.skill_id)?.name ?? null;
  const logSkillName = selectedLog ? skillNameOf(selectedLog) : null;

  const openLog = (log: Log): void => {
    if (selectedAgent) replaceToLogDetail(selectedAgent.name, log.id);
  };

  // What a request in the session was: its span, or what varied across the
  // session -- the skill it was routed to, the model that answered it
  const sessionSpansSkills =
    new Set(session.logs.map((log) => log.skill_id)).size > 1;
  const sessionSpansModels =
    new Set(session.logs.map((log) => log.model)).size > 1;
  const sessionLabelOf = (log: Log): string | null => {
    if (log.span_name) return log.span_name;
    const parts = [
      sessionSpansSkills ? skillNameOf(log) : null,
      sessionSpansModels ? log.model : null,
    ].filter((part): part is string => !!part);
    return parts.length ? parts.join(' · ') : null;
  };

  const handleBack = () => {
    if (selectedAgent) {
      smartBack(`/agents/${encodeURIComponent(selectedAgent.name)}/logs`);
    } else {
      smartBack('/agents');
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!selectedLog) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-4 mb-6">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeftIcon className="h-4 w-4 mr-2" />
            Back
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center p-12">
            <AlertTriangle className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Log not found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              The log you're looking for doesn't exist or has been deleted.
            </p>
            <Button onClick={handleBack}>
              <ArrowLeftIcon className="mr-2 h-4 w-4" />
              Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // How the request ended is the page's title: on a withheld request it is
  // the first thing worth knowing, and it used to be a badge among eleven
  // others. Which hook withheld it is the Hooks strip's summary, and why is
  // inside it, with every other verdict rather than in a panel of its own.
  const outcome = outcomeOf(selectedLog);
  const hookSummary = summariseHooks(selectedLog.hook_logs);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <PageHeader
        title={
          <span className="flex items-center gap-2" title={outcome.title}>
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 rounded-full', OUTCOME_LAMP[outcome.tone])}
            />
            {outcome.label}
          </span>
        }
        showBackButton
        onBack={handleBack}
        actions={
          <>
            {/* When it happened sits opposite the outcome, not beside it. */}
            <span className="text-sm text-muted-foreground tabular-nums">
              {[
                formatLogTimestamp(selectedLog.start_time),
                selectedLog.duration !== null
                  ? formatDuration(selectedLog.duration)
                  : null,
              ]
                .filter((part): part is string => part !== null)
                .join(' \u00b7 ')}
            </span>
            <Separator orientation="vertical" className="h-6" />
            <LogNavigation
              newerLog={newerLog}
              olderLog={olderLog}
              onNavigate={openLog}
            />
            <Separator orientation="vertical" className="h-6" />
            <LogFeedback logId={selectedLog.id} />
          </>
        }
      />
      <div className="flex-1 overflow-hidden p-6">
        {/* Log Detail Card */}
        <Card className="flex flex-col h-full overflow-hidden">
          <CardHeader className="flex flex-row justify-between items-center px-4 py-2 bg-card-header border-b">
            {/* What the request was, as one line: every fact is a child of
                the same flex, so one gap sets the spacing throughout. */}
            <div className="flex flex-row flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
              <HeaderLabel>Status:</HeaderLabel>
              <span
                title={outcome.title ?? outcome.label}
                className={cn(
                  'font-mono font-medium',
                  OUTCOME_TEXT[outcome.tone],
                )}
              >
                {selectedLog.status ?? '\u2014'}
              </span>
              {selectedAgent && (
                <>
                  <HeaderDot />
                  <HeaderEntity
                    avatar={createAgentAvatar(selectedAgent.name)}
                    name={selectedAgent.name}
                  />
                  {logSkillName && (
                    <>
                      <HeaderLabel>/</HeaderLabel>
                      <HeaderEntity
                        avatar={createSkillAvatar(logSkillName)}
                        name={logSkillName}
                        title={`Open the ${logSkillName} skill`}
                        onClick={() =>
                          navigateToSkillDashboard(
                            selectedAgent.name,
                            logSkillName,
                          )
                        }
                      />
                    </>
                  )}
                </>
              )}
              <HeaderDot />
              <span className="font-mono">
                {selectedLog.ai_provider
                  ? (PrettyAIProvider[selectedLog.ai_provider] ??
                    selectedLog.ai_provider)
                  : '\u2014'}
                /{selectedLog.model ?? '\u2014'}
              </span>
              {clusterName && logSkillName && (
                <>
                  <HeaderDot />
                  <HeaderLabel>partition</HeaderLabel>
                  <HeaderEntity
                    avatar={createClusterAvatar(logSkillName, clusterName)}
                    name={clusterName}
                  />
                </>
              )}
              {servedConfiguration && clusterName && logSkillName && (
                <>
                  <HeaderDot />
                  <HeaderLabel>config</HeaderLabel>
                  <HeaderEntity
                    avatar={createArmAvatar(
                      logSkillName,
                      clusterName,
                      servedConfiguration.name,
                    )}
                    name={servedConfiguration.name}
                  />
                </>
              )}
              {temperature !== null && (
                <>
                  <HeaderDot />
                  <HeaderLabel>temp</HeaderLabel>
                  <span className="font-mono">{temperature.toFixed(2)}</span>
                </>
              )}
              {thinkingEffort && (
                <>
                  <HeaderDot />
                  <HeaderLabel>thinking</HeaderLabel>
                  <span className="font-mono">{thinkingEffort}</span>
                </>
              )}
              {selectedLog.span_name && (
                <>
                  <HeaderDot />
                  <HeaderLabel>span</HeaderLabel>
                  <span className="font-mono">{selectedLog.span_name}</span>
                </>
              )}
            </div>
          </CardHeader>
          {trace !== null && selectedLog.duration !== null && (
            <RequestTrace stages={trace} total={selectedLog.duration} />
          )}
          {selectedLog.hook_logs.length > 0 && (
            <LogStrip
              name="Hooks"
              defaultOpen={hookSummary.verdict === 'denied'}
              note={
                <span className={SUMMARY_TONE[hookSummary.verdict]}>
                  {hookSummary.text}
                </span>
              }
            >
              <HookResults
                hookLogs={selectedLog.hook_logs}
                reviewOf={(hookLog) => reviewOf(hookLog, reviews)}
                onOpenReview={(review, reviewer) =>
                  navigateToLogDetail(reviewer, review.id)
                }
              />
            </LogStrip>
          )}
          {skillRouting && (
            <LogStrip
              name="Routing"
              note={
                <>
                  {skillRouting.label}
                  {skillRouting.detail && ` \u00b7 ${skillRouting.detail}`}
                </>
              }
            >
              <div className="flex flex-row flex-wrap items-start gap-6">
                <p className="max-w-prose flex-1 text-sm leading-relaxed text-muted-foreground">
                  {skillRouting.title}
                </p>
                {selectedLog.embedding && (
                  <EmbeddingFingerprint values={selectedLog.embedding} />
                )}
              </div>
            </LogStrip>
          )}
          {(evaluationDetails.length > 0 || averageScore !== null) && (
            <LogStrip
              name="Evaluations"
              note={
                <>
                  {evaluationDetails.length > 0
                    ? `${evaluationDetails.length} ran`
                    : 'None ran'}
                  {averageScore !== null && (
                    <>
                      {' \u00b7 '}
                      <span
                        className={cn(
                          'font-mono font-medium',
                          averageScore >= GOOD_SCORE
                            ? 'text-green-600 dark:text-green-500'
                            : 'text-amber-500',
                        )}
                      >
                        {(averageScore * 100).toFixed(0)}%
                      </span>
                      {' weighted'}
                    </>
                  )}
                </>
              }
            >
              <div className="space-y-2">
                {evaluationDetails.map((evaluation, evalIdx) => {
                  const evalKey = `${evaluation.method}-${evalIdx}`;
                  const isEvalExpanded = expandedEvaluations.has(evalKey);
                  const prettyName =
                    EvaluationMethodNames[evaluation.method] ||
                    evaluation.method;

                  return (
                    <div
                      key={evalKey}
                      className="bg-background rounded-md border overflow-hidden"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedEvaluations((prev) => {
                            const next = new Set(prev);
                            if (next.has(evalKey)) {
                              next.delete(evalKey);
                            } else {
                              next.add(evalKey);
                            }
                            return next;
                          });
                        }}
                        className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-left"
                      >
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {prettyName}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {(evaluation.score * 100).toFixed(1)}%
                          </Badge>
                          {evaluation.judgeModelName && (
                            <Badge
                              variant="secondary"
                              className="text-xs text-muted-foreground"
                            >
                              {evaluation.judgeModelProvider
                                ? `${PrettyAIProvider[evaluation.judgeModelProvider as AIProvider] || evaluation.judgeModelProvider}/${evaluation.judgeModelName}`
                                : evaluation.judgeModelName}
                            </Badge>
                          )}
                        </div>
                        {isEvalExpanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>
                      {isEvalExpanded && (
                        <div className="border-t">
                          {evaluation.sections.map((section, sectionIdx) => {
                            const sectionKey = `${evalKey}-${sectionIdx}`;
                            const isSectionExpanded =
                              expandedSections.has(sectionKey);

                            return (
                              <div
                                key={sectionKey}
                                className="border-b last:border-b-0"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedSections((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(sectionKey)) {
                                        next.delete(sectionKey);
                                      } else {
                                        next.add(sectionKey);
                                      }
                                      return next;
                                    });
                                  }}
                                  className="w-full flex items-center justify-between px-3 py-2 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                                >
                                  <span className="text-xs font-medium">
                                    {section.label}
                                  </span>
                                  {isSectionExpanded ? (
                                    <ChevronDown className="h-3 w-3 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                  )}
                                </button>
                                {isSectionExpanded && (
                                  <div className="p-3 text-sm whitespace-pre-wrap leading-relaxed bg-background">
                                    {section.content}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </LogStrip>
          )}
          <CardContent className="flex flex-row p-0 h-full relative overflow-hidden">
            {selectedLog.trace_id && session.logs.length > 1 && (
              <SessionMap
                logs={session.logs}
                currentId={selectedLog.id}
                hasEarlier={session.hasEarlier}
                hasLater={session.hasLater}
                traceId={selectedLog.trace_id}
                appId={selectedLog.app_id}
                labelOf={sessionLabelOf}
                onSelect={openLog}
              />
            )}
            <div
              ref={conversation.ref}
              className="inset-0 flex flex-1 w-full min-w-0 p-4 overflow-hidden overflow-y-auto"
            >
              <div
                ref={conversation.contentRef}
                className="flex flex-col w-full min-w-0 gap-4 h-fit"
              >
                {selectedLog && originalSystemPrompt && (
                  <GenericViewer
                    path={`${selectedLog.id}-original-system-prompt`}
                    language={'text'}
                    defaultValue={originalSystemPrompt}
                    readOnly={true}
                    defaultCollapsed={true}
                    onSave={async (): Promise<void> => {
                      //pass
                    }}
                    onSelect={(): void => {
                      //pass
                    }}
                  >
                    <div className="flex flex-row items-center gap-2">
                      <div className="text-sm font-normal">
                        Original system prompt
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs text-muted-foreground"
                      >
                        as sent by the client
                      </Badge>
                    </div>
                  </GenericViewer>
                )}
                {selectedLog && saRequestData && (
                  <MessagesView
                    logId={selectedLog.id}
                    saRequestData={saRequestData}
                    systemPromptBadge={
                      systemPromptOrigin && (
                        <Badge
                          variant="outline"
                          className="text-xs text-muted-foreground"
                          title={systemPromptOrigin.title}
                        >
                          {systemPromptOrigin.label}
                        </Badge>
                      )
                    }
                  />
                )}
                {selectedLog &&
                  judgedResponses.map(
                    ({ hookLog, outcome, saRequestData: judged }) => (
                      <div
                        key={`${hookLog.hook.id}-${hookLog.start_time}`}
                        className="flex flex-col gap-2"
                        data-testid="judged-response"
                      >
                        <div className="flex flex-row flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
                          <span>
                            {outcome.verdict === 'replaced'
                              ? 'What the model wrote, before the hook replaced it'
                              : 'What the model wrote, withheld from the client'}
                          </span>
                          <Badge
                            variant={
                              outcome.verdict === 'replaced'
                                ? 'secondary'
                                : 'destructive'
                            }
                            className={HEADER_BADGE}
                          >
                            {outcome.label} by {hookLog.hook.id}
                          </Badge>
                        </div>
                        <CompletionViewer
                          logId={`${selectedLog.id}-${hookLog.hook.id}`}
                          saRequestData={judged}
                        />
                      </div>
                    ),
                  )}
                {selectedLog &&
                  saRequestData &&
                  selectedLog.ai_provider_request_log?.response_body &&
                  ('choices' in
                    selectedLog.ai_provider_request_log.response_body ||
                    'output' in
                      selectedLog.ai_provider_request_log.response_body) && (
                    <CompletionViewer
                      logId={selectedLog.id}
                      saRequestData={saRequestData}
                    />
                  )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
