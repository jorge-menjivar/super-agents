/**
 * The material a decision-model reviewer is shown, kept within what one can
 * read.
 *
 * A reviewer is shown the reviewed request and its response, and a request
 * from an agent harness carries its whole session: every file it read, every
 * command's output, its tools' schemas, its system prompt. That grows with
 * every turn, past any model's input -- Jev refuses one with
 * `max_tokens_exceeded`, which fails the review -- while what the review is
 * about is the response, and the turns just before it.
 *
 * So the material is bounded, in this order of what matters:
 * - the response, whole but for any one string past `MAX_RESPONSE_STRING`;
 * - the request's system prompt, the start of it, which says what the agent
 *   is;
 * - the last thing the user asked, which says what the response is for;
 * - the newest messages, as many as fit, each long one clipped.
 *
 * What is left out is said to be: a clipped string ends by counting what it
 * lost, and a run of omitted messages is one `{omitted_messages: n}` entry
 * where they were, so the model knows there was more. Tools are named, not
 * described -- what the agent did with one is in the messages. A request that
 * fits is sent as it is.
 */

/** Characters of JSON the whole state may take: under the tightest input
 * any decision model is published at, with room for the question. */
export const REVIEW_MATERIAL_BUDGET = 60_000;

const MAX_RESPONSE_STRING = 12_000;
const MAX_SYSTEM_STRING = 4_000;
const MAX_LAST_USER_STRING = 8_000;
const MAX_MESSAGE_STRING = 4_000;

const size = (value: unknown): number => JSON.stringify(value ?? null).length;

function clip(text: string, max: number): string {
  return text.length <= max
    ? text
    : `${text.slice(0, max)}… [${text.length - max} more characters]`;
}

/** The value with every string in it no longer than `max`. */
function clipStrings(value: unknown, max: number): unknown {
  if (typeof value === 'string') {
    return clip(value, max);
  }
  if (Array.isArray(value)) {
    return value.map((item) => clipStrings(item, max));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, clipStrings(item, max)]),
    );
  }
  return value;
}

interface Message {
  role?: unknown;
  [key: string]: unknown;
}

const isConversation = (
  request: unknown,
): request is { messages: Message[]; tools?: unknown[] } =>
  !!request &&
  typeof request === 'object' &&
  Array.isArray((request as { messages?: unknown }).messages);

/** A tool, by its name: what a reviewer needs of its definition. */
function toolName(tool: unknown): unknown {
  if (!tool || typeof tool !== 'object') {
    return tool;
  }
  const { name, function: fn } = tool as {
    name?: unknown;
    function?: { name?: unknown };
  };
  return fn?.name ?? name ?? tool;
}

const isInstruction = (message: Message) =>
  message.role === 'system' || message.role === 'developer';

/** The conversation, within `budget` characters. */
function boundConversation(
  request: { messages: Message[]; tools?: unknown[] },
  budget: number,
): unknown {
  const tools = request.tools?.map(toolName);
  const instructions = request.messages
    .filter(isInstruction)
    .map((message) => clipStrings(message, MAX_SYSTEM_STRING));
  const turns = request.messages.filter((message) => !isInstruction(message));
  const lastAsked = turns.findLastIndex((message) => message.role === 'user');

  const clipped = turns.map((message, index) =>
    clipStrings(
      message,
      index === lastAsked ? MAX_LAST_USER_STRING : MAX_MESSAGE_STRING,
    ),
  );

  // The newest turns, back as far as the budget goes. The last thing the
  // user asked is kept wherever it falls, and the newest turn always is.
  let used = size({ messages: instructions, tools }) + size(clipped[lastAsked]);
  const kept = new Set<number>(lastAsked >= 0 ? [lastAsked] : []);
  for (let index = clipped.length - 1; index >= 0; index--) {
    if (kept.has(index)) {
      continue;
    }
    const cost = size(clipped[index]) + 1;
    if (used + cost > budget && index !== clipped.length - 1) {
      break;
    }
    kept.add(index);
    used += cost;
  }

  const messages: unknown[] = [...instructions];
  let omitted = 0;
  clipped.forEach((message, index) => {
    if (kept.has(index)) {
      if (omitted > 0) {
        messages.push({ omitted_messages: omitted });
        omitted = 0;
      }
      messages.push(message);
    } else {
      omitted += 1;
    }
  });
  if (omitted > 0) {
    messages.push({ omitted_messages: omitted });
  }
  return { messages, ...(tools ? { tools } : {}) };
}

/** The request, within `budget` characters. */
function boundRequest(request: unknown, budget: number): unknown {
  if (size(request) <= budget) {
    return request;
  }
  if (isConversation(request)) {
    return boundConversation(request, budget);
  }
  // Not a conversation to walk: its newest end, as text.
  const text = JSON.stringify(request);
  return {
    excerpt: `[${text.length - budget} earlier characters omitted] ${text.slice(-budget)}`,
  };
}

/**
 * The review material, within `budget` characters of JSON. The response is
 * kept first, and the request given what is left -- never less than a
 * quarter of the budget, so a long response cannot leave the review without
 * the question it answers.
 */
export function withinReviewBudget<
  T extends { request: unknown; response?: unknown },
>(material: T, budget = REVIEW_MATERIAL_BUDGET): T {
  if (size(material) <= budget) {
    return material;
  }
  const hasResponse = 'response' in material;
  const response = hasResponse
    ? clipStrings(material.response, MAX_RESPONSE_STRING)
    : undefined;
  const left = Math.max(budget - size(response), Math.floor(budget / 4));
  return {
    ...material,
    request: boundRequest(material.request, left),
    ...(hasResponse ? { response } : {}),
  };
}
