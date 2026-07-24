# Flat, Clean Theme Refresh

## Goal

Replace the 2021-era glassmorphism look (translucent gradient surfaces, radial background glows, backdrop blur, emboss inset highlights, heavy light-mode control borders) with a flat, solid, modern-clean theme. Add typography refinement. Update guideline docs to match. No component or page markup changes; no class-name or public API changes.

## Resolved decisions

- **Scope**: full set — flatten theme, lighten light-mode control borders, remove emboss insets, slim status shells, typography tightening, docs updates.
- **Glass**: removed entirely. Tokens stay defined but hold solid flat values so every existing `var(--nodel-*-background, fallback)` reference keeps working. All `backdrop-filter` declarations and the `--nodel-glass-blur` / `--nodel-control-highlight` tokens are deleted.
- **Button rebalance**: deferred. Variant class semantics (`.nodel-button-primary` = solid, etc.) unchanged. Solid fills are already flat colors; the soft/outline/active gradient tones are flattened as part of this work. Re-evaluate emphasis after seeing the flattened result.
- **Status shells**: keep the three tones and state tints, but flat and 1px instead of gradient and 2px.

## Files affected

1. `src/styles.css` — all visual changes (token blocks + ~25 direct gradient declarations + 4 blur sites + typography).
2. `tailwind.config.ts` — remove the `fontSize.15` token.
3. `docs/architecture.md` — Styling Layer section wording.
4. `docs/web-components.md` — token description wording.
5. `e2e/*-snapshots/` — regenerated after human review of diffs (expected churn).
6. `AGENTS.md` — no change needed (verified: no glass references; Shared Styling section stays accurate).

## Task 1 — Flatten the light theme token block (`src/styles.css:6–90`)

Replace these values in `:root`:

```
--nodel-body-background: rgb(var(--nodel-bg));            /* was radial glows + gradient */
--nodel-card-background: rgb(var(--nodel-surface));
--nodel-panel-background: rgb(var(--nodel-surface-raised));
--nodel-popover-background: rgb(var(--nodel-surface-raised));
--nodel-toolbar-background: rgb(var(--nodel-surface));    /* was white/0.54 */
--nodel-control-background: rgb(var(--nodel-surface));
--nodel-control-hover-background: rgb(var(--nodel-accent) / 0.07);
--nodel-control-active-background: rgb(var(--nodel-accent) / 0.12);
--nodel-control-border: rgb(148 163 184);                 /* slate-400; was rgb(91 106 124) */
--nodel-shadow-control: 0 1px 2px rgb(15 23 42 / 0.06);   /* inset highlight removed */
--nodel-shadow-control-active: 0 1px 1px rgb(15 23 42 / 0.07);
--nodel-shadow-panel: 0 10px 32px rgb(15 23 42 / 0.09);   /* inset top line removed */
```

Delete `--nodel-glass-blur` (line 40) and `--nodel-control-highlight` (line 52).
`--nodel-shadow-card` (light) already has no inset — leave.

## Task 2 — Flatten the dark theme token block (`src/styles.css:92–165`)

```
--nodel-body-background: rgb(var(--nodel-bg));
--nodel-card-background: rgb(var(--nodel-surface));
--nodel-panel-background: rgb(var(--nodel-surface-raised));
--nodel-popover-background: rgb(var(--nodel-surface-raised));  /* solid 30 41 59 */
--nodel-toolbar-background: rgb(var(--nodel-surface));         /* was 7 11 24/0.62 */
--nodel-control-background: rgb(255 255 255 / 0.07);           /* was white-alpha gradient */
--nodel-control-hover-background: rgb(var(--nodel-accent) / 0.10);
--nodel-control-active-background: rgb(var(--nodel-accent) / 0.16);
--nodel-shadow-card: 0 10px 36px rgb(0 0 0 / 0.16);            /* inset removed */
--nodel-shadow-control: 0 1px 2px rgb(0 0 0 / 0.38);           /* inset removed */
--nodel-shadow-control-active: 0 1px 1px rgb(0 0 0 / 0.36);
--nodel-shadow-panel: 0 14px 42px rgb(0 0 0 / 0.24);           /* inset removed */
```

