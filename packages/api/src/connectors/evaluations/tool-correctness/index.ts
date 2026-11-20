import type {
  EvaluationMethodConnector,
  UserDataStorageConnector,
} from '@api/types/connector';
import type { AppContext } from '@api/types/hono';
import { info, warn } from '@shared/console-logging';
import type {
  Log,
  SkillOptimizationEvaluation,
  SkillOptimizationEvaluationResult,
} from '@shared/types/data';
import {
  type EvaluationMethodDetails,
  EvaluationMethodName,
} from '@shared/types/evaluations';
import {
  type ToolCall,
  ToolCorrectnessEvaluationAIParameters,
  ToolCorrectnessEvaluationParameters,
} from './types';

// Pure functions for tool evaluation logic
const extractToolsCalled = (log: Log): ToolCall[] => {
  if (!log || typeof log !== 'object') {
    warn('Invalid log provided to extractToolsCalled', {
      logId: (log as Log)?.id,
    });
    return [];
  }

  const requestBody = (log.ai_provider_request_log as Record<string, unknown>)
    ?.request_body as Record<string, unknown>;
  const toolsCalled =
    requestBody?.tools_called || log.metadata?.tools_called || [];

  if (Array.isArray(toolsCalled)) {
    return toolsCalled.map((tool) => ({
      name: tool.name || tool.tool_name || '',
      input_parameters: tool.input_parameters || tool.args || {},
      output: tool.output || tool.result,
    }));
  }

  return [];
};

const extractExpectedTools = (log: Log): ToolCall[] => {
  if (!log || typeof log !== 'object') {
    warn('Invalid log provided to extractExpectedTools', {
      logId: (log as Log)?.id,
    });
    return [];
  }

  const expectedTools = log.metadata?.expected_tools || [];

  if (Array.isArray(expectedTools)) {
    return expectedTools.map((tool) => ({
      name: tool.name || tool.tool_name || '',
      input_parameters: tool.input_parameters || tool.args || {},
      output: tool.output || tool.result,
    }));
  }

  return [];
};

// More efficient deep equality comparison that avoids JSON.stringify
const deepEqual = (a: unknown, b: unknown): boolean => {
  // Handle primitive types and null/undefined
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;

  // Handle different types
  if (typeof a !== typeof b) return false;

  // Handle functions - only equal if same reference
  if (typeof a === 'function') return a === b;

  // Handle symbols - only equal if same reference
  if (typeof a === 'symbol') return a === b;

  // Handle dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Handle regular expressions
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.toString() === b.toString();
  }

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  // Handle objects
  if (typeof a === 'object' && typeof b === 'object') {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);

    if (aKeys.length !== bKeys.length) return false;

    // Check regular properties
    for (const key of aKeys) {
      if (!bKeys.includes(key)) return false;
      if (
        !deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      ) {
        return false;
      }
    }

    return true;
  }

  return false;
};

const parametersMatch = (
  calledParams: Record<string, unknown> | undefined,
  expectedParams: Record<string, unknown> | undefined,
): boolean => {
  if (!calledParams && !expectedParams) return true;
  if (!calledParams || !expectedParams) return false;

  // Use optimized deep equality instead of JSON.stringify
  try {
    return deepEqual(calledParams, expectedParams);
  } catch (error) {
    // Fallback to JSON comparison if deep equality fails
    warn('Failed to compare parameters, falling back to JSON comparison', {
      error,
    });

    try {
      return JSON.stringify(calledParams) === JSON.stringify(expectedParams);
    } catch (jsonError) {
      warn('Failed to serialize parameters', { error: jsonError });

      // Final fallback to shallow comparison
      const calledKeys = Object.keys(calledParams);
      const expectedKeys = Object.keys(expectedParams);

      if (calledKeys.length !== expectedKeys.length) return false;

      for (const key of expectedKeys) {
        if (
          !calledKeys.includes(key) ||
          calledParams[key] !== expectedParams[key]
        ) {
          return false;
        }
      }

      return true;
    }
  }
};

