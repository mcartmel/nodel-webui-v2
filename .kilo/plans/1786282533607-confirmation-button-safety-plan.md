# Confirmation Button Safety Plan

## Goal

Resolve issue #17 by formalising the existing 36/44/56px semantic button size ladder, making ordinary `.nodel-button` controls touch-safe by default, and aligning confirmation focus and colour with action risk. This is a public styling correction; it does not change confirmation events, attributes, or action dispatch.

## Decisions

- `.nodel-button` is the medium tier with `min-h-11` (44px), matching `nodel-button size="md"`.
- `.nodel-button-compact` explicitly uses `min-h-9` (36px), while `.nodel-button-touch` remains `min-h-14` (56px).
- Existing context-specific sizes remain intentional: segmented/select options may stay 40px, fader controls 36px, confirmation keypad keys 48px, and explicit `nodel-button` sizes 36/44/56px.
- Standard warning and danger confirmations initially focus Cancel; standard info and success confirmations initially focus Confirm.
- Code confirmation retains keypad-first focus because Enter cannot confirm until the code matches.
- Confirm uses the matching info, success, warning, or danger button class for every normalized dialog tone.
- No new CSS size token or public class is needed; the existing Tailwind spacing scale and semantic button classes already express the system.

## Implementation

1. Update `src/styles/10-semantic-foundation.css` so the base, compact, and touch button classes explicitly establish the 44px, 36px, and 56px minimum-height tiers. Keep the existing explicit `nodel-button[data-size]` rules aligned with those values.
2. Audit CSS selectors that combine `.nodel-button` with fixed heights. In `src/styles/40-core-administration.css`, make `.nodel-node-menu-trigger` and `.nodel-node-menu-close` deliberate 44px square touch targets rather than allowing the new base minimum height to conflict with their current 36px/32px widths. Preserve later, more-specific contextual overrides in `20-public-controls.css` where compact sizing is intentional.
3. Update `src/components/nodel-confirm-host.ts` with a typed tone-to-button-class mapping covering all `NodelToastTone` values. Use it for Confirm instead of mapping only danger and falling back to primary.
4. Adjust `focusInitialControl()` in `src/components/nodel-confirm-host.ts`: keep code mode as the first branch, then choose Cancel for warning/danger standard mode and Confirm for info/success standard mode. Do not alter modal trapping, Escape cancellation, focus restoration, or code-entry handling.
5. Update `test/nodel-confirm-host.test.ts` to cover the focus matrix for standard tones, matching Confirm classes for all tones, and keypad-first focus for ready code mode. Revise the existing warning test and its Tab-boundary assertions to start from Cancel; retain explicit danger coverage and action-resolution assertions.
6. Add browser-level coverage in `e2e/modal-focus.spec.ts` or the closest existing confirmation browser spec for a standard warning dialog: Cancel receives focus, pressing Enter resolves false and closes the dialog, and both action buttons have bounding-box heights of at least 44px. Keep the existing layered info-dialog test expecting Confirm focus.
7. Add a focused geometry contract in `e2e/control-layout-parity.spec.ts` for representative semantic base, compact, and touch buttons, asserting the 44px, 36px, and 56px minimum tiers. Include the fixed-size node-menu icon controls in the browser audit so each remains square and at least 44px.
8. Update `docs/web-components.md` in Shared Styling Classes and the button sizing guidance to document the semantic native-button ladder: standard 44px, compact 36px for dense contexts, and touch/control-grid 56px. Keep `size="sm|md|lg"` guidance consistent and avoid presenting compact controls as the default for touch workflows.
9. Regenerate only visual snapshots affected by intentional height, focus-ring, and tone changes. At minimum inspect the standard/code confirmation and public warning-dialog baselines in `e2e/catalogue.visual.spec.ts-snapshots`; review any administration-page snapshot changes caused by the global base/compact correction before accepting them.

## Risks And Compatibility

- Authored pages using the stable `.nodel-button` class will gain a 44px minimum height. This is intentional and aligns with the documented touch-first contract; no markup migration is required.
- A new base `min-height` can override an explicit smaller `height` and produce non-square icon buttons. The fixed-height audit and node-menu geometry assertions prevent that regression.
- Taller modal actions can increase dialog height in short landscape viewports. Retain the existing scrollable dialog behaviour and rerun the mobile-landscape reachability test to ensure both actions remain reachable.
- Unspecified confirmation tone normalizes to info, so its Confirm action will change from accent-primary to info styling. This is part of the all-tone consistency decision and must be reflected in reviewed snapshots.
- Compact controls remain below 44px only where callers explicitly choose the compact tier or a component context deliberately overrides size.

## Validation

1. Run `npx vitest run test/nodel-confirm-host.test.ts test/nodel-button.test.ts` during focused development.
2. Run `npm run lint`, `npm run typecheck`, and `npm run check:jsviews`.
3. Run `npm run build:preview`, then the focused Playwright confirmation, layout, catalogue visual, and mobile-landscape tests across configured projects.
4. Review and update only explained snapshot diffs, then rerun those tests without snapshot-update mode.
5. Run `npm run build` and `npm run test:browser` for final regression coverage because `.nodel-button` is a stable project-wide styling primitive.

## Acceptance Criteria

- Ordinary `.nodel-button` controls have a 44px minimum height; compact and touch tiers are explicitly 36px and 56px.
- Node-menu open and close icon buttons remain square and are at least 44px in both dimensions.
- Standard warning/danger dialogs open on Cancel; standard info/success dialogs open on Confirm.
- Ready code dialogs continue to open on the first keypad digit, regardless of tone.
- Pressing Enter immediately after opening a standard warning/danger dialog cancels rather than confirms.
- Confirm styling matches the normalized dialog tone for info, success, warning, and danger.
- Confirmation actions are at least 44px high and remain reachable in the mobile-landscape dialog.
- Documentation and reviewed visual baselines reflect the new public sizing and confirmation behaviour.
