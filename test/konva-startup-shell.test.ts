// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createTopologyStartupShell, previewWaitMs } from '../src/experiments/konva-canvas/startup-shell';

function shellFor(query = '?source=local', navigationStartedAt = 1_000, bootTime = navigationStartedAt, waitMs = 0) {
  vi.useFakeTimers();
  vi.setSystemTime(bootTime);
  const doc = document;
  doc.documentElement.dataset.topologyRealMode = String(query.includes('source=local'));
  doc.body.innerHTML = `
    <p><span data-fixture-summary aria-hidden="true"></span><span data-topology-short-summary></span><span data-topology-accessible-summary></span><span data-inventory-scope>HTTP advertisements only</span></p>
    <div data-topology-scrim><span class="topology-startup-bar"></span><p data-topology-status></p><button data-topology-show-now>Show now</button></div>
    <button data-topology-show-all hidden>Show all discovered</button>
    <button data-topology-arrange hidden>Arrange by connections</button>
    <div data-topology-activity role="img" tabindex="0" hidden><span class="topology-activity-dot"></span><span class="topology-activity-tooltip" data-topology-activity-tooltip hidden></span><span data-topology-counts></span></div>
  `;
  const shell = createTopologyStartupShell(doc, window, navigationStartedAt, waitMs);
  return { doc, shell };
}

