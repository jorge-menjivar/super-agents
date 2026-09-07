import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { useEditor } = vi.hoisted(() => ({ useEditor: vi.fn() }));
vi.mock('@tiptap/react', () => ({
  useEditor,
  EditorContent: () => <div data-testid="editor" />,
}));

import { TextViewer } from '@web/components/agents/skills/logs/components/text-viewer';

const setContent = vi.fn();
const chain = () => ({ focus: () => ({ run: vi.fn() }) });

const live = () => ({ isDestroyed: false, commands: { setContent }, chain });

/**
 * What `useEditor` hands out around a hide and restore: the instance it has
 * already destroyed. TipTap 3.31 nulls the command manager on destroy and
 * its `commands` getter reads it unguarded.
 */
const destroyed = () => ({
  isDestroyed: true,
  get commands(): { setContent: typeof setContent } {
    throw new TypeError(
      'can\'t access property "commands", this.commandManager is null',
    );
  },
  chain,
});

describe('TextViewer', () => {
  it('sets the content on a live editor', () => {
    useEditor.mockReturnValue(live());

    render(<TextViewer content="hello" readOnly />);

    expect(setContent).toHaveBeenCalledWith('hello');
  });

  it('leaves a destroyed editor alone instead of crashing the page', () => {
    useEditor.mockReturnValue(destroyed());

    expect(() =>
      render(<TextViewer content="hello" defaultContent="hi" readOnly />),
    ).not.toThrow();
  });
});
