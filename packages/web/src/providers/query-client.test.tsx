import { QueryClient, useQueryClient } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { ReactQueryProvider } from '@web/providers/query-client';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

// Mock the toast hook
vi.mock('@web/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function TestComponent(): React.ReactElement {
  const queryClient = useQueryClient();
  const defaultOptions = queryClient.getDefaultOptions();

  return (
    <div>
      <div data-testid="query-client-exists">
        {queryClient instanceof QueryClient ? 'true' : 'false'}
      </div>
      <div data-testid="stale-time">
        {defaultOptions.queries?.staleTime?.toString()}
      </div>
      <div data-testid="gc-time">
        {defaultOptions.queries?.gcTime?.toString()}
      </div>
      <div data-testid="refetch-on-window-focus">
        {defaultOptions.queries?.refetchOnWindowFocus?.toString()}
      </div>
      <div data-testid="retry">{defaultOptions.queries?.retry?.toString()}</div>
    </div>
  );
}

function BadComponent(): React.ReactElement | null {
  useQueryClient();
  return null;
}

function ErrorComponent(): React.ReactElement {
  throw new Error('Test component error');
}

function MutationTestComponent(): React.ReactElement {
  const queryClient = useQueryClient();
  const defaultOptions = queryClient.getDefaultOptions();

  return (
    <div>
      <div data-testid="mutation-retry">
        {defaultOptions.mutations?.retry?.toString() ?? 'not set'}
      </div>
    </div>
  );
}

describe('ReactQueryProvider', (): void => {
  it('provides a QueryClient with correct default options', (): void => {
    render(
      <ReactQueryProvider>
        <TestComponent />
      </ReactQueryProvider>,
    );

    expect(screen.getByTestId('query-client-exists').textContent).toBe('true');
    expect(screen.getByTestId('stale-time').textContent).toBe('60000');
    expect(screen.getByTestId('gc-time').textContent).toBe('300000');
    expect(screen.getByTestId('refetch-on-window-focus').textContent).toBe(
      'true',
    );
    expect(screen.getByTestId('retry').textContent).toBe('1');
  });

  it('renders children correctly', (): void => {
    render(
      <ReactQueryProvider>
        <div data-testid="child">Test Child</div>
      </ReactQueryProvider>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByTestId('child').textContent).toBe('Test Child');
  });

  it('provides the same QueryClient instance on multiple renders', (): void => {
    const { rerender } = render(
      <ReactQueryProvider>
        <TestComponent />
      </ReactQueryProvider>,
    );

    const firstClientExists = screen.getByTestId(
      'query-client-exists',
    ).textContent;

    rerender(
      <ReactQueryProvider>
        <TestComponent />
      </ReactQueryProvider>,
    );

    const secondClientExists = screen.getByTestId(
      'query-client-exists',
    ).textContent;

    expect(firstClientExists).toBe('true');
    expect(secondClientExists).toBe('true');
  });

  it('throws error when useQueryClient is used outside provider', (): void => {
    expect(() => render(<BadComponent />)).toThrow();
  });

  it('handles component errors gracefully with error boundary', (): void => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      // Suppress console errors in tests
    });

    render(
      <ReactQueryProvider>
        <ErrorComponent />
      </ReactQueryProvider>,
    );

    expect(screen.getByText('Data loading error')).toBeInTheDocument();
    expect(
      screen.getByText('There was a problem loading the application data.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Reload page')).toBeInTheDocument();

    consoleSpy.mockRestore();
  });

  it('configures mutation retry in default options', (): void => {
    render(
      <ReactQueryProvider>
        <MutationTestComponent />
      </ReactQueryProvider>,
    );

    expect(screen.getByTestId('mutation-retry').textContent).toBe('1');
  });
});
