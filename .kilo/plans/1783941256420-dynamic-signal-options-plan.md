# Dynamic Signal-Driven Options Plan

## Goal

Add v2 equivalents of v1 `dynamicselect` and `dynamicbuttongroup` by extending `nodel-select` and `nodel-segmented`. A local Nodel signal supplies the available choices while the existing value signal, shared action, confirmation, styling, and typed-argument behavior remain authoritative.

This is an additive custom-UI API. Static child buttons must continue to work unchanged, and the legacy v1 loader remains out of scope.

## Product Decisions

- Extend existing `nodel-select` and `nodel-segmented`; do not add separate dynamic components.
- Bind options with either `options-signal="AvailableSources"` or `signals="AvailableSources:options"`. `signal` and `join` retain their current selected-value meaning.
- Keep one shared parent action. Signal data cannot introduce per-item actions, confirmation settings, HTML, icons, variants, or tones.
- Accept arrays containing scalar values, modern `{ value, label }` objects, and v1 `{ key, value }` objects.
- Preserve authored `nodel-button` children as fallback content until the first valid dynamic payload, then replace the active option set. Removing the options binding restores the authored fallback.
- Treat an empty array as a valid empty option set. Reject malformed, duplicate, or oversized payloads atomically and retain the last valid set.
- Preserve the selected `value` if it is absent from a new option set; never clear, select another value, or call an action as a side effect of an options update.
- Limit dynamic lists to 200 entries, matching `nodel-template`.
- Include keyboard and focus behavior upgrades for both controls.

## Public Contract

### Markup

```html
<nodel-select
  options-signal="AvailableSources"
  signal="CurrentSource"
  action="SetSource">
  <nodel-button value="Fallback">Fallback source</nodel-button>
</nodel-select>

<nodel-segmented
  orientation="vertical"
  signals="AvailableModes:options; CurrentMode:value"
  action="SetMode">
  <nodel-button value="Auto">Auto</nodel-button>
</nodel-segmented>
```

Add these attributes to both elements:

- `options-signal`: shorthand signal/path expression for the `options` target.
- `options-loading-label`: waiting text, default `Loading options...`.
- `options-empty-label`: valid-empty text, default `No options`.
- `options-error-label`: invalid/unavailable text, default `Options unavailable`.

The existing `signals` attribute gains the `options` target. `options(any)` and `options(all)` are invalid because collection payloads cannot be boolean-aggregated.

### Payload normalization

Normalize one complete signal argument into ordered `{ value: string, label: string }` records:

- `"HDMI 1"`, `42`, and `true` become matching string values and labels.
- `{ "value": "HDMI1", "label": "HDMI 1" }` uses the modern form.
- `{ "key": "203", "value": "Input 1 - HDMI" }` uses the v1 form: `key` is the action value and `value` is the label.
- For a v1 object with an empty/missing `key`, use its scalar `value` for both fields, matching v1 fallback behavior.
- Mixed scalar and object entries are allowed.
- Labels are assigned with `textContent`; signal data is never interpreted as markup.
- Values and labels must resolve from string, finite number, or boolean scalars. Reject null, arrays, nested objects, non-finite numbers, missing values, and blank labels/values.
- Reject the whole payload when it is not an array, contains any invalid item, contains duplicate values after string conversion, or exceeds 200 entries.
- `[]` is valid and transitions the component to `empty`.

`arg-type` continues to parse the normalized string value only when the user selects an option. Dynamic data must not bypass `parseTypedArg` or alter action payload shape `{ arg }`.

### Observable state and events

Reflect `data-options-state="static|loading|ready|empty|error"` on each host.

- `static`: no options binding; authored options are active.
- `loading`: binding exists but no valid payload has arrived. Authored fallback remains interactive; if none exists, show loading text and make the control effectively unavailable.
- `ready`: valid non-empty dynamic data is active.
- `empty`: valid empty data is active and the control is effectively unavailable.
- `error`: malformed data or source failure. Retain authored fallback or the last valid dynamic options.

Dispatch non-cancelable, bubbled events:

- `nodel-options-updated` after a valid payload, with `{ count, state }`.
- `nodel-options-error` after a rejected payload, with `{ message, issues }`; omit the raw payload to avoid retaining or logging large/sensitive values.

