# Architecture Guidance

## Scope

`nodel-webui-v2` is the new UI. `nodel-webui-js` is v1 and is reference-only for future work.

Do not modify v1 code for new UI work. Legacy-loader remains the compatibility path for old pages and XML/custom UI content.

## Runtime Contract

The current Java Nodel implementation is the primary backend contract. Representative response and request fixtures are captured in `test/fixtures/java-nodel-api.json` from Java Nodel commit `19756071383d696682688ab436c77c0a1f80c783`. `test/java-nodel-api-contract.test.ts` protects the endpoint paths, HTTP methods, payload envelopes, and representative source-backed response values consumed by this UI. Runtime decoding and rejection of malformed variants are separate boundary-hardening work. Update the fixture provenance and contract tests whenever a Java Nodel API change is intentionally adopted.

Java Nodel's REST dispatcher accepts GET and POST. Some existing state-changing services are exposed through GET-compatible endpoints, so client methods must not be changed based only on general HTTP conventions. Method changes require a matching Java Nodel contract change and integration coverage.

The framework has two supported consumers:

- Core host and node administration pages are built in this repository and later bundled into a Nodel build by a separate integration process.
- User-authored pages are plain static files served by Nodel. They may be created after this project has been built and have no page-specific compilation step.

Both consumers use the same stable `v2/nodel-webui.js` and `v2/nodel-webui.css` files. A static authored page may declare supported components in its initial markup or insert them later. The runtime must not rely exclusively on Vite knowing every consuming HTML page at build time. Browser coverage for this contract uses `e2e/fixtures/no-build-authored-page.html`, which is deliberately not a Vite input or release page.

The complete `v2/` directory is one indivisible release asset. The stable JavaScript entry may reference hashed chunks, so copying only the stable entry files is unsupported.

## Input Boundaries

Treat all REST, WebSocket, discovery, build metadata, authored attributes, and signal values as untrusted at the browser boundary.

- `src/api/codecs/nodel-codecs.ts` validates Java Nodel response envelopes before endpoint functions return data to components. Decoders preserve tolerated unknown fields but reject malformed known fields, non-finite sequence/measurement values, unsafe node/file paths, unsafe node URLs, excessive collection sizes, and excessively deep schemas. Decoder errors include only endpoint and structural path context; they do not reflect arbitrary response values.
- `src/utils/urls.ts` owns separate policies for browser navigation, Markdown links, absolute remote-node API bases, image sources, and host reachability probes. `src/utils/node-file-path.ts` owns the shared relative file-path policy. HTML escaping does not make a URL safe. Components must use the relevant policy before assigning `href`, `src`, a browser location, a remote API base, or a node file path.
- Remote node API bases must be absolute HTTP(S) URLs without credentials, query strings, or fragments. Endpoint paths are appended through `remoteNodeEndpoint` rather than string concatenation.
- Markdown may retain only constrained `language-*` classes on `code` elements. Arbitrary classes are removed so signal/backend Markdown cannot reuse application overlay or positioning styles.
- `src/api/request.ts` combines caller cancellation with a default 30-second request deadline. File reads/writes use a documented 120-second deadline, and long-poll requests extend the default deadline beyond their server timeout. A caller abort remains an abort; an elapsed deadline is reported as a bounded `TimeoutError`.

Endpoint functions, not components, are responsible for decoding backend responses. Components still validate navigation/image values at the final DOM sink as defense in depth and must retain visible text or an accessible unavailable/error state when a value is rejected.

## Rules

- Use TypeScript.
- Use custom elements for UI composition.
- Use Tailwind CSS for the base styling system.
- Use Tailwind utilities and named Nodel Tailwind tokens for local component styling.
- Use shared semantic styling classes from `src/styles.css` for repeated controls, surfaces, state variants, and public page-authoring primitives.
- Keep JsViews for schema-form generation and live data binding.
- Do not add placeholder code.
- Do not copy v1 implementation patterns unless a behavior is being intentionally re-created.
- Keep page markup minimal by relying on safe web-component defaults; see `web-components.md`.

## Current Base Layer

The first UI layer is intentionally small:

