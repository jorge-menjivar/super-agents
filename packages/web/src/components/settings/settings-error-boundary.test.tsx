import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsErrorBoundary } from '@web/components/settings/settings-error-boundary';
import type React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Component that throws an error
const ThrowError: React.FC<{ shouldThrow: boolean }> = ({ shouldThrow }) => {
  if (shouldThrow) {
    throw new Error('Test settings error');
  }
  return <div>Settings loaded successfully</div>;
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
  return <div>Settings loaded successfully</div>;
};

describe('SettingsErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {
      // Intentionally empty to suppress console errors in tests
    });
  });

  it('renders children when there is no error', () => {
    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={false} />
      </SettingsErrorBoundary>,
    );

    expect(
      screen.getByText('Settings loaded successfully'),
    ).toBeInTheDocument();
  });

  it('renders error UI when child component throws', () => {
    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    expect(screen.getByText('Failed to Load Settings')).toBeInTheDocument();
    expect(
      screen.getByText(/We encountered an error while loading/),
    ).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('Go to Dashboard')).toBeInTheDocument();
  });

  it('displays helpful troubleshooting tips', () => {
    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    expect(
      screen.getByText('Refresh the page to try loading again'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Check your network connection'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Verify the database is accessible'),
    ).toBeInTheDocument();
  });

  it('resets error state when Try Again is clicked', () => {
    const failing = { current: true };

    render(
      <SettingsErrorBoundary>
        <ThrowsUntilFixed failing={failing} />
      </SettingsErrorBoundary>,
    );

    expect(screen.getByText('Failed to Load Settings')).toBeInTheDocument();

    failing.current = false;
    const retryButton = screen.getByText('Try Again');
    fireEvent.click(retryButton);

    expect(
      screen.getByText('Settings loaded successfully'),
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
      <SettingsErrorBoundary fallback={customFallback}>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    expect(
      screen.getByText('Custom error: Test settings error'),
    ).toBeInTheDocument();
    expect(screen.getByText('Custom Reset')).toBeInTheDocument();
  });

  it('logs error to console', () => {
    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalledWith(
      'Settings error:',
      expect.objectContaining({
        error: 'Error: Test settings error',
        timestamp: expect.any(String),
      }),
    );
  });

  it('marks performance when error occurs', () => {
    const performanceMark = vi.spyOn(performance, 'mark');

    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    expect(performanceMark).toHaveBeenCalledWith('settings-error');
  });

  it('shows error details in development mode', () => {
    vi.stubEnv('NODE_ENV', 'development');

    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    expect(
      screen.getByText('Error Details (Development Only)'),
    ).toBeInTheDocument();

    vi.unstubAllEnvs();
  });

  it('hides error details in production mode', () => {
    vi.stubEnv('NODE_ENV', 'production');

    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    expect(
      screen.queryByText('Error Details (Development Only)'),
    ).not.toBeInTheDocument();

    vi.unstubAllEnvs();
  });

  it('includes dashboard link in error UI', () => {
    render(
      <SettingsErrorBoundary>
        <ThrowError shouldThrow={true} />
      </SettingsErrorBoundary>,
    );

    const dashboardLink = screen.getByRole('link', {
      name: /Go to Dashboard/i,
    });
    expect(dashboardLink).toHaveAttribute('href', '/');
  });
});
