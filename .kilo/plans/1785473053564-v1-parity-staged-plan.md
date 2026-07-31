# V1 Feature-Parity Refinement Plan

Implementation status: Stages 1 through 9 implementation complete and reviewed. Automated release gates pass; final live-node duplication validation remains required before release because the current runtime has node deletion disabled and cannot clean up disposable validation nodes.

## Goal

Close the material V1-to-V2 feature gaps in independently releasable stages, prioritising data safety, operator safeguards, and declarative page compatibility before convenience refinements.

This plan targets V2-native APIs. It does not recreate the V1 XSL/Bootstrap implementation where ordinary HTML, composition, or an existing V2 component already provides the capability.

## Confirmed Decisions

- Object-path extraction already exists in V2 signal syntax, for example `visibility="Panel.mode"`. The missing visibility behavior is exact-value matching and global `any`/`all` aggregation.
- Add `visible-value="Presentation"` for one exact value and `visible-values="Presentation; Preview"` for several. The plural form uses V2's established semicolon-separated list convention.
- Exact visibility matching is trimmed and case-sensitive. Scalar signal values are converted canonically to attribute text; missing, object, and array values do not match.
- Preserve current boolean visibility behavior when neither exact-value attribute is present.
- Add code confirmation through `confirm-mode="code"`; do not overload the existing `confirm` text attribute. `confirm-code-signal` optionally overrides the default `ConfirmCode` local signal.
- Use V1's recoverable partial-result policy for node duplication. Configuration copying is opt-in and `script.py` is copied last.
- Keep node search on the dedicated Network page. Do not add node search to `nodel-node-menu`.
- Add a full explicit V2 link component with `href`, `node`, and `event-binding` destination modes.
- Add two offline presentations through `nodel-app offline-mode="modal|overlay"`. Modal is the default for authored/custom pages; core administration pages explicitly use `overlay`.
- Replace V1's magic `Title` and `Clock` aliases with explicit V2 signal bindings.
- Extend `nodel-palette`; do not restore Spectrum or add another colour-picker dependency by default.
- Extend `nodel-status-indicator` for compact partial states rather than introducing a separate badge component.

## Explicitly Out Of Scope

- Node search inside the node drawer.
- Integrated range mute behavior; compose a fader with a toggle or button instead.
- Arbitrary Font Awesome/Glyphicon class names. Continue using the curated V2 icon registry and add named icons centrally when needed.
- V1 smart-panel detection, zoom, and touch workarounds.
- A native V1 XML/XSL renderer inside V2. Existing V1 pages continue through the legacy compatibility path until migrated.
- Automatic loading of V1 `pages/@css` and `pages/@js`; V2 pages can use standard HTML resources.
- A blocking offline experience on core administration pages.

## Cross-Stage Rules

- Keep every stage independently deployable and covered by unit/browser tests before starting the next stage.
- Preserve current public markup unless a stage explicitly introduces additive attributes.
- Add all new public elements and attributes to `src/editor/nodel-document-definition.ts`, `docs/web-components.md`, and `components.html` in the same stage as implementation.
- Register new components from `src/main.ts` and keep catalogue source/live markup parity tests passing.
- Use the installed control runtime for actions and signals so the in-memory catalogue remains closed-loop and makes no backend control requests.
- Treat aborts, HTTP application errors, and remote-node failures separately from local host connectivity loss.
- Validate keyboard operation, focus restoration, reduced motion, mobile layout, dark/light themes, and forced-colours behavior for new interactive UI.

## Stage 1: Make Node Duplication Data-Safe

### Objective

Bring V2 duplication up to the current V1 behavior before adding further parity features. This stage prevents binary corruption and makes incomplete copies diagnosable.

### API And Data Flow

1. Replace text-only copying in `src/api/nodel-host-client.ts` with binary-safe `Blob` or `ArrayBuffer` transfer from `REST/files/contents` to `REST/files/save`.
2. Read and validate the complete source file list before creating the destination node. A source-list failure must not create an empty node.
3. Filter by file basename using the V1 policy:
   - Skip names beginning with `_`.
   - Skip `script_backup_*.py`.
   - Skip `nodeConfig.json` unless `includeNodeConfig` is true.
