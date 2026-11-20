import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '@web/components/error-boundary';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

function ThrowError({
  shouldThrow,
}: {
  shouldThrow: boolean;
}): React.ReactElement {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>Working component</div>;
}

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
  return <div>Working component</div>;
};

describe('ErrorBoundary', (): void => {
  it('renders children when no error occurs', (): void => {
    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Working component')).toBeInTheDocument();
  });

  it('catches errors and displays default error UI', (): void => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText('An error occurred while loading this component.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Try again')).toBeInTheDocument();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('displays custom fallback when provided', (): void => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });
    const customFallback = (error: Error) => (
      <div>Custom error: {error.message}</div>
    );

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Custom error: Test error')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('calls onError callback when error occurs', (): void => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });
    const onError = vi.fn();

    render(
      <ErrorBoundary onError={onError}>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        componentStack: expect.any(String),
      }),
    );

    consoleSpy.mockRestore();
  });

  it('resets error state when try again is clicked', (): void => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });
    const failing = { current: true };

    render(
      <ErrorBoundary>
        <ThrowsUntilFixed failing={failing} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Reset error state and component state
    failing.current = false;
    fireEvent.click(screen.getByText('Try again'));

    // The error boundary should have reset its error state
    expect(screen.getByText('Working component')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('shows error details in collapsible section', (): void => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    render(
      <ErrorBoundary>
        <ThrowError shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Error details')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Error details'));

    expect(screen.getByText('Test error')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });
});
