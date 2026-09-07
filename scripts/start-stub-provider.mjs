#!/usr/bin/env node
/**
 * A stub OpenAI-compatible provider for the end-to-end suite.
 *
 * The gateway is the product's hot path -- every proxied request goes through
 * request transformation, streaming, retries and caching -- but none of it can
 * be exercised without something to proxy *to*. Pointing at a real provider
 * would need API keys, cost money, and give non-deterministic answers, so the
 * suite points at this instead: the `ollama` provider is OpenAI-compatible,
 * needs no API key, and honours `custom_host`, which is what makes it usable
 * as the shape to imitate.
 *
 * Beyond answering, it records what the gateway actually sent. That is the
 * only way to assert on the request the gateway builds -- the system prompt it
 * injected, the parameters it resolved, the model it chose -- since none of
 * that is visible in the response.
 *
 * Everything is keyed by model name. The suite runs in parallel and this is one
 * shared process, so tests coin a unique model the way they coin agent names,
 * and never see each other's recorded requests or injected failures.
 *
 *   POST /v1/chat/completions   the provider endpoint the gateway calls
 *   POST /api/embeddings        ditto, for embeddings
 *   GET  /__control/requests?model=NAME   what the gateway sent for that model
 *   POST /__control/fail        {model, times, status} -- inject failures
 *   POST /__control/fence       {model} -- wrap structured output in a fence
 *   POST /__control/reply       {model, content} -- answer with this text instead;
 *                               an array is answered in order, the last one kept
 *   POST /__control/reset       {model} -- forget everything for that model
 *
 * Configured with E2E_STUB_PORT (default 3103).
 */
import { createServer } from 'node:http';

const port = Number(process.env.E2E_STUB_PORT ?? 3103);

/** model name -> request bodies the gateway sent, oldest first. */
const received = new Map();
/**
 * model name -> the texts replies carry in place of the echo or schema, in
 * order; the last one is kept for every reply after it.
 */
const canned = new Map();

/** The scripted reply for this request; the queue advances until one is left. */
const nextCanned = (model) => {
  const queue = canned.get(model);
  return queue.length > 1 ? queue.shift() : queue[0];
};
/** model name -> queued failures, shifted one per request. */
const failures = new Map();
/**
 * Models whose structured output comes back inside a markdown fence, the way a
 * provider answers when it only saw `response_format` as a prompt instruction
 * rather than enforcing it.
 */
const fenced = new Set();

const recordFor = (model) => {
  if (!received.has(model)) {
    received.set(model, []);
  }
  return received.get(model);
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

const sendJson = (response, status, payload) => {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  response.end(body);
};

/**
 * The assistant reply echoes the last user message, so a test can tell that
 * *its* request produced *this* response rather than matching a fixed string
 * that any request would have produced.
 */
const replyText = (body) => {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m?.role === 'user');
  const content =
    typeof lastUser?.content === 'string' ? lastUser.content : 'nothing';
  return `echo: ${content}`;
};

/**
 * Build the smallest value satisfying a JSON Schema.
 *
 * The internal skills -- prompt seeding, reflection, evaluation generation,
 * judging -- all ask for structured output and parse the reply against the
 * schema they sent. Echoing text back would fail that parse, so the stub reads
 * the schema off the request and answers in its shape instead. That keeps the
 * stub generic: it needs no knowledge of any particular internal skill.
 *
 * Strings carry the property name so a test can tell a stubbed value apart from
 * anything the system might have produced itself.
 */
