import {
  BACKGROUND_DEFAULTS,
  BACKGROUND_PATTERN_IDS,
  normalizeBackgroundColor,
  normalizeBackgroundNumber,
  normalizeBackgroundPosition,
  patternAsset,
  patternSize,
  renderBackground,
  resolveBackgroundSettings,
  type BackgroundFit,
  type BackgroundPosition,
  type BackgroundPattern
} from '../backgrounds/backgrounds';
import { getControlRuntime } from '../data/control-runtime';
import type { NodelControlSignalState } from '../data/control-runtime';
import { catalogueRuntimeRequested } from './runtime-bootstrap';
import { bootstrapJsViews } from '../jsviews/jsviews-runtime';
import { copyTextToClipboard } from '../utils/clipboard';
import './backgrounds.css';

const patternIds = [...BACKGROUND_PATTERN_IDS, 'none' as const];
const patterns = patternIds.map((id) => ({ id, label: id === 'none' ? 'None' : id.replaceAll('-', ' ') }));
const catalogueSignals = new Set([
  'CatalogueBackgroundPattern',
  'CatalogueBackgroundColor',
  'CatalogueBackgroundFit',
  'CatalogueBackgroundPosition'
]);

const template = `
  <div class="nodel-background-catalogue-layout grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)]">
    <div class="nodel-background-catalogue-controls grid gap-5">
      <div class="grid gap-2">
        <span class="font-semibold" id="background-pattern-label">Texture</span>
        <nodel-select aria-labelledby="background-pattern-label" signal="CatalogueBackgroundPattern" action="SetCatalogueBackgroundPattern" value="carbon-fibre" placement="bottom" variant="primary" tone="soft">
          {{for patterns}}<nodel-button value="{{:id}}">{{:label}}</nodel-button>{{/for}}
        </nodel-select>
      </div>
      <div class="grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="Texture reference">
        {{for patterns}}<div class="nodel-background-pattern-choice grid gap-1 text-center text-xs"><span class="nodel-background-pattern-swatch" data-background-pattern-swatch="{{:id}}"></span><span>{{:label}}</span></div>{{/for}}
      </div>
      <div class="grid gap-2">
        <span class="font-semibold" id="background-colour-label">Colour</span>
        <nodel-palette aria-labelledby="background-colour-label" signal="CatalogueBackgroundColor" action="SetCatalogueBackgroundColor" value="#202b38" picker="native" format="hex" value-field="editable" columns="4" variant="primary" tone="soft">
          <nodel-button value="#202b38" color="#202b38" aria-label="Slate"></nodel-button>
          <nodel-button value="#f0f3f5" color="#f0f3f5" aria-label="Mist"></nodel-button>
          <nodel-button value="#6b7280" color="#6b7280" aria-label="Graphite"></nodel-button>
          <nodel-button value="#b7791f" color="#b7791f" aria-label="Amber"></nodel-button>
        </nodel-palette>
        <nodel-button class="justify-self-start" action="SetCatalogueBackgroundColor" arg="theme" signal="CatalogueBackgroundColor" variant="ghost">Use theme colour</nodel-button>
        <p class="text-sm text-nodel-muted" data-background-theme-status hidden>Theme colour active; palette choices override it.</p>
        <label class="grid gap-1" for="background-colour-input">Precise RGB/hex <input id="background-colour-input" class="nodel-field" type="text" data-background-field="color" value="#202b38" spellcheck="false" aria-describedby="background-color-help background-color-error"></label>
        <p class="text-sm text-nodel-muted" id="background-color-help">Use opaque <code>rgb(...)</code> or <code>#RGB</code>/<code>#RRGGBB</code>.</p>
        <p class="min-h-5 text-sm text-nodel-danger" id="background-color-error" role="alert" data-background-color-error></p>
      </div>
      <div class="grid gap-2">
        <label class="grid gap-1" for="background-image-input">Image path or URL <input id="background-image-input" class="nodel-field" type="text" data-background-field="image" placeholder="./images/texture.jpg" aria-describedby="background-image-help"></label>
        <p class="text-sm text-nodel-muted" id="background-image-help">Relative paths resolve from the authored page. This previews a URL; it does not upload or embed an image.</p>
        <label class="grid gap-1">Image fit <nodel-select signal="CatalogueBackgroundFit" action="SetCatalogueBackgroundFit" value="cover"><nodel-button value="cover">Cover</nodel-button><nodel-button value="contain">Contain</nodel-button><nodel-button value="tile">Tile</nodel-button></nodel-select></label>
        <label class="grid gap-1">Image position <nodel-select signal="CatalogueBackgroundPosition" action="SetCatalogueBackgroundPosition" value="center"><nodel-button value="center">Center</nodel-button><nodel-button value="left top">Left top</nodel-button><nodel-button value="right bottom">Right bottom</nodel-button><nodel-button value="50% 30%">50% 30%</nodel-button></nodel-select></label>
      </div>
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="grid gap-1"><span id="background-strength-label">Strength</span><label class="sr-only" for="background-strength-range">Strength slider</label><input id="background-strength-range" class="nodel-field" type="range" min="0" max="100" value="25" data-background-field="patternStrength" aria-describedby="background-strength-error"><label class="sr-only" for="background-strength-number">Strength value</label><input id="background-strength-number" class="nodel-field" type="number" min="0" max="100" value="25" data-background-field="patternStrength" aria-labelledby="background-strength-label" aria-describedby="background-strength-error"><p class="text-sm text-nodel-danger" id="background-strength-error" data-background-number-error="patternStrength"></p></div>
        <div class="grid gap-1"><span id="background-brightness-label">Brightness</span><label class="sr-only" for="background-brightness-range">Brightness slider</label><input id="background-brightness-range" class="nodel-field" type="range" min="0" max="200" value="100" data-background-field="brightness" aria-describedby="background-brightness-error"><label class="sr-only" for="background-brightness-number">Brightness value</label><input id="background-brightness-number" class="nodel-field" type="number" min="0" max="200" value="100" data-background-field="brightness" aria-labelledby="background-brightness-label" aria-describedby="background-brightness-error"><p class="text-sm text-nodel-danger" id="background-brightness-error" data-background-number-error="brightness"></p></div>
        <div class="grid gap-1"><span id="background-scale-label">Scale</span><label class="sr-only" for="background-scale-range">Scale slider</label><input id="background-scale-range" class="nodel-field" type="range" min="25" max="400" value="100" data-background-field="patternScale" aria-describedby="background-scale-error"><label class="sr-only" for="background-scale-number">Scale value</label><input id="background-scale-number" class="nodel-field" type="number" min="25" max="400" value="100" data-background-field="patternScale" aria-labelledby="background-scale-label" aria-describedby="background-scale-error"><p class="text-sm text-nodel-danger" id="background-scale-error" data-background-number-error="patternScale"></p></div>
      </div>
    </div>
    <div class="grid content-start gap-3">
       <div class="nodel-background-preview min-h-72 overflow-hidden relative rounded-card" data-background-preview><div class="relative m-8 rounded-card border border-nodel-border/80 bg-nodel-surface/90 p-4"><strong>Representative preview</strong><p class="my-2 mb-4">Textures stay behind content.</p><button class="nodel-button nodel-button-primary" type="button">Control surface</button></div></div>
       <p class="text-sm text-nodel-muted">Check text and controls against your chosen background for contrast.</p>
    </div>
  </div>`;

