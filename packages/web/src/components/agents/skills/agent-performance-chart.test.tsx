import { fireEvent, render, screen } from '@testing-library/react';
import { AgentPerformanceChart } from '@web/components/agents/agent-performance-chart';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RenderedDataset {
  label: string;
  borderColor: string;
  data: (number | null)[];
  /** Indices the line was drawn out to the window edge at */
  edges?: Set<number>;
  pointRadius: number | ((context: { dataIndex: number }) => number);
  segment?: {
    borderDash: (context: { p1DataIndex: number }) => number[] | undefined;
  };
  spanGaps: boolean;
}

interface RenderedChart {
  labels: string[];
  datasets: RenderedDataset[];
}

interface TooltipItem {
  datasetIndex: number;
  dataIndex: number;
}

interface RenderedOptions {
  plugins: {
    tooltip: {
      filter: (item: TooltipItem) => boolean;
      callbacks: {
        label: (context: {
          dataset: { label: string };
          parsed: { y: number };
          datasetIndex: number;
          dataIndex: number;
        }) => string | string[];
      };
    };
  };
}

/**
 * What the chart was last handed, unserialised.
 *
 * The attributes below are JSON, which drops the scriptable options and the
 * set of window edges; a test that needs either reads them from here.
 */
const rendered = vi.hoisted(
  () => ({}) as { data: RenderedChart; options: RenderedOptions },
);

/** The radius a dataset gives a bucket, scriptable or not. */
const radiusAt = (dataset: RenderedDataset, dataIndex: number): number =>
  typeof dataset.pointRadius === 'function'
    ? dataset.pointRadius({ dataIndex })
    : dataset.pointRadius;

/** The dash pattern of the stretch ending at a bucket, if it has one. */
const dashAt = (
  dataset: RenderedDataset,
  dataIndex: number,
): number[] | undefined =>
  dataset.segment?.borderDash({ p1DataIndex: dataIndex });

// Mock Chart.js and react-chartjs-2
vi.mock('react-chartjs-2', () => ({
  Line: vi.fn(({ data, options }) => {
    rendered.data = data;
    rendered.options = options;
    return (
      <div
        data-testid="line-chart"
        data-chart-data={JSON.stringify(data)}
        data-chart-options={JSON.stringify(options)}
      >
        Line Chart Mock
      </div>
    );
  }),
}));

vi.mock('chart.js', () => ({
  Chart: {
    register: vi.fn(),
  },
  CategoryScale: vi.fn(),
  LinearScale: vi.fn(),
  PointElement: vi.fn(),
  LineElement: vi.fn(),
  Title: vi.fn(),
  Tooltip: vi.fn(),
  Legend: vi.fn(),
}));

const HOUR = 60 * 60 * 1000;

/**
 * A bucket inside the chart's default window, on the grid the server buckets
 * to. The window ends at the moment of the render, so a fixture with a fixed
 * date falls outside it and draws nothing.
 */
const bucketAt = (hoursAgo: number): string =>
  new Date(
    Math.floor(Date.now() / HOUR) * HOUR - hoursAgo * HOUR,
  ).toISOString();