- `nodel-app` manages theme state.
- `nodel-toolbar` renders the top bar.
- `nodel-page` renders page sections.
- `nodel-row` and `nodel-column` provide simple layout primitives.
- `nodel-control-grid`, `nodel-control-space`, `nodel-group`, `nodel-template`, and `nodel-button` provide touch-focused control layout, labelled passive grouping, repeated authoring fragments, and button primitives for custom node pages.
- `nodel-fader` and `nodel-meter` provide touch-first level control and read-only level display. They share a linear min/max scaling utility, support percent and dB readouts, and the fader reuses the child-aware control pattern to preserve compound rail children.
- `nodel-select`, `nodel-stepper`, `nodel-pad`, `nodel-readout`, and `nodel-palette` extend touch controls with scalable pickers, precise numeric adjustment, directional/momentary control, general value/status tiles, and swatch-first colour selection.
- `nodel-image`, `nodel-icon`, `nodel-qrcode`, `nodel-status-indicator`, and `nodel-status` provide child-aware media, scan-safe QR output, inline status primitives, and stateful status blocks for touch controls.
- `nodel-collapse` renders reusable collapsible panels.
- `nodel-description` renders the current node description from `REST/` as markdown with a collapsed preview.
- `nodel-theme-toggle` switches between light and dark themes and is shown inside the node menu on node pages.
- `nodel-text` provides default body text styling.
- `nodel-node-list` encapsulates the v1-style locals/network node lists with JsViews-backed data binding.
- `nodel-add-node` encapsulates the add-node UI and recipe/node lookup flow.
- `nodel-diagnostics` renders the host diagnostics table.
- `nodel-toolkit` renders the host scripting toolkit reference on the standalone Toolkit page.
- `nodel-console` renders the node console history and command prompt.
- `nodel-log` renders the node activity stream with hold, filter, and row-limit controls.
- `nodel-actsig` renders current-node actions and signals from their JSON schemas with lazy JsViews form materialization.
- `nodel-params` renders current-node parameters from their JSON schema and saves values back to the node.
- `nodel-bindings` renders current-node remote action/event bindings with bulk node assignment, target lookup, and match suggestions.
- `nodel-editor` renders the node file browser/editor with CodeMirror 6 and JsViews-linked controls.

Node list and add-node behavior intentionally preserve the existing v1 look and feel, including the host icon algorithm and the local vs network list split.

Node Activity behavior intentionally preserves the important v1 console/activity mechanics while keeping the implementation inside v2 web components. Description data uses the v1-style relative `REST/` `desc` field, rendered through a sanitized markdown component. Console data uses visible-only relative `REST/console` polling. Activity uses one visible-only WebSocket for the active node with polling fallback through relative `REST/activity`. Actions/signals are loaded from relative `REST/actions` and `REST/events`, paired/grouped like v1, and rendered from JSON schema using JsViews with lazy section expansion rather than the old large-form `Enable` gate. Parameters are loaded from relative `REST/params/schema` and `REST/params`, rendered through the same schema form helpers, and saved to relative `REST/params/save` as a raw parameter object. Remote bindings are loaded from relative `REST/remote/schema` and `REST/remote`, edited as grouped action/event rows, and saved to relative `REST/remote/save` in the v1 backend wire shape. Components that can summarize themselves inside `nodel-collapse` use bubbled `nodel-collapse-preview` events with plain-text preview details rather than coupling directly to the collapse component.

Activity and polling sources are bounded. The activity source has explicit `idle`, `connecting`, `websocket`, `polling`, and `backoff` states; a WebSocket that does not open within 2.5 seconds is closed and replaced by REST polling. Poll failures back off to a maximum of 15 seconds plus small jitter, and visibility/online recovery triggers an immediate refresh attempt. Activity retains at most 500 logical latest entries and at most 500 queued live updates before flushing. Console and host-log initial and incremental requests are capped at 200 entries, so large gaps page forward by cursor instead of issuing unbounded `9999` requests. Node lists retain at most 1000 rows per refresh, including the `All` display option. Network node discovery refreshes more slowly than local discovery by default, validates discovered addresses before probing, probes only the visible result window first, limits reachability checks to four concurrent hosts, treats not-yet-probed rows as unknown rather than unreachable, and expands remaining reachability checks in the background.

