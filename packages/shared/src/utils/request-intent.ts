import { FunctionName } from '@shared/types/api/request';
import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { ChatCompletionMessageRole } from '@shared/types/api/routes/shared/messages';
import { systemOneStateText } from '@shared/utils/system-one';
import { extractSystemPrompt } from '@shared/utils/system-prompt';

/**
 * How much of a system prompt one embedding takes verbatim; `embedText`
 * bounds its input to 6000 characters. A prompt over this budget is worth
 * compacting with a model before embedding rather than cutting at the
 * boundary (see `@api/utils/super-agents/intent-compaction`), which is why
 * the budget is exported.
 */
export const SYSTEM_PROMPT_BUDGET = 4000;
const CONVERSATION_MESSAGES = 6;
const MESSAGE_BUDGET = 800;
const CONVERSATION_BUDGET = 4800;

/**
 * What a request is asking for, in parts with different lifetimes.
 *
 * `systemPrompt` and `tools` are who is calling: a tool sends the same ones
 * on every request. `conversation` is what is being asked right now: the
 * last few messages, which change turn by turn. Routing embeds identity and
 * conversation separately and weighs them, so a skill can follow a
 * conversation as it evolves without one tool's varied questions tearing an
 * agent's skills apart.
 */
export interface RequestIntent {
  /** The caller's system prompt, uncut; consumers budget or compact it. */
  systemPrompt: string | null;
  /** The names of the tools on offer, as a `Tools: ...` line. */
  tools: string | null;
  conversation: string | null;
}

/**
 * The identity half of the intent as one text: the system prompt -- the
 * given compacted form, or the raw prompt cut to its budget -- and the tool
 * names. Null for a request with neither.
 */
export function identityText(
  intent: RequestIntent,
  compactedPrompt?: string | null,
): string | null {
  const prompt =
    compactedPrompt ?? intent.systemPrompt?.slice(0, SYSTEM_PROMPT_BUDGET);
  return [prompt, intent.tools].filter(Boolean).join('\n\n') || null;
}

/** The intent as one text, for prompts that describe the request to a model. */
export function intentText(intent: RequestIntent): string {
  return [identityText(intent), intent.conversation]
    .filter(Boolean)
    .join('\n\n');
}

function toolName(tool: unknown): string | null {
  if (typeof tool !== 'object' || tool === null) {
    return null;
  }
  const record = tool as Record<string, unknown>;
  // Chat completions nest the name under `function`; the Responses API puts
  // it on the tool itself, and its built-in tools have only a type.
  const fn = record.function;
  if (typeof fn === 'object' && fn !== null) {
    const name = (fn as Record<string, unknown>).name;
    if (typeof name === 'string') {
      return name;
    }
  }
  if (typeof record.name === 'string') {
    return record.name;
  }
  if (typeof record.type === 'string') {
    return record.type;
  }
  return null;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'object' &&
        part !== null &&
        typeof (part as { text?: unknown }).text === 'string'
          ? ((part as { text: string }).text as string)
          : '',
      )
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

interface IntentMessage {
  role?: unknown;
  content?: unknown;
  tool_calls?: unknown;
}

/** One conversation message as a line of the intent, or null for no text. */
function renderMessage(message: IntentMessage): string | null {
  const { role, content } = message;
  if (typeof role !== 'string') {
    return null;
  }
  if (role === ChatCompletionMessageRole.TOOL) {
    const text = messageText(content).slice(0, MESSAGE_BUDGET);
    return text ? `Tool output: ${text}` : null;
  }

  const parts: string[] = [];
  if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
    const calls = message.tool_calls
      .map((call) => {
        const record = call as {
          type?: unknown;
          function?: { name?: unknown; arguments?: unknown };
        };
        const name =
          typeof record.function?.name === 'string'
            ? record.function.name
            : typeof record.type === 'string'
              ? record.type
              : 'tool';
        const args =
          typeof record.function?.arguments === 'string'
            ? record.function.arguments.slice(0, 120)
            : '';
        return `${name}(${args})`;
      })
      .join(', ');
    parts.push(`Assistant tool calls: ${calls}`);
  }
  const text = messageText(content).slice(0, MESSAGE_BUDGET);
  if (text) {
    const label = role.charAt(0).toUpperCase() + role.slice(1);
    parts.push(`${label}: ${text}`);
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

function conversationMessages(
  saRequestData: SuperAgentsRequestData,
): IntentMessage[] {
  switch (saRequestData.functionName) {
    case FunctionName.CHAT_COMPLETE:
    case FunctionName.STREAM_CHAT_COMPLETE:
      return saRequestData.requestBody.messages as IntentMessage[];
    case FunctionName.CREATE_MODEL_RESPONSE: {
      const { input } = saRequestData.requestBody;
      if (typeof input === 'string') {
        return input
          ? [{ role: ChatCompletionMessageRole.USER, content: input }]
          : [];
      }
      return input as IntentMessage[];
    }
    // What a decision model is asked about is the conversation it is part
    // of: the material changes request by request, the questions do not.
    case FunctionName.SYSTEM_ONE: {
      const content = systemOneStateText(saRequestData.requestBody.state);
      return content ? [{ role: ChatCompletionMessageRole.USER, content }] : [];
    }
    default:
      return [];
  }
}

/**
 * What a request is asking for, used to route it to a skill.
 *
 * The system prompt is the strongest sign of who is calling -- a tool sends
 * the same one on every request -- joined by the names of the tools on
 * offer. The conversation part is the last few non-system messages, so the
 * intent follows the conversation as it evolves rather than freezing at its
 * first message. Returns `null` when there is nothing to go on, which
 * includes every endpoint that has no messages.
 */
export function describeRequestIntent(
  saRequestData: SuperAgentsRequestData,
): RequestIntent | null {
  const systemPrompt = extractSystemPrompt(saRequestData) || null;

  let tools: string | null = null;
  const rawTools = (saRequestData.requestBody as { tools?: unknown }).tools;
  if (Array.isArray(rawTools)) {
    const names = rawTools.map(toolName).filter((name) => name !== null);
    if (names.length > 0) {
      tools = `Tools: ${names.join(', ')}`;
    }
  }

  const conversation =
    conversationMessages(saRequestData)
      .filter(
        (message) =>
          message.role !== ChatCompletionMessageRole.SYSTEM &&
          message.role !== ChatCompletionMessageRole.DEVELOPER,
      )
      .slice(-CONVERSATION_MESSAGES)
      .map(renderMessage)
      .filter((line): line is string => line !== null)
      .join('\n\n')
      .slice(0, CONVERSATION_BUDGET) || null;

  if (!systemPrompt && !tools && !conversation) {
    return null;
  }
  return { systemPrompt, tools, conversation };
}
