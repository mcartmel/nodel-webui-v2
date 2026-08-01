# Production Readiness Remediation Plan

## Goal

Prepare `nodel-webui-v2` for production bundling into Nodel by addressing the security, correctness, lifecycle, maintainability, accessibility, test, and distribution gaps found in the static review.

The work should remain compatible with the project's two distinct consumption paths:

1. Core Nodel pages and assets are eventually bundled into a Nodel build by a separate integration process.
2. User-authored pages are static files served directly by Nodel. They do not have a build step and must be able to use the complete supported component framework through stable `v2/nodel-webui.js` and `v2/nodel-webui.css` entry files.

## Decisions And Constraints

- Treat the current Java Nodel REST/WebSocket behavior as the primary backend contract.
- Remove the unsupported capabilities endpoint/model and all current capability gating. Alternative-backend capability negotiation can be designed later from a real cross-backend requirement.
- Keep a single stable browser entry contract for no-build authored pages. Do not require page-specific bundling, generated imports, or knowledge of page markup at release-build time.
- Eagerly register public authoring primitives. Heavy core-administration components may be loaded behind the stable entry at runtime, provided initial markup and components inserted later both work without author intervention.
- Keep the complete public stylesheet available to authored pages. Runtime JavaScript splitting must not depend on Tailwind scanning user-authored files.
- Treat deployment to `/opt/nodel/custom/content/` as a test override, not the production installation mechanism. Make it safer and name/document it accordingly, but do not build a second production deployment system in this repository.
- The production handoff from this repository is the validated release bundle. Installation into a Java Nodel distribution remains a separate integration concern.
- Breaking internal APIs and component implementation details are acceptable. Public component markup should only be broken where the existing behavior is unsafe or cannot be made deterministic.
- Prefer small composable controllers and pure domain modules over a custom-element inheritance hierarchy.
- Complete each stage with focused tests and a green full build before starting dependent stages.

## Stage 0: Freeze Contracts And Baselines

### Objective

Establish the backend, authored-page, release, and test-deployment contracts that later refactors must preserve.

### Work

1. Document the supported runtime contract in `docs/architecture.md`:
   - Java Nodel is the current backend.
   - The stable head contract remains `v2/nodel-webui.css` plus `v2/nodel-webui.js`.
   - Static authored pages may contain any public component at initial parse time or insert one later.
   - The entire `v2/` directory is an indivisible release asset because the stable entry may reference hashed chunks.
   - `/custom` deployment is a disposable test override, not production installation.
2. Inspect the Java Nodel implementation and capture representative fixtures for every REST and WebSocket response consumed by this project:
   - Root/host details.
   - Node details.
   - Node URL discovery.
   - Actions, events, parameters, remote bindings, files, console, activity, logs, diagnostics, measurements, recipes, toolkit, restart, create, rename, remove, and file operations.
3. Record which state-changing Java endpoints require GET and which accept POST. Do not change methods based only on HTTP convention; coordinate any method change with Java Nodel.
4. Add fixture-level contract tests around current valid Java payloads before introducing runtime decoders.
5. Capture informational baselines:
   - Stable entry and chunk sizes, compressed and uncompressed.
   - Initial-load requests for `components.html`, `nodes.html`, `nodel.html`, and a minimal authored page.
   - Polling/WebSocket request rates while pages are visible and hidden.
6. Add a test fixture that is not a Vite HTML input: a plain static page referencing only the built stable CSS/JS files. This becomes the permanent no-build authored-page contract test.

### Exit Criteria

- Valid Java Nodel payloads are represented by checked-in test fixtures.
- The authored-page and test-deployment contracts are explicit in canonical documentation.
- Later changes can be compared against request, size, and runtime baselines.

## Stage 1: Secure Navigation And Input Boundaries

### Objective

Prevent unsafe backend, signal, or authored values from reaching navigation and rendering sinks, and fail safely on malformed backend payloads.

### Work

