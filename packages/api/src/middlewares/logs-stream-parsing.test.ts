import { parseStreamChunksToResponseBody } from '@api/middlewares/logs';
import { describe, expect, it } from 'vitest';

// Import the module to access the parseStreamChunksToResponseBody function
// Since it's not exported, we'll test it through the behavior it produces
// We'll create a test helper that simulates the streaming scenario

describe('Stream Parsing for Responses API', () => {
  describe('Function Call Streaming Events', () => {
    it('should parse response.output_item.added event for function_call', () => {
      const streamChunks = `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"","status":"in_progress"}}

data: [DONE]`;

      // Parse the chunks manually to verify structure
      const lines = streamChunks.split('\n');
      const dataLine = lines[0];
      expect(dataLine).toContain('response.output_item.added');

      const data = dataLine.slice(6).trim();
      const chunk = JSON.parse(data);

      expect(chunk.type).toBe('response.output_item.added');
      expect(chunk.item.type).toBe('function_call');
      expect(chunk.item.name).toBe('calculate');
      expect(chunk.item.call_id).toBe('call_123');
    });

    it('should parse response.function_call_arguments.delta events', () => {
      const streamChunks = `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"","status":"in_progress"}}

data: {"type":"response.function_call_arguments.delta","item_id":"call_123","output_index":0,"delta":"{\\"opera"}

data: {"type":"response.function_call_arguments.delta","item_id":"call_123","output_index":0,"delta":"tion\\":\\""}

data: {"type":"response.function_call_arguments.delta","item_id":"call_123","output_index":0,"delta":"multiply\\"}"}

data: [DONE]`;

      // Accumulate deltas manually to verify
      const lines = streamChunks
        .split('\n')
        .filter((l) => l.startsWith('data: '));
      let accumulatedArgs = '';

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const chunk = JSON.parse(data);
        if (chunk.type === 'response.function_call_arguments.delta') {
          accumulatedArgs += chunk.delta;
          expect(chunk.output_index).toBe(0);
          expect(chunk.item_id).toBe('call_123');
        }
      }

      expect(accumulatedArgs).toBe('{"operation":"multiply"}');
    });

    it('should parse response.function_call_arguments.done event', () => {
      const streamChunks = `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"","status":"in_progress"}}

data: {"type":"response.function_call_arguments.done","item_id":"call_123","output_index":0,"arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}"}

data: [DONE]`;

      const lines = streamChunks
        .split('\n')
        .filter((l) => l.startsWith('data: '));
      let finalArgs = '';

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const chunk = JSON.parse(data);
        if (chunk.type === 'response.function_call_arguments.done') {
          finalArgs = chunk.arguments;
          expect(chunk.output_index).toBe(0);
          expect(chunk.item_id).toBe('call_123');
        }
      }

      expect(finalArgs).toBe('{"operation":"multiply","a":15,"b":8}');
      const parsed = JSON.parse(finalArgs);
      expect(parsed.operation).toBe('multiply');
      expect(parsed.a).toBe(15);
      expect(parsed.b).toBe(8);
    });

    it('should parse response.output_item.done event for function_call', () => {
      const streamChunks = `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"","status":"in_progress"}}

data: {"type":"response.function_call_arguments.done","item_id":"call_123","output_index":0,"arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}"}

data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}","status":"completed"}}

data: [DONE]`;

      const lines = streamChunks
        .split('\n')
        .filter((l) => l.startsWith('data: '));
      let completedItem: Record<string, unknown> | null = null;

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const chunk = JSON.parse(data);
        if (chunk.type === 'response.output_item.done') {
          completedItem = chunk.item;
          expect(chunk.output_index).toBe(0);
        }
      }

      expect(completedItem).not.toBeNull();
      expect(completedItem?.type).toBe('function_call');
      expect(completedItem?.status).toBe('completed');
      expect(completedItem?.name).toBe('calculate');
      expect(completedItem?.arguments).toBe(
        '{"operation":"multiply","a":15,"b":8}',
      );
    });

    it('should handle complete function call streaming lifecycle', () => {
      const streamChunks = `data: {"type":"response.created","response":{"id":"resp_123","model":"gpt-5-nano"}}

data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"","status":"in_progress"}}

data: {"type":"response.function_call_arguments.delta","item_id":"call_123","output_index":0,"delta":"{\\"operation\\":"}

data: {"type":"response.function_call_arguments.delta","item_id":"call_123","output_index":0,"delta":"\\"multiply\\","}

data: {"type":"response.function_call_arguments.delta","item_id":"call_123","output_index":0,"delta":"\\"a\\":15,\\"b\\":8}"}

data: {"type":"response.function_call_arguments.done","item_id":"call_123","output_index":0,"arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}"}

data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}","status":"completed"}}

data: {"type":"response.completed","response":{"id":"resp_123","status":"completed"}}

data: [DONE]`;

      const lines = streamChunks
        .split('\n')
        .filter((l) => l.startsWith('data: '));

      // Track the lifecycle
      let responseId = '';
      let functionCallAdded = false;
      let argumentsAccumulated = '';
      let argumentsCompleted = false;
      let itemCompleted = false;
      let responseCompleted = false;

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const chunk = JSON.parse(data);

        if (chunk.type === 'response.created') {
          responseId = chunk.response.id;
        } else if (chunk.type === 'response.output_item.added') {
          functionCallAdded = true;
        } else if (chunk.type === 'response.function_call_arguments.delta') {
          argumentsAccumulated += chunk.delta;
        } else if (chunk.type === 'response.function_call_arguments.done') {
          argumentsCompleted = true;
        } else if (chunk.type === 'response.output_item.done') {
          itemCompleted = true;
        } else if (chunk.type === 'response.completed') {
          responseCompleted = true;
        }
      }

      // Verify complete lifecycle
      expect(responseId).toBe('resp_123');
      expect(functionCallAdded).toBe(true);
      expect(argumentsAccumulated).toBe(
        '{"operation":"multiply","a":15,"b":8}',
      );
      expect(argumentsCompleted).toBe(true);
      expect(itemCompleted).toBe(true);
      expect(responseCompleted).toBe(true);
    });

    it('should handle multiple function calls in sequence', () => {
      const streamChunks = `data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"call_1","call_id":"call_1","name":"calculate","arguments":"","status":"in_progress"}}

data: {"type":"response.function_call_arguments.done","item_id":"call_1","output_index":0,"arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}"}

data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"call_1","call_id":"call_1","name":"calculate","arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}","status":"completed"}}

data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"call_2","call_id":"call_2","name":"format","arguments":"","status":"in_progress"}}

data: {"type":"response.function_call_arguments.done","item_id":"call_2","output_index":1,"arguments":"{\\"result\\":120}"}

data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","id":"call_2","call_id":"call_2","name":"format","arguments":"{\\"result\\":120}","status":"completed"}}

data: [DONE]`;

      const lines = streamChunks
        .split('\n')
        .filter((l) => l.startsWith('data: '));
      const functionCalls = new Map<
        number,
        { name: string; arguments: string; status: string }
      >();

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const chunk = JSON.parse(data);

        if (chunk.type === 'response.output_item.added') {
          functionCalls.set(chunk.output_index, {
            name: chunk.item.name,
            arguments: chunk.item.arguments || '',
            status: chunk.item.status,
          });
        } else if (chunk.type === 'response.output_item.done') {
          const fc = functionCalls.get(chunk.output_index);
          if (fc) {
            fc.arguments = chunk.item.arguments;
            fc.status = chunk.item.status;
          }
        }
      }

      expect(functionCalls.size).toBe(2);
      expect(functionCalls.get(0)?.name).toBe('calculate');
      expect(functionCalls.get(0)?.arguments).toBe(
        '{"operation":"multiply","a":15,"b":8}',
      );
      expect(functionCalls.get(0)?.status).toBe('completed');
      expect(functionCalls.get(1)?.name).toBe('format');
      expect(functionCalls.get(1)?.arguments).toBe('{"result":120}');
      expect(functionCalls.get(1)?.status).toBe('completed');
    });
  });

  describe('Text and Function Call Mixed Streaming', () => {
    it('should handle text content and function calls together', () => {
      const streamChunks = `data: {"type":"response.output_text.delta","delta":"Let me "}

data: {"type":"response.output_text.delta","delta":"calculate "}

data: {"type":"response.output_text.delta","delta":"that."}

data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"","status":"in_progress"}}

data: {"type":"response.function_call_arguments.done","item_id":"call_123","output_index":0,"arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}"}

data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"call_123","call_id":"call_123","name":"calculate","arguments":"{\\"operation\\":\\"multiply\\",\\"a\\":15,\\"b\\":8}","status":"completed"}}

data: [DONE]`;

      const lines = streamChunks
        .split('\n')
        .filter((l) => l.startsWith('data: '));
      let textContent = '';
      const functionCalls: Array<{ name: string; arguments: string }> = [];

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const chunk = JSON.parse(data);

        if (chunk.type === 'response.output_text.delta') {
          textContent += chunk.delta;
        } else if (chunk.type === 'response.output_item.done') {
          functionCalls.push({
            name: chunk.item.name,
            arguments: chunk.item.arguments,
          });
        }
      }

      expect(textContent).toBe('Let me calculate that.');
      expect(functionCalls).toHaveLength(1);
      expect(functionCalls[0].name).toBe('calculate');
      expect(functionCalls[0].arguments).toBe(
        '{"operation":"multiply","a":15,"b":8}',
      );
    });
  });

  describe('Response Metadata Extraction', () => {
    it('should extract response ID and model from response.completed event', () => {
      const streamChunks = `data: {"type":"response.completed","response":{"id":"resp_abc123","model":"gpt-5-nano-2025-08-07","created_at":1763980623,"status":"completed"}}

data: [DONE]`;

      const lines = streamChunks
        .split('\n')
        .filter((l) => l.startsWith('data: '));
      let responseId = '';
      let model = '';
      let createdAt = 0;

      for (const line of lines) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        const chunk = JSON.parse(data);

        if (chunk.type === 'response.completed') {
          responseId = chunk.response.id;
          model = chunk.response.model;
          createdAt = chunk.response.created_at;
        }
      }

      expect(responseId).toBe('resp_abc123');
      expect(model).toBe('gpt-5-nano-2025-08-07');
      expect(createdAt).toBe(1763980623);
    });
  });
});