4. Preserve the relative path of every copied file.
5. Copy sequentially and order `script.py` last so its reload occurs after supporting files are present.
6. Continue after non-`script.py` fetch/save failures and collect structured failures containing path, phase, HTTP status when available, and a bounded message.
7. Treat a `script.py` copy failure as fatal because the destination recipe cannot be considered complete.
8. Return a structured result such as `{ url, copied, skipped, failed }` instead of only the destination URL.
9. Keep the destination node when any post-creation step fails. Error messages must explicitly say that the node exists and may be incomplete; do not attempt destructive rollback.
10. Keep readiness polling bounded and expose progress states for creation, initialization, file copy, and finalization.

### Add-Node UI

1. Add an unchecked **Copy configuration** choice to duplicate mode only.
2. Explain that configuration includes `nodeConfig.json` and may include environment-specific settings.
3. Show current file progress without replacing the selected source summary.
4. On complete success, preserve the current success behavior and destination link/navigation.
5. On partial non-script failure, do not auto-navigate. Show a warning listing failed paths and provide an explicit link to the created node.
6. On fatal post-creation failure, show an incomplete-node error and destination link when known.
7. Preserve source selection and requested destination name after a recoverable failure so the operator can inspect or retry deliberately.

### Primary Files

- `src/api/nodel-host-client.ts`
- `src/api/nodel-types.ts`
- `src/components/nodel-add-node.ts`
- `test/nodel-host-client.test.ts`
- `test/nodel-add-node.test.ts`
- `e2e/add-node.visual.spec.ts`

### Validation

- Copy representative UTF-8 text, PNG, ZIP, and arbitrary binary fixtures byte-for-byte.
- Verify generated and backup files are skipped by basename, including files in subdirectories.
- Verify configuration is excluded by default and included only when selected.
- Verify `script.py` is always the last save request.
- Verify non-script failures produce a partial result and subsequent files still copy.
- Verify script failure, source failure, creation failure, and readiness timeout produce distinct messages.
- Verify no destination node is created when the source file list cannot be read.
- Verify the partial-result UI is usable on mobile and does not redirect before the operator can read it.

### Exit Gate

No V2 duplication path may decode an unknown file as text, silently omit a copy failure, or imply that an incomplete destination was rolled back.

## Stage 2: Complete Signal Visibility Semantics

### Objective

Add exact-value visibility while preserving the path-aware syntax and current boolean behavior.

### Public Contract

```html
<nodel-row visibility="Panel.mode" visible-value="Presentation">
  ...
</nodel-row>

<nodel-column
  signals="Primary.mode:visibility(any); Backup.mode:visibility(any)"
  visible-values="Presentation; Preview">
  ...
</nodel-column>
```

- `visible-value` contains one expected scalar value.
- `visible-values` contains one or more semicolon-separated expected scalar values.
- When both are present, merge and de-duplicate their values.
- Empty list entries are ignored.
- Comparison is exact and case-sensitive after trimming authored list entries and canonically stringifying scalar signal values.
- `null`, missing paths, objects, and arrays do not match an exact-value predicate.
- Without either exact-value attribute, retain current `visible|true|1` and `hidden|false|0` semantics.
- `visibility(any)` shows when at least one current binding value passes the predicate.
- `visibility(all)` shows only when every configured binding has emitted and passes the predicate.
- Last-event-wins remains the default when no aggregation mode is specified.
- Elements with exact-value visibility start hidden until a matching value is known, avoiding a flash of conditionally restricted content.
- Removing visibility attributes restores the element's authored hidden state rather than leaving stale runtime state.

### Implementation

1. Add reusable exact-value parsing and scalar normalization to `src/data/signal-bindings.ts`.
2. Supply a `visibility` aggregator to global visibility subscriptions instead of ignoring parsed `any`/`all` modes.
3. Track whether each aggregate member has emitted so `all` cannot pass from incomplete state.
4. Keep escaped-dot aliases and nested path extraction unchanged.
5. Observe newly added visibility attributes if the bootstrap currently relies only on initial markup; attribute changes must resubscribe or reevaluate safely.
6. Add the attributes to common editor completion metadata and component documentation.