1. Add a shared URL-policy module, for example `src/utils/urls.ts`, with separate policies for:
   - Browser navigation: relative URLs plus `http:` and `https:`.
   - Markdown links: relative URLs plus `http:`, `https:`, `mailto:`, and `tel:`.
   - Remote node API bases: absolute `http:` and `https:` only, with credentials rejected.
   - Image sources, if unrestricted remote/data image support remains intentional.
2. Replace the private `safeHttpUrl` in `nodel-link` with the shared policy.
3. Apply the same policy to every navigation sink:
   - `nodel-node-list` discovery addresses.
   - `nodel-host-icon` authored and signal-driven `href` values.
   - Diagnostics build-origin, branch, and commit links.
   - Add-node and duplication source/destination links.
   - Binding discovery addresses.
   - Any toolbar, menu, or generated custom-UI links.
4. Build generated links with DOM APIs or validated `URL` objects. HTML escaping is not a substitute for URL validation.
5. Define safe invalid-URL behavior per component:
   - Keep text visible.
   - Remove executable navigation.
   - Expose an accessible unavailable/error state.
   - Use a safe Network-page fallback where one exists.
6. Tighten Markdown sanitization:
   - Remove arbitrary `class` values from untrusted Markdown, or allow only a narrow language-token syntax needed for code highlighting.
   - Continue removing event attributes and unsafe schemes.
   - Preserve `noopener noreferrer` for new-context links.
7. Create lightweight runtime decoders in `src/api/codecs/` rather than casting JSON directly to `T`:
   - Distinguish strict required fields from tolerated optional/unknown fields.
   - Validate finite sequence numbers and measurements.
   - Validate file paths, node names, URLs, action/signal maps, schemas, and binding maps before components consume them.
   - Include endpoint context in bounded errors without exposing full arbitrary response bodies.
8. Make `fetchJson` return `unknown`; endpoint functions invoke the relevant decoder.
9. Add a shared abort/timeout helper that can combine a caller signal with a bounded request deadline. Use longer or disabled deadlines only for documented long-poll endpoints.
10. Harden `getNodePathName()` and all URL construction against malformed percent encoding and invalid addresses.

### Tests

- Unit-test each URL policy with relative URLs, encoded URLs, protocol-relative URLs, credentials, control characters, mixed-case schemes, `javascript:`, `data:`, and malformed input.
- Add component tests proving unsafe URLs never become clickable anchors.
- Add Markdown tests for global-class abuse as well as script/event/scheme injection.
- Add decoder tests for valid Java fixtures, missing fields, wrong types, non-finite numbers, malformed activity entries, and oversized collections.
- Add E2E coverage with malicious network-discovery and build-info responses.

### Exit Criteria

- No unvalidated value can reach an anchor `href` or remote API base.
- Components render bounded errors rather than throwing on malformed backend payloads.
- Normal Java Nodel fixtures remain accepted.

## Stage 2: Remove Unsupported Capabilities

### Objective

Remove a runtime contract that Java Nodel does not support and avoid misleading partial feature gating.

### Work

1. Remove from `src/api/nodel-types.ts`:
   - `NodelCapabilityFeatures`.
   - `NodelCapabilitiesResponse`.
   - `NodelCapabilities`.
2. Remove from `src/api/nodel-host-client.ts`:
   - `legacyCapabilities()`.
   - `normalizeNodelCapabilities()`.
   - `getHostCapabilities()`.
3. Delete `src/data/host-capabilities-source.ts`.
4. Simplify `nodel-console` to the Java Nodel behavior:
   - Always render console execution controls.
   - Remove capability subscriptions and capability-driven history resets.
5. Remove capability tests and replace them with direct console behavior tests.
6. Remove `/REST/capabilities` guidance from `docs/architecture.md`, release guidance, and tests.
7. Remove `requiredFeatures` from the release manifest's `nodelApi` object. Because releases are not yet in production use, bump the release manifest schema version and update release validation rather than retaining a misleading compatibility field.
8. Keep only the tested Java Nodel API range in release metadata.

### Exit Criteria

- The application never calls `/REST/capabilities`.
- No feature appears conditionally supported when the primary backend cannot advertise it.
- Console behavior is deterministic and directly tested.

## Stage 3: Make Custom-Element Lifecycles Race-Safe

