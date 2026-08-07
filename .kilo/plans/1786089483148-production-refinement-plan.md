# Production Refinement Implementation Plan

## Goal

Complete the remaining Web UI refinement work after the production-readiness programme: close component-contract drift, make CodeMirror authoring assistance correct and useful, expose lazy-component failures, strengthen continuous quality and supply-chain gates, publish a machine-readable component contract, and decompose the remaining maintenance hotspots without changing supported public markup or backend wire behavior.

## Explicit Exclusions

- Do not add or rehearse a real Java package installation, production merge, service restart, or rollback flow.
- Do not design or test deployment CSP or HTTP response headers in this programme.
- Do not fetch `REST/actions` or `REST/events` for editor completion.
- Do not infer, index, validate, or suggest action/signal names from the open document. XML/HTML remains the authoritative free-form source from which recipe tooling later creates those points.
- Do not make `nodel-page` navigation attributes reactive after connection; classify them as initialization-time authoring inputs.
- Do not add compatibility behavior for the unimplemented `nodel-node-list` `show-filter` and `show-total` metadata entries; remove those unreleased declarations.

## Settled Decisions

- Publish `v2/nodel-components.json` as a stable, versioned release asset.
- Include custom, core, and internal auto-created elements in that contract, with explicit audience and authoring visibility.
- Keep the current public component markup and stable CSS/JS entry contract unchanged.
- Editor diagnostics are non-blocking CodeMirror diagnostics: errors for invalid literal syntax/values and impossible known composition, warnings for unknown Nodel attributes, normalization/clamping, and advanced/core usage. They never block file save.
- Suggest only the curated shipped authoring CSS API: semantic classes, variants/states, and named Nodel token utilities. Do not suggest arbitrary Tailwind output or internal selectors.
- Lazy-load failures receive an inline accessible alert with Retry and Reload actions, plus at most one deduplicated app toast per failed tag.
- CI blocks unexcepted high/critical dependency advisories and reports lower severities.
- Coverage gates target boundary/domain modules rather than using a single global percentage to reward DOM wrapper coverage.
- The decomposition programme includes `nodel-editor`, `nodel-bindings`, component contracts, `nodel-app`, and `nodel-actsig` as separate behavior-preserving changesets.

## Stage 0: Freeze Refinement Baselines

1. Start from a green `npm run build`, `npm run test:browser:dist`, deployment smoke, and clean `git diff --check`; retain the current `dist` inventory as the pre-refinement comparison point.
2. Add failing regression tests before changing completion behavior:
   - Apply a Nodel opening-tag completion after a typed `<` and assert no doubled delimiter.
   - Complete a partially typed enum value and assert replacement rather than suffix insertion.
   - Complete closing tags, single- and double-quoted values, long start tags, and attributes after existing attributes.
   - Assert ordinary HTML elements/attributes remain available beside Nodel completions.
   - Apply page/head scaffolds and assert no literal `${}` placeholders remain.
3. Capture the current component registry and metadata as the initial contract fixture used to review the intentional Stage 1 schema conversion. The fixture is review evidence, not a second source of truth.
4. Record current uncompressed and gzip sizes for the stable entry closure, complete CSS, CodeMirror chunk, catalogue page, and total deploy inventory. Do not set budgets until Stages 1-3 establish the new intentional baseline.

### Exit Criteria

- Existing validation is green before behavior changes.
- Completion defects are represented by focused failing tests.
- Contract and size changes can be reviewed against an explicit baseline.

## Stage 1: Establish The Canonical Component Contract

### Contract Model

1. Replace the monolithic definition body in `src/nodel-component-metadata.ts` with small contract modules under a neutral `src/component-contract/` boundary. Keep a small aggregate/re-export module so the editor and catalogue have one import.
2. Define a JSON-serializable schema containing:
   - Contract `schemaVersion` and package version.
   - Element name, description, snippet/scaffold metadata, audience (`custom`, `core`, `internal`), registration (`eager`, `lazy`, `auto-host`), catalogue visibility, and completion visibility (`recommended`, `advanced`, `hidden`).
   - Attributes with value type, accepted enum values, syntax, numeric constraints, default/default description, legacy/deprecation guidance, completion visibility, and consumption mode (`observed`, `initialization`, `parent`, `contextual-child`, or wildcard).
   - Structured action phases, default signal target, legal signal targets/aggregations, known parent/child constraints, and public custom events where applicable.
   - Curated public style metadata for semantic classes, state/variant classes, and named Nodel utility tokens.
