# Stage 3-8 Closure Remediation Plan

## Goal

Close the known Stage 3-8 exceptions found after the Stage 0-10 production-readiness audit, then repeat the audit before beginning Stage 11.

The closure must fix:

1. Schema enum identity collisions and boolean/numeric enum editing.
2. Remote control work starting or publishing stale results after disconnection.
3. Partial action failures dropping successful result details.
4. Network reachability probes escaping refresh ownership and aggregate concurrency limits.
5. Mutable nested data escaping the shared source boundary.
6. Nested node-menu modal branches remaining interactive behind `aria-modal`.
7. The residual Stage 3 component-level lifecycle test gap.
8. The missing written rationale for deliberately not deleting incomplete duplicated nodes automatically.

Java Nodel's unlocked file/script writes remain an external limitation. The existing best-effort editor conflict checks and documentation are the supported behavior; do not invent an unsupported transactional or compatibility layer.

## Decisions And Guarantees

- Keep public component markup and the stable `v2/nodel-webui.js` contract unchanged.
- Treat enum option values as private form identities. Persist and emit only the original raw scalar values.
- Continue supporting distinct scalar enum values such as `1`, `"1"`, `true`, `"true"`, `null`, empty string, and zero. Follow JSON wire semantics for numbers: negative zero is not a distinct persisted identity because `JSON.stringify(-0)` emits `0`.
- A disconnect aborts confirmation and transport requests, prevents queued phases/bindings from starting, and suppresses stale events/UI completion. It cannot undo an action already accepted by Java Nodel.
- A reconnect creates a fresh action generation; no aborted signal, serial queue entry, busy state, or latest-wins token may leak into it.
- Reachability concurrency means at most four unresolved probes per connected node-list instance across visible, background, old, and new generations combined, even if an aborted probe does not settle promptly.
- Published source data is immutable at runtime. Freeze each successful JSON-like snapshot once; do not deep-clone it for every subscriber.
- Only arrays and plain records are recursively frozen. Preserve non-plain platform objects by reference unless a source explicitly provides a safe immutable value.
- The top modal is the only interactive modal. Preserve the path from its inert root to its smallest modal interaction container and inert sibling branches at every level.
- A modal interaction container includes its dialog and backdrop. It must not include unrelated triggers or toolbar controls.
- Automatic cleanup of a partially created duplicate remains disabled unless Java Nodel later provides an ownership-safe, race-safe deletion contract.

## 1. Add Focused Regression Reproductions

Add failing tests for each observed defect before changing production behavior. Keep these tests focused enough to prove the root cause rather than relying only on broad integration assertions.

### Schema reproductions

Update `test/schema-form-pure.test.ts` to cover:

- A raw string equal to the old generated fallback identity.
- Mixed values `1`, `"1"`, `true`, `"true"`, `null`, `""`, `0`, and strings resembling internal identities.
- Numeric JSON canonicalization proving `-0` and `0` are not advertised as distinct persisted enum identities.
- Numeric enum hydration followed by serialization.
- An unknown/stale option identity producing a validation error and no payload.
- Duplicate identical raw members selecting the first member deterministically during hydration.

Add a DOM edit-path case to `test/nodel-params.test.ts` or `test/nodel-actsig.test.ts` proving a boolean enum renders as a select and serializes the selected raw boolean.

### Action reproductions

Extend `test/control-action-semantics.test.ts` with a parameterized disconnect-during-confirmation case for button, toggle, pad, segmented, select, stepper, fader, and palette.

For each control:

- Open confirmation.
- Disconnect the element.
- Resolve confirmation as accepted.
- Assert zero action calls and no completion/error event.
- Reconnect the same instance and prove a new interaction succeeds.

Add targeted tests for queued button/pad momentary phases and for a multi-action partial failure retaining earlier successful `results`.

### Discovery/source reproductions

Extend `test/nodel-node-list.test.ts` with two discovery generations whose probes overlap. Record active probe count and assert the existing implementation exceeds or loses ownership of the intended bound before the fix.

Extend `test/nodel-data-runtime.test.ts` so one listener attempts to mutate an array and a nested object, then assert another listener and `getState()` observe unchanged data.

### Modal reproduction

Update `test/nodel-node-menu.test.ts` using the real `nodel-app > nodel-toolbar > nodel-node-menu` hierarchy. Open the drawer and prove surrounding toolbar controls are currently left interactive.