### Primary Files

- `src/data/signal-bindings.ts`
- `src/editor/nodel-document-definition.ts`
- `test/signal-bindings.test.ts`
- `docs/web-components.md`
- `components.html`
- `e2e/catalogue-runtime.spec.ts`

### Validation

- Cover string, number, boolean, null, missing path, object, and array inputs.
- Cover single and plural attributes, whitespace trimming, de-duplication, and case sensitivity.
- Cover nested objects and escaped dots in aliases and property keys.
- Cover `any`, `all`, and last-event-wins with values arriving in different orders.
- Verify existing boolean visibility tests remain unchanged.
- Verify exact-value elements are hidden before the first matching event and restore authored hidden state after unbinding.

### Exit Gate

V2 can express every V1 `showevent` + `showvalue` + `showeventarg` use case without adding a comparison expression language.

## Stage 3: Add Code Confirmation As An Operator Interlock

### Objective

Restore PIN/keypad confirmation without overloading existing confirmation text and without presenting it as an authentication boundary.

### Public Contract

```html
<nodel-button
  action="Shutdown"
  confirm-mode="code"
  confirm-code-signal="ConfirmCode"
  confirm-title="Confirm shutdown"
  confirm-text="Enter the operator code">
  Shutdown
</nodel-button>
```

- `confirm-mode` supports `standard` and `code`; existing confirmation defaults to `standard`.
- `confirm-code-signal` defaults to `ConfirmCode` when code mode is selected.
- The expected code is supplied by a local signal and the confirmation subsystem never places it into generated markup, visible labels, console output, or error text. This does not conceal the underlying activity event from a separately rendered activity log.
- Treat the code as a string so leading zeroes can be preserved when the signal supplies a string.
- Code mode remains unavailable while the signal source is loading, disconnected, missing, or non-scalar.
- Changing the expected signal value while the dialog is open clears the entered code.
- This feature is documented as an accidental-action/operator interlock, not server-side authorization.

### Implementation

1. Extend `NodelConfirmRequest` and attribute parsing in `src/data/confirm.ts` with mode and code-signal metadata.
2. Add `confirm-mode` and `confirm-code-signal` to every component currently using `requestConfirm`: button, toggle, segmented control, select, palette, pad, and stepper.
3. Extend `nodel-confirm-host` with a signal subscription active only for an open code dialog.
4. Render an accessible numeric keypad, masked entered length, Clear, Backspace, Cancel, and Confirm controls.
5. Disable Confirm until entered and expected codes match exactly.
6. Keep Escape cancellation, focus trapping, backdrop cancellation, and trigger focus restoration.
7. Make fallback behavior safe: if no `nodel-confirm-host` handles code mode, cancel rather than falling back to `window.confirm`.

### Primary Files

- `src/data/confirm.ts`
- `src/components/nodel-confirm-host.ts`
- Existing confirm-capable control components
- `src/editor/nodel-document-definition.ts`
- `test/nodel-confirm-host.test.ts`
- Relevant control unit tests
- `components.html`
- `docs/web-components.md`

### Validation

- Verify standard confirmation has no behavioral or visual regression.
- Verify loading, missing, disconnected, and changing code states.
- Verify exact matching, leading zeroes, clear/backspace, keyboard digits, Enter, Escape, focus trap, and focus restoration.
- Verify no action is dispatched before a successful match and only one action dispatch occurs afterward.
- Verify the confirmation host never places the expected code in DOM text, accessible names, toast text, or console output.

### Exit Gate

Every confirm-capable V2 control can opt into the same code-signal interlock through one consistent API.

## Stage 4: Add Shared Offline State With Modal And Overlay Modes

### Objective

Give users one authoritative indication that controls cannot reach the current Nodel host while supporting both touch deployments and administration pages.

### Public Contract

