# Stage 9 Consolidation And Cleanup Plan

## Goal

Finish the post-Stage-9 cleanup identified by the static audit: remove remaining duplicated endpoint and utility policies, fix recipe-cache cancellation coupling, remove confirmed dead/redundant code, and simplify the largest remaining UI orchestration paths without changing the Java Nodel contract or authored-page API.

## Current Baseline

- Implement on top of the current uncommitted Stage 9 worktree; do not revert or rewrite those changes.
- Last full gate passed: TypeScript, 92 test files / 813 tests, and `build:preview`.
- The existing Vite warning for `v2/nodel-webui.js` exceeding 500 kB is unrelated and remains out of scope.
- `noUnusedLocals` and `noUnusedParameters` must remain enabled.

## Decisions And Constraints

- Preserve `src/api/nodel-host-client.ts` as the compatibility re-export surface used by current components and tests.
- Preserve REST paths, request bodies, timeouts, duplicate-node progress events, component events, and stable `v2/nodel-webui.js` / `v2/nodel-webui.css` outputs.
- Canonical generated local node base paths will include a trailing slash (`/nodes/<encoded>/`). Update assertions that only pin the old equivalent slash-less form.
- Keep control truthiness and display-state interpretation as separate semantic policies. Their token vocabularies currently differ (`disabled` is control-truthy but toggle-off); do not merge them into one token set.
- Do not add a custom-element base class. Continue using `ComponentLifecycle` composition.
- Do not further split CSS, schema, codecs, editor, or diagnostic chart modules in this pass.
- Internal source modules are not package exports (`package.json` is private); internalize unused exports rather than adding compatibility aliases.

## Implementation Steps

### 1. Establish The Regression Baseline

1. Run and record:
   - `npm run typecheck`
   - `npm run test`
   - `npm run build:preview`
2. Confirm `git diff --check` is clean.
3. Keep unrelated working-tree changes untouched throughout the cleanup.

### 2. Consolidate Node Lifecycle Endpoints And Local Node URLs

1. Add `src/api/node-lifecycle.ts` as the single owner of node mutation endpoints:
   - `createNode(value, base?, init?)` -> `POST /REST/newNode` with `{ value }` and optional `base`.
   - `renameCurrentNode(value, init?)` -> `POST REST/rename`.
   - `restartCurrentNode(init?)` -> `REST/restart`.
   - `removeCurrentNode(init?)` -> `REST/remove?confirm=true`.
2. Re-export those functions from `src/api/nodel-host-client.ts` and remove their inline implementations there.
3. Update `src/api/node-duplication.ts` to import `createNode` directly from `node-lifecycle.ts`; remove `createDestinationNode()` and the second direct `/REST/newNode` call.
4. Add to `src/utils/urls.ts`:
   - `localNodePath(name)` returning the encoded canonical `/nodes/<very-simple-name>/` path.
   - `localNodeUrl(name, base = window.location.origin)` returning the absolute canonical URL.
5. Replace local node URL construction in:
   - `src/api/node-duplication.ts`
   - `src/features/add-node-use-cases.ts`
   - `src/features/bindings-target-discovery.ts`
   - `src/components/nodel-node-menu.ts`
   - `src/components/nodel-node-list.ts`
6. Add URL tests for spaces, Unicode names, punctuation reduction, encoding, custom bases, and trailing-slash consistency.
7. Extend host-client/duplication tests to prove both ordinary creation and duplication make exactly one correctly shaped `/REST/newNode` request.

### 3. Finish Error, Abort, And Record Utility Consolidation

1. Refine `src/utils/errors.ts` into the only generic error policy:
   - Add or rename a base `errorMessage(error, fallback)` that trims and uses the fallback for empty/non-Error values.
   - Make `boundedErrorMessage(error, fallback, maxLength = 500)` normalize whitespace, trim, fall back when empty, and cap output.
   - Make `apiErrorMessage()` delegate to the bounded policy so user-visible API failures remain bounded.
   - Keep `isAbortError()` as the only abort classifier.