## 2. Make Schema Enum Identity Lossless

### Model changes

Update `enumOptionsFor()` in `src/schema/schema-model.ts`:

- Assign every option an opaque deterministic identity based only on its index, such as `enum-option-0`.
- Never reuse a raw label as an HTML option value.
- Keep `label` for display and `raw` for serialization.
- Keep `enumRawKey()` for exact raw-value comparison across scalar types, but align numeric keys with JSON wire semantics so `-0` and `0` compare as the same persisted number.

Internal identities need only remain stable for one normalized schema instance. They are not persisted API values.

### Hydration and serialization

Update `src/schema/schema-values.ts`:

- Resolve enum options before numeric or boolean scalar conversion.
- Hydrate by matching `enumRawKey(candidate.raw)` and store the matched option identity in `value` and `concreteValue`.
- Centralize selected-option lookup so serialization and validation use the same rule.
- Serialize only the selected option's `raw` value.
- Return no payload for an unknown internal identity.
- Treat nullable-presence null and an enum option whose raw value is `null` as the same wire value. On hydration, canonically select the enum option when one exists; otherwise use nullable `presenceState: "null"`.
- If the UI can still produce nullable-presence null for a schema whose enum includes null, serialize it as null and accept that the next hydration canonicalizes it to the enum option. Do not claim those two UI paths are independently round-trippable.
- Keep a missing enum field unselected rather than silently choosing the first option.

### Rendering and validation

Update `src/schema/schema-form.ts` so the enum `<select>` branch precedes boolean checkbox and numeric input branches. Non-enum booleans remain checkboxes.

Update `src/schema/schema-validation.ts`:

- Validate that the current internal identity resolves to an option before validating the raw scalar.
- Emit `Choose one of the available values.` for stale or unknown identities.
- Continue applying numeric/integer constraints to the selected raw number.
- Accept a selected raw `null` only where the normalized enum/schema permits it, using the canonical null behavior above.

Update `docs/schema-dialect.md` to state that all supported scalar enum identities round-trip exactly and that browser option identities are private implementation details.

### Schema acceptance tests

- Every option identity is non-empty and unique regardless of authored labels.
- Hydrate/serialize preserves all supported scalar raw values exactly.
- Numeric and integer enums use select identities rather than formatted numbers internally.
- Boolean enums render selects, edit correctly, and emit booleans rather than strings.
- Missing remains distinct from null. Nullable null and enum raw-null serialize identically, then hydrate to the documented canonical state.
- Invalid identities block parameter/action/binding writes.
- Existing unknown-field preservation and property-style round-trip tests remain green.

## 3. Make Control Actions Connection-Scoped

### Shared lifecycle contract

Extend `ControlActionController` in `src/data/control-actions.ts` with connection-generation state and an `AbortController` while retaining separate latest-wins behavior.

Each connection generation owns its own abort controller, serial queue, and single-flight state object. A new connection must not reuse or wait behind an old generation's queue.

Provide explicit operations equivalent to:

- Start or reuse the current connected generation.
- Capture an immutable interaction scope containing generation, signal, and `isCurrent()`.
- Disconnect by aborting the signal, advancing the generation, invalidating latest work, and preventing queued serial work from starting.
- Start a fresh non-aborted generation after reconnection.

Do not overload latest-wins invalidation with connection lifecycle semantics. A newer selection and a disconnected host are different states.

Make serial work capture an interaction scope. Before a queued operation starts, return an aborted/stale outcome if its scope is no longer current. New-generation work uses a new queue and is never delayed by unresolved old-generation work.

Make single-flight acquisition return or capture the owning interaction scope. Completion may release only the same generation's single-flight state. An old `finally` block must never clear a new generation's lock or busy state.

### Transport and binding propagation

Update `src/data/control-runtime.ts` so `callAction()` accepts an optional `RequestInit` and the default runtime forwards it to `callNodeAction()`.

Update `src/data/action-bindings.ts`:

- Accept the interaction signal/context.
- Check freshness before each binding.
- Pass the signal to the runtime action call.
- If cancellation aborts a call, stop the sequence and propagate cancellation rather than recording it as an ordinary action failure.
- Preserve all completed `ActionBindingResult` entries when a later binding fails.

