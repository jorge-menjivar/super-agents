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

interface AgentPerformanceChartProps {
  evaluationScores: Array<{
    time_bucket: string;
    skill_id: string;
    avg_score: number | null;
    count: number;
  }>;
  events?: SkillEvent[];
  skills?: Array<{ id: string; name: string }>; // For skill name lookup
  title?: string;
  intervalMinutes?: number;
  windowHours?: number;
  endTime?: Date; // End time for the chart (rightmost bucket)
  /**
   * Draw the skills that scored nothing in this window, whose lines are
   * carried across it from an older score. They are the agent's whole roster
   * rather than what it is doing now, and a dozen of them can crowd out the
   * two that are running, so this is the reader's to turn off.
   */
  showQuietSkills?: boolean;
}

// Color palette for skill lines
const SKILL_COLORS = [
  'rgb(59, 130, 246)', // blue
  'rgb(168, 85, 247)', // purple
  'rgb(34, 197, 94)', // green
  'rgb(251, 146, 60)', // orange
  'rgb(236, 72, 153)', // pink
  'rgb(14, 165, 233)', // sky
  'rgb(6, 182, 212)', // cyan
  'rgb(245, 158, 11)', // amber
  'rgb(239, 68, 68)', // red
  'rgb(99, 102, 241)', // indigo
];

export function AgentPerformanceChart({
  evaluationScores,
  events = [],
  skills = [],
  title = 'Agent Performance Over Time (All Skills)',
  intervalMinutes = 60,
  windowHours = 24,
  endTime = new Date(),
  showQuietSkills = true,
}: AgentPerformanceChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Create skill name lookup map
  const skillNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const skill of skills) {
      map.set(skill.id, skill.name);
    }
    return map;
  }, [skills]);

  const chartData = useMemo(() => {
    const buckets = bucketsForWindow({
      endTime,
      windowHours,
      intervalMinutes,
    });

    // Group scores by skill_id. The fetched range is wider than the window,
    // so a map holds points on both sides of it as well as inside.
    const skillScoreMap = new Map<string, Map<number, number>>();

    for (const score of evaluationScores) {
      if (score.avg_score === null) continue;
      if (!skillScoreMap.has(score.skill_id)) {
        skillScoreMap.set(score.skill_id, new Map());
      }
      const bucketTime = new Date(score.time_bucket).getTime();
      skillScoreMap.get(score.skill_id)!.set(bucketTime, score.avg_score * 100);
    }

    // Fill in data for all buckets
    const labels = buckets.map((b) => b.label);

    // Create datasets for each skill
    const skillDatasets: Array<{
      label: string;
      data: (number | null)[];
      [key: string]: unknown;
    }> = [];

    // A skill keeps its colour whether or not the quiet ones are drawn, so
    // the toggle below changes what is on the chart and not what it looks
    // like: the index is the skill's place in the response, not in the chart.
    for (const [colorIndex, [skillId, scoreMap]] of Array.from(
      skillScoreMap.entries(),
    ).entries()) {
      const { data, edges, carried, measured } = seriesAcrossWindow(
        scoreMap,
        buckets,
      );

      // The fetched range reaches outside the window, so a skill can come
      // back with nothing to draw at all -- not even a carry, having scored
      // nothing before the window either.
      if (data.every((value) => value === null)) continue;
      // Scored nothing inside it, so every point of this line is carried
      if (!showQuietSkills && measured === 0) continue;

      const skillName = skillNameMap.get(skillId) || 'Unknown Skill';
      const color = SKILL_COLORS[colorIndex % SKILL_COLORS.length];

      skillDatasets.push({
        label: skillName,
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
      });
    }

    // Create event markers dataset for all buckets (invisible, for tooltips only)
    const eventData = buckets.map((bucket) => {
      const bucketTime = bucket.time.getTime();
      const nextBucketTime = bucketTime + intervalMinutes * 60 * 1000;

      // Find event in this time bucket (skill-wide events only, cluster_id is null)
      const event = events.find((e) => {
        if (e.cluster_id !== null) return false;
        const eventTime = new Date(e.created_at).getTime();
        return eventTime >= bucketTime && eventTime < nextBucketTime;
      });

      return event ? 50 : null; // Middle of chart (0-100 scale)
    });

    // Add events dataset
    const eventsDataset = {
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
    };

    return {
      labels,
      datasets: [...skillDatasets, eventsDataset],
      buckets, // Include for event annotation calculation
    };
  }, [
    evaluationScores,
    events,
    intervalMinutes,
    windowHours,
    endTime,
    skillNameMap,
    showQuietSkills,
  ]);

  // Create event annotations
  const eventAnnotations = useMemo(() => {
    if (events.length === 0 || !chartData.buckets) return {};

    const annotations: Record<string, unknown> = {};

    // Filter for skill-wide events only
    const skillWideEvents = events.filter((event) => event.cluster_id === null);

    for (const event of skillWideEvents) {
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
            display: true,
            content: label,
            position: 'start',
            rotation: 270,
            backgroundColor: color,
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
  }, [events, chartData, intervalMinutes]);

  // Combine event annotations with hover line
  const allAnnotations = useMemo(() => {
    const combined = { ...eventAnnotations };

    // Add vertical hover line
    if (hoveredIndex !== null) {
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
  }, [eventAnnotations, hoveredIndex]);

  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 150, // Faster animation (default is 1000ms)
    },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    onHover: (_event, activeElements) => {
      if (activeElements.length > 0) {
        setHoveredIndex(activeElements[0].index);
      } else {
        setHoveredIndex(null);
      }
    },
    layout: {
      padding: {
        top: 5,
      },
    },
    plugins: {
      annotation: {
        // biome-ignore lint/suspicious/noExplicitAny: chartjs-plugin-annotation has complex types
        annotations: allAnnotations as any,
      },
      legend: {
        display: true,
        position: 'bottom',
        labels: {
          boxWidth: 12,
          boxHeight: 12,
          padding: 12,
          font: {
            size: 11,
          },
          color: 'rgb(115, 115, 115)',
          filter: (item) => item.text !== 'Events', // Hide Events from legend
        },
      },
      tooltip: {
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
                if (event.cluster_id !== null) return false;
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

                // Add skill name
                const skillName = skillNameMap.get(event.skill_id);
                if (skillName) {
                  lines.push(`Skill: ${skillName}`);
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
        display: true,
        text: title,
        font: {
          size: 12,
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
            size: 10,
          },
          color: 'rgb(115, 115, 115)',
          maxRotation: 45,
          minRotation: 45,
          autoSkip: true,
          maxTicksLimit: 10,
        },
      },
      y: {
        display: true,
        grid: {
          color: 'rgba(115, 115, 115, 0.1)',
        },
        ticks: {
          font: {
            size: 10,
          },
          color: 'rgb(115, 115, 115)',
          maxTicksLimit: 6,
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
      <div className="w-full h-64">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