### Objective

Ensure asynchronous initialization, linking, imports, requests, and cleanup cannot outlive an element connection generation.

### Work

1. Extract the safe ideas already present in `nodel-node-list` into a reusable lifecycle controller:
   - Monotonic connection generation.
   - A connection-scoped `AbortController`.
   - `isCurrent(generation)` checks after every `await`.
   - Serialized asynchronous link/unlink work.
   - Idempotent listener and subscription disposal.
2. Add a small JsViews link controller around `linkTemplate`/`unlinkTemplate` so reconnecting cannot race an old unlink operation.
3. Migrate all asynchronously initialized components:
   - `nodel-params`.
   - `nodel-actsig`.
   - `nodel-bindings`.
   - `nodel-editor`.
   - `nodel-console`.
   - `nodel-log`.
   - `nodel-add-node`.
   - `nodel-node-menu`.
   - `nodel-host-log`.
   - `nodel-diagnostic-charts`.
4. Guard dynamic imports for CodeMirror and Chart.js with connection generations and explicit failure handling.
5. Prevent stale operations from mutating JsViews models after unlink.
6. Ensure `connectedCallback()` is idempotent and reconnection restores required timers/subscriptions.
7. Fix known reconnection state issues while migrating:
   - Reset or reapply `nodel-toolkit` render caches when creating a new editor.
   - Reschedule or clear non-persistent toast state on reconnect.
   - Ensure charts do not retain stale canvases or draw requests.
8. Isolate source-listener exceptions so one component cannot block other subscribers or turn a successful fetch into a source error.

### Tests

- For each lifecycle family, delay `bootstrapJsViews`, `linkTemplate`, dynamic imports, and fetches; disconnect before resolution; assert no listeners, polling, sockets, or editors remain.
- Reconnect the same instance and assert exactly one link, listener set, source subscription, and editor/chart instance.
- Create a new instance after disposing the old one and verify complete initial state.
- Include rapid connect/disconnect/reconnect loops under fake timers.

### Exit Criteria

- No asynchronous continuation mutates or subscribes a stale element generation.
- Reconnection behavior is deterministic across all async components.
- No unhandled initialization or dynamic-import rejection reaches the browser console.

## Stage 4: Protect Files And Editor State

### Objective

Prevent local edits, existing files, and large payloads from being lost or overwritten accidentally.

### Work

1. Add an editor operation coordinator with separate generations for:
   - File-list refresh.
   - File open.
   - Save.
   - Create/upload.
   - Delete.
2. Track a monotonically increasing document revision. At save start capture:
   - Selected path.
   - Document content.
   - Document revision.
3. On save completion:
   - Mark clean only if path/content/revision still match the saved snapshot.
   - Do not reload over newer local edits.
   - If newer edits exist, report “saved previous revision; newer edits remain unsaved.”
4. Make editor writability and busy behavior explicit. Either keep editing safely with revision tracking or temporarily make the editor read-only; never allow silent loss.
5. Prevent “New file” from overwriting an existing path. Require a separate explicit overwrite confirmation if overwrite is supported.
6. Replace `window.confirm` with the shared confirmation system for discard, overwrite, and delete operations.
7. Add a dirty-document `beforeunload` guard and remove it immediately when clean/disconnected.
8. Normalize and validate paths:
   - Reject parent/current-directory segments, control characters, unsupported separators, excessive length, and ambiguous normalization.
   - Compare canonical paths when detecting existing files.
9. Define documented text-edit and binary-upload size limits based on representative Java Nodel nodes. Reject before reading a large `File` into memory or loading it into CodeMirror.
10. Surface file size in the picker where useful and provide a clear “too large to edit; download/manage externally” state.
11. Correct JSON language support by using an actual JSON language mode rather than JavaScript mode.
12. Investigate Java Nodel metadata support for conflict detection. If no conditional save/ETag exists, document that cross-browser concurrent writes cannot be made atomic and implement the strongest available pre-save modified-time check.

### Tests