Signal-bound custom controls use `src/data/signal-bindings.ts` as the boundary between the activity stream and component state. Existing text targets receive the same formatted string values as before, while collection-aware targets can read the extracted raw value as a second handler argument and observe activity loading/error state. Dynamic option controls share `src/data/dynamic-options.ts` for raw payload validation, v1 key/value normalization, fallback child ownership, 200-item limits, keyed DOM reconciliation, and focus-removal metadata. Host components such as `nodel-select` and `nodel-segmented` remain responsible for shell markup, keyboard behavior, state labels, action dispatch, confirmation, and ARIA semantics.

Schema-driven forms implement the source-backed Java Nodel schema dialect documented in `docs/schema-dialect.md`, rather than generic JSON Schema. Normalization/model construction, presence-aware hydration/serialization, and validation are DOM-free layers under `src/schema/`; JsViews and DOM event adaptation remain in `schema-form.ts`. Parameter and binding serializers start from complete loaded replacement payloads and patch only edited declared fields.

`nodel-qrcode` uses the synchronous `qrcode` matrix API with fixed high error correction. It constructs a black-on-white SVG from the returned module matrix using DOM APIs, including the quiet zone, rather than injecting encoder-generated markup or depending on canvas. Invalid non-empty values clear the symbol and expose only a payload-safe error state.

Node editor behavior intentionally preserves the v1 file endpoints while using CodeMirror 6 rather than CodeMirror 5. The editor shell, file browser, controls, and status state are JsViews-linked. CodeMirror owns only the editor viewport. Custom layout hints are maintained in `src/editor/nodel-document-definition.ts` and should be updated whenever a public `nodel-*` component is added.

The browser editor limits text reads and text uploads to 1 MiB and binary uploads to 8 MiB. These limits provide substantial headroom over representative Nodel 2.2.1 recipes sampled during Stage 4, where text files were below 256 KiB and the largest sampled binary was about 242 KiB, while bounding browser and Java-host heap use. Unknown-length text responses require a streaming body; a non-streaming response must provide a bounded `Content-Length`. Java Nodel's file list exposes `modified` timestamps but no reliable size, ETag, `If-Match`, or conditional-save parameter. The editor therefore performs a best-effort pre-write metadata comparison and, for text, a bounded content comparison. Binary writes also compare size when supplied, but a metadata-free binary replacement cannot be detected reliably. These checks detect common concurrent edits but cannot make cross-browser writes atomic because another client can write between the check and the unconditional save request.

Existing transport-safe file names remain listable on their host filesystem, including names that are not portable to every Nodel platform. New editor paths use a stricter NFC-normalized, cross-platform policy and case-folded collision check. When a case-only alias is explicitly overwritten, the request uses the existing listed path spelling so `script.py` retains its dedicated save and backup behavior.

### Script Save Reload Coordination

An exact `script.py` save through `REST/script/save` is coordinated with the shared browser restart source. The coordinator reserves a generation synchronously before awaiting `REST/hasRestarted`, so concurrent editors cannot acquire competing baselines. The UI reads a baseline immediately before the save, including a valid `timestamp: null` baseline for a node that has not started yet. A corrective reservation records the exact old unconfirmed expectation ID/generation and is abandoned if that expectation confirms, refreshes, or is superseded before the new save. The baseline is committed to a generation-scoped expected reload only after the save succeeds; activation is deferred until the editor installs the immutable saved revision as its clean baseline. Timestamp changes observed while the save is in flight are retained and confirm the activated expectation immediately, so a fast reload cannot be lost or compared against a stale baseline.

While an expected reload is pending, CodeMirror remains editable and navigation, refresh, and non-script file operations retain their existing guards, but another exact `script.py` save is disabled for every editor instance and for both the Save button and keyboard shortcut. A committed expectation is page-global and is not canceled when its initiating editor disconnects; only prepared/uncommitted work is owner-cancelable. Normal saves, create/upload saves, and case-safe overwrite paths all use the same coordinator-global write gate. A corrective preparation does not replace an unconfirmed expectation until its script save succeeds, so a failed or canceled correction leaves late recovery available. The editor exposes reload progress in a separate live status so ordinary typing status cannot erase it. After 30 seconds without a changed start timestamp, the expectation becomes unconfirmed rather than failed. Local edits remain visible, Console should be checked, and a corrective `script.py` save is available only after explicit confirmation, including when the selected clean buffer is unchanged; that save supersedes the old expectation and starts a new generation. A late timestamp change can recover an unconfirmed expectation unless a corrective save has superseded it.