const authoredMarkupTemplate = `
  <div class="mt-6 grid gap-3">
    <h3 class="nodel-catalogue-subtitle">Copyable authored markup</h3>
    <div class="flex items-center justify-between gap-3"><span>App</span><button class="nodel-button nodel-button-ghost" data-background-copy="app">Copy app</button></div>
    <pre class="nodel-catalogue-code" data-background-markup="app" tabindex="0"><code></code></pre>
    <div class="flex items-center justify-between gap-3"><span>Page override</span><button class="nodel-button nodel-button-ghost" data-background-copy="page">Copy page</button></div>
    <pre class="nodel-catalogue-code" data-background-markup="page" tabindex="0"><code></code></pre>
    <p class="min-h-6" role="status" aria-live="polite" data-background-copy-status></p>
  </div>`;

interface CatalogueState {
  pattern: BackgroundPattern;
  color: string;
  image: string;
  imageFit: BackgroundFit;
  imagePosition: BackgroundPosition;
  patternStrength: number;
  brightness: number;
  patternScale: number;
}

type NumericField = 'patternStrength' | 'brightness' | 'patternScale';
type Drafts = Record<'color' | 'image' | NumericField, string>;
type CatalogueDispose = (() => void) & { mounted?: boolean };

const mountOwners = new WeakMap<HTMLElement, symbol>();