- Edit while save is pending; verify newer text remains dirty and visible.
- Save file A, switch to B, resolve A's request late; verify B is untouched.
- Attempt to create an existing canonical path; verify no save occurs without explicit overwrite confirmation.
- Test path traversal, control characters, long names, normalized duplicates, large text files, and large binary uploads.
- Test disconnect during every file operation.
- Test dirty-page unload registration and cleanup.

### Exit Criteria

- No normal editor race silently loses local edits.
- Create and upload cannot overwrite by accident.
- Memory use is bounded by documented file limits.

## Stage 5: Rebuild The Schema Boundary

### Objective

Make schema forms lossless for supported values, validated against the actual Nodel schema dialect, and independently testable.

### Work

1. Derive and document the schema subset actually emitted by Java Nodel. Do not claim generic JSON Schema compatibility unless contract fixtures prove it.
2. Split `schema-form.ts` into:
   - Pure schema normalization/model construction.
   - Hydration and serialization.
   - Validation.
   - JsViews templates and DOM event adaptation.
3. Represent “missing” separately from valid empty values:
   - Empty string.
   - Empty array.
   - Empty object.
   - `null`.
   - Explicit `false` and zero.
4. Remove `cleanPayload` semantics that erase valid empty values.
5. Implement constraints emitted by Java Nodel:
   - Numeric finiteness, integer-only behavior, minimum, maximum, and step.
   - `minItems` and `maxItems` in both controls and serialization.
   - Required fields if emitted.
   - Nullable/union forms if emitted.
6. Give enum options stable internal identities so raw values such as `1` and `"1"` remain distinct.
7. Preserve unknown loaded parameter and binding fields when the backend save endpoint replaces the complete object. Confirm replace/merge semantics against Java Nodel fixtures first.
8. Add field-level accessible validation messages and block save/call while invalid.
9. Keep generated IDs deterministic within a form instance and remove unnecessary global monotonic state where possible.

### Tests

- Pure round-trip tests for every supported scalar, nested object, array, enum, null, and empty value.
- Property-based tests asserting `serialize(hydrate(value))` preserves supported values.
- Constraint tests for min/max/step, integer parsing, min/max items, required fields, and duplicate enum string representations.
- Parameter, action/signal, and binding integration tests proving unknown metadata is preserved where required.
- Malformed schema tests that produce a bounded unsupported-schema state instead of a partial destructive form.

### Exit Criteria

- Supported payloads round-trip without semantic loss.
- Invalid forms cannot issue backend writes.
- Schema model logic is testable without DOM or JsViews.

## Stage 6: Consolidate Control Action Semantics

### Objective

Give every interactive control consistent confirmation, argument parsing, busy, ordering, rollback, error, and event behavior.

### Work

1. Define and document the action-phase contract before refactoring:
   - Implicit `action`/`join` performs one committed action for a discrete interaction.
   - Additional live/press/release/on/off behavior requires explicit phases.
   - A configured confirmation gates every remote side effect.
2. Add a shared strict argument codec:
   - Invalid `number` and `json` values return a validation error instead of silently becoming strings.
   - Boolean vocabulary is centralized and locale-independent.
3. Add a shared action execution controller supporting explicit policies:
   - `single-flight` for buttons and destructive commands.
   - `latest-wins` UI completion for selections and rapidly changing values.
   - Serialized ordered phases for momentary controls.
   - Throttled live updates with a distinct final commit for continuous controls.
4. Ensure stale completions cannot overwrite newer local state. Network requests that cannot be cancelled may finish, but their UI results must be ignored when obsolete.
5. Consolidate:
   - Binding execution.
   - Failure formatting.
   - Error event details.
   - Toast behavior.
   - Result reporting.
   - Optimistic state and rollback policy.
6. Migrate button, toggle, segmented, select, stepper, pad, palette, and fader.
7. Fix stepper behavior specifically:
   - A normal press must not call the implicit action twice.
   - `repeat="off"` must perform one commit.
   - Confirmation must occur before any configured remote action.
   - Hold/repeat completions must not roll back later successful values.
