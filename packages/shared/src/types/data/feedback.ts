import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// Main Feedback schema
export const Feedback = z
  .object({
    id: z.uuid(),
    log_id: z.uuid(),
    score: z.number().min(0).max(1),
    // Nullable like the column: thumbs up/down comes with no text, and both
    // backends answer NULL for it.
    feedback: z.string().nullable().optional(),
    created_at: z.iso.datetime({ offset: true }),
    updated_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export type Feedback = z.infer<typeof Feedback>;

// Input schema for creating feedback
export const FeedbackCreateParams = z
  .object({
    id: z
      .undefined()
      .optional()
      .transform(() => uuidv4()),
    log_id: z.uuid(),
    score: z.number().min(0).max(1),
    feedback: z.string().optional(),
    created_at: z
      .undefined()
      .optional()
      .transform(() => new Date().toISOString()),
    updated_at: z
      .undefined()
      .optional()
      .transform(() => new Date().toISOString()),
  })
  .strict();

export type FeedbackCreateParams = z.infer<typeof FeedbackCreateParams>;

// Query parameters schema
export const FeedbackQueryParams = z
  .object({
    id: z.uuid().optional(),
    log_id: z.uuid().optional(),
    /**
     * Several logs at once, comma-separated in the query string. The session
     * rail asks for the verdicts on a whole window of requests, which is one
     * query rather than one per row. An empty list is not a query -- it would
     * read as no filter at all, which is every verdict on the deployment --
     * so it is rejected rather than widened.
     */
    log_ids: z
      .string()
      .or(z.array(z.string()))
      .transform((value) =>
        typeof value === 'string'
          ? value.split(',').map((id) => id.trim())
          : value,
      )
      .pipe(z.array(z.uuid()).min(1))
      .optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type FeedbackQueryParams = z.infer<typeof FeedbackQueryParams>;