2. Remove the local `boundedErrorMessage()` from `src/api/node-duplication.ts` and use the shared helper.
3. Remove `lookupErrorMessage()` from `src/features/add-node.ts`; use `boundedErrorMessage(error, 'Template lookup failed')` from the feature and component.
4. Replace duplicate/local abort checks with `isAbortError()` in:
   - `src/data/connectivity.ts`
   - `src/data/node-restart-source.ts`
   - `src/utils/component-lifecycle.ts`
   - `src/components/nodel-link.ts`
   - `src/components/nodel-bindings.ts`
   - `src/components/nodel-actsig.ts`
   - `src/components/nodel-params.ts`
   - `src/components/nodel-description.ts`
   - all matching `nodel-editor.ts` catch paths
5. Keep explicit `signal.aborted` ownership/generation checks where they distinguish stale operations; only replace error classification.
6. Add `src/utils/records.ts` containing the generic `isRecord`, `hasOwn`, and safe `setOwn` helpers.
7. Move generic record helpers out of `src/api/http-transport.ts` and `src/schema/schema-model.ts`; update schema, host-client, `nodel-link`, and catalogue-runtime imports.
8. Keep endpoint-specific decoding and schema validation in their current modules.
9. Make `abortReason()` private to `http-transport.ts` because no other module consumes it.
10. Add focused tests for empty errors, whitespace normalization, length capping, custom abort reasons, DOMException aborts, ordinary errors, null/array record rejection, and safe `__proto__` assignment.

### 4. Generalize Latest-Operation Ownership

1. Replace editor-specific operation mechanics with `src/utils/latest-operation-coordinator.ts`:
   - Generic key type `K extends string`.
   - Dynamic keyed slots rather than a fixed operation list.
   - `begin(key, parentSignal?)` aborts the previous operation for that key.
   - Tickets expose `key`, `generation`, `signal`, `isCurrent()`, and idempotent `finish()`.
   - `invalidate(key)`, `invalidateAll()`, and `isActive(key)` preserve current editor behavior.
   - Parent abort reasons are relayed and listeners are detached on finish/invalidation.
2. Update `nodel-editor.ts` to instantiate the generic coordinator with `EditorOperationKind`; delete `src/editor/editor-operation-coordinator.ts` after migrating imports.
3. Move and expand `test/editor-operation-coordinator.test.ts` into a generic coordinator test covering:
   - independent keys
   - same-key replacement
   - stale `finish()` safety
   - parent cancellation
   - dynamic keys
   - invalidation and listener cleanup
4. Replace `LookupSlot`, `lookupToken`, `startLookup()`, `abortLookup()`, and `abortAllLookups()` in `nodel-bindings.ts` with the generic coordinator keyed by the existing lookup key strings.
5. Replace add-node’s `searchAbortController`, `operationAbortController`, and `searchToken` with coordinator keys `'search'` and `'submit'`:
   - Debounce cancellation remains owned by `ConnectionScope.setTimeout()`.
   - Search result application still checks the current query in addition to ticket ownership.
   - Canceling submit still produces the existing incomplete-duplicate behavior when the destination already exists.
6. Replace `nodel-link`’s controller/token pair with one `'resolve'` coordinator slot.
7. Ensure each component calls `invalidateAll()` on disconnect and calls `finish()` in `finally` blocks.
8. Preserve all stale-completion, reconnect, focus, and cancellation tests; add direct tests where a newer request resolves before an older abort-insensitive request.

### 5. Fix Recipe Cache Cancellation And Cache Ownership

1. Refactor the recipe cache in `src/features/add-node.ts` so it caches only successful data and timestamps, not a caller-owned in-flight promise.
2. Every uncached caller must issue a request with its own signal; aborting obsolete query A must not cause query B to reuse A’s rejected promise.
3. A failed or aborted refresh must not update `data` or `fetchedAt`, and must not remove previously successful data.
4. A forced refresh must bypass the TTL but only replace the cache after successful decoding.
5. Add direct feature tests for:
   - fresh TTL hits avoiding another request
   - forced refresh
   - malformed/failed refresh retaining prior data
   - query A abort followed immediately by successful query B
   - two concurrent uncached callers remaining independent