8. Recreate a fader throttle when its live interval changes and cancel it on disconnect.
9. Standardize custom event payloads to include action, phase, value/arg, payload, results, failures, and committed/live state where applicable.
10. Replace duplicated truthiness, normalization, parsing, and error helpers in individual components.

### Tests

- Assert exact action call counts, not only `toHaveBeenCalledWith`.
- Test double-clicks, rapid selection changes, delayed success/failure ordering, hold/repeat, blur, pointer cancellation, and disconnect.
- Test confirmation cancellation for every interaction family and prove no action was called.
- Test explicit live/commit and press/release phase ordering.
- Run the same action-state conformance suite against all migrated controls.

### Exit Criteria

- Each user interaction has a documented and deterministic number/order of backend calls.
- No control performs a remote side effect before its confirmation.
- Control error/result events follow one shared contract.

## Stage 7: Harden Activity, Console, Polling, And Discovery

### Objective

Make live data recover predictably from malformed messages, transport failures, visibility changes, reconnects, and large result sets.

### Work

1. Refactor node activity into an explicit transport state machine:
   - `idle`.
   - `connecting`.
   - `websocket`.
   - `polling`.
   - `backoff`.
2. Add a WebSocket connection deadline. On timeout or error, close the socket and begin polling immediately.
3. Validate every socket message before applying it.
4. Correct cursor handling so the next sequence is `max(currentNext, incomingSequence + 1)` and stale entries cannot advance it incorrectly.
5. Deduplicate by sequence and logical point where required, and cap retained activity keys/history.
6. Reset console cursor state when the last subscriber is disposed or scope the cursor to the source entry so a new console receives initial history.
7. Cap poll backoff, add modest jitter if multiple browser clients are expected, and trigger an immediate refresh on browser-online/visibility recovery.
8. Treat abort errors consistently across `DOMException` and `Error` implementations.
9. Bound console and host-log incremental request sizes; page through large gaps rather than requesting `9999` entries repeatedly.
10. Improve network node discovery:
    - Validate every result before rendering/probing.
    - Limit host reachability concurrency.
    - Probe only the currently relevant result window before background expansion.
    - Distinguish unknown reachability from confirmed unreachable.
    - Use an intentional cross-origin probing strategy and test CORS/no-CORS behavior.
    - Use a slower network refresh interval than local node refresh unless measurements justify the current rate.
11. Isolate listener errors and report them through a bounded diagnostic hook without stopping other listeners.
12. Make subscriber state snapshots immutable or defensively copied at module boundaries.

### Tests

- Fake WebSockets that hang, error without close, close repeatedly, send malformed data, duplicate data, and out-of-order sequences.
- WebSocket-to-poll and poll-to-WebSocket recovery tests under fake timers.
- Console remove/new-instance tests proving initial history is not skipped.
- Long-outage/online recovery tests proving refresh is prompt and backoff is bounded.
- Large discovery-result tests proving concurrency and retained data remain bounded.
- Listener-throws tests proving other subscribers still receive updates.

### Exit Criteria

- Activity always reaches polling fallback within a bounded time.
- New source subscribers cannot inherit stale cursors incorrectly.
- Polling and discovery have documented request and memory bounds.

## Stage 8: Complete Component Reliability And Accessibility

### Objective

Address remaining component-specific failure paths and make modal/menu behavior match declared semantics.

### Work

1. `nodel-add-node`:
   - Catch and render recipe/search failures.
   - Abort obsolete searches.
   - Validate discovered addresses.
   - Guard state updates after disconnect.
   - Define cancellation and partial-result behavior for long duplication operations.
2. Node duplication:
   - Validate and deduplicate source file paths.
   - Add per-file and total-size limits or explicit user confirmation above a threshold.
   - Add cancellation.
   - Clearly report created-but-incomplete destinations.
   - Investigate optional cleanup of a failed destination; do not delete automatically unless the backend contract makes that safe.
3. `nodel-bindings`:
   - Replace component-global search tokens with per-row/per-field request controllers.
   - Abort underlying target requests when a lookup times out.
   - Make normalization Unicode-aware.
   - Preserve backend metadata according to Stage 5 save semantics.
   - Remove unused searching state or expose it consistently in the UI.
