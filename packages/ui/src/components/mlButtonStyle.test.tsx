import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdjustmentSection } from './AdjustmentSection.js';

// Enabled ML vs Auto header buttons, rendered on the server (no jsdom): the
// enabled ML button used a much brighter gold treatment than the enabled
// Auto pill (denoise/straighten style), so the two looked unrelated. The
// enabled states are now the same declarations — this pins the CSS rules
// equal, pins that no ML-only active-hover override can diverge them again,
// and pins the markup contract (is-active + aria-pressed) the rules target.
// The idle ML button intentionally keeps its bold, letterspaced label.

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../../../../apps/web/src/index.css');
const css = () => readFileSync(cssPath, 'utf8');

const cssRule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css().match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
};

const normalize = (body: string): string => body.replace(/\s+/g, ' ').trim();

const noop = () => {};

function renderAction(kind: 'ml' | 'auto', applied: boolean): string {
  return renderToStaticMarkup(
    <AdjustmentSection
      title="White Balance"
      icon={null}
      ml={{ id: 'white-balance', kind, applied, onToggle: noop }}
    >
      <p>content</p>
    </AdjustmentSection>,
  );
}

describe('ml button enabled style', () => {
  it('styles the enabled ML button exactly like the enabled Auto button', () => {
    expect(normalize(cssRule('.ml-button.is-active'))).toBe(normalize(cssRule('.auto-small.is-active')));
  });

  it('has no ML-only active-hover override that could diverge hover-on-active', () => {
    expect(css()).not.toMatch(/\.ml-button\.is-active:hover/);
    expect(css()).not.toMatch(/\.auto-small\.is-active:hover/);
  });

  it('keeps the idle ML label bold and letterspaced', () => {
    expect(cssRule('.ml-button')).toContain('font-weight: 700');
    expect(cssRule('.ml-button')).toContain('letter-spacing: .04em');
  });

  it('marks the applied ML header action is-active with aria-pressed', () => {
    const html = renderAction('ml', true);
    expect(html).toContain('class="ml-button is-active" data-testid="white-balance-ml" aria-pressed="true"');
  });

  it('marks the applied Auto header action is-active with aria-pressed', () => {
    const html = renderAction('auto', true);
    expect(html).toContain('class="auto-small is-active" data-testid="white-balance-auto" aria-pressed="true"');
  });

  it('leaves both idle header actions without is-active', () => {
    expect(renderAction('ml', false)).toContain('class="ml-button" data-testid="white-balance-ml" aria-pressed="false"');
    expect(renderAction('auto', false)).toContain('class="auto-small" data-testid="white-balance-auto" aria-pressed="false"');
  });
});