const instanceOf = (schema, root, name = 'value') => {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  if (typeof schema.$ref === 'string') {
    const key = schema.$ref.replace('#/$defs/', '');
    return instanceOf(root?.$defs?.[key], root, name);
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  // A union: the first branch is as good as any for a stub.
  for (const branches of [schema.anyOf, schema.oneOf, schema.allOf]) {
    if (Array.isArray(branches) && branches.length > 0) {
      return instanceOf(branches[0], root, name);
    }
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  switch (type) {
    case 'object': {
      const properties = schema.properties ?? {};
      const required = Array.isArray(schema.required)
        ? schema.required
        : Object.keys(properties);
      const built = {};
      for (const key of required) {
        built[key] = instanceOf(properties[key], root, key);
      }
      return built;
    }
    case 'array': {
      const count = Math.max(schema.minItems ?? 1, 1);
      return Array.from({ length: count }, () =>
        instanceOf(schema.items, root, name),
      );
    }
    case 'number':
    case 'integer':
      // Mid-range where one is given, so a score lands inside its bounds.
      return typeof schema.minimum === 'number' &&
        typeof schema.maximum === 'number'
        ? (schema.minimum + schema.maximum) / 2
        : 1;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return `stub: ${name}`;
  }
};

/** The schema an OpenAI-style structured-output request is asking for. */
const requestedSchema = (body) =>
  body?.response_format?.type === 'json_schema'
    ? (body.response_format.json_schema?.schema ?? null)
    : null;

const completionPayload = (body, text) => ({
  id: 'chatcmpl-stub',
  object: 'chat.completion',
  // Fixed rather than Date.now(), so a response is byte-identical across
  // requests and a cache hit cannot be confused with a fresh call.
  created: 1_780_000_000,
  model: body?.model ?? 'stub-model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: text },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
});

const streamCompletion = (response, body, text) => {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const base = {
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: 1_780_000_000,
    model: body?.model ?? 'stub-model',
  };

  // Split into several chunks so the test sees real incremental assembly
  // rather than one chunk that happens to contain the whole answer.
  const write = (chunk) => response.write(`data: ${JSON.stringify(chunk)}\n\n`);

  write({
    ...base,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });
  for (const word of text.split(' ')) {
    write({
      ...base,
      choices: [
        { index: 0, delta: { content: `${word} ` }, finish_reason: null },
      ],
    });
  }
  write({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
  response.write('data: [DONE]\n\n');
  response.end();
};

/**
 * A text can pin its own embedding by carrying `vec(1,0,0,0,0,0,0,0)`, which is
 * how the routing specs make two skills distinguishable. Anything else embeds
 * to a constant, which is all the optimizer specs need.
 */
function stubEmbedding(text) {
  const pinned = /vec\(([-\d., ]+)\)/.exec(String(text ?? ''));
  if (pinned) {
    const values = pinned[1].split(',').map(Number);
    if (values.length === 8 && values.every(Number.isFinite)) {
      return values;
    }
  }
  return Array.from({ length: 8 }, () => 0.1);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);

  if (url.pathname === '/__control/requests') {
    const model = url.searchParams.get('model') ?? '';
    sendJson(response, 200, { requests: received.get(model) ?? [] });
    return;
  }

  if (url.pathname === '/__control/fail') {
    const {
      model,
      times = 1,
      status = 503,
    } = JSON.parse((await readBody(request)) || '{}');
    failures.set(
      model,
      Array.from({ length: times }, () => status),
    );
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/__control/fence') {
    const { model } = JSON.parse((await readBody(request)) || '{}');
    fenced.add(model);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/__control/reply') {
    const { model, content } = JSON.parse((await readBody(request)) || '{}');
    canned.set(
      model,
      (Array.isArray(content) ? content : [content]).map(String),
    );
    sendJson(response, 200, { ok: true });
    return;
  }

  if (url.pathname === '/__control/reset') {
    const { model } = JSON.parse((await readBody(request)) || '{}');
    received.delete(model);
    failures.delete(model);
    fenced.delete(model);
    canned.delete(model);
    sendJson(response, 200, { ok: true });
    return;
  }

  const raw = await readBody(request);
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    sendJson(response, 400, { error: { message: 'stub: invalid JSON' } });
    return;
  }

  const model = body?.model ?? '';
  recordFor(model).push(body);

  const queued = failures.get(model);
  if (queued?.length) {
    const status = queued.shift();
    // Shaped like a provider error so the retry handler treats it as one.
    sendJson(response, status, {
      error: { message: `stub: injected failure (${status})`, type: 'stub' },
    });
    return;
  }

  if (url.pathname === '/api/embeddings') {
    sendJson(response, 200, { embedding: stubEmbedding(body?.prompt) });
    return;
  }

  if (url.pathname === '/v1/chat/completions') {
    const schema = requestedSchema(body);
    const structured = schema ? JSON.stringify(instanceOf(schema, schema)) : '';
    // A canned reply wins over both: a test that scripted the model's answer
    // wants exactly that answer, whatever shape the request asked for.
    const text = canned.has(model)
      ? nextCanned(model)
      : schema
        ? fenced.has(model)
          ? `Here is the JSON you asked for:\n\n\`\`\`json\n${structured}\n\`\`\``
          : structured
        : replyText(body);
    if (body?.stream) {
      streamCompletion(response, body, text);
    } else {
      sendJson(response, 200, completionPayload(body, text));
    }
    return;
  }

  sendJson(response, 404, {
    error: { message: `stub: no handler for ${url.pathname}` },
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Stub AI provider listening on http://127.0.0.1:${port}`);
});