4. Create a shared modal/focus controller for confirm, connectivity modal, and node menu:
   - Focus capture and restoration.
   - Tab containment.
   - Background `inert` restoration.
   - Escape/backdrop policy.
   - Nested/competing modal behavior.
5. Add keyboard-complete toolbar and node-menu navigation, including focus preservation after rerender and arrow-key menu movement.
6. Make dynamic import failures visible and retryable in toolkit, editor, and diagnostics charts.
7. Harden chart input sizes and duplicate measurement names.
8. Make custom UI file discovery support the valid Java Nodel filename/path set while retaining explicit exclusions.
9. Replace locale-sensitive lowercasing for protocol tokens and boolean/state keywords with locale-independent normalization. Keep locale-aware comparison only for actual user-facing search.
10. Bound persistent toast count and make reconnect timer behavior deterministic.
11. Align the custom-element style registry:
    - Public elements have intentional display defaults.
    - Undefined elements use a consistent anti-FOUC rule.
    - Internal hosts are included where relevant.
12. Add a registry consistency test comparing public component definitions, editor completions, documentation, main loader registration, and CSS undefined-element coverage.

### Exit Criteria

- Every modal marked `aria-modal` actually contains focus and makes background content inert.
- Component async failures are visible, bounded, and retryable.
- Search/autocomplete operations cannot invalidate unrelated rows.
- Public component registration/documentation/style lists cannot drift silently.

## Stage 9: Separate Responsibilities And Remove Duplication

### Objective

Reduce the largest maintenance hotspots after behavior is protected by the earlier tests.

### Work

1. Split `nodel-host-client.ts` into:
   - Generic HTTP/error/timeout transport.
   - Endpoint functions.
   - Response codecs.
   - Node discovery/reachability.
   - Node duplication orchestration in a feature/service module.
2. Split `nodel-bindings.ts` into:
   - Wire/model conversion.
   - Target discovery/cache.
   - Matching/scoring.
   - JsViews view model and custom element.
3. Complete the Stage 5 schema split.
4. Split `nodel-add-node.ts` into recipe cache/search, creation/duplication use cases, and UI orchestration.
5. Split `src/styles.css` into source files for tokens/base, semantic primitives, public controls, core administration, editor/third-party, and accessibility overrides. Continue emitting one stable complete CSS file for authored pages.
6. Consolidate shared utilities:
   - HTML escaping.
   - API error extraction.
   - URL policy.
   - typed argument parsing.
   - truthiness/state normalization.
   - action result formatting.
   - inherited component attributes.
7. Remove confirmed dead code and data:
   - `e2e/catalogue.accessibility.spec.ts.orig`.
   - Unused capability remnants.
   - Unused activity timer helper.
   - Unused node-list highlighted value.
   - Unused visibility/theme/source exports.
   - Unused binding result/candidate fields and searching state.
8. Enable `noUnusedLocals` and `noUnusedParameters` after cleanup.

### Exit Criteria

- Transport, domain logic, and rendering can be tested independently.
- No production component file remains a combined transport/domain/view monolith.
- One implementation exists for each shared parsing, URL, error, and action policy.

## Stage 10: Preserve Static Authoring While Reducing Initial Work

### Objective

Improve load cost without weakening the no-build static page contract.

### Stable Entry Design

1. Keep `v2/nodel-webui.js` as the only required script for authored pages.
2. Keep catalogue runtime selection as the first initialization step, before public component definitions upgrade existing DOM.
3. Eagerly import and register all public authoring primitives listed in `docs/web-components.md`.
4. Do not call `bootstrapJsViews()` unconditionally from `main.ts`. JsViews should load when the first JsViews-backed administration component connects.
5. Move heavy core-administration components behind an internal runtime component loader:
   - Scan the parsed document for known core tags.
   - Dynamically import matching modules.
   - Observe added DOM so components inserted later are loaded.
   - Deduplicate concurrent import requests.
   - Dispatch a bounded global/component load-error event if a chunk cannot load.
