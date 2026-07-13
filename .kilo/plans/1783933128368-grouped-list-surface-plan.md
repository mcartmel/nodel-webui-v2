# Grouped List Surface Plan

## Goal

Reduce repeated button-like visual noise in dense navigation lists while retaining clear touch, pointer, and keyboard affordances. Use one low-elevation collection surface with divided flat rows, consistently with the existing Nodel theme hierarchy.

## Decisions

- Add a shared `.nodel-list` collection wrapper and keep standalone `.nodel-list-item` styling raised and unchanged.
- Apply the grouped treatment to both current grouped consumers: local/network node lists and the node drawer's **Open** links.
- Use card-level tokens for the collection, transparent rows at rest, subtle token-backed dividers, and no row-level resting border, radius, shadow, gap, or accent rail.
- Preserve the existing row padding/content density, enforce at least a 44px target, and add a muted trailing chevron to communicate navigation on non-hover devices.
- Reveal the existing accent rail and interaction tint only on hover, focus, or press. Keep unreachable-node dimming and all fetch/filter/paging behavior unchanged.
- Add no new colour, radius, shadow, or component attribute API. Reuse card, divider, subtle-hover, active-control, focus, and accessibility-mode tokens.

## Implementation

1. Extend shared list styling in `src/styles.css`.
   - Define `.nodel-list` as an unstyled semantic list with one clipped, card-level surface using `--nodel-card-background`, `--nodel-card-border`, `--nodel-shadow-card`, and `rounded-card`.
   - Divide adjacent list entries with `--nodel-divider`; do not add spacing between rows.
   - In the `.nodel-list` context, make `.nodel-list-item` a full-width, minimum-44px row with transparent resting background, zero row border/radius/shadow, and no pressed translation.
   - Hide the row accent pseudo-element at rest and reveal it for hover, `:focus-visible`, and `:active`; use `--nodel-subtle-hover-background` for hover and `--nodel-control-active-background` for press.
   - Add `.nodel-list-item-affordance` for the trailing muted chevron and tint it with the row interaction state.
   - Keep grouped focus treatment inset so the collection's `overflow: hidden` cannot clip it.
   - Include `.nodel-list` and its grouped focus/divider rules in increased-contrast and forced-colours handling. Use a negative/inset outline offset there, matching the existing clipped `nodel-collapse` treatment.
   - Rely on existing reduced-transparency token overrides so the collection becomes solid without a component-specific colour.

2. Update internal collection markup.
   - In `src/components/nodel-node-list.ts`, render populated results as `ul.nodel-list.nodel-node-list-items` with one `li` per existing anchor. Keep `a.nodel-list-item`, hrefs, host icons, highlighting, unreachable state, and text structure intact.
   - Keep loading, error, and empty states outside the collection surface. Keep the **Load more** ghost button outside the list with deliberate spacing so it remains a standalone action.
   - In `src/components/nodel-node-menu.ts`, place custom UI, Toolkit, and Diagnostics links in the same `ul.nodel-list`, with one `li` per anchor. Keep loading/error/empty alerts outside that collection to avoid nested control surfaces.
   - Add an `aria-hidden` Font Awesome chevron-right at the trailing edge of each navigation row using `renderFontAwesomeIcon` and `.nodel-list-item-affordance`.
   - In `src/icons/fontawesome.ts`, expose `faChevronRight` through `uiIcons`, following the existing centralized icon wrapper.

3. Document the styling contract.
   - Update `docs/architecture.md` to distinguish standalone raised `.nodel-list-item` controls from grouped `.nodel-list` collections.
   - Update `docs/web-components.md` shared styling guidance with the recommended `ul.nodel-list > li > a.nodel-list-item` structure and explain that dense related navigation should share one card-level surface.
   - State that rows remain visibly navigational through their chevron and interaction states, while standalone items retain the stronger raised treatment.

4. Update unit coverage.
   - In `test/nodel-node-list.test.ts`, assert populated rows use one semantic `ul.nodel-list`, one `li` per node, and trailing `chevron-right` icons while preserving hrefs, host details, filtering, reachability, and icon behavior.
   - Add coverage that empty results do not leave an empty collection surface and that **Load more** is outside the grouped list.
   - In `test/nodel-node-menu.test.ts`, assert all custom/reference links share one semantic collection, preserve order/hrefs, and include decorative trailing chevrons. Preserve existing empty-custom-UI behavior and reference links.

5. Add browser and visual regression coverage using deterministic routed node data.
   - Add a focused node-list Playwright spec that loads `/nodes.html#Locals`, fulfills `/REST` with several stable nodes, and waits for the rendered collection.
   - Capture the collection at rest in light/dark desktop and mobile projects, avoiding a full-page baseline.
   - Assert a single outer collection surface, contiguous divided rows, transparent/shadowless row rest styling, visible trailing affordances, minimum 44px row targets, and no horizontal overflow at mobile width.
   - Reach a row through normal `Tab` navigation and verify its focus treatment is visible and contained by the clipped collection in normal, increased-contrast, and forced-colours modes.
   - Verify hover/press styling changes the row without introducing an individual raised border/shadow, and verify reduced-transparency produces a solid collection background when Chromium supports the preference.
   - Run Axe against `nodel-node-list` in both desktop themes and assert the muted chevron has at least 3:1 non-text contrast against the resting row surface.
   - Leave the existing standalone `.nodel-list-item` 3:1 surface matrix in `e2e/catalogue.accessibility.spec.ts` intact; it protects the unchanged standalone variant.

## Validation

- Run `npm run typecheck`.
- Run `npm run check:jsviews`.
- Run `npm test`.
- Run `npm run build:preview`.
- Run the new focused Playwright spec across all configured projects, updating only its intentional new baselines.
- Run `npm run test:browser` to catch theme, accessibility, forced-colour, and existing visual regressions.
- Manually inspect local/network lists and the node drawer in light/dark desktop and mobile layouts, confirming that only the collection is raised at rest and all rows remain clearly navigable.

## Compatibility And Rollout

- This is an additive CSS primitive and internal markup migration; no `nodel-node-list` attributes, data flow, URLs, events, or polling behavior change.
- Existing standalone `.nodel-list-item` consumers retain their current appearance unless placed inside `.nodel-list`.
- No persisted data or migration is involved. If visual regressions appear outside the two migrated consumers, treat them as selector leakage and narrow `.nodel-list` descendant selectors rather than changing global list-item tokens.
