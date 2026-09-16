'use client';

import type { SkillEvent } from '@shared/types/data/skill-event';
import { eventColors, eventLabels } from '@web/constants';
import { bucketsForWindow, seriesAcrossWindow } from '@web/utils/chart-window';
import {
  CategoryScale,
  Chart as ChartJS,
  type ChartOptions,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { format } from 'date-fns';
import { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  annotationPlugin,
);

interface SkillPerformanceChartProps {
  evaluationScores: Array<{
    time_bucket: string;
    avg_score: number | null;
    scores_by_evaluation: Record<string, number> | null;
    count: number;
  }>;
  events?: SkillEvent[];
  clusters?: Array<{ id: string; name: string }>; // For cluster name lookup
  size?: 'small' | 'large';
  intervalMinutes?: number; // Bucket size in minutes
  windowHours?: number; // Total time window in hours
  endTime?: Date; // End time for the chart (rightmost bucket)
}

const METHOD_COLORS: Record<string, string> = {
  task_completion: 'rgb(59, 130, 246)', // blue
  argument_correctness: 'rgb(168, 85, 247)', // purple
  role_adherence: 'rgb(34, 197, 94)', // green
  turn_relevancy: 'rgb(251, 146, 60)', // orange
  tool_correctness: 'rgb(236, 72, 153)', // pink
  knowledge_retention: 'rgb(14, 165, 233)', // sky
  conversation_completeness: 'rgb(168, 85, 247)', // purple
  hallucination: 'rgb(220, 38, 38)', // red
  custom: 'rgb(148, 163, 184)', // gray
  latency: 'rgb(6, 182, 212)', // cyan
};

export function SkillPerformanceChart({
  evaluationScores,
  events = [],
  clusters = [],
  size = 'large',
  intervalMinutes = 60,
  windowHours = 24,
  endTime = new Date(),
}: SkillPerformanceChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Create cluster name lookup map
  const clusterNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cluster of clusters) {
      map.set(cluster.id, cluster.name);
    }
    return map;
  }, [clusters]);

  const chartData = useMemo(() => {
    const buckets = bucketsForWindow({
      endTime,
      windowHours,
      intervalMinutes,
      compact: size === 'small',
    });

    // Create a map of time bucket to score. The fetched range is wider than
    // the window, so these hold points on both sides of it as well as inside.
    const scoreMap = new Map<number, number>();
    for (const score of evaluationScores) {
      if (score.avg_score === null) continue;
      const bucketTime = new Date(score.time_bucket).getTime();
      scoreMap.set(bucketTime, score.avg_score * 100);
    }

    // Fill in data for all buckets
    const labels = buckets.map((b) => b.label);

    // Collect all evaluation methods across all buckets
    const allMethods = new Set<string>();
    for (const score of evaluationScores) {
      if (score.scores_by_evaluation) {
        for (const method of Object.keys(score.scores_by_evaluation)) {
          allMethods.add(method);
        }
      }
    }

    // Create a map for each evaluation method
    const methodDataMaps = new Map<string, Map<number, number>>();
    for (const method of allMethods) {
      methodDataMaps.set(method, new Map());
    }

    // Fill method maps with scores
    for (const score of evaluationScores) {
      const bucketTime = new Date(score.time_bucket).getTime();
      if (score.scores_by_evaluation) {
        for (const [method, methodScore] of Object.entries(
          score.scores_by_evaluation,
        )) {
          const methodMap = methodDataMaps.get(method);
          if (methodMap) {
            methodMap.set(bucketTime, methodScore * 100);
          }
        }
      }
    }

    // Format method names
    const formatMethodName = (method: string) => {
      return method
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    };

    // Create datasets for each evaluation method. The fetched range reaches
    // outside the window, so a method can come back with nothing to draw
    // inside it; it used to be absent from the response altogether, and it
    // stays out of the legend the same way.
    const methodDatasets = Array.from(methodDataMaps.entries())
      .map(([method, methodMap]) => {
        const { data, edges, carried, measured } = seriesAcrossWindow(
          methodMap,
          buckets,
        );
        const color = METHOD_COLORS[method] || 'rgb(148, 163, 184)';

        return {
          label: formatMethodName(method),
          data,
          // Where the line meets the window edge is not a bucket anyone
          // scored, so it carries no marker and the tooltip skips it.
          edges,
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          pointRadius: (ctx: { dataIndex: number }) =>
            measured === 1 && !edges.has(ctx.dataIndex) ? 2 : 0,
          pointHoverRadius: (ctx: { dataIndex: number }) =>
            edges.has(ctx.dataIndex) ? 0 : 8,
          pointHoverBorderWidth: 2,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: 'white',
          // A carried stretch is dashed: it says the score is the last one
          // known, not one measured here.
          segment: {
            borderDash: (ctx: { p1DataIndex: number }) =>
              carried.has(ctx.p1DataIndex) ? [6, 4] : undefined,
          },
          tension: 0.3,
          spanGaps: true,
        };
      })
      .filter((dataset) => dataset.data.some((value) => value !== null));

    // Create weighted average dataset (only if more than 1 evaluation method)
    const shouldShowWeightedAverage = methodDatasets.length > 1;
    const datasets: Array<{
      label: string;
      data: (number | null)[];
      [key: string]: unknown;
    }> = [];

    if (shouldShowWeightedAverage) {
      const {
        data: avgData,
        edges: avgEdges,
        carried: avgCarried,
        measured: avgMeasured,
      } = seriesAcrossWindow(scoreMap, buckets);

      datasets.push({
        label: 'Weighted Average',
        data: avgData,
        edges: avgEdges,
        borderColor: 'rgb(115, 115, 115)', // gray for overall average
        backgroundColor: 'rgb(115, 115, 115)',
        borderWidth: 3, // Thicker line to stand out
        pointRadius: (ctx: { dataIndex: number }) =>
          avgMeasured === 1 && !avgEdges.has(ctx.dataIndex) ? 3 : 0,
        pointHoverRadius: (ctx: { dataIndex: number }) =>
          avgEdges.has(ctx.dataIndex) ? 0 : 8,
        pointHoverBorderWidth: 2,
        pointHoverBackgroundColor: 'rgb(115, 115, 115)',
        pointHoverBorderColor: 'white',
        // A carried stretch is dashed: it says the score is the last one
        // known, not one measured here.
        segment: {
          borderDash: (ctx: { p1DataIndex: number }) =>
            avgCarried.has(ctx.p1DataIndex) ? [6, 4] : undefined,
        },
        tension: 0.3,
        spanGaps: true,
      });
    }

    // Add method datasets
    datasets.push(...methodDatasets);

    // Create event markers dataset for all buckets (invisible, for tooltips only)
    const eventData = buckets.map((bucket) => {
      const bucketTime = bucket.time.getTime();
      const nextBucketTime = bucketTime + intervalMinutes * 60 * 1000;

      // Find event in this time bucket
      const event = events.find((e) => {
        const eventTime = new Date(e.created_at).getTime();
        return eventTime >= bucketTime && eventTime < nextBucketTime;
      });

      return event ? 50 : null; // Middle of chart (0-100 scale)
    });

    // Add events dataset
    datasets.push({
      label: 'Events',
      data: eventData,
      borderColor: 'rgba(0, 0, 0, 0)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      borderWidth: 0,
      pointRadius: 6, // Invisible point for hover area
      pointHoverRadius: 6,
      pointHoverBorderWidth: 0,
      tension: 0,
      spanGaps: false,
    });

    return {
      labels,
      datasets,
      buckets, // Include for event annotation calculation
    };
  }, [evaluationScores, events, intervalMinutes, windowHours, endTime, size]);

  // Create event annotations
  const eventAnnotations = useMemo(() => {
    if (events.length === 0 || !chartData.buckets) return {};

    const annotations: Record<string, unknown> = {};

    // Show all events (both skill-wide and cluster-specific)
    for (const event of events) {
      const eventTime = new Date(event.created_at).getTime();

      // Find which time bucket this event falls into
      const xIndex = chartData.buckets.findIndex((bucket) => {
        const bucketTime = bucket.time.getTime();
        const nextBucketTime = bucketTime + intervalMinutes * 60 * 1000;
        return eventTime >= bucketTime && eventTime < nextBucketTime;
      });

      if (xIndex !== -1) {
        const color =
          eventColors[event.event_type as keyof typeof eventColors] ||
          'rgba(148, 163, 184, 0.6)';
        const label =
          eventLabels[event.event_type as keyof typeof eventLabels] ||
          event.event_type;

        annotations[`event-${event.id}`] = {
          type: 'line',
          xMin: xIndex,
          xMax: xIndex,
          borderColor: color,
          borderWidth: 2,
          borderDash: [5, 5],
          label: {
            display: size === 'large',
            content: label,
            position: 'start',
            rotation: 270,
            backgroundColor: color, // Use event color for label background
            color: 'white',
            font: {
              size: 9,
              weight: 'bold',
            },
            padding: 4,
          },
        };
      }
    }

    return annotations;
  }, [events, chartData, intervalMinutes, size]);

  // Combine event annotations with hover line
  const allAnnotations = useMemo(() => {
    const combined = { ...eventAnnotations };

    // Add vertical hover line (only for large charts)
    if (hoveredIndex !== null && size === 'large') {
      combined.hoverLine = {
        type: 'line',
        xMin: hoveredIndex,
        xMax: hoveredIndex,
        borderColor: 'rgba(0, 0, 0, 0.3)',
        borderWidth: 2,
        borderDash: [5, 5],
      };
    }

    return combined;
  }, [eventAnnotations, hoveredIndex, size]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 150, // Faster animation (default is 1000ms)
    },
    events: size === 'large' ? undefined : [], // Disable all events for small charts
    interaction: {
      mode: size === 'large' ? 'index' : undefined,
      intersect: false,
    },
    onHover:
      size === 'large'
        ? (_event, activeElements) => {
            if (activeElements.length > 0) {
              setHoveredIndex(activeElements[0].index);
            } else {
              setHoveredIndex(null);
            }
          }
        : undefined,
    plugins: {
      annotation: {
        // biome-ignore lint/suspicious/noExplicitAny: chartjs-plugin-annotation has complex types
        annotations: allAnnotations as any,
      },
      legend: {
        display: true,
        position: 'bottom',
        onClick: size === 'large' ? undefined : () => false, // Disable legend click for small charts
        labels: {
          boxWidth: size === 'large' ? 12 : 8,
          boxHeight: size === 'large' ? 12 : 8,
          padding: size === 'large' ? 12 : 8,
          font: {
            size: size === 'large' ? 11 : 9,
          },
          color: 'rgb(115, 115, 115)',
          filter: (item) => item.text !== 'Events', // Hide Events from legend
        },
      },
      tooltip: {
        enabled: size === 'large',
        mode: 'index',
        intersect: false,
        displayColors: true,
        // Where a line meets the window edge is not a bucket anybody
        // scored: the line passes through it, but there is nothing to report
        // for it, so the tooltip leaves it out as it does an empty bucket.
        filter: (item) =>
          !(
            chartData.datasets[item.datasetIndex] as { edges?: Set<number> }
          ).edges?.has(item.dataIndex),
        callbacks: {
          label: (context) => {
            const label = context.dataset.label || '';

            // If this is the Events dataset, show event details
            if (label === 'Events') {
              const xIndex = context.dataIndex;
              const bucket = chartData.buckets?.[xIndex];
              if (!bucket) return 'Event';

              const bucketTime = bucket.time.getTime();
              const nextBucketTime = bucketTime + intervalMinutes * 60 * 1000;

              const eventsAtTime = events.filter((event) => {
                const eventTime = new Date(event.created_at).getTime();
                return eventTime >= bucketTime && eventTime < nextBucketTime;
              });

              if (eventsAtTime.length === 0) return 'Event';

              const lines: string[] = [];
              for (const event of eventsAtTime) {
                const eventLabel =
                  eventLabels[event.event_type as keyof typeof eventLabels] ||
                  event.event_type;

                const eventTime = new Date(event.created_at);
                const timeString = format(eventTime, 'MMM d, h:mm a');
                lines.push(timeString);
                lines.push(eventLabel);

                // Add cluster name if this is a cluster-specific event
                if (event.cluster_id) {
                  const clusterName = clusterNameMap.get(event.cluster_id);
                  if (clusterName) {
                    lines.push(`Partition: ${clusterName}`);
                  }
                }

                if (event.metadata.model_name) {
                  lines.push(String(event.metadata.model_name));
                }
              }

              return lines;
            }

            // For performance datasets, show the score
            const value = context.parsed.y;
            return `${label}: ${value!.toFixed(3)}`;
          },
        },
      },
      title: {
        display: size === 'large',
        text: 'Skill Performance Over Time',
        font: {
          size: size === 'large' ? 12 : 11,
        },
        color: 'rgb(115, 115, 115)',
        padding: {
          top: 10,
          bottom: 20,
        },
      },
    },
    scales: {
      x: {
        display: true,
        grid: {
          display: false,
        },
        ticks: {
          font: {
            size: size === 'large' ? 10 : 9,
          },
          color: 'rgb(115, 115, 115)',
          maxRotation: 45,
          minRotation: 45,
          autoSkip: true,
          maxTicksLimit: size === 'large' ? 10 : 5,
        },
      },
      y: {
        display: true,
        grid: {
          color: 'rgba(115, 115, 115, 0.1)',
        },
        ticks: {
          font: {
            size: size === 'large' ? 10 : 9,
          },
          color: 'rgb(115, 115, 115)',
          maxTicksLimit: size === 'large' ? 6 : 4,
          callback: (value) => {
            return Number(value).toFixed(2);
          },
        },
        min: 0,
        max: 100,
      },
    },
  };

  return (
    <div className="w-full space-y-2">
      {/* Chart */}
      <div className={`w-full ${size === 'large' ? 'h-64' : 'h-40'}`}>
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