6. Continue allowing authored pages to use documented core components. The runtime loader, not Vite HTML inputs, decides whether those modules are needed.
7. Export an optional `loadNodelComponent(tagName)` function from the stable module for advanced imperative pages that need to await definition before inserting an element. Ordinary static markup must not require it.
8. Keep all public/core styles in `nodel-webui.css`; runtime component loading must not create a per-page CSS build requirement.
9. Keep semantic public classes and the documented set of compiled Tailwind utilities available to authored pages.

### Contract Tests

1. Build and serve an authored fixture that was not an input to Vite.
2. Verify public controls in initial static markup upgrade and work using only stable assets.
3. Insert public and core components after page load and verify automatic upgrade.
4. Verify an advanced module import can call `loadNodelComponent()` and await `customElements.whenDefined()` before insertion.
5. Verify JsViews and heavy editor/chart chunks are not requested by a simple public-control page.
6. Verify a page using params/bindings/editor loads the needed chunks and remains functional.
7. Verify the catalogue in-memory runtime is installed before any eager public controls subscribe.
8. Verify all built and authored pages continue to work at both root and node-style URLs.

### Exit Criteria

- A user can create a static HTML page after release and use supported components without any build step.
- Heavy administration dependencies are loaded only when markup or imperative loading requests them.
- The complete stable asset contract remains release-tested.

## Stage 11: Clarify Test Deployment And Production Handoff

### Objective

Keep immediate `/custom` testing convenient while making its destructive nature explicit and preventing accidental misuse as production deployment.

### Test Override Scripts

1. Rename scripts to reflect intent:
   - `deploy:preview` remains the local filesystem preview.
   - Replace `deploy` with `deploy:custom` or `deploy:test-host`.
   - Rename catalogue deployment similarly.
2. Update README wording from “production deployment” to “live Nodel test override.”
3. Keep full replacement of the test override where required, but add safeguards:
   - Reject unknown and missing CLI arguments.
   - Validate `support-subdir` as one safe relative path segment or a deliberately supported relative subtree without `.`/`..`.
   - Refuse filesystem roots, project/source parents, and paths outside an explicitly allowed test target policy.
   - Print the exact target and destructive action before changing files.
   - Use a marker file to distinguish a directory managed by this test deployer; require an explicit first-use override before clearing an unmarked non-empty directory.
4. Stage the built test content in a sibling temporary directory, validate it, then replace the managed test target. This reduces broken test hosts without pretending to be the production installer.
5. Add `--dry-run` and machine-readable summary output for troubleshooting.
6. Validate the complete test override after copy, including all stable assets and referenced chunks.
7. Constrain catalogue page names to safe expected basenames and document that catalogue deployment depends on stable support files already being available.

### Production Handoff

1. Keep `prepare-release.mjs` and the release ZIP as the production artifact from this repository.
2. Add a machine-readable file inventory with hashes to the release bundle or extend `release.json` accordingly.
3. Validate that every stable entry reference and dynamic chunk in the release exists and is included in the inventory.
4. Document requirements for the separate Nodel build integration:
   - Install the entire `v2/` directory as one version.
   - Apply appropriate MIME types and compression.
   - Revalidate stable JS/CSS/HTML while treating hashed chunks as immutable.
   - Avoid removing chunks still referenced by an active/cached stable entry during upgrade, or version the complete support directory in the Nodel distribution.
   - Provide rollback at the Nodel build/package level.
5. Do not add host-install or system-service mutation logic to this repository.

### Tests

- CLI tests for unknown flags, missing values, traversal attempts, unmarked targets, dry-run, staging failure, and successful managed replacement.
- Release tests that walk stable entry imports and verify every referenced file/hash.
- Smoke-test both the preview tree and a managed custom test override layout.

### Exit Criteria

- `/custom` remains a quick, explicitly destructive test mechanism with strong path safeguards.
- No documentation presents it as the production installer.
- The release bundle has a complete, verifiable handoff contract for the separate Nodel build process.

## Stage 12: Strengthen Quality, CI, And Release Gates

### Objective

Turn the new contracts into continuously enforced production gates.

### Work