Confirmation means only that `REST/hasRestarted` returned a newer start timestamp. It does not mean that the node is ready because a REST request succeeded or because a console message contains a particular string. The app awaits explicit console/activity source outcomes on the requested refresh generation; failures, unresolved waits, aborts, and superseded work cannot produce verified-success messaging. Expected polling uses immediate retries for successful long-poll responses, but increasing capped backoff for request failures and a slower unconfirmed cadence. The app passes the expectation generation to restart-aware children. Every restart-aware child returns an explicit verified, dirty-preserved, conflict, failed, aborted, or superseded outcome; missing or non-reporting outcomes are treated conservatively as verification failures. A clean, unchanged selected `script.py` buffer may be replaced by the bounded remote content and receives a new clean metadata baseline. Dirty or newly changed buffers are never replaced: if the remote content still equals the saved baseline, metadata is updated while local edits remain unsaved; otherwise the editor preserves local text and reports an explicit conflict or unknown baseline requiring the existing safe resolution path. Missing-file recovery remains local-buffer based. Refresh results are generation-checked so stale work cannot mutate a newer expectation, and explicit false, conflict, failure, aborted, or superseded results cannot produce a “View is up to date” message.

This coordination prevents repeat `script.py` saves from racing the reload within this Web UI and preserves local browser edits, but it does not make Java Nodel's unlocked, unconditional script write atomic, prevent another client from writing concurrently, or make the first save itself transactional. A timeout is not proof that startup failed. `hasRestarted` advances only after Java reaches its successful start-timestamp update, so a broken script or a startup that runs longer than 30 seconds can remain unconfirmed even when the initial save request succeeded.

`nodel-app` also owns page navigation. It discovers declared `nodel-page` elements, creates the toolbar navigation model, tracks the active page, and hides inactive pages with the `hidden` attribute. Nested `nodel-page` elements create toolbar submenu groups. This preserves the v1 behavior concept without using Bootstrap dropdowns or jQuery page switching.

## Styling Layer

Tailwind is the primary styling layer. Use utilities directly for local layout, spacing, sizing, typography, responsive behavior, and simple color styling. Use the Nodel token utilities from `tailwind.config.ts`, such as `text-nodel-muted`, `text-nodel-fg`, `bg-nodel-surface`, `border-nodel-border`, `ring-nodel-accent`, `rounded-control`, `rounded-card`, and `rounded-panel`, instead of repeated arbitrary CSS-variable utilities.

Common UI primitives still live in `src/styles.css` as semantic classes backed by Tailwind tokens. Use `.nodel-button`, `.nodel-field`, `.nodel-card`, `.nodel-panel`, `.nodel-popover`, `.nodel-list`, `.nodel-list-item`, `.nodel-menu-item`, `.nodel-alert`, `.nodel-link`, and `.nodel-choice` for repeated controls, surfaces, and user-authored page primitives. Treat `.nodel-card` as a passive display surface and standalone `.nodel-list-item` elements as raised tappable row surfaces. Dense related navigation should use one `.nodel-list` collection surface containing divided `.nodel-list-item` rows so elevation communicates the group rather than repeating on every item.

Light and dark themes use shared solid surface tokens for flat page backgrounds, cards, panels, popovers, and controls. Hairline borders separate adjacent surfaces, cards and grouped lists use restrained elevation, panels provide a clearer surface step, and only floating UI uses the strongest shadow. Interactive controls have separate control tokens for resting, active, and pressed states so touch users can identify tappable elements without hover. Prefer those semantic primitives over hard-coded gradients, alpha surfaces, or decorative shadows so user-authored pages inherit future theme updates.

Control authoring is composition-first. `nodel-group` owns visible labels, passive card/panel backgrounds, and padding. `nodel-status` owns stateful status block semantics and should be used when the surrounding surface itself represents runtime health/state. Individual controls own behavior, state, accessible names, and the tactile styling of actual interactive parts. Component `label` attributes are accessibility-only fallback labels; use `nodel-group label="..."` when text should be visible. Keep `variant` and `tone` scoped to the interactive/status part of a control, not to component-owned wrapper cards. `nodel-control-grid` remains the only equal-cell grid primitive, so groups and status blocks should be placed inside grids or contain grids rather than growing their own column API.