3. Keep descriptive contract data out of eager component runtime modules. Where runtime normalization values and contract values currently duplicate, move small enums/default constants into focused dependency-light modules that both sides can import without pulling the aggregate contract into the eager bundle.
4. Assign all documented elements an audience. Internal auto-created hosts remain in the JSON contract but are hidden from ordinary completion and clearly marked as not author-instantiated.
5. Remove `show-filter` and `show-total` from the `nodel-node-list` contract. Add a regression proving no generated catalogue/editor/public JSON row advertises them.
6. Mark `nodel-page` `title`, `nav-label`, and `nav-id` as initialization-time/parent-consumed. Document that changing them after connection is unsupported rather than adding mutation behavior.

### Publication And API Review

7. Add one deterministic serializer for the public contract. It must exclude functions, source paths, timestamps, and environment-specific data; preserve intentional completion ordering; and reject duplicate elements, attributes, enum values, style names, or invalid defaults.
8. Extend the Vite plugin/configuration so development serves and production emits `v2/nodel-components.json` from the in-memory canonical contract. Do not check in a second hand-maintained production JSON file.
9. Extend release/deployment verification so:
   - The JSON asset is required in `dist/v2/`, deploy previews, release inventory, and release ZIP.
   - `release.json` records its schema version, path, and SHA-256.
   - Archive and deployment verifiers reject a missing, stale, malformed, or unhashed contract.
10. Add a checked-in golden contract fixture and a comparison script/test that categorizes removals, enum narrowing, audience restriction, changed defaults, and removed phases/targets as breaking; additions as additive; and prose-only changes as informational. Updating the fixture must be an explicit reviewed change.

### Bidirectional Alignment Tests

11. Replace the current one-way observed-attribute assertion with bidirectional checks across custom and core components:
   - Every observed attribute exists in metadata and is classified `observed`.
   - Every metadata attribute classified `observed` appears in `observedAttributes`.
   - Every non-observed metadata attribute declares a valid alternate consumer and has a focused behavior test.
   - Wildcards such as `data-*` are explicit and bounded.
12. Retain and strengthen the existing registry checks for main imports, lazy loaders, docs, catalogue membership, CSS display defaults, and anti-FOUC selectors. Compare semantic registry fields rather than relying only on broad string inclusion where practical.
13. Add table-driven component assertions for declared defaults, accepted enums, normalization/clamping behavior, and dynamic-vs-initialization consumption. Tests should exercise DOM-visible/ARIA/data-state behavior instead of duplicating implementation functions.
14. Update the catalogue generator to consume only the aggregate contract and show audience, initialization-only, legacy/deprecated, syntax, default, and constraint information consistently.

### Exit Criteria

- One source produces catalogue rows, editor schemas, API-diff evidence, and `v2/nodel-components.json`.
- Component/attribute registration and consumption drift fails tests in both directions.
- `show-filter` and `show-total` are absent from every public surface.
- Contract publication is deterministic and included in release integrity checks.

## Stage 2: Rebuild Editor Authoring Assistance

### Completion Correctness

1. Remove the 160-character regex completion parser in `src/editor/nodel-document-definition.ts`.
2. Adapt the canonical contract to CodeMirror's native language mechanisms:
   - For HTML, wrap or configure `htmlCompletionSourceWith` so standard HTML completion remains present and Nodel tags/global attributes are added contextually.
   - For XML, generate `ElementSpec`/`AttrSpec` data for `xml()` or `completeFromSchema`.
   - Do not install a Nodel-only `autocompletion({ override: [...] })` that suppresses language defaults.
