'use client';

import { cn } from '@web/utils/ui/utils';
import { ChevronRight } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';

/**
 * One concern of a request, closed.
 *
 * The page carries several of these -- what the hooks made of the request,
 * how it was routed, what the judges scored it -- and they are read the
 * same way, so they are one component rather than three panels that each
 * invented their own. Closed by default: none of them is what the reader
 * came for, and open they push the conversation off the screen.
 *
 * The summary line has to be worth reading on its own, since it is what is
 * there when the strip is shut. `note` is that line: a verdict, a score, a
 * count -- not a label repeating the name.
 */
export function LogStrip({
  name,
  note,
  defaultOpen = false,
  children,
}: {
  name: string;
  /** The answer in a phrase, read while the strip is closed. */
  note: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}): ReactElement {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const headingId = useId();

  return (
    <div className="border-b">
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          'flex w-full flex-row items-center gap-2 px-4 py-2 text-left text-xs',
          'transition-colors hover:bg-muted/60 motion-reduce:transition-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        )}
      >
        {/* The same quarter turn the rows inside it use. */}
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground',
            'transition-transform duration-150 motion-reduce:transition-none',
            isOpen && 'rotate-90',
          )}
        />
        {/* The name alone labels the region, so it is reachable by it. */}
        <span id={headingId} className="w-24 shrink-0 font-medium">
          {name}
        </span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {note}
        </span>
      </button>
      {isOpen && (
        <section aria-labelledby={headingId} className="px-4 pb-3 pl-11">
          {children}
        </section>
      )}
    </div>
  );
}