Do not emit toasts for signal-data errors. Use the inline status and event so repeated bad signal updates cannot create toast spam. Existing action error events/toasts remain unchanged.

## Technical Architecture

### 1. Preserve typed signal values

Update `src/data/signal-bindings.ts` without changing existing text-target behavior:

- Change target handlers to receive `(formattedValue: string, rawValue: unknown)`; existing one-argument handlers remain valid and continue receiving the same formatted text.
- Extract the path once per binding, pass the extracted raw value as the second argument, and derive the current formatted string from that same value.
- Keep `last`, `any`, and `all` aggregation behavior unchanged for current string/boolean targets. Collection handlers use only `last` mode.
- Add an optional subscription-state callback to `subscribeSignalBindings` and `createSignalBindingController` exposing `{ loading, connected, error }` from `subscribeNodeActivity`. Dynamic controls use it for loading/source-error presentation; existing callers need no changes.
- Ensure `options-signal` is converted to an ordinary path-aware `options` binding and merged with `signals` before deduplication. Escaped-dot aliases and nested paths must work exactly like existing bindings.
- If both shorthand and `signals` describe the same options binding, subscribe once through existing binding identity deduplication.

Do not JSON-parse formatted signal strings in components. The raw handler is the source of truth for collections.

### 2. Add a shared dynamic-option controller

Create `src/data/dynamic-options.ts` to keep parsing, ownership, and reconciliation identical across select and segmented controls.

Responsibilities:

- Export the normalized option and validation issue types.
- Capture authored direct `nodel-button` options in source order without cloning them.
- Track whether an options binding is active and whether a valid dynamic payload has been applied.
- Validate an update completely before mutating the DOM.
- Reconcile generated `nodel-button` elements by normalized value, updating labels in place, inserting them in payload order, and removing absent generated buttons. Mark generated nodes with `data-nodel-dynamic-option`.
- Detach authored fallback nodes only after the first valid payload; restore the same nodes when the binding is removed.
- Preserve generated node identity when values survive a reorder so focus and custom-element state are not needlessly lost.
- Generate buttons with only `value` and text content. Parent controls continue to own action, confirmation, variant/tone inheritance, disabled state, and selection semantics.
- Capture whether focus was inside an option removed by reconciliation and return enough information for each host to perform control-specific focus recovery.
- Clean up generated nodes and restore authored children on disposal/reconnection without leaking subscriptions or duplicate buttons.

Keep host-specific shell/status markup and keyboard behavior in `nodel-select.ts` and `nodel-segmented.ts`; the shared controller should not know their visual structure.

### 3. Integrate `nodel-select`

Update `src/components/nodel-select.ts`:

- Observe the new options and state-label attributes.
- Preserve the existing panel as the option container and let the shared controller own only its direct option children.
- Register `options` as a raw signal target while preserving `value`, `label`, and `disabled` targets and `join` semantics.
- Render an `aria-live="polite"` status within the component for loading, empty, and error states. Do not show loading text while authored fallback options are visible.
- Distinguish explicit `disabled` from effective unavailability caused by no active options; do not reflect temporary options state into the public `disabled` attribute.
- Close the panel if options become empty. If a focused option is removed, close the panel and return focus to the trigger.
- Preserve the selected raw value in the trigger when no current option matches. Show the state label separately; if no selected value exists, the trigger may use the loading/empty/error label.
- Keep the current max-height, scrolling popover, action, confirmation, `allow-deselect`, and action-failure behavior.

Keyboard behavior:

- Trigger: Enter/Space toggles; ArrowDown opens and focuses selected/first option; ArrowUp opens and focuses selected/last option; Escape closes.
- Open list: ArrowUp/ArrowDown move focus, Home/End jump, Enter/Space select, Escape closes and focuses the trigger, and Tab closes without trapping focus.
- Keep one option in the listbox tab sequence at a time. Put option/listbox semantics on the focusable native buttons rather than creating duplicate host/button accessibility nodes.

### 4. Integrate `nodel-segmented`

Update `src/components/nodel-segmented.ts`:

- Observe the new options and state-label attributes and register the raw `options` target.
- Use the host as the dynamic option container while ensuring status content is excluded from `options()`.
- Render a compact `aria-live="polite"` status for loading, empty, and error states. Suppress loading text while fallback buttons are visible.
- Keep the group action, confirmation, busy state, inherited active variant/tone, `allow-deselect`, and selected-value signal behavior unchanged.
- Preserve the current selected value when it disappears; render no active option until it returns or the user selects another.
- During keyed updates, retain focus on the same value. If the focused value is removed, move to the nearest remaining option by prior index, then selected option, then first option. Do not move focus when focus was outside the group.

Keyboard behavior:

- Implement roving `tabindex`: selected option is tabbable, otherwise the first enabled option; all others are `-1`.
- Horizontal groups use Left/Right and vertical groups use Up/Down, with wrapping. Home/End jump to first/last.
- Arrow navigation moves focus and selection through the existing selection path so confirmation/action semantics remain consistent; do not call actions merely because options data changed.
- Put `radio`/`aria-checked` semantics on the native focusable button and suppress redundant `aria-pressed` for select/radio contexts.

### 5. Shared styling and accessibility

Update `src/styles.css` using existing tokens and semantic primitives:

- Add a compact `.nodel-options-status` treatment for loading/empty/error text that works on body, card, and panel surfaces.
- Error state uses semantic danger text without adding a new elevated surface or toast.
- Ensure status content does not stretch segmented cells or count as a control-grid option.
- Preserve touch target sizes, popover scrolling, high-contrast boundaries, forced-colours behavior, reduced-motion behavior, and visible focus rings.
- Avoid layout shifts when a select changes from fallback to dynamic options; segmented groups may change height naturally according to option count.

## Integration Work

1. Implement raw-value and source-state delivery in `src/data/signal-bindings.ts`; update types and focused signal-binding tests first.
2. Add `src/data/dynamic-options.ts` with atomic normalization, fallback ownership, keyed reconciliation, and focus metadata.
3. Integrate the controller and states into `nodel-select.ts`, then add complete select unit tests.
4. Integrate the same controller into `nodel-segmented.ts`, including roving focus and orientation-aware keys.
5. Adjust `nodel-button.ts` only as needed to forward contextual role/ARIA/tabindex to the native button and to avoid redundant `aria-pressed` when used as an option/radio. Do not broaden the public button API.
6. Add token-based status styling and forced-colours/focus rules in `src/styles.css`.
7. Update `src/editor/nodel-document-definition.ts` with `options-signal`, the three label attributes, and the `options` signal target descriptions for both components. Update completion tests.
8. Add a Dynamic Options subsection to `components.html` showing select and vertical segmented fallback markup with the new binding syntax. On the non-node catalogue route, fallback content remains the visible example.
9. Update `docs/web-components.md` with the payload contract, state behavior, accessibility behavior, 200-item limit, and v1 migration examples:
   - `dynamicselect data="List" event="Selected" action="Selected"` -> `nodel-select options-signal="List" signal="Selected" action="Selected"`.
   - `dynamicbuttongroup data="List" join="Selected"` -> vertical `nodel-segmented options-signal="List" join="Selected"`.
10. Update `docs/architecture.md` to identify typed raw delivery and the shared dynamic-option controller as the architectural boundary; keep v1 reference-only.

## Failure and Edge-Case Rules

- Signal update before selected-value update, or vice versa: render each independently; final active state converges without actions.
- Empty valid list: detach fallback, show empty state, close select, preserve `value`.
- Malformed/duplicate/oversized update: no DOM mutation; preserve fallback or last valid list; set error state and dispatch one error event per received bad update.
- Recovery after error: the next valid payload clears error state and reconciles normally.
- Options binding removed at runtime: dispose/rebind signal subscription, remove generated options, restore authored nodes and static state.
- Component disconnected/reconnected: no duplicate options, event listeners, activity subscribers, or generated nodes.
- Reorder with stable values: reorder existing nodes; preserve focus and active styling.
- Label change with stable value: update text safely without replacing the node.
- Current selection removed: preserve host value; select displays raw value, segmented has no checked radio.
- Action in flight while options update: action uses the value captured at activation; successful completion may leave a preserved value absent from the latest options.
- Activity transport failure: retain fallback/last valid options, show error state, and recover without a toast when the source reconnects.
- No node context: no activity transport starts; catalogue/static fallback remains usable, matching other signal-bound controls.