3. Let native syntax-tree context own tag, closing-tag, attribute, quote, and replacement ranges. Enrich Nodel options with contract descriptions, defaults, accepted values, constraints, audience, and legacy/deprecation information.
4. Use CodeMirror `snippetCompletion`/snippet application for explicit scaffolds. Opening-tag completion should insert context-appropriate tag text and rely on normal close-tag behavior rather than applying an entire raw element over the wrong range.
5. Replace the incomplete head snippet with a complete current authored-page scaffold containing doctype, language, viewport, canonical theme bootstrap, stable CSS/JS references in the required order, `nodel-app`, toolbar, page, row, and column. Keep the scaffold synchronized through a shared authoring fixture/constant and a release-gate assertion. CSP redesign remains out of scope.
6. Rank recommended custom UI elements first, show documented core elements as advanced completions, and omit internal auto-host elements from ordinary suggestions. Explicit search/help may still describe internal entries from the published contract.

### Structured Static Hints

7. Keep all action and signal names free-form. Add only grammar-aware assistance:
   - Supported action phases after the `:` in `actions` and direction-specific action lists.
   - Supported signal targets and allowed `(any|all)` aggregation after the `:` in `signals`.
   - Syntax/detail help for paths, separators, `join`, visibility, confirmation, and template placeholders.
   - No REST calls, document symbol index, unknown-name warning, or point existence validation.
8. Add document-local navigation hints for static fragment destinations using declared `nav-id` values and title-derived page IDs. Treat duplicate/ambiguous derived IDs conservatively and do not rewrite markup.
9. Add `class` value completion from the curated style contract only. Replace the active class token, suppress already-present tokens, label semantic versus utility entries, and explain that arbitrary Tailwind utilities are not guaranteed in no-build pages.

### Non-Blocking Diagnostics

10. Add a direct `@codemirror/lint` dependency and a syntax-tree-backed Nodel markup linter for HTML/XML:
    - Error: invalid literal enum, malformed numeric syntax, malformed binding/action grammar, duplicate mutually-exclusive destination sources, or a contract-defined impossible parent/child placement.
    - Warning: unknown `nodel-*` attribute, out-of-range value that runtime clamps, compatibility alias/deprecated usage, direct use of advanced core elements, or author-instantiation of an internal host.
    - Ignore safe global HTML/ARIA/data attributes and template-placeholder values that cannot be validated statically.
    - Never diagnose free-form action/signal names or block Save.
11. Bound diagnostics per document and message length so malformed or very large allowed documents cannot create unbounded work or disclose arbitrary content in errors.
12. Debounce/reuse syntax-tree analysis through CodeMirror updates; cancel stale analysis when documents or language modes change.

### Discoverability And Tests

13. Add concise accessible editor help shown for HTML/XML, such as `Ctrl/Cmd+Space for Nodel UI hints`, plus a diagnostic count/status that does not overwrite save/reload status.
14. Expand unit tests for HTML/XML adapters, metadata details, completion ranking, binding phase/target grammar, class hints, scaffold application, diagnostic severity, malformed input bounds, and language-switch cancellation.
15. Add Playwright coverage that types into the real CodeMirror instance, opens completion, selects options by keyboard, verifies resulting text/cursor fields, checks diagnostics, confirms standard HTML completion remains, and runs Axe on completion/diagnostic UI in light and dark themes.

### Exit Criteria

- Native HTML/XML and Nodel completion coexist.
- Opening tags, closing tags, partial values, quotes, long tags, and snippets apply correctly in a real editor.
- The editor provides static component/attribute/value/phase/target/style/navigation assistance without querying or validating runtime points.
- Diagnostics are bounded, useful, and never block file saving.

## Stage 3: Make Lazy Component Failures Visible And Recoverable

1. Extend `nodel-component-loader.ts` to retain per-tag load state and associate automatic load requests with the unresolved element instances that triggered them.
2. On automatic load failure, render a bounded accessible fallback adjacent to each unresolved hidden element:
   - `role="alert"`, failed component tag, safe generic explanation, Retry button, and Reload button.
   - Never render raw network response bodies, chunk URLs with sensitive query data, or unbounded exception text.
   - Preserve authored child content in the unresolved element and avoid replacing it destructively.
