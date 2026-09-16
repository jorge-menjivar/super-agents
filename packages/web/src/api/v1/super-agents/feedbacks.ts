import type { feedbacksRouter } from '@api/v1/super-agents/feedbacks';
import type {
  Feedback,
  FeedbackQueryParams,
} from '@shared/types/data/feedback';
import { hc } from 'hono/client';

const client = hc<typeof feedbacksRouter>('/v1/super-agents/feedbacks', {
  init: {
    credentials: 'include',
  },
});

export async function getFeedback(
  params: FeedbackQueryParams,
): Promise<Feedback[]> {
  const query: Record<string, string> = {};
  if (params.id) query.id = params.id;
  if (params.log_id) query.log_id = params.log_id;
  // Comma-separated, which is how the query schema reads a list back
  if (params.log_ids?.length) query.log_ids = params.log_ids.join(',');
  if (params.limit) query.limit = params.limit.toString();
  if (params.offset) query.offset = params.offset.toString();

  const response = await client.index.$get({ query });

  if (!response.ok) {
    throw new Error('Failed to fetch feedback');
  }

  return (await response.json()) as Feedback[];
}

export async function createFeedback(params: {
  log_id: string;
  score: number;
  feedback?: string;
}): Promise<Feedback> {
  // The create schema fills id and timestamps itself; its input type wants
  // them present as undefined.
  const response = await client.index.$post({
    json: {
      id: undefined,
      log_id: params.log_id,
      score: params.score,
      feedback: params.feedback,
      created_at: undefined,
      updated_at: undefined,
    },
  });

  if (!response.ok) {
    throw new Error('Failed to create feedback');
  }

  return (await response.json()) as Feedback;
}

export async function deleteFeedback(feedbackId: string): Promise<void> {
  const response = await client[':feedbackId'].$delete({
    param: { feedbackId },
  });

  if (!response.ok) {
    throw new Error('Failed to delete feedback');
  }
}