```html
<nodel-app offline-mode="modal">
  ...
</nodel-app>
```

- `offline-mode="modal"` is the default when omitted.
- `offline-mode="overlay"` displays a fixed, non-layout-shifting banner above the interface and does not block interaction.
- `offline-mode="modal"` displays a non-dismissible blocking dialog/backdrop until connectivity returns.
- Set `offline-mode="overlay"` explicitly in `nodel.html`, `nodes.html`, `toolkit.html`, and other core administration entry pages.
- Custom component pages inherit modal behavior unless their author opts into overlay.

### Connectivity State

1. Add a shared same-origin connectivity coordinator rather than letting every component render a competing global state.
2. Enter offline state immediately when `navigator.onLine` becomes false.
3. Report same-origin network failures from shared REST helpers and the node activity transport to the coordinator. Ignore aborts and cross-origin remote-node failures.
4. Confirm suspected loss with a lightweight context-aware probe: relative `REST/` on node pages and `/REST` on host pages.
5. An HTTP response, including an HTTP application error, proves transport reachability and must not be classified as offline.
6. While offline, retry with a short bounded backoff and clear the global state after the first successful probe or browser `online` event followed by a successful probe.
7. Do not continuously poll while healthy; use browser events and reported same-origin transport failures to start probing.
8. Keep per-component API errors visible because an online host can still reject an individual request.

### Presentation

1. Add one connectivity host owned by `nodel-app` with `role="alertdialog"` for modal mode and an assertive status region for overlay mode.
2. Use clear text such as **Offline** and **Controls are unavailable while this Nodel host cannot be reached. Retrying...**.
3. The modal cannot be dismissed and blocks pointer and keyboard access to underlying controls.
4. The overlay is fixed-position, does not shift toolbar/page layout, does not trap focus, and remains readable in forced-colours mode.
5. Preserve page state and entered form values across disconnect/reconnect.

### Primary Files

- New `src/data/connectivity.ts`
- New `src/components/nodel-connectivity-host.ts`
- `src/api/nodel-host-client.ts`
- `src/data/node-activity-source.ts`
- `src/components/nodel-app.ts`
- Core HTML entry pages
- `src/styles.css`
- New unit tests for connectivity and presentation
- Browser tests for modal, overlay, and reconnection

### Validation

- Cover browser offline, DNS/network rejection, timeout, abort, same-origin HTTP 404/500, and cross-origin node failure.
- Verify transient component HTTP errors do not display the global offline state.
- Verify modal is the custom-page default and core pages opt into overlay.
- Verify neither mode shifts layout, and only modal mode blocks control invocation.
- Verify automatic recovery does not reload the page or lose state.
- Use deterministic fake timers for retry/backoff tests.

### Exit Gate

Users get one clear, accurate connectivity state without conflating a failed remote node or API validation error with loss of the current host.

## Stage 5: Restore Remote-Aware Links And Filtered Navigation

### Objective

Restore V1 link capabilities while keeping search on the dedicated Network page and avoiding parent-component inference.

### Public Contract

```html
<nodel-link href="https://example.org">Documentation</nodel-link>
<nodel-link node="Display Controller">Open controller</nodel-link>
<nodel-link event-binding="DisplayStatus">Open bound node</nodel-link>
```

- Exactly one destination source should be authored: `href`, `node`, or `event-binding`.
- `href` behaves as a standard anchor.
- `node` resolves through `REST/nodeURLsForNode` and uses the best discovered address.
- `event-binding` reads the local remote-event binding, obtains its configured node, then resolves that node.
- Preserve arbitrary child text and inline V2 icons/status content.
- Default to same-tab navigation. Respect an explicit `target`, and add `rel="noopener noreferrer"` for `_blank`.
- While resolving, expose an accessible busy state and use the dedicated Network page as a usable fallback when a node name is known.
- Do not infer an event binding from an ancestor `nodel-status`; migration must be explicit.

### Network Page Deep Links