3. Retry through the existing single-flight loader after clearing only the failed attempt state. Disable Retry while pending. If browser module-failure caching causes another rejection, keep the alert and make Reload the reliable recovery path.
4. On successful retry/definition, remove all fallback UI for that tag and let custom-element upgrade proceed normally.
5. Preserve the bounded `nodel-component-load-error` event and promise rejection for advanced callers. Add one lifecycle-safe `nodel-app` window listener that mirrors at most one toast per failed tag/attempt generation; the inline alert remains authoritative.
6. Add shared semantic classes for the fallback in the appropriate core/semantic style layer, including forced-colours and reduced-motion behavior. Ensure anti-FOUC still hides only the unresolved custom element, not its fallback.
7. Test initial scan failures, dynamically inserted failures, concurrent instances, retry success/failure, disconnect/removal, duplicate suppression, error bounds, app reconnect, no-app pages, keyboard focus, and zero unhandled rejections/page errors.

### Exit Criteria

- A failed core chunk can no longer leave the only relevant UI silently invisible.
- Recovery is keyboard accessible, bounded, deduplicated, and tested for automatic and imperative loading.

## Stage 4: Strengthen Static Quality, Coverage, And Supply-Chain Gates

### Lint And TypeScript

1. Add ESLint flat configuration for TypeScript and project JavaScript/MJS. Enforce at minimum floating-promise, misused-promise, awaitability, unsafe boundary use, duplicate imports, dead code, and type-only import rules. Scope narrow test/mock exceptions explicitly rather than weakening production rules.
2. Add `lint` and non-gating local `lint:fix` scripts; make `npm run build` and CI run lint before tests/build output.
3. Enable stricter TypeScript settings in separate green changesets:
   - `noImplicitReturns` and `noFallthroughCasesInSwitch`.
   - `noUncheckedIndexedAccess`, fixing boundary indexing rather than adding broad assertions.
   - `exactOptionalPropertyTypes`, correcting model/API optionality rather than assigning `undefined` indiscriminately.
4. Keep `strict`, `noUnusedLocals`, and `noUnusedParameters`; do not add blanket `any`, `@ts-ignore`, or unchecked cast escapes to close errors.

### Coverage And Property Tests

5. Add V8 Vitest coverage and a `test:coverage` command. Gate per-module/group coverage for:
   - API codecs and request/URL/path/JSON boundaries.
   - Schema normalization, hydration, serialization, and validation.
   - Action/signal/binding parsers and control state machines.
   - Activity/restart accumulation and operation coordinators.
6. Require at least 90% lines/statements/functions and 85% branches for each selected pure boundary/domain group. Add tests to meet the floor before enabling it; do not lower a floor merely to match an uncovered branch. Report component/DOM coverage without a global blocking floor initially.
7. Add property/fuzz tests for URL and node-file policies, action/signal expression parsing, typed action arguments, schema round trips, activity cursor accumulation, and completion/diagnostic parsing bounds. Persist minimal regressions when fuzzing finds a failure.

### Dependencies, Licenses, And SBOM

8. Pin every GitHub Action to a full immutable commit SHA with a comment recording the human-readable release. Add grouped monthly Dependabot updates for npm and GitHub Actions.
9. Add an advisory verifier that consumes machine-readable audit output, blocks unexcepted high/critical findings, reports lower severities, and supports only checked-in exceptions containing advisory ID, bounded reason, owner, and mandatory expiry. Expired or unmatched exceptions fail closed.
10. Add PR dependency review and run the advisory gate after `npm ci` in build and release workflows. Preserve an auditable JSON report as a CI artifact on failure.
11. Generate a normalized CycloneDX SBOM from the exact lockfile used for release. Reject machine-specific paths/non-deterministic fields, include `SBOM.cdx.json` in the release root and hash inventory, and verify it after archive creation.
12. Generate a deterministic production-dependency license inventory, validate every package against an explicit project policy, reconcile it with `THIRD-PARTY-NOTICES.md`, and include the machine-readable inventory in the release root. Unknown, missing, or disallowed licenses fail release preparation.
13. Update release-contract, archive, and handoff documentation/tests for the two new root artifacts without expanding into Java install or header work.

