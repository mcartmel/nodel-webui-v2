import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(import.meta.dirname, '../src/styles/40-core-administration.css'), 'utf8');
const fixture = readFileSync(resolve(import.meta.dirname, '../e2e/fixtures/admin-control-density-raw-hosts.html'), 'utf8');
const tailwind = readFileSync(resolve(import.meta.dirname, '../tailwind.config.ts'), 'utf8');

describe('admin control density contract', () => {
  it('scopes the compact default and explicit touch override to admin hosts and editor chrome', () => {
    expect(styles).toContain(':is(nodel-console, nodel-actsig, nodel-log, nodel-params, nodel-bindings, nodel-editor),');
    expect(styles).toContain(':is(nodel-console, nodel-actsig, nodel-log, nodel-params, nodel-bindings, nodel-editor).nodel-controls-touch');
    expect(styles).toContain(':is(nodel-console, nodel-actsig, nodel-log, nodel-params, nodel-bindings).nodel-controls-compact');
    expect(styles).toContain('.nodel-controls-compact');
    expect(styles).toContain('.nodel-controls-touch');
    expect(styles).toContain('--nodel-admin-control-min-height: 2.25rem');
    expect(styles).toContain('--nodel-admin-control-min-height: 3.5rem');
    expect(styles).toContain('--nodel-admin-control-padding-inline: 0.5rem');
    expect(styles).toContain('--nodel-admin-control-padding-inline: 0.75rem');
    expect(styles).not.toContain('--nodel-control-min-height');
    expect(styles).toContain('nodel-editor .nodel-editor-control');
    expect(styles).not.toContain('nodel-editor :is(\n    button');
    expect(styles).toMatch(/:is\(nodel-console, nodel-actsig, nodel-log, nodel-params, nodel-bindings\) :is\([\s\S]*?button:not\(\.nodel-menu-item\)/);
    expect(styles).not.toMatch(/nodel-editor\s+:is\(\s*button/);
    expect(tailwind).toContain("safelist: ['nodel-controls-compact', 'nodel-controls-touch']");
  });

  it('keeps multiline and choice controls outside the single-line sizing selector', () => {
    const sizingStart = styles.lastIndexOf('  :is(nodel-console, nodel-actsig, nodel-log, nodel-params, nodel-bindings) :is(');
    const sizingRule = styles.slice(sizingStart, styles.indexOf("input[type='color']", sizingStart));
    expect(sizingRule).toContain("input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']):not([type='color'])");
    expect(sizingRule).not.toContain('textarea');
    expect(sizingRule).not.toContain('nodel-control-min-height');
    expect(styles).toContain("textarea.nodel-field");
    expect(styles).toContain("input[type='color']");
    expect(styles).toContain("input[type='range']");
    expect(styles).toContain('.nodel-bindings .nodel-bindings-row > label[role=\'cell\']');
    expect(styles).toContain('.nodel-bindings .nodel-bindings-open-node');
  });

  it('provides static host markup with the distributed stylesheet and no component runtime', () => {
    expect(fixture).toContain('/v2/nodel-webui.css');
    expect(fixture).toContain('class="nodel-controls-compact"');
    expect(fixture).toContain('class="nodel-controls-touch"');
    expect(fixture).toContain('aria-label="Public field"');
    expect(fixture).not.toContain('<script');
  });
});