1. Add a public query-parameter hook to `nodel-node-list`, for example `query-param="filter"`.
2. Set it on the core Network list so `/nodes.html?filter=Display%20Controller#Network` pre-fills and runs the search.
3. Keep URL decoding, empty values, repeated parameters, and later manual edits deterministic.
4. Make wired binding statuses in `nodel-bindings` link to the filtered Network page. Do not add node search to the drawer.

### Implementation

1. Add typed client helpers for exact node URL lookup and local remote-binding lookup/reuse existing binding data functions where available.
2. Add `nodel-link` with request cancellation and stale-result protection when attributes change.
3. Validate resolved URLs and reject unsafe schemes; allow normal same-origin relative URLs and HTTP(S).
4. Define deterministic address selection when discovery returns several entries without issuing extra cross-origin probes: prefer a current-origin address, then the first valid HTTP(S) result in backend order.
5. Register/document the component and add it to the catalogue with memory-runtime-safe examples.

### Primary Files

- New `src/components/nodel-link.ts`
- `src/api/nodel-host-client.ts`
- `src/api/nodel-types.ts`
- `src/components/nodel-node-list.ts`
- `src/components/nodel-bindings.ts`
- `nodes.html`
- `src/editor/nodel-document-definition.ts`
- New and existing component tests
- `components.html`
- `docs/web-components.md`

### Validation

- Cover static, discovered-node, and event-binding destinations.
- Cover no result, malformed binding, missing node, unsafe URL, fetch failure, stale responses, and disconnect cleanup.
- Verify fallback query links round-trip names containing spaces and Unicode.
- Verify same-tab and `_blank` behavior, keyboard activation, accessible busy/error states, and nested icon content.
- Verify no node-drawer search UI is introduced.

### Exit Gate

V2 custom pages and binding administration can navigate to local, remote, or binding-derived destinations without hidden parent coupling.

## Stage 6: Add High-Value Page Authoring Primitives

### 6A. Page Activation Actions

- Add `action`, `actions`, `arg`, and `arg-type` to `nodel-page` using the existing action-binding parser and control runtime. Use an empty object payload when `arg` is omitted to match V1 page-action behavior.
- Invoke activation actions once on initial/hash activation and on each explicit navigation selection, including explicit reselection of the current page.
- Do not invoke actions merely because a mutation rediscovered the same active page.
- Keep navigation immediate; report action failure through the shared toast path without trapping the user on the previous page.
- Add unit tests for initial activation, hash activation, explicit selection, reselection, mutation rediscovery, multiple actions, and failure.

### 6B. Status Navigation

- Use explicit `nodel-link` composition inside `nodel-status` for external/node navigation.
- For internal page navigation, support normal hash links such as `<nodel-link href="#Details">`.
- Do not make an entire status card clickable when it can contain nested buttons, toggles, or links.
- Document the migration from V1 `status page="..."` to composed links.

### 6C. Footer

- Add semantic `nodel-footer` preserving arbitrary children.
- Default to normal document flow.
- Add an explicit `fixed` attribute for V1-style touch-page footers.
- When fixed, reserve matching bottom space in the app so content is not obscured and respect safe-area insets.
- Cover responsive wrapping, mobile safe areas, keyboard focus, and no-footer pages.

### 6D. Signal-Driven Markdown

- Add `nodel-markdown` with `value`, `signal`, and `signals` targeting `value`.
- Reuse `src/utils/markdown.ts`; never restore V1's unsanitized runtime Markdown insertion.
- Add optional `max-height` from a constrained token set rather than arbitrary generated CSS and use an internal overflow region.
- Preserve a plain-text empty/loading fallback and make links safe.
- Document this as the replacement for V1 `<panel event="...">`.

### 6E. Explicit Dynamic Title And Clock

- Add `signal`/`signals` support to `nodel-app` with `title` as the default target.
- A signal-driven app title updates `document.title` and the default toolbar title; an explicit toolbar `title` remains an override.
- Add `nodel-clock` with `value`, `signal`, and `signals` targeting `value`.
- Format valid date/time input through `Intl.DateTimeFormat`; expose constrained `format="time|date|datetime"`, `hour12="auto|true|false"`, and optional `time-zone` attributes.
- Display invalid scalar values as text rather than clearing silently.
- The component reflects signal updates and does not invent an autonomous ticking clock unless a future requirement explicitly requests one.
- Do not make aliases named exactly `Title` or `Clock` globally special.