6. In `BindingTargetDiscoveryService`, add a service-owned controller for the shared local-node discovery request:
   - `clear()` aborts it, increments the generation, and clears successful/pending caches.
   - Caller cancellation must not poison or populate the shared cache.
   - Existing generation guards remain the final protection against abort-insensitive completions.
7. Ensure `nodel-bindings` clears the discovery service on disconnect as well as reload/target changes.
8. Extend `bindings-target-discovery.test.ts` for abort propagation, clear-during-flight, rejected retry, and no stale cache repopulation.

### 6. Remove Confirmed Dead And Redundant Code

1. In `src/utils/toggle-state.ts`, remove `offValues` and replace the identical-result ternary with the explicit default `return 'off'`.
2. In `nodel-status-indicator.ts`, remove `falseyValues` and its branch because the fallback is already `'off'`.
3. Add tests documenting the intentionally distinct display-state and control-truthiness vocabularies; do not change which tokens resolve on/off.
4. In `nodel-bindings.ts`:
   - Remove the three always-true `if (selected)` guards after object fallbacks.
   - Extract one local helper to construct an option from the indexed model entry or DOM dataset fallback.
   - Keep validation and observable updates explicit per bulk/node/target case.
5. In add-node result projection:
   - Stop returning the redundant aggregate `views` field from `templateResultViews()`.
   - Derive autocomplete visibility from `results.length` or the two projected arrays.
6. Replace private `connected` flags with native `this.isConnected` in:
   - `nodel-add-node`
   - `nodel-node-list`
   - `nodel-qrcode`
   - `nodel-segmented`
   - `nodel-link`
   - `nodel-toggle`
   - `nodel-button`
7. Remove manual event-listener teardown for listeners already owned by `scope.listen()` in:
   - `nodel-actsig`
   - `nodel-add-node`
   - `nodel-bindings`
   - `nodel-console`
8. Remove manual subscription disposal where the same subscription is already registered through `scope.own()`; keep teardown for timers/controllers not owned by the scope.
9. Replace the manual pre-link error DOM in `nodel-params.ts` with `renderComponentError()`.
10. Export one canonical toast-tone normalizer from the toast feedback owner and use it in `nodel-confirm-host`; remove the duplicate one-line implementation.
11. Re-run reconnect tests after every lifecycle cleanup to detect duplicate or missing listeners.

### 7. Reduce Internal Export Surface

1. Internalize symbols that are only used in their defining module, including:
   - `NodelReachabilityResult` and its host-client re-export if no external import remains.
   - `ControlArgParseSuccess`, `ControlArgParseFailure`, and `ControlArgParseResult` when inference is sufficient.
   - `ControlActionPayloadSuccess`, `ControlActionPayloadFailure`, `ControlActionPayloadResult`, and `ControlActionErrorOptions` if not imported elsewhere.
   - add-node option/result interfaces used only as local signatures.
   - `BindingTargetKey`, `BindingTargetDiscoveryKind`, `BindingTargetDiscoveryRequest`, and `SuggestionSubject` when not imported externally.
2. Keep types imported by components/tests exported (`BindingKind`, `BindingOption`, `BindingRow`, `BindingSection`, target option/definition types, duplicate-node public result types).
3. Search the entire repository before each export removal; TypeScript unused checks do not identify exported-but-unconsumed symbols.
4. Do not remove the capabilities string in `test/runtime-api-contract.test.ts`; it is the deliberate regression guard proving source does not call the unsupported endpoint.

### 8. Consolidate Dynamic Option Source State

1. Move source loading/error ownership into `DynamicOptionsController`:
   - Track whether the options binding is active.
   - Track source-error state separately from payload-derived `ready`/`empty`/`error` state.
   - Add a method that maps `SignalBindingSourceState` to the effective `DynamicOptionsState`.
   - Add a reset method used when the binding identity changes or disconnects.