function unmountedDispose(): CatalogueDispose {
  return () => undefined;
}

function escapedAttribute(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function normalizedState(state: CatalogueState) {
  const source = document.createElement('div');
  const values = {
    'background-color': state.color,
    'background-image': state.image || 'none',
    'background-pattern': state.pattern,
    'background-pattern-strength': state.patternStrength,
    'background-brightness': state.brightness,
    'background-pattern-scale': state.patternScale,
    'background-image-fit': state.imageFit,
    'background-image-position': state.imagePosition
  };
  for (const [name, value] of Object.entries(values)) source.setAttribute(name, String(value));
  return resolveBackgroundSettings(source).settings;
}

export type BackgroundCatalogueMarkupState = CatalogueState;

export function backgroundCatalogueMarkup(state: BackgroundCatalogueMarkupState) {
  const settings = normalizedState(state);
  const values: Record<string, string | number> = {
    'background-color': settings.color,
    'background-image': settings.image ? state.image : 'none',
    'background-pattern': settings.pattern,
    'background-pattern-strength': settings.patternStrength,
    'background-brightness': settings.brightness,
    'background-pattern-scale': settings.patternScale,
    'background-image-fit': settings.imageFit,
    'background-image-position': settings.imagePosition
  };
  const defaults: Record<string, string | number> = {
    'background-color': BACKGROUND_DEFAULTS.color,
    'background-image': 'none',
    'background-pattern': BACKGROUND_DEFAULTS.pattern,
    'background-pattern-strength': BACKGROUND_DEFAULTS.patternStrength,
    'background-brightness': BACKGROUND_DEFAULTS.brightness,
    'background-pattern-scale': BACKGROUND_DEFAULTS.patternScale,
    'background-image-fit': BACKGROUND_DEFAULTS.imageFit,
    'background-image-position': BACKGROUND_DEFAULTS.imagePosition
  };
  const attributes = (page: boolean) => Object.entries(values)
    .filter(([name, value]) => page || String(value) !== String(defaults[name]))
    .map(([name, value]) => ` ${name}="${escapedAttribute(String(value))}"`)
    .join('');
  return {
    app: `<nodel-app${attributes(false)}>\n  <nodel-page title="Home">...</nodel-page>\n</nodel-app>`,
    page: `<nodel-page title="Home override"${attributes(true)}>...</nodel-page>`
  };
}

function setStateProperty<K extends keyof CatalogueState>(
  observable: { setProperty(name: string, value: unknown): void },
  state: CatalogueState,
  name: K,
  value: CatalogueState[K]
) {
  state[name] = value;
  observable.setProperty(name, value);
}

function signalUpdate(state: CatalogueState, alias: string, value: unknown): keyof CatalogueState | null {
  if (alias === 'CatalogueBackgroundPattern' && typeof value === 'string' && patternIds.includes(value as typeof patternIds[number])) {
    state.pattern = value as BackgroundPattern;
    return 'pattern';
  }
  if (alias === 'CatalogueBackgroundColor' && typeof value === 'string' && Boolean(normalizeBackgroundColor(value))) {
    state.color = normalizeBackgroundColor(value) ?? state.color;
    return 'color';
  }
  if (alias === 'CatalogueBackgroundFit' && (value === 'cover' || value === 'contain' || value === 'tile')) {
    state.imageFit = value;
    return 'imageFit';
  }
  if (alias === 'CatalogueBackgroundPosition' && typeof value === 'string') {
    const position = normalizeBackgroundPosition(value);
    if (position) {
      state.imagePosition = position;
      return 'imagePosition';
    }
  }
  return null;
}

function findSection(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches('[data-background-catalogue-section]')) return root;
  return root.querySelector<HTMLElement>('[data-background-catalogue-section]');
}

