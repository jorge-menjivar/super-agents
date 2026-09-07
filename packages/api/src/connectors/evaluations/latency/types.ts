import { z } from 'zod';

/**
 * Parameters for the latency evaluation.
 *
 * It measures how quickly the provider answered, counted from the moment it
 * was asked: to its first token when the request streamed, and to its whole
 * answer otherwise. Nothing the gateway did around the call -- choosing the
 * skill, embedding the request, the hooks, a reviewer -- counts, since none
 * of it is the model's to answer for.
 *
 * The score is normalized based on target_latency_ms and max_latency_ms:
 * - Responses at or below target_latency_ms score 1.0 (perfect)
 * - Responses at or above max_latency_ms score 0.0 (worst)
 * - Responses in between are scored linearly
 */
export const LatencyEvaluationParameters = z
  .object({
    /**
     * Target latency in milliseconds (ideal time-to-first-token)
     * Responses at or below this threshold score 1.0
     */
    target_latency_ms: z.number().positive().default(10_000),

    /**
     * Maximum acceptable latency in milliseconds
     * Responses at or above this threshold score 0.0
     */
    max_latency_ms: z.number().positive().default(30_000),
  })
  .refine((data) => data.target_latency_ms < data.max_latency_ms, {
    message: 'Target latency must be less than max latency',
    path: ['target_latency_ms'],
  });

export type LatencyEvaluationParameters = z.infer<
  typeof LatencyEvaluationParameters
>;
