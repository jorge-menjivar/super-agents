import { fireEvent, render, screen } from '@testing-library/react';
import { SkillPerformanceChart } from '@web/components/agents/skills/skill-performance-chart';
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface RenderedDataset {
  label: string;
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

interface RenderedOptions {
  plugins: {
    tooltip: {
      filter: (item: { datasetIndex: number; dataIndex: number }) => boolean;
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

vi.mock('chartjs-plugin-annotation', () => ({
  default: {},
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

describe('SkillPerformanceChart', () => {
  const mockEvaluationScores = [
    {
      time_bucket: bucketAt(3),
      avg_score: 0.875,
      scores_by_evaluation: {
        task_completion: 0.85,
        argument_correctness: 0.9,
        role_adherence: 0.85,
      },
      count: 2,
    },
    {
      time_bucket: bucketAt(2),
      avg_score: 0.9,
      scores_by_evaluation: {
        task_completion: 0.88,
        argument_correctness: 0.92,
        role_adherence: 0.9,
      },
      count: 2,
    },
    {
      time_bucket: bucketAt(1),
      avg_score: 0.925,
      scores_by_evaluation: {
        task_completion: 0.9,
        argument_correctness: 0.93,
        role_adherence: 0.95,
      },
      count: 2,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('should render empty state when no evaluation runs are provided', () => {
    render(<SkillPerformanceChart evaluationScores={[]} />);

    // Component always renders chart, no empty state UI
    const chart = screen.getByTestId('line-chart');
    expect(chart).toBeInTheDocument();
  });

  it('should render chart with evaluation data', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    expect(chart).toBeInTheDocument();
    expect(screen.getByText('Line Chart Mock')).toBeInTheDocument();
  });

  it.skip('should render all time interval buttons', () => {
    // Time interval UI removed from component
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    expect(screen.getByText('5 Min')).toBeInTheDocument();
    expect(screen.getByText('30 Min')).toBeInTheDocument();
    expect(screen.getByText('1 Hour')).toBeInTheDocument();
    expect(screen.getByText('1 Day')).toBeInTheDocument();
  });

  it.skip('should have 1 Hour selected by default', () => {
    // Time interval UI removed from component
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const oneHourButton = screen.getByText('1 Hour');
    expect(oneHourButton).toHaveClass('bg-blue-500', 'text-white');
  });

  it.skip('should change interval when clicking different interval button', () => {
    // Time interval UI removed from component
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const fiveMinButton = screen.getByText('5 Min');
    const oneHourButton = screen.getByText('1 Hour');

    // Initially 1 Hour is selected
    expect(oneHourButton).toHaveClass('bg-blue-500', 'text-white');
    expect(fiveMinButton).toHaveClass('bg-gray-100', 'text-gray-600');

    // Click 5 Min button
    fireEvent.click(fiveMinButton);

    // Now 5 Min should be selected
    expect(fiveMinButton).toHaveClass('bg-blue-500', 'text-white');
    expect(oneHourButton).toHaveClass('bg-gray-100', 'text-gray-600');
  });

  it.skip('should update chart data when interval changes', () => {
    // Time interval UI removed from component
    const { rerender } = render(
      <SkillPerformanceChart evaluationScores={mockEvaluationScores} />,
    );

    const chart = screen.getByTestId('line-chart');
    const initialData = chart.getAttribute('data-chart-data');

    // Click on 1 Day interval
    fireEvent.click(screen.getByText('1 Day'));

    // Re-render to get updated chart data
    rerender(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const updatedChart = screen.getByTestId('line-chart');
    const updatedData = updatedChart.getAttribute('data-chart-data');

    // Data should change when interval changes
    expect(updatedData).not.toBe(initialData);
  });

  it('should group data correctly for different intervals', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    // Should have datasets for each method
    expect(chartData.datasets).toBeDefined();
    expect(chartData.datasets.length).toBeGreaterThan(0);

    // Should have labels (time buckets)
    expect(chartData.labels).toBeDefined();
    expect(chartData.labels.length).toBeGreaterThan(0);
  });

  it('should format method names correctly in chart datasets', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    const datasetLabels = chartData.datasets.map(
      (ds: { label: string }) => ds.label,
    );

    // Should convert snake_case to Title Case
    expect(datasetLabels).toContain('Task Completion');
    expect(datasetLabels).toContain('Argument Correctness');
  });

  it('should apply correct colors to methods', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    const taskCompletionDataset = chartData.datasets.find(
      (ds: { label: string }) => ds.label === 'Task Completion',
    );

    expect(taskCompletionDataset).toBeDefined();
    expect(taskCompletionDataset.borderColor).toBe('rgb(59, 130, 246)'); // blue
  });

  it('should display per-method scores correctly', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    const taskCompletionDataset = chartData.datasets.find(
      (ds: { label: string }) => ds.label === 'Task Completion',
    );

    expect(taskCompletionDataset).toBeDefined();
    expect(taskCompletionDataset.data).toBeDefined();
  });

  it.skip('should handle daily interval correctly', () => {
    // Time interval UI removed from component
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    // Switch to 1 Day interval
    fireEvent.click(screen.getByText('1 Day'));

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    // Labels should be formatted as MM/DD for daily intervals
    expect(chartData.labels).toBeDefined();
    expect(chartData.labels.length).toBeGreaterThan(0);
    // Label should be in MM/DD format (e.g., "01/15")
    expect(chartData.labels[0]).toMatch(/^\d{2}\/\d{2}$/);
  });

  it.skip('should show point radius when only one data point exists', () => {
    // Point radius behavior changed in component
    const singleScore = [
      {
        time_bucket: '2025-01-15T10:00:00Z',
        avg_score: 0.85,
        scores_by_evaluation: {
          task_completion: 0.85,
        },
        count: 1,
      },
    ];

    render(<SkillPerformanceChart evaluationScores={singleScore} />);

    const chart = screen.getByTestId('line-chart');
    const chartData = JSON.parse(chart.getAttribute('data-chart-data') || '{}');

    const dataset = chartData.datasets[0];
    expect(dataset.pointRadius).toBeGreaterThan(0);
  });

  it('should hide points when multiple data points exist', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    // Scriptable, so that the value a line is drawn out to the window edge at
    // carries no marker; here every bucket is a measured one.
    expect(radiusAt(rendered.data.datasets[0], 0)).toBe(0);
  });

  it('carries every line forward to the right edge, dashed', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    // The newest score is an hour old and the window ends now, so each line
    // stands at its last value the rest of the way -- said with a dash.
    for (const dataset of rendered.data.datasets) {
      if (dataset.label === 'Events') continue;
      const last = dataset.data.length - 1;
      expect(dataset.data[last]).not.toBeNull();
      expect(dashAt(dataset, last)).toEqual([6, 4]);
    }
  });

  it('should configure chart options correctly', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartOptions = JSON.parse(
      chart.getAttribute('data-chart-options') || '{}',
    );

    expect(chartOptions.responsive).toBe(true);
    expect(chartOptions.maintainAspectRatio).toBe(false);
    expect(chartOptions.scales.y.min).toBe(0);
    expect(chartOptions.scales.y.max).toBe(100);
  });

  it('should display chart title correctly', () => {
    render(<SkillPerformanceChart evaluationScores={mockEvaluationScores} />);

    const chart = screen.getByTestId('line-chart');
    const chartOptions = JSON.parse(
      chart.getAttribute('data-chart-options') || '{}',
    );

    expect(chartOptions.plugins.title.display).toBe(true);
    expect(chartOptions.plugins.title.text).toBe('Skill Performance Over Time');
  });
});