## Testing Strategy

### Unit tests

Add `test/dynamic-options.test.ts`:

- Normalize scalar, modern object, v1 key/value, mixed, and empty arrays.
- Reject non-array, nested/missing/blank/non-finite values, duplicates after coercion, and 201 entries atomically.
- Verify text-only rendering resists HTML/script injection.
- Verify keyed reorder/relabel, fallback replacement/restoration, and cleanup.

Extend `test/signal-bindings.test.ts`:

- Existing formatted handlers remain byte-for-byte compatible.
- Raw handlers receive original arrays/objects and nested path extraction.
- `options-signal`-style path and escaped alias composition deduplicate correctly.
- Source-state callback reports loading, connected, error, and recovery without changing aggregation behavior.

Extend `test/nodel-select.test.ts` and `test/nodel-segmented.test.ts`:

- Both binding syntaxes render scalar, modern, and v1 payloads in order.
- Static children remain during loading and are restored if binding is removed.
- Valid empty state, no-fallback loading state, malformed retention, error recovery, and custom labels.
- Selected value remains when absent and becomes active again when reintroduced.
- Shared actions receive correctly parsed string/number/boolean/JSON args; option data cannot inject actions.
- Confirm, allow-deselect, busy, disabled, action failure, and option-level static overrides do not regress.
- Duplicate subscriptions/listeners/nodes do not appear after attribute changes or reconnects.
- Focus survives reorder, recovers after removal, and behaves correctly on empty updates.
- Full keyboard matrices for select and horizontal/vertical segmented controls, including Home/End, wrapping, Escape, and Tab.
- Native ARIA roles, selected/checked state, roving tabindex, live status, and effective disabled state are correct.

### Catalogue and browser tests

- Extend the catalogue coverage assertion and code/live-example parity test for the new Dynamic Options examples.
- Add Axe coverage for fallback, loading, empty, ready, and error states in light and dark themes.
- Add Playwright keyboard tests. Load `components.html`, replace browser history with a node-context path before component initialization, stub WebSocket failure, and route relative `REST/activity` with initial option/value entries so the real activity polling and raw signal path are exercised.
- Validate dynamic list replacement, selected state, trigger display, keyboard focus, and one shared action request through routed REST endpoints.
- Add a focused visual snapshot for select and segmented loading/empty/error status treatment; avoid snapshots for arbitrary dynamic list contents.
- Re-run forced-colours and unclipped-focus assertions for the new states.

### Regression validation

Run:

1. `npm run typecheck`
2. `npm run check:jsviews`
3. `npm test`
4. `npm run build:preview`
5. Targeted Playwright catalogue accessibility, visual, keyboard, mobile, dark/light, and forced-colours projects.
6. Full `npm run test:browser` before completion.

## Acceptance Criteria

- Existing static select and segmented markup behaves and renders unchanged.
- A current local signal array can replace options in both controls through either supported binding syntax without custom JavaScript.
- v1 scalar and key/value list payloads migrate directly to the documented v2 forms.
- Dynamic labels are text-safe, list updates are atomic, and no signal data can choose an action.
- Selection and action semantics remain deterministic across reorder, removal, empty, malformed, and in-flight updates.
- Loading, empty, and error states are understandable without toast spam and remain accessible in all supported themes/modes.
- Keyboard and screen-reader semantics match listbox/radiogroup expectations and focus is not lost during live updates.
- The editor hints, component catalogue, architecture guide, and web-component guide describe the same API and limits.
- Typecheck, unit tests, build, Axe checks, visual checks, and browser tests pass.

## Explicitly Out Of Scope

- New `nodel-dynamic-*` elements.
- Per-option actions or behavior supplied by signal data.
- Signal-provided HTML, icons, arbitrary attributes, styles, variants, tones, or confirmation text.
- Search, filtering, virtualization, pagination, or lists over 200 items.
- Dynamic palette swatches or arbitrary independent button grids.
- Changes to v1 XML/XSL or the legacy loader.
