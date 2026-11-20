import { FunctionName } from '@shared/types/api/request';

/**
 * The requests a skill is optimized on: the ones a skill's system prompt
 * shapes. A chat or Responses request is served under it as a system prompt,
 * and a System One request under it as a policy ahead of each question, so
 * all of them are embedded to find their cluster, served by an arm, judged,
 * and learned from. An embedding or an image request has no system prompt to
 * evolve.
 */
const OPTIMIZED_FUNCTIONS: ReadonlySet<FunctionName> = new Set([
  FunctionName.CHAT_COMPLETE,
  FunctionName.STREAM_CHAT_COMPLETE,
  FunctionName.CREATE_MODEL_RESPONSE,
  FunctionName.SYSTEM_ONE,
]);

export function isOptimizedFunction(
  functionName: FunctionName | null | undefined,
): boolean {
  return functionName ? OPTIMIZED_FUNCTIONS.has(functionName) : false;
}