### CI Shape

14. Split a fast required quality job (lint, typecheck, JsViews check, unit tests, coverage, contract validation, dependency policy) from the existing slower exact-dist browser/deployment job. The latter must consume the build that passed the fast gate and retain current dist-continuity checks.

### Exit Criteria

- Lint and all selected strict compiler flags are required gates.
- High/critical advisories require remediation or an explicit unexpired exception.
- Boundary/domain coverage and property tests are continuously enforced.
- Release artifacts contain verified, hashed SBOM and license inventories.
- GitHub Actions no longer execute mutable major-version tags.

## Stage 5: Add Performance And Public-API Regression Budgets

1. After Stages 1-3, capture an approved new size baseline and add a checked-in budget file with explicit uncompressed and gzip limits for:
   - Stable entry plus eager dependency closure.
   - Complete stable CSS.
   - CodeMirror base chunk and language chunks.
   - `components.html`.
   - Total deployable `v2/` inventory.
2. Add a verifier that follows actual emitted imports/chunks rather than assuming one hashed filename. Fail missing roles and budget overruns; print old/new bytes and percentages.
3. Keep budget changes explicit and reviewable. Intentional increases require an updated baseline, rationale in `RELEASE_NOTES.md`, and corresponding inventory test changes; builds must never auto-ratchet upward.
4. Add component-contract diff output and bundle-budget output as concise CI summaries/artifacts so reviewers can see public API and loading impact together.

### Exit Criteria

- Accidental eager-loading, CSS, editor, catalogue, and total-release growth fails CI.
- Public contract and bundle impact are visible during review.

## Stage 6: Decompose Remaining Maintenance Hotspots

Perform each subsection as its own reviewable, fully green changeset after Stages 1-5 protect behavior. Prefer pure functions and small composable controllers; do not introduce a custom-element inheritance hierarchy or compatibility wrappers.

### `nodel-editor`

1. Extract a DOM-free document session model for selected path/content, clean baseline, metadata baseline, revision, dirty state, binary/legacy capability, and save-completion transitions.
2. Extract file operation use cases for list/open/conflict-check/save/create/upload/delete that accept the existing API functions, abort signals, operation tickets, and bounded callbacks. Keep unconditional Java write limitations unchanged.
3. Extract restart-event interpretation and editor refresh outcomes into a focused bridge around the existing page-global restart source; do not duplicate restart ownership.
4. Extract upload/drop staging and path/size validation coordination where it can be tested without JsViews.
5. Leave `NodelEditor` responsible for lifecycle ownership, JsViews linking, DOM events, CodeMirror attachment, confirmations, and translating domain outcomes into existing status/toast/custom events.
6. Preserve all public attributes, selectors used by browser tests, event payloads, save/reload wording semantics, and dirty-buffer guarantees.

### `nodel-bindings`

7. Build on existing `bindings-model`, matching, lookup, and target-discovery modules. Extract row/form state transitions, touched/reveal validation state, bulk assignment, and save orchestration from the custom element.
8. Keep partial rows valid and inactive, preserve unknown metadata and complete replacement payload semantics, and retain per-row abortable lookups.
9. Leave the component responsible for JsViews shell/linking and DOM event adaptation only; no transport, scoring, serialization, or schema-policy decisions should remain inline.

### `nodel-app`

10. Extract an app navigation controller for initial page discovery, title-derived IDs, nested groups, hash activation, and action activation. Treat navigation attributes as initialization-time and retain dynamically inserted page discovery.
11. Extract restart refresh coordination/generation handling from the element while continuing to use the existing restart source and explicit child outcomes.
12. Extract connectivity presentation state from host wiring; keep theme logic in the existing theme layer and keep modal/toast/confirm hosts app-owned.
13. Leave `NodelApp` as the lifecycle/event composition root.

### `nodel-actsig`

