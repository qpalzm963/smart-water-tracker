import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HydrationScene } from '../src/views/dashboard/HydrationScene';

describe('HydrationScene', () => {
  it('renders the lightweight SVG water glass without a WebGL canvas', () => {
    const markup = renderToStaticMarkup(<HydrationScene progress={0.71} />);

    expect(markup).toContain('<svg');
    expect(markup).toContain('water-glass');
    expect(markup).not.toContain('<canvas');
  });
});
