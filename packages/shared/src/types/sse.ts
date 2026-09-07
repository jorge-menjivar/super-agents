import { z } from 'zod';

/**
 * SSE Event Types
 * Defines all possible real-time events that can be broadcast to clients
 */
export const SSEEventType = z.enum([
  // Agent events
  'agent:created',
  'agent:updated',
  'agent:deleted',

  // Skill events
  'skill:created',
  'skill:updated',
  'skill:deleted',

  // Model events
  'model:created',
  'model:updated',
  'model:deleted',

  // Evaluation events
  'evaluation:created',
  'evaluation:updated',
  'evaluation:deleted',

  // AI Provider events
  'ai-provider:created',
  'ai-provider:updated',
  'ai-provider:deleted',

  // Log events
  'log:created',
  /**
   * A gateway request that has arrived and is still running. The dashboard
   * shows it as a pending row whose duration ticks up, so a request in
   * progress is visible rather than appearing only once it has finished.
   * Sent as soon as the request reaches its agent, before a skill has been
   * chosen, and again once one has.
   */
  'log:request-started',
  /** That request has finished; the pending row can go. */
  'log:request-settled',

  // Skill optimization events
  'skill-optimization:arm-updated',
  'skill-optimization:cluster-updated',
  'skill-optimization:evaluation-run-created',
  'skill-optimization:evaluation-run-updated',
  'skill-optimization:evaluations-regenerated',
  'skill-optimization:event-created',
  'cluster:reset',
  'skill:reset',

  // Feedback events
  'feedback:created',
  'improved-response:created',

  // System events
  'ping',
]);

export type SSEEventType = z.infer<typeof SSEEventType>;

/**
 * SSE Event Data
 * Contains the payload for each event type
 */
export const SSEEventData = z.object({
  type: SSEEventType,
  timestamp: z.number(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type SSEEventData = z.infer<typeof SSEEventData>;

/**
 * SSE Connection Options
 */
export interface SSEConnectionOptions {
  /**
   * Reconnection delay in milliseconds (default: 8787)
   */
  reconnectDelay?: number;

  /**
   * Maximum number of reconnection attempts (default: 5)
   */
  maxReconnectAttempts?: number;

  /**
   * Ping interval in milliseconds to keep connection alive (default: 30000)
   */
  pingInterval?: number;

  /**
   * Whether to open the connection at all (default: true). False keeps the
   * hook mounted without a stream, which is what an unauthenticated dashboard
   * wants: the endpoint would only answer 401.
   */
  enabled?: boolean;
}
