'use client';

import type {
  ChatCompletionRequestBody,
  ChatCompletionResponseBody,
} from '@shared/types/api/routes/chat-completions-api';
import { PrettyChatCompletionMessageRole } from '@shared/types/api/routes/shared/messages';
import type { RawSchema } from '@shared/types/api/routes/shared/tools';
import { FunctionCallCard } from '@web/components/agents/skills/logs/components/function-call-card';
import { GenericViewer } from '@web/components/agents/skills/logs/components/generic-viewer';
import { isArray } from 'lodash';
import { useMemo } from 'react';

export function ChatCompletionsAPIViewer({
  logId,
  saRequestBody,
  saResponseBody,
}: {
  logId: string;
  saRequestBody: ChatCompletionRequestBody;
  saResponseBody: ChatCompletionResponseBody;
}): React.ReactElement {
  const language =
    'response_format' in saRequestBody
      ? saRequestBody.response_format?.type === 'json_object' ||
        saRequestBody.response_format?.type === 'json_schema'
        ? 'json'
        : 'text'
      : 'text';

  const rawSchema =
    'response_format' in saRequestBody
      ? saRequestBody.response_format?.type === 'json_schema'
        ? saRequestBody.response_format.json_schema.schema
        : undefined
      : undefined;

  const message = saResponseBody.choices[0].message;

  // What the model thought before it answered. Providers report it in shapes
  // of their own -- Ollama and OpenRouter each have a `reasoning` field -- and
  // their transforms re-express it as a thinking block, which is the one shape
  // this reads.
  const thinking = useMemo(
    () =>
      (message.content_blocks ?? [])
        .flatMap((block) =>
          block.type === 'thinking' && block.thinking ? [block.thinking] : [],
        )
        .join('\n'),
    [message.content_blocks],
  );

  const hasToolCalls =
    'tool_calls' in message &&
    message.tool_calls &&
    message.tool_calls.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Closed: the answer is what the reader came for, and a long chain of
          thought above it would push the answer off the screen. */}
      {thinking && (
        <GenericViewer
          path={`${logId}-reasoning`}
          language="text"
          defaultValue={thinking}
          readOnly
          defaultCollapsed
          variant="response"
        >
          <div className="text-sm font-normal text-right">
            {PrettyChatCompletionMessageRole.reasoning}
          </div>
        </GenericViewer>
      )}
      {message.content && (
        <GenericViewer
          path={`${logId}-completion`}
          language={language}
          defaultValue={
            isArray(message.content)
              ? message.content.map((c) => c.text).join('')
              : message.content
          }
          readOnly={false}
          onSave={async (): Promise<void> => {
            //pass
          }}
          onSelect={(): void => {
            //pass
          }}
          rawSchema={rawSchema as RawSchema}
          variant="response"
        >
          <div className="text-sm font-normal text-right">
            {PrettyChatCompletionMessageRole[message.role]}
          </div>
        </GenericViewer>
      )}
      {hasToolCalls &&
        message.tool_calls?.map((tc) => (
          <FunctionCallCard
            key={tc.id}
            name={tc.function.name}
            callId={tc.id}
            args={tc.function.arguments}
            variant="response"
          />
        ))}
    </div>
  );
}
