# UI Theme Consistency: Implementation Record

## Goal

Close the remaining verification and visual-state gaps without redesigning the current slate/sky system or changing public custom-element APIs.

**Status:** Implemented and validated on 2026-07-12. Integration files remain untracked until the user requests staging or a commit.

## Completed baseline

Preserve the existing implementation unless a remaining test exposes a defect:

- Segmented inheritance/state correctness and unit coverage
- Pre-CSS bootstrap on all shipped pages plus runtime system/storage synchronization
- Revised light/dark surfaces, elevation, opaque control borders, teal info palette, and inactive status tokens
- Readout mask and local-surface fallback CSS
- Compact two-row mobile toolbar and viewport-clamped menus
- Semantic headings, operational empty states, microcopy, links, and native-choice styling
- Reduced-transparency, increased-contrast, reduced-motion, and forced-colours CSS
- Feedback-state catalogue fixture and add-node autocomplete light/dark fixtures
- Playwright/axe/CI infrastructure and current Linux Chromium baselines
- Current validation: 306 unit tests and 33 applicable browser tests pass

## Implemented work

### 1. Complete the 3:1 control/surface matrix

Implemented with a runtime-generated full control matrix, fast computed-colour diagnostics, and rendered pixel sampling against actual body/card/panel/popover surfaces.

1. Add a dedicated catalogue fixture containing these resting controls on body, `.nodel-card`, `.nodel-panel`, and `.nodel-popover` surfaces:
   - `.nodel-button`
   - `.nodel-field`
   - `.nodel-list-item`
   - `.nodel-select-trigger`
   - toggle track
   - stepper and pad buttons
   - fader nudge
   - theme switch
2. Give the fixture stable test selectors and enough padding to sample each boundary without shadows or neighbouring controls interfering.
3. Add `pngjs` as a development dependency and sample Linux Chromium screenshots at device scale 1:
   - Sample the centre of a straight border segment.
   - Sample the adjacent outer surface several pixels away.
   - Require at least 3:1 for every control/surface/theme pair.
4. Keep the existing computed-colour test as a fast diagnostic, but extend its selector list to all controls above.
5. If a pair fails, adjust semantic border/surface tokens; do not lower the threshold or add component-specific arbitrary colours.

### 2. Verify inactive status visibility

Implemented with rendered inactive-track pixel assertions on every semantic surface in both themes.

1. Add status-scale samples to the pixel-based surface fixture.
2. Require the inactive track border to reach 3:1 against card and panel surfaces in light and dark themes.
3. Keep the current semantic info/teal values unless the measurement or snapshots expose ambiguity with accent/success.

### 3. Exercise the readout fallback in a browser

Implemented with forced mask removal, fallback-centre assertions, and focused light/dark snapshots.

1. In a dedicated Playwright test, load the readout catalogue example.
2. Inject a test stylesheet that forces `mask`/`-webkit-mask` to `none` and forces the fallback `::after` centre to display.
3. Assert the centre uses the local surface rather than the page gradient and capture focused light/dark fallback snapshots.
4. Assert the readout remains visually ring-shaped and its value/label remain visible.
5. Retain the source assertion to guard the `@supports` structure.

### 4. Complete delayed-CSS first-paint scenarios

Implemented as a parameterized matrix that releases the intercepted stylesheet in `finally`:

1. Stored dark overrides a light system preference.
2. No stored value follows a dark system preference.
3. Malformed stored value falls back to dark system preference.
4. Throwing/blocked `localStorage.getItem` falls back to dark system preference.
5. Explicit root `data-theme="light"` wins over stored dark and dark system preference.
6. For each case, assert `document.documentElement.dataset.theme` before the delayed CSS request is released.
7. Run this matrix in one desktop Chromium project; theme rendering itself remains covered in both light/dark projects.

### 5. Complete preference and keyboard-focus validation

Implemented across semantic surfaces, an actual blurred popover, keyboard traversal, clipping ancestors, increased contrast, reduced transparency, and forced colours.

1. Under CDP-emulated `prefers-reduced-transparency: reduce`, assert:
   - Card, panel, and popover backgrounds have no gradient image.
   - Popover `backdrop-filter` is `none`.
   - Toolbar/control backgrounds use solid semantic surfaces.
2. Under `prefers-contrast: more`, assert stronger boundaries and 3px focus outlines on representative button, field, link, choice, menu item, segmented option, fader, and disclosure controls.
3. Add a keyboard helper that presses `Tab` until the expected selector is active; do not use `.focus()` for the normal keyboard-path checks.
4. For each focused control, calculate the outline rectangle from element bounds, outline width, and offset. Verify it remains within every ancestor whose overflow clips content.
5. Run the complete keyboard matrix in normal mode, then representative controls in increased-contrast, reduced-transparency, and forced-colours modes.

### 6. Make mobile navigation scrolling deterministic

Implemented with guaranteed overflow, nonzero scrolling, document overflow checks, and portrait-to-landscape menu geometry.

1. Use the full component catalogue navigation at 320px or inject enough navigation items to guarantee overflow.
2. Require `scrollWidth > clientWidth`.
3. Set `scrollLeft` to the far edge and require `scrollLeft > 0`.
4. Retain document/toolbar no-overflow checks and portrait-to-landscape open-menu viewport assertions.

### 7. Finish focused visual-state coverage

Implemented with focused state fixtures and public-event overlay interactions.

1. Add small marked catalogue fixtures, reusing real components where practical, for:
   - Disabled and busy controls
   - Partial toggle state
   - Card/panel/popover hierarchy
   - Confirm dialog and toast
   - Editor status
   - Console and activity-log empty states
2. Add matching code snippets for static fixtures so the catalogue consistency test covers them.
3. For interactive overlays, open them through their public events/actions in Playwright rather than duplicating private markup.
4. Capture focused light/dark desktop screenshots; avoid new full-page baselines.
5. Keep the existing routed add-node autocomplete fixture and selection assertion unchanged.

### 8. Close integration tracking

1. Confirm `e2e/`, all snapshot PNGs, `playwright.config.ts`, and this plan remain present and are not ignored.
2. Confirm `dist/`, `playwright-report/`, `test-results/`, videos, and traces are not included.
3. When the user requests a commit, include the currently untracked plan/browser files with the intended source changes. Do not stage or commit them before such a request.
4. Review the final diff for public API removal or renamed semantic classes; none are permitted.

## Validation gates

Run and pass:

- `npm run typecheck`
- `npm run check:jsviews`
- `npm test`
- `npm run build`
- `npm run test:browser`
- `git diff --check`

Acceptance requires:

- Every planned control reaches 3:1 against actual body/card/panel/popover rendering in both themes.
- Inactive status marks reach 3:1 on card and panel surfaces.
- The readout remains ring-shaped with masks forcibly disabled.
- All five delayed-CSS precedence scenarios set the correct theme before CSS completes.
- Keyboard focus is reached through `Tab` and is unclipped in normal and accessibility preference modes.
- Mobile navigation demonstrably scrolls at 320px and menus remain in viewport after orientation change.
- Focused light/dark baselines cover the remaining disabled, busy, partial, overlay, editor, console, and log states.

## Constraints and risks

- Preserve all custom-element attributes, events, action/signal bindings, URLs, and semantic classes.
- Pixel tests must use fixed Linux Chromium, device scale 1, animations disabled, and stable fixture geometry.
- Sample straight border segments away from rounded corners, shadows, text, and anti-aliased edges.
- Media emulation support must be checked explicitly; skip only when Chromium cannot activate the requested media feature, not when an assertion fails.
- Keep Playwright workers capped at two so the shared preview server remains stable.