1. Add ESLint with rules for:
   - Floating promises.
   - Unsafe `any` and unchecked assertions at boundaries.
   - Duplicate imports and dead code.
   - Promise misuse in event handlers.
2. Incrementally enable stricter TypeScript options:
   - `noUnusedLocals`.
   - `noUnusedParameters`.
   - `noImplicitReturns`.
   - `noFallthroughCasesInSwitch`.
   - `noUncheckedIndexedAccess`.
   - `exactOptionalPropertyTypes` after API/model cleanup.
3. Add meaningful coverage floors for pure domain and boundary modules rather than a single easily gamed global percentage.
4. Add property/fuzz tests for:
   - URL policies.
   - action/signal expression parsers.
   - typed argument codecs.
   - schema round trips.
   - file path validation.
   - activity cursor handling.
5. Add automated integration tests against a representative Java Nodel runtime or a contract server generated from captured Java fixtures. Cover the manual release checklist where automation is feasible.
6. Keep a smaller manual hardware/live-node checklist for behaviors that cannot be represented faithfully in CI.
7. Avoid rebuilding the same production assets twice in CI; add a browser-test command that consumes the already validated build.
8. Split fast unit/type/lint gates from slower browser matrices while preserving one required aggregate release gate.
9. Increase CI timeouts based on measured cross-browser duration rather than relying on a tight global ten-minute limit.
10. Pin GitHub Actions to immutable commit SHAs and add update automation.
11. Add dependency vulnerability policy, automated license inventory, and an SBOM to release artifacts.
12. Align `.nvmrc`, README, CI, and `engines.node` on either the Node 20 line or an explicitly tested version range.
13. Move the synchronous theme bootstrap to a stable same-origin script, or publish a CSP hash, so the separate Nodel build can deploy a strict CSP without requiring `unsafe-inline`.
14. Document recommended Nodel response headers owned by the integration process:
    - Content Security Policy.
    - `frame-ancestors`/clickjacking policy.
    - MIME type protections.
    - Referrer policy.
    - Stable-entry and hashed-chunk cache policy.
15. Version release notes by package version and include compatibility, migration, known limitations, and rollback notes.

### Exit Criteria

- Static analysis, unit tests, contract tests, release validation, authored-page tests, and browser tests are required CI gates.
- Release artifacts include provenance, checksum, file inventory, license information, and SBOM.
- The Java Nodel integration contract is tested rather than inferred.

## Final Production Readiness Gate

Before declaring the project ready for inclusion in a production Nodel build, require all of the following:

1. No unresolved security or data-loss findings from Stages 1-7.
2. All supported Java Nodel response fixtures pass runtime decoding and integration tests.
3. A no-build authored page works with initial and dynamically inserted public/core components through stable assets only.
4. Editor save/create/delete, schema save, action execution, activity fallback, reconnect, and offline recovery pass race-focused tests.
5. The release ZIP passes file-inventory and internal-reference validation.
6. The managed `/custom` test override passes live smoke testing, with its test-only status documented.
7. The release bundle is consumed by a representative Nodel build using the documented cache, MIME, CSP, and complete-directory rules.
8. Chromium, Firefox, and WebKit functional/accessibility suites pass on desktop and mobile projects.
9. Forced colours, reduced motion, keyboard-only navigation, screen-reader modal semantics, offline recovery, and reconnect behavior are manually spot-checked.
10. A rollback rehearsal succeeds at the Nodel build/package layer.

## Suggested Delivery Sequence

Use small reviewable branches/changesets in this order:

1. Contract fixtures and authored-page harness.
2. URL safety and response codecs.
3. Capability removal.
4. Lifecycle controller and component migration.
5. Editor safety.
6. Schema boundary rewrite.
7. Shared control action runner.
8. Activity/polling/discovery state machines.
9. Component reliability and accessibility.
10. Module/CSS decomposition and dead-code cleanup.
11. Stable runtime loader for static authored pages.
12. Test-deployment clarification and release inventory.
13. Compiler/lint/CI/release hardening.

Each changeset should include its focused tests and documentation updates. Avoid combining broad visual redesign with these behavioral changes so regressions remain attributable and reviewable.
