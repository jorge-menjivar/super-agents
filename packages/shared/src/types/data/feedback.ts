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
/**
 * How many logs one feedback query may name.
 *
 * A uuid is 36 characters and an encoded comma is three, so a hundred of them
 * is a 3.9 KB request line -- and the same list is built a second time as
 * PostgREST's `log_id=in.(...)`. Four kilobytes is comfortable everywhere: the
 * tightest limit in the usual path is nginx's 8 KB request line, and Node's
 * own budget is 16 KB for the request line and every header together.
 *
 * It is a cap rather than a target. Callers with more logs than this ask in
 * batches, so the ceiling is a property of the request rather than of how much
 * a caller is allowed to know.
 */
export const FEEDBACK_LOG_IDS_LIMIT = 100;

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
     *
     * Capped at `FEEDBACK_LOG_IDS_LIMIT`, because the list travels as a URL
     * twice over: once from the browser, and again as PostgREST's
     * `log_id=in.(...)`. See that constant for the arithmetic.
     */
    log_ids: z
      .string()
      .or(z.array(z.string()))
      .transform((value) =>
        typeof value === 'string'
          ? value.split(',').map((id) => id.trim())
          : value,
      )
      .pipe(z.array(z.uuid()).min(1).max(FEEDBACK_LOG_IDS_LIMIT))
      .optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type FeedbackQueryParams = z.infer<typeof FeedbackQueryParams>;