export async function mountBackgroundCatalogue(root: ParentNode = document, owner = Symbol('background-catalogue-mount')): Promise<CatalogueDispose> {
  if (!catalogueRuntimeRequested()) return unmountedDispose();
  const section = findSection(root);
  const host = section?.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]');
  const markupHost = section?.querySelector<HTMLElement>('[data-background-catalogue-markup]');
  if (!section || !host || !markupHost || mountOwners.has(host)) return unmountedDispose();
  mountOwners.set(host, owner);
  host.dataset.backgroundCatalogueMounted = 'pending';
  const mountedSection = section;
  const mountedHost = host;

  const releaseOwnership = () => {
    if (mountOwners.get(mountedHost) !== owner) return;
    mountOwners.delete(mountedHost);
    delete mountedHost.dataset.backgroundCatalogueMounted;
  };

  let jq: Awaited<ReturnType<typeof bootstrapJsViews>>;
  try {
    jq = await bootstrapJsViews();
  } catch (error) {
    releaseOwnership();
    throw error;
  }
  if (mountOwners.get(host) !== owner || !catalogueRuntimeRequested() || !host.isConnected || !section.isConnected) {
    releaseOwnership();
    return unmountedDispose();
  }

  const state: CatalogueState = {
    pattern: 'carbon-fibre',
    color: '#202b38',
    image: '',
    imageFit: 'cover',
    imagePosition: 'center',
    patternStrength: 25,
    brightness: 100,
    patternScale: 100
  };
  const drafts: Drafts = {
    color: state.color,
    image: state.image,
    patternStrength: String(state.patternStrength),
    brightness: String(state.brightness),
    patternScale: String(state.patternScale)
  };
  const invalidFields = new Set<string>();
  const observable = (jq as unknown as { observable(value: object): { setProperty(name: string, value: unknown): void } }).observable(state);
  jq.templates(template).link(jq(host), { state, patterns });
  if (!markupHost.firstElementChild) markupHost.innerHTML = authoredMarkupTemplate;
  const preview = host.querySelector<HTMLElement>('[data-background-preview]');
  if (!preview) {
    jq.unlink(jq(host));
    releaseOwnership();
    return unmountedDispose();
  }
  for (const swatch of host.querySelectorAll<HTMLElement>('[data-background-pattern-swatch]')) {
    const pattern = swatch.dataset.backgroundPatternSwatch as BackgroundPattern;
    swatch.style.setProperty('--nodel-background-pattern', patternAsset(pattern) ?? 'none');
    swatch.style.backgroundSize = patternSize(pattern, 50);
  }
  const appCode = section.querySelector<HTMLElement>('[data-background-markup="app"] code');
  const pageCode = section.querySelector<HTMLElement>('[data-background-markup="page"] code');
  const status = section.querySelector<HTMLElement>('[data-background-copy-status]');
  if (!appCode || !pageCode || !status) {
    jq.unlink(jq(host));
    releaseOwnership();
    return unmountedDispose();
  }

  let disposed = false;
  let pendingColorSignal: string | null = null;
  const refresh = () => {
    if (disposed) return;
    const color = host.querySelector<HTMLInputElement>('[data-background-field="color"]');
    const colorNormalized = normalizeBackgroundColor(drafts.color);
    const colorError = host.querySelector<HTMLElement>('[data-background-color-error]');
    if (color) {
      if (document.activeElement !== color) color.value = drafts.color;
      color.setCustomValidity(colorNormalized ? '' : 'Enter an opaque RGB or hexadecimal colour.');
      color.setAttribute('aria-invalid', String(!colorNormalized));
    }
    if (colorError) colorError.textContent = colorNormalized ? '' : 'Enter an opaque RGB or hexadecimal colour.';
    const themeStatus = host.querySelector<HTMLElement>('[data-background-theme-status]');
    if (themeStatus) themeStatus.hidden = state.color !== 'theme';
    const palette = host.querySelector('nodel-palette');
    if (palette) {
      palette.setAttribute('value', state.color === 'theme' ? '' : state.color);
      palette.setAttribute('picker', state.color === 'theme' ? 'off' : 'native');
    }
    for (const name of ['patternStrength', 'brightness', 'patternScale'] as const) {
      const limits = name === 'patternStrength' ? [0, 100] : name === 'brightness' ? [0, 200] : [25, 400];
      const valid = normalizeBackgroundNumber(drafts[name], limits[0]!, limits[1]!);
      for (const control of host.querySelectorAll<HTMLInputElement>(`[data-background-field="${name}"]`)) {
        if (document.activeElement !== control) control.value = valid === null && control.type === 'number' ? drafts[name] : String(valid ?? state[name]);
        control.setAttribute('aria-invalid', String(valid === null));
      }
      const error = host.querySelector<HTMLElement>(`[data-background-number-error="${name}"]`);
      if (error) error.textContent = valid === null ? `Enter a number from ${limits[0]} to ${limits[1]}.` : '';
    }
    const values = backgroundCatalogueMarkup(state);
    appCode.textContent = values.app;
    pageCode.textContent = values.page;
    renderBackground(preview, { settings: normalizedState(state), customized: true });
    const disabled = invalidFields.size > 0 || !colorNormalized;
    for (const button of section.querySelectorAll<HTMLButtonElement>('[data-background-copy]')) button.disabled = disabled;
  };
  const publishColor = (value: string) => {
    const normalized = normalizeBackgroundColor(value);
    drafts.color = value;
    if (!normalized) {
      invalidFields.add('color');
      refresh();
      return;
    }
    invalidFields.delete('color');
    pendingColorSignal = normalized;
    void getControlRuntime().callAction('SetCatalogueBackgroundColor', { arg: normalized }).catch(() => undefined);
    refresh();
  };
  const onInput = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const name = target.dataset.backgroundField;
    if (name === 'color') {
      publishColor(target.value);
      return;
    }
    if (name === 'image') {
      drafts.image = target.value;
      state.image = target.value;
      observable.setProperty('image', state.image);
      refresh();
      return;
    }
    if (name === 'patternStrength' || name === 'brightness' || name === 'patternScale') {
      drafts[name] = target.value;
      const minimum = name === 'patternScale' ? 25 : 0;
      const maximum = name === 'brightness' ? 200 : name === 'patternStrength' ? 100 : 400;
      const normalized = normalizeBackgroundNumber(target.value, minimum, maximum);
      if (normalized === null) invalidFields.add(name);
      else {
        invalidFields.delete(name);
        setStateProperty(observable, state, name, normalized);
      }
      refresh();
    }
  };
  const commitDraft = (target: HTMLInputElement) => {
    const name = target.dataset.backgroundField;
    if (name === 'color') {
      const normalized = normalizeBackgroundColor(drafts.color);
      if (normalized) {
        drafts.color = normalized;
        target.value = normalized;
      }
    } else if (name === 'patternStrength' || name === 'brightness' || name === 'patternScale') {
      const minimum = name === 'patternScale' ? 25 : 0;
      const maximum = name === 'brightness' ? 200 : name === 'patternStrength' ? 100 : 400;
      const normalized = normalizeBackgroundNumber(drafts[name], minimum, maximum);
      if (normalized !== null) {
        drafts[name] = String(normalized);
        target.value = drafts[name];
      }
    }
    refresh();
  };
  const onChange = (event: Event) => commitDraft(event.target as HTMLInputElement);
  const onFocusOut = (event: FocusEvent) => commitDraft(event.target as HTMLInputElement);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') commitDraft(event.target as HTMLInputElement);
  };
  const onClick = (event: Event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-background-copy]');
    if (!button || disposed) return;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement && host.contains(active)) commitDraft(active);
    const code = button.dataset.backgroundCopy === 'app' ? appCode.textContent ?? '' : pageCode.textContent ?? '';
    void copyTextToClipboard(code).then(
      () => { if (!disposed && section.isConnected) status.textContent = 'Markup copied to the clipboard.'; },
      () => { if (!disposed && section.isConnected) status.textContent = 'Clipboard access failed. Select the markup above and copy it manually.'; }
    );
  };
  const onSignal = ({ entries }: NodelControlSignalState) => {
    let changed = false;
    for (const entry of entries) {
      if (!catalogueSignals.has(entry.alias)) continue;
      const property = signalUpdate(state, entry.alias, entry.arg);
      if (!property) continue;
      if (property === 'color') {
        const colorInput = host.querySelector<HTMLInputElement>('[data-background-field="color"]');
        const isOwnedDraftUpdate = pendingColorSignal === state.color && document.activeElement === colorInput;
        pendingColorSignal = null;
        if (!isOwnedDraftUpdate) {
          drafts.color = state.color;
          if (colorInput) colorInput.value = state.color;
        }
        invalidFields.delete('color');
      }
      observable.setProperty(property, state[property]);
      changed = true;
    }
    if (changed) {
      refresh();
    }
  };
  const subscription = getControlRuntime().subscribeSignals(mountedHost, onSignal);
  mountedHost.addEventListener('input', onInput);
  mountedHost.addEventListener('change', onChange);
  mountedHost.addEventListener('focusout', onFocusOut);
  mountedHost.addEventListener('keydown', onKeyDown);
  mountedSection.addEventListener('click', onClick);
  refresh();

  function dispose() {
    if (disposed) return;
    disposed = true;
    subscription.dispose();
    mountedHost.removeEventListener('input', onInput);
    mountedHost.removeEventListener('change', onChange);
    mountedHost.removeEventListener('focusout', onFocusOut);
    mountedHost.removeEventListener('keydown', onKeyDown);
    mountedSection.removeEventListener('click', onClick);
    jq.unlink(jq(mountedHost));
    releaseOwnership();
  }
  dispose.mounted = true;
  return dispose;
}