Use variant and state classes such as `.nodel-button-primary`, `.nodel-button-danger`, `.nodel-button-ghost`, `.nodel-menu-item-active`, `.nodel-alert-danger`, `.is-disabled`, and `.is-unreachable` when behavior or public API drives appearance. Keep raw CSS for theme variable definitions, custom-element defaults, generated markdown content, CodeMirror/editor styling, CSS-variable-driven layout, third-party widgets, and complex runtime selectors.

The sans stack is native-system only so deployed pages do not depend on an unavailable webfont. Shared styling provides `prefers-reduced-motion`, `prefers-contrast`, and forced-colours fallbacks; do not replace semantic controls with arbitrary translucent surfaces that bypass those modes.

## Stable Head Contract

User-authored pages should reference the stable v2 entry files, not the Vite source entry:

```html
<script>
  (() => {
    const root = document.documentElement;
    let theme = root.dataset.theme;
    if (theme !== 'light' && theme !== 'dark') {
      try {
        const stored = window.localStorage.getItem('nodel.theme');
        theme = stored === 'light' || stored === 'dark' ? stored : undefined;
      } catch {}
    }
    if (theme !== 'light' && theme !== 'dark') {
      try {
        theme = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      } catch {
        theme = 'light';
      }
    }
    root.dataset.theme = theme;
  })();
</script>
<link rel="stylesheet" href="./v2/nodel-webui.css" />
<script type="module" src="./v2/nodel-webui.js"></script>
```

Place this synchronous bootstrap before the stylesheet to set the initial theme from a valid root theme, then the stored preference, then the system preference. It tolerates unavailable storage and media queries. The connected `nodel-app` remains authoritative: explicit `theme="light"` or `theme="dark"` wins, otherwise it keeps the root synchronized with stored and system preferences. Pages with a fixed app theme should set the same root `data-theme` value (for example, `<html data-theme="dark">` with `<nodel-app theme="dark">`) so the first paint cannot differ from the app theme.

The page title can then be controlled by `nodel-app title="..."`.

Vite source pages may reference `/src/main.ts` during local dev. Built/deployed pages should reference the stable v2 support files.

This contract also applies to pages authored after a release. They do not need to be listed in `vite.config.ts` and must not import source modules. The stable script eagerly registers the Custom UI Components listed in `web-components.md`, scans initial markup for Core Nodel Components, and observes later insertions so ordinary static markup remains sufficient. Core implementations are loaded from a fixed internal dynamic-import registry; authored tag names never become import paths. The loader deduplicates concurrent requests and dispatches a bounded `nodel-component-load-error` event on `window` when a known core module cannot load.

Advanced module pages may explicitly await a core definition before creating it:

```js
import { loadNodelComponent } from './v2/nodel-webui.js';

await loadNodelComponent('nodel-editor');
const editor = document.createElement('nodel-editor');
document.body.append(editor);
```

`loadNodelComponent()` accepts only documented lazy core tags. Public primitives and the app-owned toast, confirmation, and connectivity hosts are already registered when the stable module finishes evaluating. The complete stylesheet remains in `nodel-webui.css`; JavaScript component loading does not require page-specific CSS builds or Tailwind scanning. JsViews starts only when a connected JsViews-backed component requests it, while CodeMirror and Chart.js remain behind their component-specific dynamic imports.

The public `components.html` catalogue is the one intentional exception to the normal node-backed control path. Its module script carries the internal `data-nodel-runtime="memory"` marker, which the first import in `src/main.ts` detects before custom elements are registered. That import installs a page-local, closed-loop in-memory action/signal runtime for catalogue demonstrations. The runtime seeds the signal examples and resolves catalogue actions without calling `REST/actions/*/call` or opening the node activity stream; mapped actions publish synthetic local signal entries so related examples stay synchronized. Other pages omit the marker and retain the default REST/WebSocket adapters. The marker is an implementation detail of the catalogue page, not a public custom-page attribute.

## Test Deployment

The deploy script follows the v1 convention of a root page plus versioned support files. It is a live test override for a development Nodel host, not the production installation mechanism for this project.

`npm run deploy:preview` writes the same structure inside the project at `build/deploy-preview/`. Use this for local smoke tests that should not touch a running Nodel content directory.