Update `executeActionPhases()` in `src/data/control-actions.ts` to check the same context before every phase and binding group.

Update `dispatchControlActionError()` to accept and emit `results` instead of always emitting `results: []`.

### Control migration

Apply the connection lifecycle consistently to:

- `src/components/nodel-button.ts`
- `src/components/nodel-toggle.ts`
- `src/components/nodel-pad.ts`
- `src/components/nodel-stepper.ts`
- `src/components/nodel-fader.ts`
- `src/components/nodel-select.ts`
- `src/components/nodel-segmented.ts`
- `src/components/nodel-palette.ts`
- `src/components/nodel-page.ts`

For each component:

- Start the action generation in `connectedCallback()`.
- Disconnect the action generation before other asynchronous cleanup.
- Pass its signal to `requestConfirm()`.
- Recheck the captured scope immediately after confirmation and before every side effect.
- Suppress completion/error/change events and rollback from stale generations.
- Clear local busy/pressed/live state on disconnect without issuing a remote release from a dead generation.
- Pass complete `results` and `failures` to partial-failure events.
- Guard every asynchronous `finally` cleanup with its captured interaction scope before changing shared component busy/active state. Disconnect clears old local state synchronously; an old finalizer cannot overwrite state established after reconnect.

Control-specific requirements:

- Button and pad momentary queues must never start an old press or release after disconnect.
- A release already required by an accepted press may run only while that same generation remains connected.
- Segmented must not retain `busy` after disconnect/reconnect.
- Fader and palette must cancel throttled live work and prevent a final commit from starting after disconnect.
- Stepper, select, segmented, fader, and palette retain latest-wins UI behavior within a connected generation.
- Page activation stops before later bindings when its page disconnects.

Update `docs/web-components.md` to define the disconnection guarantee and state that partial-failure events contain both successful and failed action results.

### Action acceptance tests

- Confirmation cannot lead to an action after disconnect for all eight controls.
- Cancellation between two bindings prevents the second call.
- Cancellation between two phases prevents the later phase.
- The runtime receives the same abort signal used by the interaction.
- In-flight cancellation is not emitted as an ordinary backend error.
- No stale completion/error event mutates a reconnected instance.
- Reconnection permits a fresh action.
- An old action settling while a new-generation action is busy cannot clear the new busy flag, release its single-flight lock, or delay its serial queue.
- Momentary press/release ordering remains deterministic while connected.
- Partial failure events include earlier successful results and later failures.
- Existing exact action-count, confirmation, latest-wins, throttle, and repeat tests remain green.

## 4. Re-own Reachability Work And Freeze Source Snapshots

### Discovery ownership

Refactor `src/components/nodel-node-list.ts` so `loadNetworkRows()` only fetches, validates, sorts, caps, and returns discovery rows with `reachability: "unknown"`.

When the source listener accepts a new `updatedAt` snapshot:

- Cancel the previous component-owned reachability generation.
- Store an immutable component display snapshot.
- Render discovery rows immediately.
- Submit work to one persistent component-owned reachability scheduler for the accepted rows.
- Queue visible hosts first and remaining unique hosts afterward.
- Keep no more than four worker slots for the lifetime of the connected component, not four workers per generation.
- Apply each accepted host result by replacing affected row objects and the display array, never by mutating source-owned rows.
- Ignore results unless generation, connection, filter/scope, and abort signal are still current.

Cancel queued jobs for the obsolete generation immediately on disconnect, source rebuild, filter change, page-size/scope change, visibility-driven source disposal, or a newer discovery snapshot. Abort its active probes, but do not release their scheduler slots until their promises actually settle. New-generation jobs wait for those slots, which preserves the aggregate four-probe bound even for an abort-insensitive transport.

Keep the scheduler object and its unresolved-slot accounting on the element instance across disconnect/reconnect. Reconnecting the same element starts a new generation but must not create a second pool while old aborted probes remain unresolved.

Page-size expansion may reprioritize previously background hosts, but must not create a second worker pool.

Update `src/api/node-discovery.ts` so an actual abort remains cancellation. Only a completed timeout/network/CORS failure becomes `reachable: false`; an aborted probe must leave the row unknown.

### Immutable source boundary

Update `src/data/nodel-data-runtime.ts`:

- Recursively freeze arrays and plain records once when a successful fetch result enters `entry.state.data`.
- Freeze or otherwise make each returned top-level state snapshot immutable.
- Keep internal mutable state separate from the exported snapshot type if required by TypeScript.
- Do not recursively traverse non-plain objects.
- Document that source fetchers must return fresh snapshots and subscribers must treat data as immutable.

Remove the node-list's in-place reachability mutation before enabling freezing.

### Discovery/source acceptance tests

- Aggregate active probes never exceed four across visible and background hosts.
- Aggregate active probes remain at four or fewer when old probes ignore abort and settle after a newer generation is queued.
- A second refresh aborts or invalidates all first-generation work before starting its queue.
- Filter, page-size, scope change, hidden transition, and disconnect cannot receive old row updates.
- Visible hosts are still probed before background hosts.
- Aborted probes remain unknown; genuine failures become unreachable.
- Source data arrays and nested records cannot be changed by one listener or `getState()` consumer.
- Other subscribers receive the original data after a mutation attempt.
- Listener exception isolation, reentrant subscription behavior, polling backoff, and bounded row retention remain unchanged.

Update the reachability and immutable-source guarantees in `docs/architecture.md`.

## 5. Recompute Modal Inertness From The Top Layer

### Interaction container correction

Change the node-menu call in `src/components/nodel-node-menu.ts` to pass `.nodel-node-menu-layer` as the modal `container`, not the whole `nodel-node-menu` host. The layer contains both backdrop and drawer; the trigger remains outside and must become inert.

Review confirm and connectivity hosts and ensure each passes the smallest element containing its dialog and backdrop as `container`.

### Stack-wide inert algorithm

Refactor `src/utils/modal-focus-controller.ts` around one module-level active-layer registry:

- Only the top active layer controls Tab and Escape.
- On activation, deactivation, disconnect, or relevant DOM mutation, recompute the desired inert branches from the current top layer.
- Walk from `inertRoot` to the top layer's interaction container.
- At each ancestor, retain the child on the active path and inert every sibling element branch.
- Do not descend into the interaction container, so its backdrop and dialog remain usable.
- Restore branches no longer desired from their originally captured `inert` and `aria-hidden` state.
- Recompute after out-of-order layer removal rather than restoring one layer independently.
- Observe `childList` with `subtree: true` for active roots so inserted, removed, or reparented branches are reconciled.
- Keep managed state only while at least one layer requires it; do not leak detached elements.
- Expose a read-only controller check such as `isTopLayerActive()` so component-specific keyboard handlers can yield while another modal is above them.

Before applying inertness, move focus synchronously into the new top dialog when current focus is outside its interaction container. Keep `focusInitial()` for selecting the preferred first control.

When the top layer closes:

- Recompute inertness for any surviving layer.
- Restore focus inside the surviving dialog if needed.
- Otherwise restore the original connected trigger only when focus has not already moved intentionally elsewhere.

Gate `NodelNodeMenu.handleDocumentKeydown()` on the node menu controller still owning the top layer and focus remaining in its drawer. Arrow, Home, and End handling from an underlying drawer must not intercept keys while confirm or connectivity is topmost.

### Modal acceptance tests

Add direct controller tests for:

- Root sibling branches.
- A modal container nested under toolbar/menu ancestors.
- Competing sibling modal hosts.
- A modal nested inside another modal container.
- Out-of-order stack removal.
- Exact restoration of authored `inert` and `aria-hidden` values.
- Dynamic subtree insertion, removal, and reparenting.
- Disconnect cleanup.
- Top-layer-only Escape and Tab handling.
- Underlying node-menu Arrow, Home, and End handlers yielding to a top confirmation/connectivity modal.
- Focus transfer before the old branch becomes inert.

Extend node-menu, confirm-host, and connectivity-host tests for menu-to-confirm and connectivity-to-confirm transitions.

Add `e2e/modal-focus.spec.ts` using the real node-page hierarchy. Verify focus trapping, Escape ordering, background inertness, backdrop usability, trigger restoration, dynamic siblings, and no `aria-hidden` ancestor around the active dialog in Chromium, Firefox, WebKit, mobile Chromium, and the existing forced-colours project where applicable.

## 6. Close The Stage 3 Lifecycle Verification Matrix

Do not rewrite working component lifecycle code solely to satisfy test structure. Add component-level evidence that each family correctly applies `ComponentLifecycle` and `JsViewsLinkController`.

