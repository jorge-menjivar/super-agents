import { fireEvent, render, screen } from '@testing-library/react';
import {
  AgentErrorBoundary,
  withAgentErrorBoundary,
} from '@web/components/agents/agent-error-boundary';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Component that throws an error
const ThrowError: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>Component rendered successfully</div>;
};

// Component for testing HOC
const TestComponent: React.FC = () => {
  return <div>Test Component</div>;
};

const ErrorComponent: React.FC = () => {
  throw new Error('HOC test error');
};

/**
 * Throws until the test sets `failing.current` to false. The flag is read on
 * each render, so the retry after it changes renders the component whole.
 */
const ThrowsUntilFixed: React.FC<{ failing: { current: boolean } }> = ({
  failing,
}) => {
  if (failing.current) {
    throw new Error('Test error');
  }
  return <div>Component rendered successfully</div>;
};

describe('AgentErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console.error to avoid test output noise
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Intentionally empty to suppress console errors in tests
    });
  });

  it('renders children when there is no error', () => {
    render(
      <AgentErrorBoundary>
        <ThrowError shouldThrow={false} />
      </AgentErrorBoundary>,
    );

    expect(
      screen.getByText('Component rendered successfully'),
    ).toBeInTheDocument();
  });

  it('renders error UI when child component throws', () => {
    render(
      <AgentErrorBoundary sectionName="Test Section">
        <ThrowError shouldThrow={true} />
      </AgentErrorBoundary>,
    );

    expect(screen.getByText(/Error in Test Section/)).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('resets error state when Try Again is clicked', () => {
    const failing = { current: true };

    render(
      <AgentErrorBoundary sectionName="Test Section">
        <ThrowsUntilFixed failing={failing} />
      </AgentErrorBoundary>,
    );

    expect(screen.getByText(/Error in Test Section/)).toBeInTheDocument();

    // Click Try Again - this should reset the error boundary
    failing.current = false; // Component won't throw on next render
    const retryButton = screen.getByText('Try Again');
    fireEvent.click(retryButton);

    // After clicking Try Again, the component should render successfully
    expect(
      screen.getByText('Component rendered successfully'),
    ).toBeInTheDocument();
  });

  it('uses custom fallback when provided', () => {
    const customFallback = (error: Error, resetError: () => void) => (
      <div>
        <p>Custom error: {error.message}</p>
        <button type="button" onClick={resetError}>
          Custom Reset
        </button>
      </div>
    );

    render(
      <AgentErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </AgentErrorBoundary>,
    );

    expect(screen.getByText('Custom error: Test error')).toBeInTheDocument();
    expect(screen.getByText('Custom Reset')).toBeInTheDocument();
  });

  it('logs error to console', () => {
    render(
      <AgentErrorBoundary sectionName="Test Section">
        <ThrowError shouldThrow={true} />
      </AgentErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      'Agent section error:',
      expect.objectContaining({
        section: 'Test Section',
        error: 'Error: Test error',
        timestamp: expect.any(String),
      }),
    );
  });

  it('marks performance when error occurs', () => {
    const performanceMark = vi.spyOn(performance, 'mark');

    render(
      <AgentErrorBoundary sectionName="Test Section">
        <ThrowError shouldThrow={true} />
      </AgentErrorBoundary>,
    );

    expect(performanceMark).toHaveBeenCalledWith('agent-error-Test Section');
  });

  it('shows error details in development mode', () => {
    // Mock NODE_ENV for test
    vi.stubEnv('NODE_ENV', 'development');

    render(
      <AgentErrorBoundary sectionName="Test Section">
        <ThrowError shouldThrow={true} />
      </AgentErrorBoundary>,
    );

    expect(
      screen.getByText('Error Details (Development Only)'),
    ).toBeInTheDocument();

    vi.unstubAllEnvs();
  });

  it('hides error details in production mode', () => {
    // Mock NODE_ENV for test
    vi.stubEnv('NODE_ENV', 'production');

    render(
      <AgentErrorBoundary sectionName="Test Section">
        <ThrowError shouldThrow={true} />
      </AgentErrorBoundary>,
    );

    expect(
      screen.queryByText('Error Details (Development Only)'),
    ).not.toBeInTheDocument();

    vi.unstubAllEnvs();
  });
});

describe('withAgentErrorBoundary HOC', () => {
  it('wraps component with error boundary', () => {
    const WrappedComponent = withAgentErrorBoundary(TestComponent, 'Test HOC');

    render(<WrappedComponent />);

    expect(screen.getByText('Test Component')).toBeInTheDocument();
  });

  it('catches errors in wrapped component', () => {
    const WrappedComponent = withAgentErrorBoundary(ErrorComponent, 'Test HOC');

    // Mock console.error to avoid test output noise
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Intentionally empty to suppress console errors in tests
    });

    render(<WrappedComponent />);

    expect(screen.getByText(/Error in Test HOC/)).toBeInTheDocument();
  });
});
