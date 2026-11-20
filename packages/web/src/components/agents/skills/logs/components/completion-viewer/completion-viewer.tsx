'use client';

import type { SuperAgentsRequestData } from '@shared/types/api/request/body';
import { FunctionName } from '@shared/types/api/request/function-name';
import { ChatCompletionsAPIViewer } from '@web/components/agents/skills/logs/components/completion-viewer/chat-completions-api';
import { CompletionsAPIViewer } from '@web/components/agents/skills/logs/components/completion-viewer/completions-api';
import { ImageGenerationViewer } from '@web/components/agents/skills/logs/components/completion-viewer/images-api';
import { ResponsesAPIViewer } from './responses-api';
import { SystemOneAPIViewer } from './system-one-api';

export function CompletionViewer({
  logId,
  saRequestData,
}: {
  logId: string;
  saRequestData: SuperAgentsRequestData;
}): React.ReactElement {
  if (!saRequestData.responseBody) {
    return <div>No response body found.</div>;
  }

  if (
    saRequestData.functionName === FunctionName.CHAT_COMPLETE ||
    saRequestData.functionName === FunctionName.STREAM_CHAT_COMPLETE
  ) {
    return (
      <ChatCompletionsAPIViewer
        logId={logId}
        saRequestBody={saRequestData.requestBody}
        saResponseBody={saRequestData.responseBody}
      />
    );
  } else if (
    saRequestData.functionName === FunctionName.COMPLETE ||
    saRequestData.functionName === FunctionName.STREAM_COMPLETE
  ) {
    return (
      <CompletionsAPIViewer
        logId={logId}
        saResponseBody={saRequestData.responseBody}
      />
    );
  } else if (
    saRequestData.functionName === FunctionName.CREATE_MODEL_RESPONSE
  ) {
    return (
      <ResponsesAPIViewer
        logId={logId}
        saRequestBody={saRequestData.requestBody}
        saResponseBody={saRequestData.responseBody}
      />
    );
  } else if (saRequestData.functionName === FunctionName.SYSTEM_ONE) {
    return (
      <SystemOneAPIViewer
        logId={logId}
        saRequestBody={saRequestData.requestBody}
        saResponseBody={saRequestData.responseBody}
      />
    );
  } else if (saRequestData.functionName === FunctionName.GENERATE_IMAGE) {
    return <ImageGenerationViewer response={saRequestData.responseBody} />;
  } else if (saRequestData.functionName === FunctionName.MODERATE) {
    return <div>Moderation</div>;
  } else if (saRequestData.functionName === FunctionName.CREATE_SPEECH) {
    return <div>Speech</div>;
  } else if (saRequestData.functionName === FunctionName.PROXY) {
    return <div>Proxy</div>;
  } else {
    return <div>Unstructured output</div>;
  }
}
