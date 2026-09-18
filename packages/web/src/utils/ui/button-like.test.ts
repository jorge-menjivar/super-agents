import { buttonLike } from '@web/utils/ui/button-like';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

/** A key press on the element the props were spread onto, unless said otherwise. */
const press = (key: string, from?: unknown): KeyboardEvent<HTMLElement> => {
  const currentTarget = {};
  return {
    key,
    currentTarget,
    target: from ?? currentTarget,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement>;
};

describe('buttonLike', () => {
  it('says what it is and can be tabbed to', () => {
    const props = buttonLike({ onActivate: vi.fn() });
    expect(props.role).toBe('button');
    expect(props.tabIndex).toBe(0);
  });

  it('is pressed by Enter and by Space', () => {
    for (const key of ['Enter', ' ']) {
      const onActivate = vi.fn();
      const event = press(key);
      buttonLike({ onActivate }).onKeyDown(event);
      expect(onActivate).toHaveBeenCalledOnce();
      // Space would otherwise scroll the page out from under the reader.
      expect(event.preventDefault).toHaveBeenCalled();
    }
  });

  it('ignores every other key', () => {
    const onActivate = vi.fn();
    const { onKeyDown } = buttonLike({ onActivate });
    for (const key of ['a', 'Tab', 'Escape', 'ArrowDown']) {
      onKeyDown(press(key));
    }
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('leaves a control inside it its own keys', () => {
    const onActivate = vi.fn();
    buttonLike({ onActivate }).onKeyDown(press(' ', { inner: true }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('is named only when the caller says so', () => {
    expect(buttonLike({ onActivate: vi.fn() })['aria-label']).toBeUndefined();
    expect(
      buttonLike({ onActivate: vi.fn(), label: 'triage skill' })['aria-label'],
    ).toBe('triage skill');
  });

  it('keeps the caller classes and adds a focus ring', () => {
    const { className } = buttonLike({
      onActivate: vi.fn(),
      className: 'cursor-pointer',
    });
    expect(className).toContain('cursor-pointer');
    expect(className).toContain('focus-visible:ring-[3px]');
  });
});
