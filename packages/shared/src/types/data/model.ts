import { z } from 'zod';

/**
 * What a model does. A text model writes, an embed model embeds, and a
 * decision model answers questions about some material with probabilities --
 * the System One API -- and writes nothing, so it serves neither a text slot
 * nor the embedding slot. The database enforces which type each slot takes.
 */
export const ModelType = {
  TEXT: 'text',
  EMBED: 'embed',
  DECISION: 'decision',
} as const;

export type ModelType = (typeof ModelType)[keyof typeof ModelType];

export const ModelTypeSchema = z.enum(['text', 'embed', 'decision']);

export const Model = z.object({
  id: z.uuid(),
  ai_provider_id: z.uuid(),
  model_name: z.string().min(1),
  model_type: ModelTypeSchema,
  embedding_dimensions: z.number().int().positive().nullable(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});
export type Model = z.infer<typeof Model>;

export const ModelQueryParams = z
  .object({
    id: z.uuid().optional(),
    ai_provider_id: z.uuid().optional(),
    model_name: z.string().min(1).optional(),
    model_type: ModelTypeSchema.optional(),
    limit: z.coerce.number().int().positive().optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();

export type ModelQueryParams = z.infer<typeof ModelQueryParams>;

export const ModelCreateParams = z
  .object({
    ai_provider_id: z.uuid(),
    model_name: z.string().min(1),
    model_type: ModelTypeSchema.default('text'),
    embedding_dimensions: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine(
    (data) => {
      // embedding_dimensions required for embed models, and only for them
      if (data.model_type === 'embed') {
        return data.embedding_dimensions != null;
      }
      return data.embedding_dimensions == null;
    },
    {
      message:
        'embedding_dimensions is required for embed models and must not be set for any other',
      path: ['embedding_dimensions'],
    },
  );

export type ModelCreateParams = z.infer<typeof ModelCreateParams>;

export const ModelUpdateParams = z
  .object({
    model_name: z.string().min(1).optional(),
    model_type: ModelTypeSchema.optional(),
    embedding_dimensions: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine(
    (data) => {
      const updateFields = ['model_name', 'model_type', 'embedding_dimensions'];
      return updateFields.some(
        (field) => data[field as keyof typeof data] !== undefined,
      );
    },
    {
      message: 'At least one field must be provided for update',
      path: ['model_name'],
    },
  )
  .refine(
    (data) => {
      // If explicitly setting model_type to 'embed', embedding_dimensions must be provided
      if (data.model_type === 'embed') {
        return (
          data.embedding_dimensions !== undefined &&
          data.embedding_dimensions !== null
        );
      }
      return true;
    },
    {
      message:
        'embedding_dimensions is required when changing model_type to embed',
      path: ['embedding_dimensions'],
    },
  )
  .refine(
    (data) => {
      // If explicitly setting model_type to anything but 'embed',
      // embedding_dimensions must be null or not set
      if (data.model_type !== undefined && data.model_type !== 'embed') {
        return (
          data.embedding_dimensions === undefined ||
          data.embedding_dimensions === null
        );
      }
      return true;
    },
    {
      message:
        'embedding_dimensions must not be set when changing model_type to anything but embed',
      path: ['embedding_dimensions'],
    },
  )
  .refine(
    (data) => {
      // If only embedding_dimensions is being set (without model_type), it cannot be a positive number
      // because we don't know if the target model is embed type
      // This prevents accidentally setting dimensions on a text model
      if (
        data.model_type === undefined &&
        data.embedding_dimensions !== undefined &&
        data.embedding_dimensions !== null
      ) {
        // Setting dimensions without specifying model_type is not allowed
        // because we can't validate consistency without knowing the target model's type
        return false;
      }
      return true;
    },
    {
      message:
        'model_type must be specified as "embed" when setting embedding_dimensions',
      path: ['model_type'],
    },
  )
  // Only an embed model has dimensions, and both databases check it, so a
  // model that stops being one loses them in the same write. Without this a
  // client changing an embed model's type had to know to send
  // `embedding_dimensions: null` as well, or be refused by that check with a
  // 409 that named neither field. Done here because the route parses every
  // update with this schema before either backend is asked.
  .transform((data): typeof data =>
    data.model_type !== undefined && data.model_type !== ModelType.EMBED
      ? { ...data, embedding_dimensions: null }
      : data,
  );

export type ModelUpdateParams = z.infer<typeof ModelUpdateParams>;
