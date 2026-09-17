import type { Client, Row } from '@libsql/client';
import type {
  EvaluationScoresByTimeBucketParams,
  EvaluationScoresByTimeBucketResult,
} from '@shared/types/data/evaluation-runs-with-scores';

/** The filters a query carries besides its range, as SQL and arguments. */
const seriesFilters = (
  params: EvaluationScoresByTimeBucketParams,
): { sql: string; args: string[] } => {
  const conditions: string[] = [];
  const args: string[] = [];
  for (const [column, value] of [
    ['agent_id', params.agent_id],
    ['skill_id', params.skill_id],
    ['cluster_id', params.cluster_id],
  ] as const) {
    if (value) {
      conditions.push(`AND er.${column} = ?`);
      args.push(value);
    }
  }
  return { sql: conditions.join(' '), args };
};

/**
 * The runs of the bucket nearest outside each end of the range, per series.
 *
 * Two steps, because a bucket's score is the mean of every run in it: find
 * the run nearest beyond the edge for each series, then read the whole bucket
 * it belongs to. Doing it the other way -- taking that one run as the edge --
 * would give a bucket a different score depending on which side of a window
 * it fell.
 */
const edgeBucketRows = async (
  client: Client,
  params: EvaluationScoresByTimeBucketParams,
  intervalMs: number,
): Promise<Row[]> => {
  const filters = seriesFilters(params);

  // The nearest run beyond each edge, one per series. `cluster_id` partitions
  // alongside the skill, matching the grouping the buckets are keyed by.
  const nearest = await client.execute({
    sql: `SELECT created_at, side FROM (
            SELECT er.created_at,
                   'before' AS side,
                   ROW_NUMBER() OVER (
                     PARTITION BY er.agent_id, er.skill_id, er.cluster_id
                     ORDER BY er.created_at DESC
                   ) AS rank
            FROM evaluation_runs_with_scores er
            WHERE er.created_at < ? ${filters.sql}
            UNION ALL
            SELECT er.created_at,
                   'after' AS side,
                   ROW_NUMBER() OVER (
                     PARTITION BY er.agent_id, er.skill_id, er.cluster_id
                     ORDER BY er.created_at ASC
                   ) AS rank
            FROM evaluation_runs_with_scores er
            WHERE er.created_at > ? ${filters.sql}
          ) WHERE rank = 1`,
    args: [
      params.start_time,
      ...filters.args,
      params.end_time,
      ...filters.args,
    ],
  });

  if (nearest.rows.length === 0) {
    return [];
  }

  // Every run of the buckets those fall in. One range per bucket, which is a
  // handful of them: one per series and side.
  const ranges: string[] = [];
  const args: string[] = [];
  for (const row of nearest.rows) {
    const at = Date.parse(String(row.created_at));
    if (Number.isNaN(at)) continue;
    const start = Math.floor(at / intervalMs) * intervalMs;
    ranges.push('(er.created_at >= ? AND er.created_at < ?)');
    args.push(
      new Date(start).toISOString(),
      new Date(start + intervalMs).toISOString(),
    );
  }

  if (ranges.length === 0) {
    return [];
  }

  const bucketed = await client.execute({
    sql: `SELECT er.id, er.agent_id, er.skill_id, er.cluster_id, er.created_at,
                 er.scores_by_evaluation
          FROM evaluation_runs_with_scores er
          WHERE (${ranges.join(' OR ')}) ${filters.sql}`,
    args: [...args, ...filters.args],
  });

  return bucketed.rows;
};

/**
 * Replaces the `get_evaluation_scores_by_time_bucket` plpgsql function.
 *
 * SQLite has no stored procedures, so the SQL fetches the per-run scores from
 * `evaluation_runs_with_scores` and the bucketing and weighting happen here.
 * Doing the arithmetic in TypeScript rather than in a single dense query also
 * keeps it readable against the plpgsql it replaces.
 *
 * The Postgres function's semantics that matter, and are reproduced here:
 *
 * - Buckets are aligned to the epoch at `interval_minutes`, so a series is
 *   stable across calls rather than relative to the range requested.
 * - `include_edge_buckets` also returns the bucket nearest outside each end of
 *   the range, per series, whole rather than just the run that identified it.
 * - `avg_score` is recomputed from the **current** evaluation weights rather
 *   than reusing the weighted average stored per run, so re-weighting an
 *   evaluation retroactively changes the chart.
 * - An evaluation method with no matching row weighs 1.0 (`COALESCE(e.weight, 1.0)`).
 * - `scores_by_evaluation` holds the per-method mean within the bucket.
 * - `count` is the number of runs in the bucket, not the number of scores.
 * - Results are ordered by bucket ascending.
 */