const outputMatch = (
  calledOutput: unknown,
  expectedOutput: unknown,
): boolean => {
  try {
    return deepEqual(calledOutput, expectedOutput);
  } catch (error) {
    // Handle circular references or other comparison issues
    warn('Failed to compare outputs, using shallow comparison', {
      error,
    });
    // If we can't compare, perform a shallow comparison as fallback
    return calledOutput === expectedOutput;
  }
};

const toolsMatch = (
  called: ToolCall,
  expected: ToolCall,
  parameters: ToolCorrectnessEvaluationParameters,
): boolean => {
  // Check tool name
  if (called.name !== expected.name) {
    return false;
  }

  // Check input parameters if required
  if (parameters.evaluation_params.includes('INPUT_PARAMETERS')) {
    if (!parametersMatch(called.input_parameters, expected.input_parameters)) {
      return false;
    }
  }

  // Check output if required
  if (parameters.evaluation_params.includes('OUTPUT')) {
    if (!outputMatch(called.output, expected.output)) {
      return false;
    }
  }

  return true;
};

const isPerfectMatch = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): boolean => {
  if (tools_called.length !== expected_tools.length) {
    return false;
  }

  for (let i = 0; i < tools_called.length; i++) {
    if (!toolsMatch(tools_called[i], expected_tools[i], parameters)) {
      return false;
    }
  }

  return true;
};

// Helper function to create a unique signature for a tool based on evaluation parameters
const createToolSignature = (
  tool: ToolCall,
  parameters: ToolCorrectnessEvaluationParameters,
): string => {
  const parts = [tool.name];

  if (parameters.evaluation_params.includes('INPUT_PARAMETERS')) {
    try {
      // Use a more efficient serialization approach
      parts.push(JSON.stringify(tool.input_parameters || {}));
    } catch (_error) {
      // Fallback for circular references
      parts.push(String(tool.input_parameters));
    }
  }

  if (parameters.evaluation_params.includes('OUTPUT')) {
    try {
      parts.push(JSON.stringify(tool.output));
    } catch (_error) {
      // Fallback for circular references
      parts.push(String(tool.output));
    }
  }

  return parts.join('|');
};

// Optimized version with O(n) complexity instead of O(n²)
const countMatchedToolsOptimized = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): number => {
  // Create frequency map of called tools for O(1) lookup
  const calledToolsMap = new Map<string, number>();

  for (const tool of tools_called) {
    const signature = createToolSignature(tool, parameters);
    calledToolsMap.set(signature, (calledToolsMap.get(signature) || 0) + 1);
  }

  let matchedCount = 0;

  // Match expected tools against called tools map
  for (const expectedTool of expected_tools) {
    const signature = createToolSignature(expectedTool, parameters);
    const availableCount = calledToolsMap.get(signature) || 0;

    if (availableCount > 0) {
      matchedCount++;
      calledToolsMap.set(signature, availableCount - 1);
    }
  }

  return matchedCount;
};

// Fallback to original algorithm for cases where hash-based matching might not work
const countMatchedTools = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): number => {
  // For small datasets, use optimized version
  if (tools_called.length <= 100 && expected_tools.length <= 100) {
    try {
      return countMatchedToolsOptimized(
        tools_called,
        expected_tools,
        parameters,
      );
    } catch (error) {
      // Fallback to original algorithm if optimization fails
      warn('Falling back to original matching algorithm', { error });
    }
  }

  // Original O(n²) algorithm as fallback for large datasets or edge cases
  let matchedCount = 0;
  const usedCalledTools = new Set<number>();

  for (const expectedTool of expected_tools) {
    for (let i = 0; i < tools_called.length; i++) {
      if (
        !usedCalledTools.has(i) &&
        toolsMatch(tools_called[i], expectedTool, parameters)
      ) {
        matchedCount++;
        usedCalledTools.add(i);
        break;
      }
    }
  }

  return matchedCount;
};

