# Log Display Icon Plan

## Goal

Make `nodel-log` icons compact, consistent, and identifiable without changing activity ingestion, row identity, filtering, ordering, or backend behavior.

## Decisions

- Keep the current activity colours:
  - local action: success/green
  - remote action: accent
  - local signal/event: danger/red
  - remote signal/event: warning/amber
- Render remote direction as a small lower-right arrow badge over a fixed-size base icon rather than stacking SVGs.
- Render binding statuses distinctly:
  - `actionBinding`: action/running-person base with a link badge
  - `eventBinding`: signal/traffic-light base with a link badge
  - do not add a remote-arrow badge because the link badge already conveys a remote binding
- Keep unbound activity neutral/muted with the appropriate action or signal base icon and no badge.
- Add tooltip and accessible icon labels using user-facing “signal” terminology rather than backend “event” terminology.
- Do not add a visible legend.

## Activity Matrix

| Source/type | Base icon | Badge | Colour | Accessible label |
|---|---|---|---|---|
| local action | running person | none | success | Local action |
| remote action | running person | arrow | accent | Remote action |
| unbound action | running person | none | muted | Unbound action |
| local event | traffic light | none | danger | Local signal |
| remote event | traffic light | arrow | warning | Remote signal |
| unbound event | traffic light | none | muted | Unbound signal |
| actionBinding | running person | link | accent | Remote action binding status |
| eventBinding | traffic light | link | accent | Remote signal binding status |
| incomplete/unknown | traffic light fallback | remote arrow only when source is remote | muted/default | Activity |

## Implementation

1. Refactor icon composition in `src/components/nodel-log.ts`.
   - Add a small internal classifier/helper that derives the base icon, optional badge icon, and accessible label from `source` and `type`.
   - Render the primary and badge SVGs with explicit classes such as `nodel-log-icon-primary` and `nodel-log-icon-badge` so layout does not depend on SVG order.
   - Add the derived activity label to `ActivityRowView` and update it in both row creation and row refresh paths.
   - Make the icon wrapper the labelled element (`role="img"`, `aria-label`, and `title`); keep the generated SVGs hidden from assistive technology.
   - Preserve `rowKey()` and all source/type data attributes.

2. Replace stacked icon styling in `src/styles.css`.
   - Change `.nodel-log-icon` from a vertical flex stack to a fixed `0.875rem` square, relatively positioned wrapper with visible overflow.
   - Keep the primary SVG within that fixed footprint.
   - Absolutely position a smaller badge at the lower-right, allowing minimal overlap into the existing column gap without increasing row height or grid-column width.
   - Preserve the four existing local/remote colour selectors and pulse treatment.
   - Keep binding rows accent-coloured and unbound/unknown rows muted.
   - Ensure forced-colours mode still leaves base and badge shapes distinguishable.

3. Extend `test/nodel-log.test.ts`.
   - Feed one batch containing the full activity matrix.
   - Assert each row’s primary `data-icon`, optional badge `data-icon`, source/type attributes, title, role, and accessible label.
   - Assert remote action/signal rows use an arrow badge, binding rows use only a link badge, and unbound rows have no badge.
   - Retain the malformed-entry regression and verify it receives the neutral fallback without throwing.

4. Add focused browser geometry coverage in `e2e/log-icons.spec.ts`.
   - Reuse the polling fixture pattern from `e2e/dynamic-options.spec.ts`: block WebSocket, route node activity, switch history to `/nodes/Demo/`, and inject `nodel-log` into a catalogue page.
   - Render local, remote, unbound, and binding examples without arguments so row geometry is comparable.
   - Assert every icon wrapper has the same width and height.
   - Assert the remote/link badge overlaps the primary icon footprint and does not increase row height or the first grid column width.
   - Assert tooltip/accessibility labels in a real browser, including forced-colours coverage where practical.

5. Update `docs/web-components.md` under `nodel-log` behavior.
   - Document compact base-plus-badge icon semantics, binding distinction, preserved colour mapping, and accessible labels.

## Scope And Risks

- Backend changes are explicitly out of scope. The known Java backend mismatch between historical remote actions and live remote/unbound actions can still create duplicate or differently classified rows. The UI must not infer or rewrite activity types because it lacks reliable target-binding context.
- No persisted data, public component attributes, REST payloads, or migration steps are affected.
- Preserve the current uncommitted action/signal spinner work; this plan should not revert unrelated edits in `src/components/nodel-actsig.ts`, `src/icons/fontawesome.ts`, or `test/nodel-actsig.test.ts`.
- Use existing `logIcons` entries (`action`, `event`, `actionBinding`/link, and `remote`/arrow); no new icon dependency is required.

## Validation

- `npm run typecheck`
- `npm run check:jsviews`
- `npm test -- --run test/nodel-log.test.ts`
- `npm run build:preview && npx playwright test e2e/log-icons.spec.ts`
- `npm test`
- `git diff --check`
- After deployment, inspect a node containing local, remote, unbound, and binding-status activity to confirm compact geometry and acknowledge that the backend history/live duplicate remains unchanged.