describe('AgentPerformanceChart', () => {
  const mockSkillId = '123e4567-e89b-12d3-a456-426614174000';
  const mockEvaluationScores = [
    {
      time_bucket: bucketAt(3),
      skill_id: mockSkillId,
      avg_score: 0.875,
      count: 2,
    },
    {
      time_bucket: bucketAt(2),
      skill_id: mockSkillId,
      avg_score: 0.9,
      count: 2,
    },
    {
      time_bucket: bucketAt(1),
      skill_id: mockSkillId,
      avg_score: 0.925,
      count: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should render empty state when no evaluation runs are provided', () => {
    render(<AgentPerformanceChart evaluationScores={[]} />);

    // Component always renders chart, no empty state UI
    const chart = screen.getByTestId('line-chart');
    expect(chart).toBeInTheDocument();
  });

  it('should render chart with evaluation data', () => {
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    expect(chart).toBeInTheDocument();
    expect(screen.getByText('Line Chart Mock')).toBeInTheDocument();
  });

  it.skip('should render all time interval buttons', () => {
    // Time interval UI removed from component
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    expect(screen.getByText('5 Min')).toBeInTheDocument();
    expect(screen.getByText('30 Min')).toBeInTheDocument();
    expect(screen.getByText('1 Hour')).toBeInTheDocument();
    expect(screen.getByText('1 Day')).toBeInTheDocument();
  });

  it.skip('should have 1 Hour selected by default', () => {
    // Time interval UI removed from component
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const oneHourButton = screen.getByText('1 Hour');
    expect(oneHourButton).toHaveClass('bg-blue-500', 'text-white');
  });

  it.skip('should change interval when clicking different interval button', () => {
    // Time interval UI removed from component
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const thirtyMinButton = screen.getByText('30 Min');
    const oneHourButton = screen.getByText('1 Hour');

    // Initially 1 Hour is selected
    expect(oneHourButton).toHaveClass('bg-blue-500', 'text-white');
    expect(thirtyMinButton).toHaveClass('bg-gray-100', 'text-gray-600');

    // Click 30 Min button
    fireEvent.click(thirtyMinButton);

    // Now 30 Min should be selected
    expect(thirtyMinButton).toHaveClass('bg-blue-500', 'text-white');
    expect(oneHourButton).toHaveClass('bg-gray-100', 'text-gray-600');
  });

  it.skip('should update chart data when interval changes', () => {
    // Time interval UI removed from component
    const { rerender } = render(
      <AgentPerformanceChart evaluationScores={mockEvaluationScores} />,
    );

    const chart = screen.getByTestId('line-chart');
    const initialData = chart.getAttribute('data-chart-data');

    // Click on 1 Day interval
    fireEvent.click(screen.getByText('1 Day'));

    // Re-render to get updated chart data
    rerender(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const updatedChart = screen.getByTestId('line-chart');
    const updatedData = updatedChart.getAttribute('data-chart-data');

    // Data should change when interval changes
    expect(updatedData).not.toBe(initialData);
  });

  it('should aggregate data across all skills', () => {
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    // Should have datasets
    expect(chartData.datasets).toBeDefined();
    expect(chartData.datasets.length).toBeGreaterThan(0);

    // Should have labels (time buckets)
    expect(chartData.labels).toBeDefined();
    expect(chartData.labels.length).toBeGreaterThan(0);
  });

  it('should configure chart options correctly', () => {
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartOptions = JSON.parse(
      chart.getAttribute('data-chart-options') || '{}',
    );

    expect(chartOptions.responsive).toBe(true);
    expect(chartOptions.maintainAspectRatio).toBe(false);
    expect(chartOptions.scales.y.min).toBe(0);
    expect(chartOptions.scales.y.max).toBe(100);
  });

  it('should display default chart title correctly', () => {
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartOptions = JSON.parse(
      chart.getAttribute('data-chart-options') || '{}',
    );

    expect(chartOptions.plugins.title.display).toBe(true);
    expect(chartOptions.plugins.title.text).toBe(
      'Agent Performance Over Time (All Skills)',
    );
  });

  it('should display custom chart title when provided', () => {
    const customTitle = 'Custom Performance Chart';
    render(
      <AgentPerformanceChart
        evaluationScores={mockEvaluationScores}
        title={customTitle}
      />,
    );

    const chart = screen.getByTestId('line-chart');
    const chartOptions = JSON.parse(
      chart.getAttribute('data-chart-options') || '{}',
    );

    expect(chartOptions.plugins.title.text).toBe(customTitle);
  });

  it('crosses the left edge at the slope of the point before the window', () => {
    render(
      <AgentPerformanceChart
        evaluationScores={[
          // An hour before the window opens, and well inside it: the line
          // enters the chart on the segment between the two.
          {
            time_bucket: bucketAt(25),
            skill_id: mockSkillId,
            avg_score: 0.5,
            count: 1,
          },
          {
            time_bucket: bucketAt(21),
            skill_id: mockSkillId,
            avg_score: 0.9,
            count: 1,
          },
        ]}
      />,
    );

    // 50 an hour before the window, 90 three hours into it: ten points an
    // hour, so the segment stands at 60 where it crosses the edge.
    const [skill] = rendered.data.datasets;
    expect(skill.data[0]).toBeCloseTo(60, 6);
    expect(skill.edges?.has(0)).toBe(true);
    // A real segment between two scores, so the line enters solid
    const entering = skill.data.findIndex(
      (value, index) => index > 0 && value !== null,
    );
    expect(dashAt(skill, entering)).toBeUndefined();
    // The edge is where the line is, not a bucket that was scored: no marker,
    // and the tooltip has nothing to say about it.
    expect(radiusAt(skill, 0)).toBe(0);
    expect(
      rendered.options.plugins.tooltip.filter({
        datasetIndex: 0,
        dataIndex: 0,
      }),
    ).toBe(false);
  });

  it('leaves a line that nothing precedes starting where its first score is', () => {
    render(
      <AgentPerformanceChart
        evaluationScores={[
          {
            time_bucket: bucketAt(21),
            skill_id: mockSkillId,
            avg_score: 0.9,
            count: 1,
          },
        ]}
      />,
    );

    // Nothing is known before a skill's first score, so the left edge is
    // where the line starts, not where it enters.
    const [skill] = rendered.data.datasets;
    expect(skill.data[0]).toBeNull();
    expect(skill.edges?.has(0)).toBe(false);
  });

  it('carries a skill quiet since before the window across it, dashed', () => {
    render(
      <AgentPerformanceChart
        evaluationScores={[
          {
            time_bucket: bucketAt(40),
            skill_id: mockSkillId,
            avg_score: 0.9,
            count: 1,
          },
        ]}
      />,
    );

    // The skill scored nothing inside the window, and would have been absent
    // from the chart altogether; its last score stands instead.
    const [skill] = rendered.data.datasets;
    const last = skill.data.length - 1;
    expect(skill.data[0]).toBeCloseTo(90, 6);
    expect(skill.data[last]).toBeCloseTo(90, 6);
    // Carried the whole way, so the whole line is dashed
    expect(dashAt(skill, last)).toEqual([6, 4]);
    expect(skill.edges).toEqual(new Set([0, last]));
  });

  it('drops the skills that scored nothing in the window when asked to', () => {
    const quiet = {
      time_bucket: bucketAt(40),
      skill_id: mockSkillId,
      avg_score: 0.9,
      count: 1,
    };
    const active = {
      time_bucket: bucketAt(2),
      skill_id: '123e4567-e89b-12d3-a456-426614174111',
      avg_score: 0.5,
      count: 1,
    };

    const { rerender } = render(
      <AgentPerformanceChart evaluationScores={[quiet, active]} />,
    );
    expect(rendered.data.datasets).toHaveLength(3); // both skills, plus Events
    const activeColor = rendered.data.datasets[1].borderColor;

    rerender(
      <AgentPerformanceChart
        evaluationScores={[quiet, active]}
        showQuietSkills={false}
      />,
    );

    // Only the carried-across skill goes; the one with scores keeps both its
    // place and its colour, so the toggle changes what is drawn and not how.
    expect(rendered.data.datasets).toHaveLength(2);
    expect(rendered.data.datasets[0].borderColor).toBe(activeColor);
    expect(rendered.data.datasets[0].data.some((v) => v !== null)).toBe(true);
  });

  it('says when a carried value was last measured, and stays quiet at a crossing', () => {
    render(
      <AgentPerformanceChart
        evaluationScores={[
          {
            time_bucket: bucketAt(40),
            skill_id: mockSkillId,
            avg_score: 0.9,
            count: 1,
          },
        ]}
      />,
    );

    const [skill] = rendered.data.datasets;
    const last = skill.data.length - 1;
    const tooltip = rendered.options.plugins.tooltip;

    // A carried value is reported: the dash says it was not measured here,
    // and this says when it was.
    expect(tooltip.filter({ datasetIndex: 0, dataIndex: last })).toBe(true);
    const line = tooltip.callbacks.label({
      dataset: { label: skill.label },
      parsed: { y: 90 },
      datasetIndex: 0,
      dataIndex: last,
    });
    expect(line).toContain('last scored');
    // Not today, so it is named by date rather than by clock time
    expect(line).toMatch(/last scored [A-Z][a-z]{2} \d{1,2}/);
  });

  it('draws the measured stretch of a line solid and the carried one dashed', () => {
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const [skill] = rendered.data.datasets;
    const measured = skill.data.findIndex((value) => value !== null);
    expect(dashAt(skill, measured)).toBeUndefined();
    expect(dashAt(skill, skill.data.length - 1)).toEqual([6, 4]);
  });

  it('should span gaps in data correctly', () => {
    render(<AgentPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    const dataset = chartData.datasets[0];
    expect(dataset.spanGaps).toBe(true);
  });
});