const calculateStrictMode = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): number => {
  const perfect = isPerfectMatch(tools_called, expected_tools, parameters);
  return perfect ? 1 : 0;
};

const calculateExactMatch = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): number => {
  if (tools_called.length !== expected_tools.length) {
    return 0;
  }

  const matchedTools = countMatchedTools(
    tools_called,
    expected_tools,
    parameters,
  );
  return matchedTools / expected_tools.length;
};

const calculateWithOrdering = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): number => {
  const minLength = Math.min(tools_called.length, expected_tools.length);
  let matchedCount = 0;

  for (let i = 0; i < minLength; i++) {
    if (toolsMatch(tools_called[i], expected_tools[i], parameters)) {
      matchedCount++;
    }
  }

  return matchedCount / expected_tools.length;
};

const calculateBasicMatch = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): number => {
  if (expected_tools.length === 0) {
    return tools_called.length === 0 ? 1 : 0;
  }

  const matchedTools = countMatchedTools(
    tools_called,
    expected_tools,
    parameters,
  );
  return matchedTools / expected_tools.length;
};

const calculateToolCorrectness = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  parameters: ToolCorrectnessEvaluationParameters,
): number => {
  if (parameters.strict_mode) {
    return calculateStrictMode(tools_called, expected_tools, parameters);
  }

  if (parameters.should_exact_match) {
    return calculateExactMatch(tools_called, expected_tools, parameters);
  }

  if (parameters.should_consider_ordering) {
    return calculateWithOrdering(tools_called, expected_tools, parameters);
  }

  return calculateBasicMatch(tools_called, expected_tools, parameters);
};

const generateReason = (
  tools_called: ToolCall[],
  expected_tools: ToolCall[],
  score: number,
  _parameters: ToolCorrectnessEvaluationParameters,
): string => {
  const calledNames = tools_called.map((t) => t.name);
  const expectedNames = expected_tools.map((t) => t.name);

  if (score === 1) {
    return `Perfect match: All expected tools (${expectedNames.join(', ')}) were called correctly.`;
  }

  if (score === 0) {
    return `No match: Expected tools (${expectedNames.join(', ')}) but called (${calledNames.join(', ')}).`;
  }

  const matchedCount = Math.round(score * expected_tools.length);
  return `Partial match: ${matchedCount}/${expected_tools.length} expected tools were called correctly. Expected: ${expectedNames.join(', ')}, Called: ${calledNames.join(', ')}.`;
};

const evaluateLogInternal = (
  log: Log,
  parameters: ToolCorrectnessEvaluationParameters,
): {
  log_id: string;
  score: number;
  reason?: string;
  tools_called: ToolCall[];
  expected_tools: ToolCall[];
} => {
  // Enhanced validation for log structure
  if (!log || typeof log !== 'object') {
    throw new Error(`Invalid log: ${(log as Log)?.id || 'unknown'}`);
  }

  if (!log.id || typeof log.id !== 'string') {
    throw new Error('Log missing required id field');
  }

  // Validate that log has expected structure for tool extraction
  const requestBody = (log.ai_provider_request_log as Record<string, unknown>)
    ?.request_body as Record<string, unknown>;
  if (typeof requestBody !== 'object' && typeof log.metadata !== 'object') {
    throw new Error(
      `Log ${log.id} missing expected structure (request_body or metadata)`,
    );
  }

  // Extract tools_called and expected_tools from log with validation
  const tools_called = extractToolsCalled(log);
  const expected_tools = extractExpectedTools(log);

  // Validate array contents before processing
  if (!Array.isArray(tools_called)) {
    throw new Error(
      `Invalid tools_called format in log ${log.id}: expected array`,
    );
  }

  if (!Array.isArray(expected_tools)) {
    throw new Error(
      `Invalid expected_tools format in log ${log.id}: expected array`,
    );
  }

  // Validate tool structure
  for (let i = 0; i < tools_called.length; i++) {
    const tool = tools_called[i];
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') {
      throw new Error(
        `Invalid tool structure at index ${i} in tools_called for log ${log.id}`,
      );
    }
  }

  for (let i = 0; i < expected_tools.length; i++) {
    const tool = expected_tools[i];
    if (!tool || typeof tool !== 'object' || typeof tool.name !== 'string') {
      throw new Error(
        `Invalid tool structure at index ${i} in expected_tools for log ${log.id}`,
      );
    }
  }

  if (parameters.verbose_mode) {
    info(`Evaluating log ${log.id}`, {
      tools_called,
      expected_tools,
    });
  }

  // Calculate tool correctness score
  const score = calculateToolCorrectness(
    tools_called,
    expected_tools,
    parameters,
  );

  let reason: string | undefined;
  if (parameters.include_reason) {
    reason = generateReason(tools_called, expected_tools, score, parameters);
  }

  return {
    log_id: log.id,
    score,
    reason,
    tools_called,
    expected_tools,
  };
};