Keep dark `--nodel-control-border: rgb(139 153 171)` as-is. Delete `--nodel-glass-blur` (line 125) and `--nodel-control-highlight` (line 137).

## Task 3 — Flatten direct gradient declarations

Replace each two-stop `linear-gradient(180deg, rgb(TONE / A), rgb(TONE / B))` with the flat color `rgb(TONE / C)` per this table (TONE is the local `*-tone-rgb` variable at each site):

| Location (approx. line) | Selector | Old A/B | New C |
|---|---|---|---|
| 1009 | `.nodel-button-soft` | 0.14/0.08 | 0.10 |
| 1015 | soft hover | 0.20/0.12 | 0.15 |
| 1023 | `.nodel-button-outline` | 0.07/0.035 | 0.05 |
| 1029 | outline hover | 0.16/0.09 | 0.12 |
| 1069 | soft/outline `:active` | 0.24/0.14 | 0.18 |
| 1076 | `.nodel-button.is-active` | 0.20/0.12 | 0.15 |
| 1084 | soft/outline `.is-active` | 0.22/0.12 | 0.16 |
| 1305 | segmented active | 0.20/0.12 | 0.15 |
| 1312 | segmented active hover | 0.26/0.16 | 0.20 |
| 1375 | select soft trigger | 0.12/0.06 | 0.09 |
| 1381 | select outline trigger | 0.06/0.025 | 0.04 |
| 1386 | stepper/pad/palette soft | 0.12/0.06 | 0.09 |
| 1392 | stepper/pad/palette outline | 0.06/0.025 | 0.04 |
| 1517 | stepper/pad/palette `:active` | 0.22/0.13 | 0.16 |
| 1575 | pad button hover | 0.18/0.10 | 0.13 |
| 1580 | pad button `.is-active` | 0.24/0.14 | 0.18 |
| 2183 | fader soft track/nudge | 0.12/0.06 | 0.09 |
| 2190 | fader outline track/nudge | 0.06/0.025 | 0.04 |
| 2278 | fader nudge `:active` | 0.22/0.13 | 0.16 |

Special cases:

- **Pad button resting** (line 1564): `linear-gradient(180deg, rgb(var(--nodel-surface-raised) / 0.75), rgb(var(--nodel-border) / 0.22))` → `var(--nodel-control-background, rgb(var(--nodel-surface)))` (matches other controls).
- **Fader track shadow** (line 2177): keep `inset 0 1px 2px rgb(0 0 0 / 0.18)` (recessed groove is a functional affordance), delete the second term `0 1px 0 var(--nodel-control-highlight, transparent)` (last remaining `--nodel-control-highlight` reference).

Do **not** touch the `mask-image` gradients (lines 1680–1683, 2827–2828) — those are scroll-fade masks, not surfaces.

## Task 4 — Remove backdrop blur

Delete the `-webkit-backdrop-filter` / `backdrop-filter` declaration pairs at:

- `.nodel-popover` (~2416–2417)
- `.nodel-toast` (~2603–2604)
- `.nodel-node-menu-drawer` (~3172–3173)
- `.nodel-editor-status` (~3577–3578)

Leave the `background: var(--nodel-popover-background, …)` lines — they auto-flatten via Tasks 1–2.

## Task 5 — Slim status shells (`src/styles.css:486–504`)

- Base shell: `border-width: 2px` → `1px`; background → `linear-gradient(rgb(var(--nodel-status-tone-rgb) / 0.06), rgb(var(--nodel-status-tone-rgb) / 0.06)), var(--nodel-status-base-background)`; border-color `tone / 0.34` → `tone / 0.30`. (The single-stop gradient overlay keeps the opaque base beneath the tint.)
- `[data-tone='solid']`: flat overlay `tone / 0.12`; border `tone / 0.46` → `tone / 0.40`.
- `[data-tone='outline']`: flat overlay `tone / 0.03`; border `tone / 0.78` → `tone / 0.60`.
- Scale bars, state color mappings, and `nodel-status-indicator` unchanged.

