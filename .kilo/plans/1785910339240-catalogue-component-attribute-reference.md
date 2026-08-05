# Catalogue Component Attribute Reference

## Goal

Add a collapsed, complete attribute table for every component demonstrated as a custom-page authoring primitive in `components.html`, without replacing or interrupting the existing examples. Generate all table content from one audited TypeScript metadata source shared with editor completions.

## Decisions

- Keep reference tables co-located with the relevant examples rather than adding a separate API-reference page.
- Use a closed `nodel-collapse` per component. Inside it, render a semantic table with `Attribute`, `Accepted value`, `Default`, and `Description` columns.
- Repeat universal visibility attributes in every table and label them as common, so each component reference is self-contained.
- Keep placement explicit in `components.html` with inert catalogue markers; do not infer placement by scanning example markup, which would duplicate commonly nested components and place shell components unpredictably.
- Generate tables at runtime from bundled local metadata. Do not hand-author rows, fetch documentation, introspect `observedAttributes`, or add a public `nodel-*` component solely for catalogue rendering.
- Scope the reference to authored HTML attributes and declarative sub-syntax such as signal targets and action phases. Exclude JavaScript events, internal/reflected `data-*` state, CSS custom properties, and arbitrary native global attributes. Include contextual authored attributes consumed by a parent component, such as button option values/colours, and mark legacy aliases as such.
- Treat component implementations as the behavioral truth, `docs/web-components.md` as canonical prose guidance, and the new structured metadata as the authoritative source for editor completions and generated attribute tables.

## Implementation

1. Extract the element and attribute records from `src/editor/nodel-document-definition.ts` into a neutral module such as `src/nodel-component-metadata.ts`.
   - Preserve the existing editor completion behavior by importing/re-exporting the records from `src/editor/nodel-document-definition.ts`.
   - Mark which entries belong in the visual catalogue, including the intentional `nodel-link` exception, rather than maintaining another hard-coded catalogue component list.
   - Extend `NodelAttributeDefinition` with enough structured data to render enums, booleans, strings/binding syntax, finite numbers/integers, numeric bounds and units, defaults (including derived/context-dependent defaults), common status, and legacy/deprecation notes.
   - Keep enum values machine-readable so CodeMirror value completion continues to use the same records displayed in the tables.

2. Audit every catalogue component API against its implementation and `docs/web-components.md`, then complete the metadata.
   - Cover component-owned attributes, attributes consumed by composition parents, supported signal targets, action phases, defaults, normalization, and numeric constraints.
   - Include universal `visibility`, `visible-value`, `visible-values`, and the `signals` visibility-target form without duplicating or contradicting a component-specific `signals` row.
   - Reconcile known drift, including missing `xl`/`2xl` control-grid breakpoints; stepper prefix/repeat timing; directional pad actions, args, and labels; palette contextual/custom options; readout formatting/state options; accessibility naming attributes; and page attributes consumed by `nodel-app` rather than observed by `nodel-page` itself.
   - Exclude internal attributes such as `data-nodel-native-*`. Clearly identify supported legacy aliases instead of presenting them as preferred authoring syntax.
   - For unconstrained numeric inputs, say `finite number` rather than inventing a range. Distinguish accepted input constraints from operational defaults such as unit-dependent meter ranges.

3. Add a catalogue-only renderer, for example `src/catalogue/component-reference.ts`, and load it only from `components.html` with a separate module script.
   - Find explicit markers such as `<div data-catalogue-reference="nodel-button"></div>` and validate each requested component against catalogue-enabled metadata.
   - Replace each marker using DOM APIs with a closed `nodel-collapse`, a concise preview such as the attribute count, and an accessible semantic table (`caption`, column headers, row headers where appropriate).
   - Derive accepted-value text from structured metadata: enumerate fixed values, describe presence booleans, display numeric bounds/units, and show syntax/type text for open strings and bindings.
   - Merge common and component-specific definitions deterministically, label common rows, and avoid duplicate `signals` rows.
   - Fail visibly in development/tests for an unknown or duplicate marker rather than silently omitting documentation. Production output remains local and deterministic with no backend/runtime calls.

4. Place exactly one reference marker for every catalogue-enabled component in the most relevant existing page or subsection of `components.html`.
   - Group shell/layout references (`nodel-app`, `nodel-toolbar`, `nodel-page`, `nodel-theme-toggle`, `nodel-row`, `nodel-column`, `nodel-footer`) in the Layout area, adding a compact shell-reference subsection if needed.
   - Place composition references with Control Grid/Templates; picker references beside their matching subsections; fader/meter, toggle/segmented, media/status, button, title/text, page primitive, link, collapse, QR, and host-icon references beside their current primary explanations.
   - Do not add a reference every time a nested component appears. Each catalogue component must have one canonical table location.
   - Leave live examples and their matched copyable code blocks unchanged unless an API audit exposes an existing inaccurate example.

5. Add catalogue table styling using the existing Tailwind/token conventions.
   - Use a bordered semantic surface and an internal horizontal overflow wrapper so narrow screens can scroll the table without causing page-level overflow.
   - Keep attribute names, enum values, ranges, and defaults readable as code; allow descriptions to wrap.
   - Preserve light/dark, increased-contrast, and forced-colours behavior through named Nodel tokens and existing surface primitives.
   - Keep the collapse summary touch-sized and keyboard accessible through the existing `nodel-collapse` component.

6. Update `docs/web-components.md` briefly to state that catalogue attribute tables and editor completions share the structured metadata, while the document remains the canonical prose/behavior guidance.

## Validation

1. Extend `test/nodel-document-definition.test.ts` or split focused metadata tests to enforce unique component/attribute names, valid enum/default/range declarations, editor completion parity, and registry/docs coverage.
2. Replace the hard-coded catalogue coverage expectation with metadata-driven assertions where practical. Assert that every catalogue-enabled definition has exactly one marker and that no core-only component receives one.
3. Add renderer unit tests for enum, boolean, open string/binding, bounded/unbounded numeric, derived default, common-row merge, legacy note, unknown marker, and duplicate marker behavior.
4. Add a focused browser test that opens a representative large component reference (for example `nodel-button`), verifies table semantics/content, keyboard operation, and internal horizontal scrolling without page overflow at a narrow viewport.
5. Include an opened reference table in the catalogue accessibility matrix and verify both themes with axe; cover forced colours if the existing catalogue project supports it cheaply.
6. Run `npm run typecheck`, the focused Vitest files, relevant catalogue Playwright tests, and `npm run build` to verify the separate catalogue module is emitted correctly and does not alter the stable authored-page runtime contract.

## Risks And Guardrails

- Metadata can still drift from behavior. Mitigate with implementation audit plus tests that reconcile public observed/read attributes and known parent-consumed attributes; do not claim runtime introspection can derive values/defaults.
- Importing editor-specific code into the catalogue could pull unnecessary dependencies into the release. Keep raw metadata in a neutral dependency-light module and load the renderer only from `components.html`.
- Repeating common rows can become noisy, but closed collapses and generated labeling keep the normal example view unchanged and remove maintenance duplication.
- Very wide enum/syntax values can overflow mobile layouts. Contain overflow at the table wrapper and test page-level width explicitly.

## Rollout

No migration or backend changes are required. The catalogue remains a static release page using its existing in-memory demonstration runtime; authored custom pages and the stable `v2/nodel-webui.js` API are unchanged.