interface CatalogueMount {
  section: HTMLElement;
  host: HTMLElement;
  dispose: () => void;
}

export function startCatalogueMounting() {
  if (!catalogueRuntimeRequested()) return () => undefined;

  let generation = 0;
  let pending: Omit<CatalogueMount, 'dispose'> & { generation: number; owner: symbol } | null = null;
  let active: CatalogueMount | null = null;
  let stopped = false;

  const reconcile = () => {
    if (stopped) return;
    if (active?.section.isConnected && active.host.isConnected) return;
    if (pending?.section.isConnected && pending.host.isConnected) return;

    const currentSection = findSection(document);
    const currentHost = currentSection?.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]') ?? null;

    if (active && (active.section !== currentSection || active.host !== currentHost || !active.host.isConnected)) {
      const previous = active;
      active = null;
      previous.dispose();
    }
    if (pending && (pending.section !== currentSection || pending.host !== currentHost || !pending.host.isConnected)) {
      if (mountOwners.get(pending.host) === pending.owner) {
        mountOwners.delete(pending.host);
        delete pending.host.dataset.backgroundCatalogueMounted;
      }
      generation += 1;
      pending = null;
    }
    if (!currentSection || !currentHost || active || pending) return;

    const mountGeneration = ++generation;
    const owner = Symbol('background-catalogue-manager');
    pending = { section: currentSection, host: currentHost, generation: mountGeneration, owner };
    void mountBackgroundCatalogue(currentSection, owner).then((dispose) => {
      if (pending?.generation === mountGeneration) pending = null;
      if (!dispose.mounted) return;
      const latestSection = findSection(document);
      const latestHost = latestSection?.querySelector<HTMLElement>('[data-background-catalogue="backgrounds"]') ?? null;
      if (stopped || generation !== mountGeneration || latestSection !== currentSection || latestHost !== currentHost || !currentHost.isConnected) {
        dispose();
        reconcile();
        return;
      }
      active = { section: currentSection, host: currentHost, dispose };
    }).catch(() => {
      if (pending?.generation === mountGeneration) pending = null;
    });
  };

  const observer = new MutationObserver(reconcile);
  observer.observe(document, { childList: true, subtree: true });
  reconcile();

  return () => {
    if (stopped) return;
    stopped = true;
    generation += 1;
    if (pending && mountOwners.get(pending.host) === pending.owner) {
      mountOwners.delete(pending.host);
      delete pending.host.dataset.backgroundCatalogueMounted;
    }
    pending = null;
    observer.disconnect();
    if (active) {
      const previous = active;
      active = null;
      previous.dispose();
    }
  };
}

startCatalogueMounting();