export const aggregateScoresByTimeBucket = async (
  client: Client,
  params: EvaluationScoresByTimeBucketParams,
): Promise<EvaluationScoresByTimeBucketResult[]> => {
  const conditions = ['er.created_at >= ?', 'er.created_at <= ?'];
  const args: (string | number)[] = [params.start_time, params.end_time];

  if (params.agent_id) {
    conditions.push('er.agent_id = ?');
    args.push(params.agent_id);
  }
  if (params.skill_id) {
    conditions.push('er.skill_id = ?');
    args.push(params.skill_id);
  }
  if (params.cluster_id) {
    conditions.push('er.cluster_id = ?');
    args.push(params.cluster_id);
  }

  const result = await client.execute({
    sql: `SELECT er.id, er.agent_id, er.skill_id, er.cluster_id, er.created_at,
                 er.scores_by_evaluation
          FROM evaluation_runs_with_scores er
          WHERE ${conditions.join(' AND ')}`,
    args,
  });

  const intervalMs = params.interval_minutes * 60 * 1000;

  let rows = result.rows;
  if (params.include_edge_buckets) {
    // An edge bucket straddles the range when the caller's bounds are not on
    // a bucket boundary, and then its runs come back from both queries. The
    // id is what keeps such a run from being counted into its bucket twice.
    const seen = new Set(rows.map((row) => String(row.id)));
    const edges = await edgeBucketRows(client, params, intervalMs);
    rows = [...rows, ...edges.filter((row) => !seen.has(String(row.id)))];
  }

  interface Bucket {
    time_bucket: string;
    agent_id: string;
    skill_id: string;
    cluster_id: string | null;
    /** Per evaluation method: every score seen in this bucket. */
    scores: Map<string, number[]>;
    count: number;
  }

  const buckets = new Map<string, Bucket>();

  for (const row of rows) {
    const createdAt = Date.parse(String(row.created_at));
    if (Number.isNaN(createdAt)) {
      continue;
    }

    const bucketStart = Math.floor(createdAt / intervalMs) * intervalMs;
    const timeBucket = new Date(bucketStart).toISOString();
    const clusterId =
      row.cluster_id === null || row.cluster_id === undefined
        ? null
        : String(row.cluster_id);

    const key = `${timeBucket}|${row.agent_id}|${row.skill_id}|${clusterId ?? ''}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        time_bucket: timeBucket,
        agent_id: String(row.agent_id),
        skill_id: String(row.skill_id),
        cluster_id: clusterId,
        scores: new Map(),
        count: 0,
      };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    // NULL when the run's results referenced no known evaluation.
    if (row.scores_by_evaluation === null) {
      continue;
    }

    const scores = JSON.parse(String(row.scores_by_evaluation)) as Record<
      string,
      number
    >;
    for (const [method, score] of Object.entries(scores)) {
      const seen = bucket.scores.get(method);
      if (seen) {
        seen.push(score);
      } else {
        bucket.scores.set(method, [score]);
      }
    }
  }

  if (buckets.size === 0) {
    return [];
  }

  // Current weights, keyed by skill and method, matching the function's join on
  // `e.skill_id = ... AND e.evaluation_method = ...`.
  const weightRows = await client.execute(
    'SELECT skill_id, evaluation_method, weight FROM skill_optimization_evaluations',
  );
  const weights = new Map<string, number>();
  for (const row of weightRows.rows) {
    weights.set(`${row.skill_id}|${row.evaluation_method}`, Number(row.weight));
  }

  const results: EvaluationScoresByTimeBucketResult[] = [];

  for (const bucket of buckets.values()) {
    const scoresByEvaluation: Record<string, number> = {};
    let weightedSum = 0;
    let weightTotal = 0;

    for (const [method, scores] of bucket.scores) {
      const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
      scoresByEvaluation[method] = mean;

      const weight = weights.get(`${bucket.skill_id}|${method}`) ?? 1.0;
      weightedSum += mean * weight;
      weightTotal += weight;
    }

    results.push({
      time_bucket: bucket.time_bucket,
      agent_id: bucket.agent_id,
      skill_id: bucket.skill_id,
      cluster_id: bucket.cluster_id,
      avg_score: weightTotal === 0 ? null : weightedSum / weightTotal,
      scores_by_evaluation:
        Object.keys(scoresByEvaluation).length === 0
          ? null
          : scoresByEvaluation,
      count: bucket.count,
    });
  }

  results.sort((a, b) => a.time_bucket.localeCompare(b.time_bucket));

  return results;
};
