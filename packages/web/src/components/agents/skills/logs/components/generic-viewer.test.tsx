import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next-themes', () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: 'light' })),
}));

// The editors are lazy, heavy, and not what these tests are about: what
// matters is which one a language picks and what value it is handed.
vi.mock(
  '@web/components/agents/skills/logs/components/text-viewer.lazy',
  () => ({
    LazyTextViewer: ({ content }: { content: string }) => (
      <div data-testid="text-viewer">{content}</div>
    ),
  }),
);
vi.mock('@web/components/monaco-editor', () => ({
  MonacoEditor: ({ value }: { value: string }) => (
    <div data-testid="monaco">{value}</div>
  ),
}));

import { GenericViewer } from '@web/components/agents/skills/logs/components/generic-viewer';

const viewer = (
  props: Partial<React.ComponentProps<typeof GenericViewer>> = {},
) => (
  <GenericViewer
    path="log-1-system"
    language="text"
    defaultValue="You are a concierge."
    readOnly={true}
    {...props}
  >
    <div>System</div>
  </GenericViewer>
);

describe('GenericViewer', () => {
  it('reads text through the text viewer', () => {
    render(viewer());

    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByTestId('text-viewer')).toHaveTextContent(
      'You are a concierge.',
    );
  });

  it('reads a structured answer through the editor', () => {
    render(viewer({ language: 'json', defaultValue: '{"score":0.9}' }));

    expect(screen.getByText('JSON')).toBeInTheDocument();
    expect(screen.getByTestId('monaco')).toHaveTextContent('{"score":0.9}');
    expect(screen.queryByTestId('text-viewer')).not.toBeInTheDocument();
  });

  it.each([
    'https://json-schema.org/draft/2020-12/schema',
    'http://json-schema.org/draft-07/schema#',
  ])('validates against a schema written for %s', ($schema) => {
    render(
      viewer({
        language: 'json',
        defaultValue: '{"score":0.9}',
        rawSchema: {
          $schema,
          type: 'object',
          properties: { score: { type: 'number' } },
          required: ['score'],
        } as never,
      }),
    );

    expect(screen.queryByText(/^schema is invalid: /)).not.toBeInTheDocument();
    // A schema that compiled formats the answer it validated.
    expect(screen.getByTestId('monaco')).toHaveTextContent('"score": 0.9');
  });

  it('collapses to a preview of the prompt', () => {
    render(viewer());

    fireEvent.click(screen.getByRole('button', { expanded: true }));

    expect(screen.queryByTestId('text-viewer')).not.toBeInTheDocument();
    // The role label stays, so a collapsed card is still identifiable.
    expect(screen.getByText('System')).toBeInTheDocument();
    expect(screen.getByText('You are a concierge.')).toBeInTheDocument();
  });

  it('starts collapsed when asked, as the original system prompt does', () => {
    render(viewer({ defaultCollapsed: true }));

    expect(screen.queryByTestId('text-viewer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: false }));

    expect(screen.getByTestId('text-viewer')).toBeInTheDocument();
  });

  it("tints the agent's answer", () => {
    const { container, rerender } = render(viewer());
    expect(container.firstElementChild?.className).not.toContain('emerald');

    rerender(viewer({ variant: 'response' }));

    expect(container.firstElementChild?.className).toContain('bg-emerald');
  });

  it('copies what is on screen', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    render(viewer());
    const [, copy] = screen.getAllByRole('button');
    fireEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith('You are a concierge.');
  });

  it('reports a schema it could not compile, and hides it when collapsed', () => {
    render(
      viewer({
        language: 'json',
        defaultValue: '{}',
        rawSchema: { type: 'not-a-type' } as never,
      }),
    );

    const complaint = screen.getByText(/^schema is invalid: /);
    expect(complaint).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { expanded: true }));

    expect(complaint).not.toBeInTheDocument();
  });
});
