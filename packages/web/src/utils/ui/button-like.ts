import { cn } from '@web/utils/ui/utils';
import type { KeyboardEvent } from 'react';

/** The two keys that press a button, per the ARIA button pattern. */
const ACTIVATION_KEYS = new Set(['Enter', ' ']);

/** How a card says it has focus, matching the ring every real button draws. */
const FOCUS_RING =
  'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

export interface ButtonLikeProps {
  role: 'button';
  tabIndex: 0;
  'aria-label'?: string;
  className: string;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * What a card needs to be the button it already looks like.
 *
 * A `<Card onClick>` is a div wearing a pointer cursor: it cannot be tabbed
 * to, Enter and Space do nothing on it, and a keyboard-driven browser cannot
 * find it at all -- React delegates the click at the root, so there is no
 * `onclick` attribute in the DOM for anything to see. The card is reachable
 * only by pointer, which is no way to reach it.
 *
 * `label` is worth giving whenever the card holds more than a line of text:
 * without one the button is named by everything inside it, and a card with a
 * chart in it announces the chart.
 */
export function buttonLike({
  onActivate,
  label,
  className,
}: {
  onActivate: () => void;
  label?: string;
  className?: string;
}): ButtonLikeProps {
  return {
    role: 'button',
    tabIndex: 0,
    ...(label ? { 'aria-label': label } : {}),
    className: cn(FOCUS_RING, className),
    onClick: onActivate,
    onKeyDown: (event) => {
      if (!ACTIVATION_KEYS.has(event.key)) return;
      // A control inside the card keeps its own keys: Space on a button in
      // here is that button's, not the card's.
      if (event.target !== event.currentTarget) return;
      // Space would otherwise scroll the page.
      event.preventDefault();
      onActivate();
    },
  };
}