`npm run deploy` writes to the Nodel custom content root, defaulting to `/opt/nodel/custom/content/`.

The command clears and replaces its target. Use it only where that custom content directory is intentionally disposable test state. Production Nodel builds consume a validated release bundle through their separate build/integration process.

Both deployment commands write:

- `index.htm` into the target content root as the non-visual redirector.
- visual pages such as `nodes.html`, `nodel.html`, `toolkit.html`, and the user-facing `components.html` catalogue into the target content root.
- built JavaScript and CSS under the `v2/` support folder in that same target.

This lets the custom content root override the built-in default document and visual pages for testing without replacing the built-in v1 support files. The support folder can be changed with `--support-subdir`, but `v2` is the default convention for this UI.

## Release Bundle

Version tags matching `package.json` publish a versioned, deployable ZIP through GitHub Releases. Its root contains the built pages, the complete `v2/` support directory, `LICENSE`, `THIRD-PARTY-NOTICES.md`, and `release.json`. The manifest identifies the package version, source commit, and tested Java Nodel API contract range used by the release.

The release contract includes `index.htm`, `nodes.html`, `nodel.html`, `toolkit.html`, the user-facing `components.html` catalogue, and `RELEASE_NOTES.md`. Consumers must install the entire `v2/` directory because the stable JavaScript and CSS entry files can reference hashed chunks and assets. Other projects should consume a pinned release and checksum rather than rebuilding this project or downloading a mutable branch artifact.

The runtime targets the tested Java Nodel API directly and does not perform generic feature negotiation. The release manifest schema is version 2 and records only the supported API contract range. This is a project-owned version for the source-backed REST/WebSocket contract recorded in `test/fixtures/java-nodel-api.json`, not the Java host's `nodelVersion` and not a value negotiated at runtime. A consuming Java build maps its implementation to this contract during packaging. Alternative-backend negotiation can be designed later from a concrete cross-backend requirement.

This repository produces the web UI release bundle; it does not install production host files or mutate a Nodel service. The consuming Nodel build is responsible for packaging the complete support directory, MIME types, compression, cache policy, upgrade/rollback behavior, and deployment security headers.

The Stage 0 build and request baseline is recorded in `production-baseline.md`. It is informational rather than a permanent size budget and should be refreshed after intentional runtime-loading changes.

### Release Validation

- `npm run build` runs type checking, JsViews compliance, all Vitest tests, the production build, and the built-entry release gate. The gate verifies every entry page, stable assets, the catalogue's single in-memory runtime marker, authored-page modal defaults, and explicit core-page overlays.
- `npm run test:browser` runs the exhaustive Chromium theme/device/forced-colours matrix plus focused Firefox and WebKit functional and visual release projects. Browser hosts must install Playwright's declared dependencies; the version-matched official Playwright container is the reproducible fallback when host package installation is unavailable.
- Catalogue runtime tests must report no action/activity backend calls or node WebSockets.
- Before a tagged release, duplicate a disposable live node containing text, image, archive, nested, configuration, backup, and generated files. Verify byte preservation, nested paths, generated/backup filtering, opt-in configuration copying, transparent partial results, and `script.py` last. Remove the disposable nodes after validation.
- Exercise modal offline recovery on a representative authored touch page and overlay recovery on `nodes.html`, `nodel.html`, and `toolkit.html` without losing page state or shifting layout.
- Exercise `nodel-link` on same-host discovery, remote-host discovery, missing-node fallback, and unreachable-node fallback.
- Review light, dark, narrow mobile, wide desktop, reduced-motion, and forced-colours baselines before publishing.

## JsViews

JsViews stays in the stack for schema-driven forms.

Use JsViews for components with async state, polling/live data, interactive lists, popovers, autocomplete results, drawers, and schema-driven controls where incremental DOM updates preserve focus and avoid unnecessary redraws. Keep shell-once imperative DOM for stable editor/markdown hosts and tiny static components. Avoid whole-component `innerHTML` replacement for interactive or frequently-updated components unless the DOM is intentionally disposable.

Future form code should use:

- `{^{}}` for live bindings.
- `data-link` for element and attribute bindings.
- Explicit cleanup when linked DOM is removed.

See `jsviews-bindings.md` for examples.