Create a small test helper for delayed JsViews bootstrap/link initialization and rapid connect/disconnect/reconnect. Use it from existing component test files rather than adding production test hooks.

Add these missing boundaries:

| Component | Required closure case |
|---|---|
| `nodel-params` | Delay initial schema/value loading across disconnect and reconnect; old values/listeners must not appear. |
| `nodel-actsig` | Delay bootstrap/link; only the reconnected generation may subscribe or render. |
| `nodel-bindings` | Delay initial schema/value loading; stale load cannot replace the reconnected model. |
| `nodel-editor` | Delay link before the existing CodeMirror import case; only one editor/link survives. |
| `nodel-console` | Delay initial source callback; old cursor/history cannot enter the new generation. |
| `nodel-log` | Delay initial activity callback; old listener cannot append after reconnect. |
| `nodel-add-node` | Delay link; reconnect retains one event/debounce/listener set. |
| `nodel-node-menu` | Delay link; stale menu data/navigation cannot bind after reconnect. |
| `nodel-host-log` | Delay initial fetch; stale rows/cursor cannot enter the reconnected instance. |
| `nodel-diagnostic-charts` | Delay link and initial measurement fetch; only one chart and draw generation survives. |

Add one rapid-loop test per family:

- Schema/data-loading component.
- Subscription-driven component.
- Poll/fetch-driven component.
- Dynamic-import editor/chart component.

Each test must finish with exactly one current link, listener/subscription set, timer, and editor/chart resource as applicable, with no unhandled rejection.

Add one fresh-instance isolation test per family. Fully dispose the old instance while initialization or work is pending, create a separate new instance, then resolve old and new work. Assert the old instance retains zero links, listeners, subscriptions, timers, editors, charts, or model updates and the new instance receives exactly one complete initial resource/state set. This explicitly covers the original Stage 3 new-instance exit criterion rather than relying only on same-instance reconnect tests.

## 7. Record Intentional Operational Limits

Update `docs/architecture.md` with the duplication cleanup decision:

- Java exposes destructive removal for the current destination node but does not provide a creation ownership token or conditional delete.
- Destination readiness can fail before the UI can safely prove identity/state.
- Another operator may modify or replace the destination after creation.
- Automatic cleanup could therefore delete valid work after a race.
- Cancellation and partial failure continue to report the destination URL and incomplete status.
- Operators must inspect and explicitly remove an incomplete destination through the normal confirmed node-removal workflow.

Retain the existing editor documentation explaining that metadata/content preflight is best effort and cross-client writes cannot be atomic. Add or retain a test that prevents release guidance from claiming transactional saves or automatic duplicate cleanup.

## 8. Verification And Closure Review

Run focused tests after each workstream, then run:

1. `npm run typecheck`
2. `npm run check:jsviews`
3. `npm run test`
4. `npm run build`
5. `npm run test:browser`

Repeat an independent read-only audit against the original Stage 3, 5, 6, 7, and 8 requirements and exit criteria.

The closure is complete only when:

- No supported enum value changes type or identity during hydrate/edit/serialize.
- No new action binding or phase starts after its owner disconnects.
- No stale action result publishes into a reconnected control.
- Partial action errors retain successful and failed results.
- Node-list reachability never exceeds four aggregate active probes per instance.
- Published source snapshots cannot be mutated by consumers.
- Every `aria-modal` host leaves only the top modal interaction container reachable.
- Every Stage 3 asynchronous component family has delayed disconnect/reconnect evidence.
- Every Stage 3 lifecycle family proves a disposed instance cannot contaminate a newly created instance.
- Incomplete duplicate cleanup and editor atomicity limits are explicit and accurate.
- Full unit, production build/release, and browser matrices pass with a clean worktree.

## Suggested Reviewable Change Sequence

1. Schema enum identities, rendering, validation, and tests.
2. Shared action lifecycle/transport contract and control conformance tests.
3. Discovery coordinator, immutable source snapshots, and race tests.
4. Modal stack/inert algorithm and browser accessibility coverage.
5. Stage 3 lifecycle matrix and operational-limit documentation.
6. Full verification and independent Stage 3-8 closure audit.

Do not begin Stage 11 until the final closure audit has no concrete Stage 3-8 gap.
