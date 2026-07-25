# Add-node: overlay autocomplete, Cancel button, clearer click-away

## Context

`nodel-add-node` (src/components/nodel-add-node.ts) has three interaction problems:

1. **Suggestions expand the panel instead of overlaying it.** `.nodel-template-autocomplete` uses the `nodel-popover` surface class but is rendered in normal flow, so recipe/node results grow the add-node panel. The wrapper `div.relative` (nodel-add-node.ts:69) and the `z-10` rule (src/styles.css:3236-3239) show an absolute overlay was intended but never implemented.
2. **No visible close control.** The panel closes only via toggle re-click, outside click, or Esc. In-repo precedent for an inline form close action is the editor's secondary `Cancel` button next to the primary action (`data-editor-cancel-add`, src/components/nodel-editor.ts:62-63). Do NOT invent a new design element (no × icon; that pattern is reserved for overlays/drawers/toasts).
3. **Click-away boundary is invisible.** `handleDocumentClick` (nodel-add-node.ts:331-338) tests `this.contains(target)`, but the `<nodel-add-node>` host is full-width (`@apply block` + grid column), so clicking blank space beside the "Add node here" button counts as "inside" and does not close the panel. The boundary should be the *visible* surfaces: the toggle button and the panel.

## Decisions

- Overlay styling follows the existing combobox popover precedent: `.nodel-bindings-popover` (`absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-auto p-1`, src/styles.css:3349-3351) and `.nodel-select-panel` (src/styles.css:1470-1475). Apply via CSS on `.nodel-template-autocomplete`; keep template class strings unchanged except removing the flow `mt-2` (spacing moves into the CSS rule).
- `.nodel-template-selected` ("Recipe: …" confirmation card) stays in normal flow — it is persistent feedback, not a popover.
- Cancel is a secondary `.nodel-button` labeled `Cancel`, left of the primary `Add` button, disabled while `submitting` (matches editor precedent). It calls the existing `closePanel()`. No state clearing needed on cancel — `togglePanel()` already resets all fields on next open.
- Click-away closes the panel when the click is outside BOTH `.nodel-add-node-toggle` and `.nodel-add-node-panel`, even if it lands on the host's whitespace.
- Because the autocomplete now overlays the status row / Add button, it must also dismiss when the user clicks inside the panel but outside the template combobox (e.g. clicks the name field). Otherwise the open overlay obscures controls.

## Tasks

### 1. Overlay CSS — `src/styles.css` (~line 3236)

Replace the current rule pair:

- `.nodel-template-autocomplete`: `@apply absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto;` (the `nodel-popover` class on the element keeps supplying surface/border/shadow; `overflow-auto` must override its `overflow-hidden`).
- `.nodel-template-selected`: keep `z-10` (or drop z entirely since it stays in flow — verify nothing overlaps).

### 2. Template markup — `src/components/nodel-add-node.ts`

- Remove `mt-2` from the two `nodel-template-autocomplete` class strings inside the `data-link` class expression (line 72) so spacing comes from the CSS rule only. Both the visible and `hidden` variants must stay in sync (jsviews swaps whole class strings).
- Add a class to the combobox wrapper: `<div class="nodel-add-node-combobox relative">` (line 69) for click-target checks.
- Add Cancel to the footer row (line 99-108), before the submit button:
  `<button type="button" class="nodel-add-node-cancel nodel-button" data-link="disabled{:submitting}">Cancel</button>`
  Keep the status/error block layout intact (wrap the two buttons in a `flex items-center gap-2` container if needed).

### 3. Behavior — `src/components/nodel-add-node.ts`

- In `handleClick`: if the click hits `.nodel-add-node-cancel`, `preventDefault()` and call `this.closePanel()`.
- In `handleClick` (panel-internal clicks): if `state.showAutocomplete` is true and the click is inside the panel but NOT inside `.nodel-add-node-combobox`, set `showAutocomplete: false`.
- Rewrite `handleDocumentClick`:
  - Return early if `!this.state.open`.
  - Return early if `!(target instanceof Element)` or `!target.isConnected` (guards against jsviews re-renders detaching the clicked node mid-dispatch, which would otherwise falsely read as "outside").
  - Close the panel unless `target.closest('.nodel-add-node-toggle, .nodel-add-node-panel')` resolves to an element contained in `this`.

### 4. Unit tests — `test/nodel-add-node.test.ts`

Add cases (reuse `openAddNodePanel` helper):

- Cancel button click closes the panel (`.nodel-add-node-panel` gains `hidden`).
- Click on the component's own whitespace — dispatch a bubbling click on the host `<nodel-add-node>` element (or the inner `.nodel-add-node` root div) with a target outside toggle/panel — closes the panel.
- Click on `document.body` (fully outside) still closes the panel.
- With suggestions showing, clicking the `.nodel-add-node-name` input hides `.nodel-template-autocomplete` but keeps the panel open.
- Confirm existing Escape tests (lines 226-255) still pass unchanged.

### 5. E2E / visual — `e2e/add-node.visual.spec.ts`

- Add a structural assertion that locks in the overlay: capture `.nodel-add-node-panel` bounding-box height before typing and after suggestions appear; expect them equal (panel no longer grows).
- Re-run visual baselines; the `add-node-autocomplete.png` screenshots (light+dark desktop) target the autocomplete element itself and should be near-identical (`left-0 right-0` preserves width), but regenerate if positioning shifts rendering. New panel-level baselines are not required.

### 6. Docs — `docs/web-components.md` (Add Node section, ~line 983)

Extend the Behavior list:

- Suggestions render as an overlay popover below the template field.
- Close actions: Cancel button, clicking outside the toggle/panel, or Esc (first Esc dismisses open suggestions, second closes the panel).

## Validation

- `npm run typecheck`
- `npm run check:jsviews` (template class-string expressions changed)
- `npm test` (vitest; includes new add-node cases)
- `npm run test:browser` for the add-node visual spec; regenerate snapshots only if diffs appear.
- Manual sanity in `npm run dev` on `/nodes.html#Locals`: open panel, type a query, verify the dropdown overlays the status/Add row, Esc/Cancel/whitespace-click behavior, and that selecting a result still fills the field.

## Risks / notes

- jsviews `data-link` class expressions replace the entire class attribute — every literal class string variant must be edited consistently or state toggling silently drops classes (`check:jsviews` helps catch this).
- `handleDocumentClick` fires for the toggle click itself; the `closest('.nodel-add-node-toggle', …)` check must keep the toggle exempt or the panel will close immediately after opening.
- The `.nodel-popover` base class sets `overflow-hidden`; the new `overflow-auto` must win (same-specificity later rule in the `@layer` — verify order, mirroring how `.nodel-bindings-popover` does it).