### 6F. Host Favicon

- If a page has no authored favicon, let `nodel-app` create one from `generateHostIconDataUri(window.location.host)`.
- Never replace an explicitly authored favicon.
- Keep favicon generation independent of visible toolbar icon overrides.

### Primary Files

- `src/components/nodel-app.ts`
- `src/components/nodel-page.ts`
- `src/components/nodel-toolbar.ts`
- New `src/components/nodel-footer.ts`
- New `src/components/nodel-markdown.ts`
- New `src/components/nodel-clock.ts`
- `src/main.ts`
- `src/styles.css`
- `src/editor/nodel-document-definition.ts`
- New and existing component tests
- `components.html`
- `docs/web-components.md`

### Exit Gate

Common V1 page-level behavior is expressible through explicit, composable V2 markup without magic aliases or unsafe Markdown.

## Stage 7: Finish Control And Layout Parity

### 7A. Palette Output And Live Control

- Make the existing `nodel-palette format` attribute functional for `hex`, `rgb`, `hsl`, and `hsv` action payloads.
- Keep one canonical internal colour representation and convert only at the action boundary.
- Add an editable value field when the custom picker is enabled; validate and normalize accepted formats without discarding the last valid value.
- Add explicit `live` behavior that dispatches throttled updates from picker `input`; retain current explicit Select/change behavior by default.
- Add a bounded `live-interval` with a documented default and minimum.
- Flush the final selected value at interaction end and cancel pending dispatch on disconnect.
- Keep swatches, dynamic options, selection state, confirmation, and in-memory runtime behavior working for every output format.

### 7B. Select Placement

- Add `placement="auto|bottom|top"` to `nodel-select`, defaulting to `auto`.
- In auto mode, measure available visual-viewport space when opened and choose the side that fits best.
- Reposition on relevant resize/scroll events while open and clean listeners on close/disconnect.
- Keep keyboard order logical regardless of visual placement.

### 7C. Partial Compact Status

- Extend `nodel-status-indicator` with `partial-on-value` and `partial-off-value`.
- Add `partially-on` and `partially-off` internal/data states with warning styling by default and a constrained `partial-tone` override.
- Preserve the current dot-only default.
- Add optional visible labels using `show-state-label`, `on-label`, `off-label`, `partial-on-label`, and `partial-off-label` while keeping `label` as the accessible component name.
- Define precedence: exact partial values, exact on/off values, then existing truthy/falsey inference.

### 7D. Modern Column Reordering

- Do not recreate Bootstrap push/pull offsets.
- Add `order`, `sm-order`, `md-order`, `lg-order`, `xl-order`, and `2xl-order` to `nodel-column` using CSS variables and the existing responsive breakpoint model.
- Accept a small bounded integer range and preserve source order when omitted.
- Document source-order/accessibility implications; visual order must not be used to create a nonsensical keyboard or screen-reader sequence.

### Primary Files

- `src/components/nodel-palette.ts`
- `src/components/nodel-select.ts`
- `src/components/nodel-status-indicator.ts`
- `src/components/nodel-column.ts`
- `src/styles.css`
- Existing corresponding unit tests
- `src/editor/nodel-document-definition.ts`
- `components.html`
- `docs/web-components.md`

### Exit Gate

The remaining retained control/layout gaps have V2-native APIs and preserve existing component defaults.

## Stage 8: Editor Refinements

### Drag-And-Drop Upload

- Add dragenter/dragover/dragleave/drop handling to `nodel-editor` without removing the accessible file input.
- Reuse the existing path validation, binary detection, confirmation, save, and error paths; do not create a second upload implementation.
- Start with one dropped file per operation. Reject multiple files with a clear message rather than silently selecting the first.
- Prevent browser navigation when a file is dropped over the editor.
- Show a visible drop target only during a valid drag and remove drag state on drop, leave, cancellation, and disconnect.
- Use the dropped filename as the initial path while allowing the operator to edit it before save.

