# Partial Bindings Validation Plan

## Goal

Allow empty and partial remote binding rows to be saved even though Java's emitted remote schema marks `node` and `action`/`event` as required. Keep validation for values that are supplied, preserve payload metadata, and render genuine validation messages below their fields without overlap.

## Decisions And Constraints

- Treat these row states as valid for both action and event bindings: empty, node-only, target-only, and complete.
- Relax only the direct `node` and row-specific `action`/`event` presence requirements in the bindings editor. Do not weaken shared schema validation or unrelated required properties.
- Continue validating supplied values against type, enum, numeric, and other supported schema constraints.
- Do not mutate the backend-provided schema when deriving binding-specific validation behavior.
- Keep current serialization semantics: emit only dirty binding fields, retain untouched row/section/root metadata, and do not canonicalize missing fields to empty strings or vice versa.
- Keep incomplete bindings inactive/unwired; this change only permits persistence and does not infer or auto-fill a counterpart.
- Action/signal discovery is confirmed working and is out of scope: Actions rows query actions, Events rows query signals, and existing component coverage exercises both paths. Live verification found `Gate1Output` is a signal on `Example 1`, so its absence from an Actions row was correct.
- No migration or compatibility layer is needed because the backend already accepts partial bindings.
- The worktree already contains an incomplete fix in `src/components/nodel-bindings.ts` and `test/nodel-bindings.test.ts`: retain its error-visibility/layout intent, but replace the test expectation that node-only submission must fail.

## Implementation Steps

1. Update binding-specific validation in `src/features/bindings-model.ts`.
   - In `validateBindingRow`, assemble the row value exactly as today from the original value plus dirty/present fields.
   - Validate against a cloned row schema whose direct `node` and `row.targetKey` property schemas have `required` disabled.
   - Leave every other schema property and constraint intact and keep the existing empty-row handling/documentation consistent with backend behavior.
   - Ensure repeated validation cannot alter `row.schema` or the source schema model.

2. Reconcile form validity and error presentation in `src/components/nodel-bindings.ts`.
   - Keep `invalid` derived from the revised binding validation issues so partial rows no longer disable Save or abort `saveBindings()`.
   - Preserve submit-time validation and the current touched-field/reveal-all behavior for genuine supplied-value errors.
   - Retain block-level, spaced node and target alerts (`block` plus top margin) and their `role="alert"`, `aria-invalid`, and `aria-describedby` relationships so alerts occupy layout space below inputs.
   - Do not add warnings for a missing counterpart because partial bindings are an intentional valid state.

3. Expand pure model coverage in `test/bindings-model.test.ts`.
   - Use a representative Java remote row schema with `required: true` on `node` and `action`/`event`.
   - Assert no validation issues for empty, node-only, target-only, and complete rows.
   - Assert an invalid supplied value, such as a target outside an enum, still produces a field-specific issue.
   - Assert validation leaves the original schema's `required` flags unchanged.

4. Correct and extend component regressions in `test/nodel-bindings.test.ts`.
   - Rewrite the existing "blocks writes for emitted required fields" case to prove a partial row saves while unknown root, section, and row metadata remain intact.
   - Replace the newly added bulk-node test's submit rejection with assertions that no target error appears, Save remains enabled, submission calls `saveNodeRemoteBindings`, and the payload contains the selected row's node without manufacturing an action/event.
   - Add target-only coverage and a mixed-form case containing complete, partial, and untouched rows to prove one partial row cannot globally block otherwise valid saves.
   - Keep a genuine invalid-value case to verify saving is blocked, the affected input receives `aria-invalid="true"` and `aria-describedby`, and the alert retains block spacing classes.

5. Add layout-level coverage in `e2e/authored-administration-contract.spec.ts`.
   - Give the existing mocked action target a small enum, enter a non-enum target, and wait for its validation alert.
   - Compare Playwright bounding boxes and assert the alert begins at or below the input's bottom edge, covering the reported overlap with actual browser layout.
   - Keep lookup requests deterministic by stubbing any action-definition endpoint triggered by editing the target.

## Validation

1. Run focused tests: `npm test -- --run test/bindings-model.test.ts test/nodel-bindings.test.ts`.
2. Run template and type checks: `npm run check:jsviews` and `npm run typecheck`.
3. Build browser assets and run the administration contract in its supported project: `npm run build:preview`, then `npx playwright test e2e/authored-administration-contract.spec.ts --project=chromium-light-desktop`.
4. Run the complete unit suite: `npm test`.
5. Confirm `git diff --check` passes and review that no shared parameter/action schema validation behavior changed.

## Acceptance Criteria

- Save is available and succeeds for empty, node-only, action/event-only, complete, and mixed binding collections.
- A bulk node assignment does not create or display a required target error.
- Saved partial payloads preserve missing counterparts as missing and preserve all unrelated backend metadata.
- Invalid supplied values still block saving and remain accessibly associated with the correct field.
- Validation alerts render below, not over, their inputs at browser layout level.
- The backend schema object and shared schema-validation behavior remain unchanged.
