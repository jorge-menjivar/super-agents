'use client';

import type { ReactElement } from 'react';
import { useEffect, useRef } from 'react';

/**
 * The request's own embedding, drawn.
 *
 * Routing is decided in a space nobody can look at: a few thousand numbers
 * the request was turned into, compared against each skill's centroids. The
 * scores say how that came out; this says what was compared. Every dimension
 * gets one cell, in order, so nothing is summarised away -- two requests that
 * routed to the same skill look alike, and one that did not, does not.
 *
 * It is a fingerprint, not a map: cells next to each other are neighbours in
 * the vector, which means nothing in the space itself.
 */

/** The side of one dimension's cell, in CSS pixels. */
const CELL = 3;

/** Below zero and above it. The page's own two colours. */
const BELOW = '13, 148, 136';
const ABOVE = '217, 119, 6';

/** A grid a little wider than it is tall, holding every dimension. */
export function gridFor(count: number): { columns: number; rows: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt((count * 4) / 3)));
  return { columns, rows: Math.ceil(count / columns) };
}

export function EmbeddingFingerprint({
  values,
}: {
  values: number[];
}): ReactElement | null {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { columns, rows } = gridFor(values.length);
  const width = columns * CELL;
  const height = rows * CELL;

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    // jsdom has no canvas, and a browser can refuse a context under memory
    // pressure. Neither is worth losing the panel over.
    if (!context) return;

    const ratio = window.devicePixelRatio || 1;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const largest = values.reduce(
      (peak, value) => Math.max(peak, Math.abs(value)),
      0,
    );
    if (largest === 0) return;

    values.forEach((value, index) => {
      // Against the largest alone almost every cell is faint, since an
      // embedding's values cluster well below its peak. The square root
      // lifts the middle of the range without touching either end.
      const weight = Math.sqrt(Math.abs(value) / largest);
      context.fillStyle = `rgba(${value < 0 ? BELOW : ABOVE}, ${weight.toFixed(3)})`;
      context.fillRect(
        (index % columns) * CELL,
        Math.floor(index / columns) * CELL,
        CELL - 0.5,
        CELL - 0.5,
      );
    });
  }, [values, columns, width, height]);

  if (values.length === 0) return null;

  const ratio =
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  return (
    <figure className="m-0 flex flex-col gap-1.5" style={{ width }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label={`The request's embedding: ${values.length} dimensions, each drawn as one cell`}
        width={Math.round(width * ratio)}
        height={Math.round(height * ratio)}
        style={{ width, height }}
        className="rounded-sm border bg-muted/30"
      />
      <figcaption className="text-[11px] text-muted-foreground">
        {values.length.toLocaleString()} dimensions, one cell each. Teal is
        below zero, amber above.
      </figcaption>
    </figure>
  );
}