### Syntax Modes

- Add CodeMirror language support for V1's previously highlighted Java, Groovy, SQL, and shell file types.
- Prefer maintained CodeMirror 6 packages; use `@codemirror/legacy-modes` only where no maintained language package exists.
- Keep unsupported extensions as plain text rather than guessing an incorrect parser.
- Record the bundle-size impact and ensure language modules are loaded only when selected if the current editor architecture permits it cleanly.

### Primary Files

- `src/components/nodel-editor.ts`
- `src/editor/codemirror-editor.ts`
- `src/editor/file-types.ts`
- `package.json`
- `test/nodel-editor.test.ts`
- `test/codemirror-editor.test.ts`
- Editor browser/visual tests

### Exit Gate

Editor upload convenience and the retained V1 syntax modes work without weakening current dirty-state, binary-file, or path-safety behavior.

## Stage 9: Integration, Migration, And Release Gate

### Migration Guidance

Add a concise V1-to-V2 mapping section covering:

| V1 | V2 |
|---|---|
| `showevent` + `showeventarg` | `visibility="Signal.path"` |
| `showvalue` | `visible-value` / `visible-values` |
| `confirm="code"` | `confirm-mode="code"` + optional `confirm-code-signal` |
| `<link url>` | `<nodel-link href>` |
| `<link node>` | `<nodel-link node>` |
| Parent status event link | `<nodel-link event-binding>` |
| `<page action>` | `nodel-page action` / `actions` |
| `<status page>` | Composed `nodel-link href="#PageId"` |
| `<footer>` | `nodel-footer`, with `fixed` when required |
| `<panel event>` | `nodel-markdown signal` |
| Magic `Title` | `nodel-app signal` / `signals` |
| Magic `Clock` | `nodel-clock signal` |
| `range type="mute"` | Compose `nodel-fader` and `nodel-toggle` |
| Bootstrap push/pull | Responsive `*-order` attributes or source-order redesign |

### Integrated Validation

1. Run formatting/type checks through the normal build.
2. Run all Vitest tests.
3. Run Playwright functional and visual suites in Chromium, Firefox, and WebKit through the established CI command.
4. Verify `npm run build` emits all entry pages and preserves the components in-memory runtime marker.
5. Verify the catalogue makes no unexpected control-backend requests.
6. Exercise duplication against a live node containing text, image, archive, nested, configuration, backup, and generated files.
7. Exercise modal offline mode on a representative touch custom page and overlay mode on every core page.
8. Exercise remote links across same-host, discovered remote-host, missing-node, and unreachable-node cases.
9. Check light, dark, narrow mobile, wide desktop, reduced-motion, and forced-colours presentations.

### Release Strategy

- Merge and release each numbered stage independently where practical; do not hold the critical duplication fix for later authoring refinements.
- Keep additive public attributes backward-compatible throughout.
- Call out the modal-by-default offline behavior in release notes because it affects custom component pages.
- Call out that `visible-value` matching is case-sensitive and that code confirmation is client-side operator protection, not authorization.
- Do not remove the legacy V1 path as part of this plan.

## Completion Criteria

- Duplication is binary-safe, filtered, ordered, configurable, and transparent about incomplete results.
- Visibility supports object paths, exact single/multiple values, and working `any`/`all` aggregation.
- Confirm-capable controls support explicit code mode using a local signal.
- Custom pages default to blocking offline modal behavior; core pages use a non-layout-shifting overlay.
- Static, node-discovered, and event-binding links are first-class V2 components, with filtered Network-page fallback.
- Page actions, footer, signal Markdown, explicit title, clock, and host favicon behavior are available without V1 magic.
- Palette, select placement, compact partial status, and responsive column order cover the retained component gaps.
- Editor drag-and-drop and retained syntax modes are restored.
- The agreed exclusions remain excluded and are documented as composition, current V2 behavior, or retired deployment workarounds.