export function evaluateLog(
  _c: AppContext,
  evaluation: SkillOptimizationEvaluation,
  log: Log,
  _storageConnector: UserDataStorageConnector,
): Promise<SkillOptimizationEvaluationResult> {
  const params = ToolCorrectnessEvaluationParameters.parse(evaluation.params);

  const start_time = Date.now();

  // Evaluate using the internal evaluateLogInternal function
  const logResult = evaluateLogInternal(log, params);

  const execution_time = Date.now() - start_time;

  // Format display info
  const displayInfoSections = [];

  if (logResult.reason) {
    displayInfoSections.push({
      label: 'Reasoning',
      content: logResult.reason,
    });
  }

  if (logResult.tools_called.length > 0) {
    const toolsSummary = logResult.tools_called
      .map((tool) => {
        const params = tool.input_parameters
          ? JSON.stringify(tool.input_parameters, null, 2)
          : 'No parameters';
        return `${tool.name}:\nParameters: ${params}`;
      })
      .join('\n\n');

    displayInfoSections.push({
      label: 'Tools Called',
      content: toolsSummary,
    });
  }

  if (logResult.expected_tools.length > 0) {
    const expectedSummary = logResult.expected_tools
      .map((tool) => {
        const params = tool.input_parameters
          ? JSON.stringify(tool.input_parameters, null, 2)
          : 'No parameters';
        return `${tool.name}:\nParameters: ${params}`;
      })
      .join('\n\n');

    displayInfoSections.push({
      label: 'Expected Tools',
      content: expectedSummary,
    });
  }

  const evaluationResult: SkillOptimizationEvaluationResult = {
    evaluation_id: evaluation.id,
    method: EvaluationMethodName.TOOL_CORRECTNESS,
    score: logResult.score,
    extra_data: {
      tools_called: logResult.tools_called,
      expected_tools: logResult.expected_tools,
      reasoning: logResult.reason,
      execution_time,
      execution_time_ms: execution_time,
      evaluated_at: new Date().toISOString(),
    },
    display_info: displayInfoSections,
    judge_model_name: null,
    judge_model_provider: null,
  };

  return Promise.resolve(evaluationResult);
}

// Tool correctness connector constant instance
export const toolCorrectnessEvaluationConnector: EvaluationMethodConnector = {
  getDetails(): EvaluationMethodDetails {
    return {
      method: EvaluationMethodName.TOOL_CORRECTNESS,
      agent_types: ['text'],
      name: 'Tool Correctness Evaluation',
      description: 'Evaluates the correctness of tool calls made by agents',
    };
  },
  evaluateLog,
  getParameterSchema: ToolCorrectnessEvaluationParameters,
  getAIParameterSchema: ToolCorrectnessEvaluationAIParameters,
};