14. Extract schema section modelling/materialization, point feedback/pulse state, value presentation, and call/emit outcome mapping into DOM-free feature modules.
15. Reuse existing schema and API boundaries; retain lazy JsViews materialization, clipboard behavior, event payloads, and restart verification outcomes.
16. Leave the element responsible for JsViews linking, DOM event routing, and lifecycle disposal.

### Refactor Validation

17. For every extraction, move or add focused pure tests before deleting inline logic, then run the original component, lifecycle, restart, and browser contract suites unchanged.
18. Do not use line count alone as the goal. Exit when transport/domain/state decisions are independently testable and components are primarily lifecycle/view adapters.

### Exit Criteria

- The five hotspot areas have explicit responsibility boundaries and focused domain tests.
- No public component API, backend method/payload, custom event, or authored-page behavior changes as a side effect of decomposition.
- Race, reconnect, dirty-buffer, partial-binding, and restart tests remain green after each slice.

## Stage 7: Documentation, Release Notes, And Aggregate Gate

1. Update `docs/architecture.md` with the component contract/data flow, editor completion/lint architecture, lazy-load failure path, coverage policy, and the new decomposition boundaries.
2. Update `docs/web-components.md` to:
   - Describe `v2/nodel-components.json`, audiences, and compatibility expectations.
   - Document editor invocation, completion categories, non-blocking diagnostics, curated class hints, and the explicit absence of action/signal name lookup or validation.
   - State that page navigation attributes are initialization-time.
   - Document that empty, node-only, target-only, and complete binding rows are valid to save, while incomplete rows remain unwired.
   - Remove `show-filter`/`show-total` wherever generated or mentioned.
3. Add an `Unreleased` section to `RELEASE_NOTES.md` while main is ahead of `v0.1.2`. Before a tag, require release preparation to find a heading matching `package.json` and reject an unconverted Unreleased-only release.
4. Document component-contract breaking/additive changes, editor assistance, lazy-load UX, quality gates, SBOM/license artifacts, and size-budget changes in the next release notes.
5. Run the aggregate gate from exact built bytes:
   - `npm run lint`
   - `npm run typecheck`
   - `npm run check:jsviews`
   - `npm run test:coverage`
   - `npm run build`
   - Component-contract validation/diff and bundle-budget verification
   - `npm run verify:dist -- --write`, then `--check`
   - `npm run test:browser:dist`
   - Existing deployment preview and deployment smoke
   - Local non-publishable release preparation and archive verification, including component contract, SBOM, and licenses
   - `git diff --check`
6. Manually spot-check CodeMirror completion and diagnostics in HTML and XML, light/dark, keyboard-only, narrow/wide layouts, malformed markup, offline mode, and a failed lazy chunk. No live action/signal endpoint or Java installation check is required by this plan.

## Rollout And Compatibility

- Ship all stages in the next normal versioned release; do not patch previously published `v0.1.2` artifacts.
- `v2/nodel-components.json` begins at contract schema version 1. Consumers must reject unknown major schema versions and ignore unknown additive fields within a known version.
- Removing `show-filter` and `show-total` removes only newly added metadata that never had runtime behavior; no migration is required.
- Editor diagnostics are advisory and do not change browser runtime behavior or save eligibility.
- Lazy-load fallback UI is additive; the existing event and imperative loader rejection remain available.
- Refactors must be behavior-preserving and independently revertible before release.

## Completion Criteria

- Component lists, attributes, defaults, phases, signal targets, styles, docs, loader registration, CSS coverage, catalogue, editor, and public JSON cannot drift silently.
- Real CodeMirror completion preserves standard HTML/XML behavior and correctly applies Nodel tags, attributes, values, snippets, phases, targets, navigation IDs, and curated classes.
- Action and signal names remain document-authored free-form values with no runtime lookup or validation.
- Lazy component failures are visible and recoverable rather than hidden by anti-FOUC CSS.
- Lint, strict typing, boundary/domain coverage, fuzz tests, advisory policy, license inventory, SBOM, immutable Actions, API diffs, and bundle budgets are required gates.
- Editor, bindings, app, actsig, and contract code have testable domain boundaries without public or wire-contract regressions.