## Task 6 — Typography

- `nodel-title[data-level='1']` (648): add `letter-spacing: -0.02em`.
- `nodel-title[data-level='2']` (653): add `letter-spacing: -0.01em`.
- Level 3 unchanged.
- `.nodel-catalogue-title` (835): add `@apply tracking-tight` (≈ -0.025em).
- `.nodel-catalogue-subtitle` (839): add `letter-spacing: -0.01em`.
- Replace both `text-15` usages — `.nodel-catalogue-description` (843) and `.nodel-description-content` (2832) — with `text-sm leading-6`, then delete the `fontSize.15` entry from `tailwind.config.ts`. Keep `fontSize.13` (used by `.nodel-editor-status`).

## Task 7 — Remove the now-redundant reduced-transparency fallback

Delete the entire `@media (prefers-reduced-transparency: reduce)` block (3670–3682). All its overrides are now the defaults; remaining alpha tints sit on opaque surfaces, which the mode permits. Keep `prefers-contrast: more` and `forced-colors` blocks untouched.

## Task 8 — Update guideline docs

- `docs/architecture.md` (line 66, Styling Layer): rewrite the "Light and dark themes use shared glass surface tokens for page gradients, translucent cards…" sentence to describe flat, solid surface tokens (opaque card/panel/popover/control backgrounds, hairline borders, elevation via one shadow cue); remove `prefers-reduced-transparency` from the fallback list in the paragraph beginning "The sans stack is native-system only…" (~line 68).
- `docs/web-components.md` (line 134): replace "glass surface tokens such as `--nodel-card-background`…" with "solid surface tokens such as …".
- `AGENTS.md`: verify no contradictions after the doc edits (expected: none; no edit).

## Validation

1. `npm run build` (typecheck + jsviews check + vitest + vite build) — must pass. No unit test changes expected (no class-name or API changes).
2. Visual specs: run `npx playwright test` — expect snapshot failures across `catalogue.visual`, `add-node.visual`, `node-list.visual`, and `dynamic-options` suites. **Human gate**: review diff images in `playwright-report/` / `test-results/` to confirm the new look matches intent (flat surfaces, no glows, lighter light-mode borders, slimmer status shells), then regenerate with `npx playwright test --update-snapshots` and re-run to green.
3. `e2e/catalogue.accessibility.spec.ts` (axe) must pass unmodified — flattening improves contrast predictability; report any new violation rather than loosening rules.
4. Manual spot-check matrix (dev server): light + dark themes; resting/hover/active on button, segmented, select, stepper, pad, fader nudge, list-item, menu-item; status blocks in all states × tones; popover, toast, node-menu drawer, editor status pill — all legible without blur; `prefers-contrast: more` and `forced-colors` still render usable high-contrast output.
5. Optional: `npm run deploy:preview` smoke test of the deployed bundle.

## Risks and notes

- Snapshot churn is large and expected; the human diff review (step 2) is the quality gate, not the green run.
- Lightening `--nodel-control-border` slightly reduces resting touch affordance; mitigated by retained `--nodel-shadow-control`, accent hover/active borders, and the unchanged `prefers-contrast: more` override that forces strong borders.
- `nodel-toggle-track`, `.nodel-catalogue-code`, `.nodel-node-menu-drawer`, `.nodel-editor-status`, and `.nodel-collapse-summary` all consume the changed tokens via `var()` and flatten automatically — no per-selector edits needed; verify visually in step 4.
- Deferred (explicitly out of scope): button emphasis rebalance (solid reserved for primary/danger), `--nodel-control-hover-border` policy, any component markup or API changes, placeholder italic style.

## Open questions

None — all decisions resolved with the user (scope: full; glass: removed; button rebalance: deferred).