describe('topology startup shell', () => {
  afterEach(() => { window.__topologyShowNowRequested = false; vi.useRealTimers(); vi.restoreAllMocks(); });

  it('allows only the three benchmark budgets in an explicit comparison build', () => {
    for (const budget of [0, 1500, 3000]) expect(previewWaitMs('konva-preview-test', String(budget))).toBe(budget);
    expect(previewWaitMs('production', '1500')).toBe(0);
    expect(previewWaitMs('development', '3000')).toBe(0);
    expect(previewWaitMs('konva-preview-test', '15')).toBe(0);
  });

  it('sets one absolute 1.5-second deadline and releases on Show now', () => {
    const { doc, shell } = shellFor('?source=local', 1000, 1000, 1500);
    expect(shell.previewDeadline).toBe(2_500);
    const show = doc.querySelector('[data-topology-show-now]')!;
    let activated = 0;
    shell.on('show-now', () => { activated += 1; });
    show.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(shell.showNowRequested).toBe(true);
    expect(doc.querySelector<HTMLElement>('[data-topology-status]')!.textContent).toBe('Waiting for node data…');
    expect(doc.querySelector<HTMLButtonElement>('[data-topology-show-now]')!.hidden).toBe(true);
    expect(activated).toBe(1);
  });

  it('preserves an early click through delayed shell boot and expires from navigation timeOrigin', () => {
    window.__topologyShowNowRequested = true;
    const early = shellFor();
    expect(early.shell.released).toBe(true);
    expect(early.shell.releaseReason).toBe('show-now');
    expect(early.doc.querySelector<HTMLButtonElement>('[data-topology-show-now]')!.hidden).toBe(true);

    window.__topologyShowNowRequested = false;
    const late = shellFor('?source=local', 1_000, 10_000);
    expect(late.shell.previewDeadline).toBe(1_000); // default: no intentional delay
    expect(late.shell.released).toBe(true);
    expect(late.shell.releaseReason).toBe('deadline');
    expect(late.doc.querySelector('[data-topology-status]')!.textContent).toBe('Waiting for node data…');
  });

  it('anchors the startup budget to navigation timeOrigin in the HTML preflight', async () => {
    const html = await readFile(resolve(process.cwd(), 'topology-canvas.html'), 'utf8');
    expect(html).toContain('String(performance.timeOrigin)');
    expect(html).not.toContain('performance.timeOrigin + performance.now()');
  });

  it('retains scrim until current generation paints; stale paint cannot dismiss it', () => {
    const { doc, shell } = shellFor();
    shell.release('show-now');
    const oldGeneration = shell.generation;
    const currentGeneration = shell.setGeneration();
    expect(shell.painted(oldGeneration)).toBe(false);
    expect(doc.querySelector<HTMLElement>('[data-topology-scrim]')!.hidden).toBe(false);
    expect(shell.painted(currentGeneration)).toBe(true);
    expect(doc.querySelector<HTMLElement>('[data-topology-scrim]')!.hidden).toBe(true);
  });

  it('keeps a compact focusable indicator with hover tooltip and accessible detailed counts', () => {
    const { doc, shell } = shellFor();
    shell.release('deadline');
    doc.querySelector<HTMLElement>('[data-fixture-summary]')!.textContent = '12 discovered · 5 shown · 4 inspected · 3 complete · 1 partial · 7 queued · 2 no-route · coverage limited · scheduler running';
    shell.update({ discovered: 12, shown: 5, inspected: 4, pending: 7, unsuccessful: 1, noRoute: 2, coverage: 'HTTP advertisements only' });
    const activity = doc.querySelector<HTMLElement>('[data-topology-activity]')!;
    expect(activity.hidden).toBe(false);
    expect(doc.querySelector('[data-topology-short-summary]')!.textContent).toBe('12 discovered · 5 shown');
    expect(activity.title).toBe('');
    expect(activity.getAttribute('aria-label')).toContain('2 without an advertised route');
    const tooltip = doc.querySelector<HTMLElement>('[data-topology-activity-tooltip]')!;
    expect(tooltip.textContent).toContain('12 discovered · 5 shown · 4 inspected');
    expect(tooltip.textContent).toContain('3 complete · 1 partial');
    expect(doc.querySelector('[data-topology-accessible-summary]')!.textContent).toContain('3 complete · 1 partial');
    expect(doc.querySelector('[data-inventory-scope]')!.textContent).toBe('HTTP advertisements only');
    vi.spyOn(activity, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, right: 30, bottom: 30 } as DOMRect);
    doc.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 15, clientY: 15 }));
    expect(tooltip.hidden).toBe(false); // Hover over the compact indicator reveals the count tooltip.
    doc.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 80, clientY: 80 }));
    expect(tooltip.hidden).toBe(true);
    activity.focus();
    expect(doc.activeElement).toBe(activity);
    expect(tooltip.hidden).toBe(false);
    shell.settled({ incomplete: true });
    expect(doc.querySelector('[data-topology-short-summary]')!.textContent).toBe('12 discovered · 5 shown · Coverage limited');
    expect(activity.hidden).toBe(true);
  });

  it.each([
    [{ emptyConfirmed: true }, 'No nodes found'],
    [{ failed: true }, 'Discovery unavailable'],
    [{ incomplete: true }, 'No nodes found · coverage incomplete']
  ])('distinguishes terminal empty state %j', (result, expected) => {
    const { doc, shell } = shellFor();
    shell.settled(result);
    expect(doc.querySelector('[data-topology-status]')!.textContent).toBe(expected);
    expect(doc.querySelector<HTMLElement>('[data-topology-scrim]')!.hidden).toBe(false);
    expect(doc.querySelector<HTMLElement>('.topology-startup-bar')!.hidden).toBe(true);
  });

  it('keeps synthetic mode network-neutral and hides all real-mode startup controls', () => {
    const { doc, shell } = shellFor('?nodes=450');
    expect(shell.isRealMode).toBe(false);
    expect(doc.querySelector<HTMLElement>('[data-topology-scrim]')!.hidden).toBe(true);
    shell.update({ discovered: 450, shown: 9, inspected: 1 });
    shell.setControls({ showAll: true, arrange: true });
    expect(doc.querySelector<HTMLButtonElement>('[data-topology-show-all]')!.hidden).toBe(true);
    expect(doc.querySelector<HTMLButtonElement>('[data-topology-arrange]')!.hidden).toBe(true);
  });

  it('keeps the already-painted scene visible on retained-document return', () => {
    const { doc, shell } = shellFor();
    shell.painted();
    const generation = shell.generation;
    shell.retain();
    expect(shell.generation).toBe(generation + 1);
    expect(doc.querySelector<HTMLElement>('[data-topology-scrim]')!.hidden).toBe(true);
    expect(doc.querySelector<HTMLElement>('[data-topology-activity]')!.hidden).toBe(true);
  });

  it('offers explicit session reveal and arrange controls through separate callbacks', () => {
    const { doc, shell } = shellFor();
    shell.update({ discovered: 12, shown: 5, inspected: 3 });
    expect(doc.querySelector<HTMLButtonElement>('[data-topology-show-all]')!.hidden).toBe(false);
    expect(doc.querySelector<HTMLButtonElement>('[data-topology-arrange]')!.hidden).toBe(false);
    const reveal = vi.fn();
    const arrange = vi.fn();
    shell.on('show-all-discovered', reveal);
    shell.on('arrange-by-connections', arrange);
    doc.querySelector<HTMLButtonElement>('[data-topology-show-all]')!.click();
    doc.querySelector<HTMLButtonElement>('[data-topology-arrange]')!.click();
    expect(reveal).toHaveBeenCalledOnce();
    expect(arrange).toHaveBeenCalledOnce();
  });

  it('uses a pointer-pass-through indicator and static reduced-motion treatment', async () => {
    const css = await readFile(resolve(process.cwd(), 'src/experiments/konva-canvas/style.css'), 'utf8');
    expect(css).toMatch(/\.topology-activity\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.topology-activity-dot\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/\.topology-activity-tooltip\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)[\s\S]*?\.topology-startup-bar::after, \.topology-activity-dot\s*\{\s*animation:\s*none;/);
  });
});