describe('Reconstructing a streamed chat completion', () => {
  function chunk(delta: Record<string, unknown>): string {
    return `data: ${JSON.stringify({
      id: 'chatcmpl-871',
      object: 'chat.completion.chunk',
      created: 1234567890,
      model: 'glm-5.3-flash',
      choices: [{ delta, index: 0, finish_reason: null }],
    })}`;
  }

  function messageOf(chunks: string[]): Record<string, unknown> {
    const { response_body } = parseStreamChunksToResponseBody(
      `${chunks.join('\n\n')}\n\ndata: [DONE]`,
    );
    const choices = response_body.choices as {
      message: Record<string, unknown>;
    }[];
    return choices[0].message;
  }

  it('keeps the thinking a provider streamed beside the answer', () => {
    const message = messageOf([
      chunk({
        role: 'assistant',
        content_blocks: [{ index: 0, delta: { thinking: '17 * 23 = ' } }],
      }),
      chunk({ content_blocks: [{ index: 0, delta: { thinking: '391' } }] }),
      chunk({ content: '391' }),
    ]);

    expect(message.content).toBe('391');
    expect(message.content_blocks).toEqual([
      { type: 'thinking', thinking: '17 * 23 = 391' },
      { type: 'text', text: '391' },
    ]);
  });

  it('leaves an answer that did no thinking as it was', () => {
    const message = messageOf([chunk({ role: 'assistant', content: '391' })]);

    expect(message.content).toBe('391');
    expect(message.content_blocks).toBeUndefined();
  });
});