2. Remove `optionsSourceError` and the duplicated `onSourceState` branches from both `nodel-select.ts` and `nodel-segmented.ts`.
3. Leave component-specific rendering/focus behavior in each component; the controller should return state, not manipulate component DOM outside its option container.
4. Preserve these transitions in both controls:
   - static fallback -> loading
   - loading with fallback content
   - valid payload -> ready/empty
   - invalid payload -> error
   - source offline -> error
   - source recovery -> prior payload/static state
   - binding identity change -> clean loading/static state
   - disconnect/reconnect -> no stale source error
5. Expand `dynamic-options.test.ts`, `nodel-select.test.ts`, and `nodel-segmented.test.ts` around the shared transition matrix.

### 9. Simplify Binding Lookup Domain Boundaries

1. Keep JsViews observable mutations, keyboard handling, focus management, and option application in `nodel-bindings.ts`.
2. Move backend/domain-only lookup work out of the component:
   - Add node-option search/mapping to a binding lookup service under `src/features/`.
   - Keep target definition discovery/cache in `BindingTargetDiscoveryService`, or compose it behind the lookup service.
   - Expose methods returning plain `BindingOption[]`, `TargetOption[]`, or suggestion results; no jQuery/JsViews access in the service.
3. Remove direct `searchNodeUrls` imports from `nodel-bindings.ts` after migration.
4. Keep the three UI operations (`bulk node`, `row node`, `target`) as explicit component methods, but make each responsible only for busy/error/observable state around a service call.
5. Add pure service tests for result limits, invalid remote URLs, partial target success, all-target failure, Unicode matching, and abort propagation.
6. Do not extract the large template string or add component inheritance in this pass; after domain and request ownership move out, the remaining file is intentionally the view/controller.

## Validation And Review Sequence

After each numbered implementation section:

1. Run `npm run typecheck`.
2. Run the focused tests named in that section.
3. Review the diff for behavior changes, stale imports/exports, duplicated policy implementations, and lifecycle ownership.
4. Fix findings before starting the next section.

Final gate:

1. Search for remaining duplicate policies:
   - local `isAbortError` implementations and direct `AbortError` classifiers
   - local `isRecord` helpers
   - local bounded/error-message helpers
   - direct `/REST/newNode` calls outside `node-lifecycle.ts`
   - manual local node path construction
   - duplicate dynamic-options source-state branches
   - manual listener removal paired with `scope.listen()`
2. Run:
   - `npm run typecheck`
   - `npm run check:jsviews`
   - `npm run test`
   - `npm run build:preview`
   - `git diff --check`
3. Confirm the stable authored-page assets are still emitted at `dist/v2/nodel-webui.js` and `dist/v2/nodel-webui.css`.
4. Compare the final diff against every audit item in this plan. If a proposed abstraction increases call-site complexity or changes semantics, keep the simpler explicit call site and document that item as intentionally not consolidated.
5. Repeat review/fix/validation until no blocking consolidation, dead-code, lifecycle, or stale-completion findings remain.

## Acceptance Criteria

- Exactly one implementation issues `POST /REST/newNode`.
- All generated local node paths use the shared URL policy.
- Generic abort, record, and bounded error policies each have one implementation.
- Obsolete add-node recipe requests cannot fail or poison newer searches.
- Editor, bindings, add-node, and link use the shared latest-operation ownership primitive without stale completion regressions.
- Confirmed dead branches, always-true guards, redundant result fields, connection flags, duplicate lifecycle teardown, and unnecessary exports are removed.
- Select and segmented controls share dynamic option source-state policy while preserving their distinct UI/focus behavior.
- `nodel-bindings` no longer performs backend node search/mapping directly; transport/domain services remain independently testable.
- Reconnects do not duplicate listeners/subscriptions, and disconnects abort or invalidate owned work.
- All focused tests, full unit tests, typecheck, JsViews checks, and preview build pass.

## Out Of Scope

- Further splitting `src/styles/`, schema modules, codecs, editor, or diagnostic charts.
- A custom-element base class or inheritance hierarchy.
- Changing control truthy/falsey token semantics or merging them with display-state semantics.
- Backend API changes, capability negotiation, deployment path changes, release workflow work, or bundle-size remediation.
- Compatibility wrappers for internal exports that have no repository consumers.
