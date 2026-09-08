import { render, screen } from '@testing-library/react';
import {
  EmbeddingFingerprint,
  gridFor,
} from '@web/components/agents/skills/logs/components/embedding-fingerprint';
import { describe, expect, it } from 'vitest';

describe('gridFor', () => {
  it('holds every dimension, in a grid a little wider than it is tall', () => {
    // The embedding models in use are 3072 and 1536 dimensions.
    expect(gridFor(3_072)).toEqual({ columns: 64, rows: 48 });
    expect(gridFor(1_536)).toEqual({ columns: 46, rows: 34 });
    for (const count of [1, 7, 384, 1_536, 3_072]) {
      const { columns, rows } = gridFor(count);
      expect(columns * rows).toBeGreaterThanOrEqual(count);
    }
  });
});

describe('EmbeddingFingerprint', () => {
  it('draws a cell per dimension, and says how many there were', () => {
    const values = Array.from({ length: 3_072 }, (_, i) => Math.sin(i) / 10);
    render(<EmbeddingFingerprint values={values} />);

    const drawing = screen.getByRole('img', { name: /3072 dimensions/ });
    // 64 columns and 48 rows of 3px cells.
    expect(drawing).toHaveStyle({ width: '192px', height: '144px' });
    expect(screen.getByText(/3,072 dimensions, one cell each/)).toBeVisible();
  });

  it('draws nothing at all when the request was never embedded', () => {
    const { container } = render(<EmbeddingFingerprint values={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
