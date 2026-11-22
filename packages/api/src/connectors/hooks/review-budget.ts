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
 * So the material is bounded, and the response comes first:
 * - the response, whole whenever it fits in three quarters of the budget;
 * - then, in what is left, the start of the request's system prompt, which
 *   says what the agent is; the last thing the user asked, which says what
 *   the response is for; and the newest turns, as many as fit, each long one
 *   clipped.
 *
 * What is left out is said to be: a clipped string ends by counting what it
 * lost, and a run of omitted turns is one `{omitted_messages: n}` entry where
 * they were, so the model knows there was more. Tools are named, not
 * described -- what the agent did with one is in the messages. Material that
 * fits is sent as it is.
 *
 * The bound holds whatever the material's shape: every string, every list
 * and every message is cut to size, and whatever still does not fit is cut to
 * its newest end. A response that had to be cut is reported as such, because
 * a reviewer shown part of a response cannot clear the rest of it.
 */

/** Characters of JSON the whole state may take: under the tightest input
 * any decision model is published at, with room for the question. */
export const REVIEW_MATERIAL_BUDGET = 60_000;

const MAX_SYSTEM_STRING = 4_000;
const MAX_LAST_USER_STRING = 8_000;
const MAX_MESSAGE_STRING = 4_000;
const MAX_TOOL_NAMES = 64;

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

/** A value cut to its newest end, as text, when nothing finer will do. */
function excerpt(value: unknown, max: number): { excerpt: string } {
  const text = JSON.stringify(value ?? null);
  return {
    excerpt:
      text.length <= max
        ? text
        : `[${text.length - max} earlier characters omitted] ${text.slice(-max)}`,
  };
}

/** What a message says, as text: its parts in order, an image by reference. */
function textOf(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object') {
          const { text, image_url: image } = part as {
            text?: unknown;
            image_url?: { url?: unknown };
          };
          if (typeof text === 'string') {
            return text;
          }
          if (typeof image?.url === 'string') {
            return image.url;
          }
        }
        return JSON.stringify(part);
      })
      .join('\n');
  }
  return content === undefined || content === null
    ? ''
    : JSON.stringify(content);
}

interface Message {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

/**
 * The message within about `max` characters. Its strings are clipped first;
 * a message that is still too long -- a thousand short parts, a hundred tool
 * calls -- becomes its role and its text, clipped.
 */
function clipMessage(message: Message, max: number): unknown {
  const clipped = clipStrings(message, max);
  if (size(clipped) <= max + 1_000) {
    return clipped;
  }
  const { role, content, ...rest } = message;
  const said = [textOf(content), ...Object.values(rest).map(textOf)]
    .filter(Boolean)
    .join('\n');
  return { role, content: clip(said, max) };
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
    return clipStrings(tool, 200);
  }
  const { name, function: fn } = tool as {
    name?: unknown;
    function?: { name?: unknown };
  };
  return clipStrings(fn?.name ?? name ?? 'unnamed', 200);
}

function toolNames(tools: unknown[]): unknown[] {
  const names = tools.slice(0, MAX_TOOL_NAMES).map(toolName);
  return tools.length > MAX_TOOL_NAMES
    ? [...names, `… and ${tools.length - MAX_TOOL_NAMES} more`]
    : names;
}

const isInstruction = (message: Message) =>
  message.role === 'system' || message.role === 'developer';

/** The conversation, within `budget` characters. */
function boundConversation(
  request: { messages: Message[]; tools?: unknown[] },
  budget: number,
): unknown {
  const tools = Array.isArray(request.tools)
    ? toolNames(request.tools)
    : undefined;
  // However many there are, the instructions are the start of one text.
  const instructionText = request.messages
    .filter(isInstruction)
    .map((message) => textOf(message.content))
    .join('\n\n');
  const instructions = instructionText
    ? [{ role: 'system', content: clip(instructionText, MAX_SYSTEM_STRING) }]
    : [];
  const turns = request.messages.filter((message) => !isInstruction(message));
  const lastAsked = turns.findLastIndex((message) => message.role === 'user');

  const clipped = turns.map((message, index) =>
    clipMessage(
      message,
      index === lastAsked ? MAX_LAST_USER_STRING : MAX_MESSAGE_STRING,
    ),
  );

  // The newest turns, back as far as the budget goes. The last thing the
  // user asked is kept wherever it falls, and the newest turn always is.
  let used =
    size({ messages: instructions, tools }) +
    (lastAsked >= 0 ? size(clipped[lastAsked]) : 0);
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
  const bounded = isConversation(request)
    ? boundConversation(request, budget)
    : request;
  // Not a conversation to walk, or one whose pinned turns alone are past the
  // budget: its newest end, as text.
  return size(bounded) <= budget ? bounded : excerpt(request, budget - 100);
}

/**
 * The response within `budget` characters, and whether all of it is there:
 * whole when it fits, its strings clipped shorter and shorter when it does
 * not, and its newest end as text when even that is not enough.
 */
function boundResponse(
  response: unknown,
  budget: number,
): { response: unknown; complete: boolean } {
  if (size(response) <= budget) {
    return { response, complete: true };
  }
  for (const max of [12_000, 4_000, 1_000]) {
    const clipped = clipStrings(response, max);
    if (size(clipped) <= budget) {
      return { response: clipped, complete: false };
    }
  }
  return { response: excerpt(response, budget - 100), complete: false };
}

export interface ReviewMaterial<T> {
  material: T;
  /**
   * Whether the response is there whole. A reviewer shown part of one can
   * withhold it, but cannot clear what it was not shown.
   */
  complete: boolean;
}

/**
 * The review material, within `budget` characters of JSON. The response is
 * kept first, whole when it fits in three quarters of the budget, and the
 * request given what is left -- never less than a quarter, so a long
 * response cannot leave the review without the question it answers.
 */
export function withinReviewBudget<
  T extends { request: unknown; response?: unknown },
>(material: T, budget = REVIEW_MATERIAL_BUDGET): ReviewMaterial<T> {
  if (size(material) <= budget) {
    return { material, complete: true };
  }
  if (!('response' in material)) {
    return {
      material: {
        ...material,
        request: boundRequest(material.request, budget - 100),
      },
      complete: true,
    };
  }
  const { response, complete } = boundResponse(
    material.response,
    budget - Math.floor(budget / 4),
  );
  return {
    material: {
      ...material,
      request: boundRequest(material.request, budget - size(response) - 100),
      response,
    },
    complete,
  };
}
