# Components In-Memory Runtime Plan

## Goal

Make `components.html` a deterministic, closed-loop demonstration page that never calls current-node action or activity endpoints for its public control examples. Actions must succeed in memory, signal-bound examples must receive seeded values, and mapped actions must publish synthetic local signal updates so related controls remain synchronized.

Normal host and node pages must continue using the existing REST/WebSocket implementation. The catalogue override is internal documentation infrastructure, not a new public web-component API.

## Decisions

- `components.html` always uses the in-memory control runtime, including when served below `/nodes/<name>/...`.
- Selection is explicit in the page source: retain the stable `/src/main.ts` loader, add `data-nodel-runtime="memory"` to that module script, and place an adjacent HTML comment explaining that the first `main.ts` import installs the catalogue runtime before custom elements upgrade.
- Use one page-global state store. Controls that share aliases such as `Source`, `Power`, or `Zone1` intentionally update together, matching one node's local signal namespace.
- Use seeded state plus action feedback, not successful no-ops alone.
- Unknown catalogue actions resolve successfully as no-ops. This prevents future presentational examples from producing user-facing errors; focused tests protect the stateful mappings that matter.
- State lasts only for the page lifetime and resets on reload. Persistence, URL state, and a live-runtime override are out of scope.
- Continue to show real, copyable `action`, `signal`, `signals`, `join`, and `options-signal` markup. Do not add demo attributes to individual examples or alter production error handling.

## Runtime Boundary

### 1. Add an internal control-runtime port

Create `src/data/control-runtime.ts` with an internal interface covering only the facilities used by public custom controls:

```ts
interface NodelControlSignalState {
  loading: boolean;
  connected: boolean;
  error: string;
  entries: NodelActivityLogEntry[];
}

interface NodelControlRuntime {
  callAction(name: string, payload: unknown): Promise<unknown>;
  subscribeSignals(
    element: HTMLElement,
    listener: (state: NodelControlSignalState) => void
  ): { dispose(): void };
}
```

Provide a default runtime and narrow module functions for calling, subscribing, and installing an override. The install function should return a restore callback or otherwise support test cleanup without exposing mutable globals outside this internal module.

The default implementation must:

- Delegate actions to `callNodeAction` unchanged.
- Delegate subscriptions to `subscribeNodeActivity`, preserving the element/visibility behavior.
- Convert each activity callback into `{ loading, connected, error, entries }`, where `entries` is the current batch's `item.entry` values or an empty array.
- Preserve all existing REST errors, activity connection state, batching order, and subscription disposal behavior.

Update only the two shared binding seams:

- `src/data/action-bindings.ts`: call the active control runtime instead of importing `callNodeAction` directly.
- `src/data/signal-bindings.ts`: subscribe through the active control runtime instead of importing `subscribeNodeActivity` directly. Keep parsing, path extraction, formatting, aggregation, visibility handling, dynamic-option raw values, and source-state callbacks unchanged.

Do not route `nodel-actsig`, `nodel-log`, parameters, bindings, diagnostics, editor operations, or other core administration APIs through this port. Those components are not present in the public catalogue and broad REST emulation is out of scope.

### 2. Install the override before element registration

Add `src/catalogue/runtime.ts` for the in-memory implementation and `src/catalogue/runtime-bootstrap.ts` for page selection.

Make the bootstrap module the first import in `src/main.ts`, before every `src/components/*` import. It must query for the explicit module script marker `script[type="module"][data-nodel-runtime="memory"]` and install a fresh catalogue runtime only when the marker is present. Static import evaluation must complete the installation before `customElements.define(...)` upgrades the already-parsed catalogue DOM.

In `components.html`:

- Add `data-nodel-runtime="memory"` to the existing `/src/main.ts` module script.
- Add a concise comment immediately above it explaining that the marker selects the catalogue-only in-memory action/signal runtime and must not be copied to ordinary node pages.
- Leave the other HTML pages and all live example/source pairs unchanged.

This approach keeps built pages on the stable `v2/nodel-webui.js` asset, so the current release bundle and `deploy:catalog` assumptions do not gain a new required entry file. Verify that Vite preserves the script data attribute in built `dist/components.html`.

## Catalogue Runtime Behavior

### 3. Implement the signal store

In `src/catalogue/runtime.ts`, create a fresh runtime instance with:

- A `Map<string, unknown>` containing the current value of each synthetic local signal.
- A set of active signal listeners.
- A monotonically increasing sequence number.
- A helper that creates `NodelActivityLogEntry` values with `source: 'local'`, `type: 'event'`, the signal alias/value, an ISO timestamp, and the next sequence number.

Subscription behavior:

- Immediately report `{ loading: false, connected: true, error: '', entries: snapshot }` to each new subscriber.
- Replay the complete current signal snapshot so controls created later, reconnected controls, dynamic templates, and changed bindings receive current state.
- On publication, update the map and notify all current subscribers with only the newly changed entries.
- Remove the listener on `dispose()` and make repeated disposal harmless.
- Ignore the supplied element for transport purposes; hidden catalogue pages should still receive state so they are ready when navigated to.

Seed these aliases, choosing values that match authored fallbacks where possible and provide useful state variety:

| Alias | Initial value |
| --- | --- |
| `PanelVisible` | `true` |
| `AvailableSources` | Options for `HDMI 1`, `HDMI 2`, `USB-C`, `Chromecast`, `TV`, and `Signage` |
| `CurrentSource` | `HDMI 1` |
| `AvailableModes` | `Auto`, `Manual`, and `Presentation` |
| `CurrentMode` | `Auto` |
| `Source` | `HDMI 1` |
| `Temp` | `22` |
| `ZoneA` | `70` |
| `Power` | `false` |
| `VisitorLink` | `https://example.org/visitor-guide` |
| `DeviceOnline` | `true` |
| `NetworkStatus` | `{ level: 1, message: 'Packet loss warning' }` |
| `ShowRunning` | `false` |
| `ControlsLocked` | `false` |
| `PageTitle` | A short signal-driven catalogue title |
| `SectionTitle` | A short signal-driven section title |
| `Status` | A concise ready/status message |
| `AlertText` | A concise warning/demo message |
| `HostName` | `Demo Host` |
| `HostAddress` | `demo-host` |
| `HostUrl` | A safe in-page catalogue hash |
| `HostTitle` | `Demo host` |
| `Zone1` through `Zone4` | Alternating false/true values |
| `Zone1Online` through `Zone4Online` | A mix of online/offline booleans |
| `Level1` through `Level3` | Distinct values such as `20`, `50`, and `80` |
| `Output5` and `Output6` | One false and one true value |

Keep seed creation explicit and centralized so catalogue markup changes have one obvious fixture to update.

### 4. Implement closed-loop action handling

`callAction` must accept the existing `{ arg?: unknown }` payload shape without coercing false, zero, arrays, or objects. Distinguish an absent `arg` property from `arg: undefined`/falsey values.

Apply these rules in order:

1. `CatalogueBusy`: resolve successfully after a short named delay suitable for demonstrating the busy state. Keep the delay bounded for real users; update the visual test to hold/advance browser time rather than relying on a never-resolving network route.
2. `SetSource`: publish the payload argument to both `Source` and `CurrentSource`, keeping the static controls and dynamic-options example synchronized.
3. `SetMode`: publish the argument to `CurrentMode`.
4. `StartShow`: toggle `ShowRunning`.
5. `RestartNetwork`: publish `{ level: 0, message: 'Network ready' }` to `NetworkStatus`.
6. Any other `Set<Alias>` action: publish to `<Alias>`. Use the payload argument when present; when absent, toggle the current value as a boolean. This covers `SetPower`, `SetTemp`, `SetZoneA`, generated `SetLevel1..3`, `SetZone1..4`, `SetOutput5..6`, and future straightforward setters.
7. An action whose name already exists as a seeded signal alias: update that same alias using the argument-or-toggle rule. This covers generated `join="Zone1"` through `join="Zone4"` controls.
8. All remaining actions, including navigation/momentary/confirmation examples, resolve successfully without publishing a signal.

Publish mapped changes before resolving the action promise so the awaiting component sees the corresponding feedback. Return a small non-sensitive result such as `{ demo: true, action: name }`; do not emit success toasts. Never log payloads to the browser console.

## Tests And Existing Fixtures

### 5. Add focused unit coverage

Add tests for the runtime port and catalogue implementation:

- Default actions still forward name and payload to `callNodeAction` and preserve rejection behavior.
- Default signal subscriptions map `subscribeNodeActivity` state/batches correctly and dispose the underlying subscription.
- Installing and restoring an override does not leak between tests.
- A memory subscriber immediately receives connected state and the seeded snapshot.
- `SetSource` updates both aliases, including falsey/scalar payload handling.
- Generic setters publish to derived aliases; no-argument generated setters and alias-named actions toggle booleans.
- `StartShow` and `RestartNetwork` apply their explicit mappings.
- Unknown actions resolve without signal changes or errors.
- Multiple subscribers receive updates; disposed subscribers do not.
- `CatalogueBusy` uses the bounded delay under fake timers.

Retain existing component tests. Adjust their module mocks only as required by the new default runtime indirection; they should continue proving real action failures create component error events/toasts and real signal activity drives attributes.

### 6. Add catalogue browser coverage

Add `e2e/catalogue-runtime.spec.ts` (or equivalent focused coverage) to prove the integrated page behavior:

- The built catalogue script retains `data-nodel-runtime="memory"` and signal examples exit loading/fallback states after startup.
- Dynamic source/mode options are populated from seeded arrays.
- Selecting a source updates controls bound to both `Source` and `CurrentSource`.
- Toggling power updates the signal-driven toggle/button state.
- At least one generated template action updates its matching generated signal.
- `RestartNetwork` changes the status block from warning to ready.
- Confirmation still gates the `Shutdown` action and confirmation does not produce a danger toast after acceptance.
- No requests target `REST/actions/*/call` or `REST/activity`, and no node activity WebSocket is created by catalogue signal bindings.
- Repeat the isolation assertion with the catalogue document initially served at a `/nodes/Demo/components.html` URL. Route that document/assets to the built catalogue during the test so the memory marker is present before module evaluation; do not use `history.replaceState` after startup for this assertion.

Update `e2e/catalogue.visual.spec.ts`:

- Remove the `CatalogueBusy` REST route because the request must no longer exist.
- Hold the runtime's bounded busy timer with Playwright clock control (or an equivalent deterministic mechanism), capture the existing busy screenshot, then advance/restore time.
- Review snapshots only where seeded signal text/state intentionally changes; avoid unrelated baseline churn.

Update `e2e/dynamic-options.spec.ts` because its current helper turns `components.html` into a node-backed test harness after load. The catalogue runtime is now permanently selected before that rewrite. Replace the helper with a test-only minimal HTML shell served at a node-style URL that imports the normal built `v2/nodel-webui.js` without the memory marker, then inject the existing dynamic-option fixtures. Preserve the current routed action/activity assertions so this suite continues testing the real REST polling path independently of catalogue simulation.

Extend `test/nodel-document-definition.test.ts` or a focused page contract test to assert:

- Only `components.html` marks its module script with `data-nodel-runtime="memory"`.
- The explanatory source comment is present.
- `nodel.html`, `nodes.html`, and `toolkit.html` remain unmarked and therefore use the default runtime.
- Existing live-example/code-snippet parity remains unchanged.

## Documentation

### 7. Document the page/runtime distinction

Update the canonical guides:

- `docs/architecture.md`: describe the internal control-runtime port, the real default adapter, the catalogue script marker/bootstrap ordering, and the fact that the built catalogue still uses the stable shared entry asset.
- `docs/web-components.md`: state that `components.html` simulates local actions/signals in memory for demonstration, while copied markup on ordinary node pages uses current-node REST actions and activity signals.

Do not document `data-nodel-runtime` as a supported custom-page feature or add it to editor completions. It is an internal catalogue loader contract.

## Failure Modes And Guardrails

- If bootstrap import order changes, custom elements could subscribe before the override is installed. Keep the bootstrap import first and cover initialized catalogue state in E2E.
- If a new signal example is not seeded, it will retain authored fallback/loading behavior rather than contact a node. Add its seed and interaction mapping when meaningful.
- If a new action has no mapping, it succeeds as a no-op and cannot produce a missing-action toast. Add a focused mapping test when the example promises visible feedback.
- The memory runtime must not modify global `fetch`, `WebSocket`, URL parsing, or production error handling.
- Page-global shared aliases intentionally couple examples. Use unique aliases in future examples when independent state is required.
- Host metadata/restart APIs used by core shell behavior are outside this narrow control runtime; the guarantee here covers public-control action calls and signal activity subscriptions.

## Validation

Run in this order after implementation:

1. `npm run typecheck`
2. `npm run check:jsviews`
3. `npm test`
4. `npm run build:preview`
5. `npx playwright test e2e/catalogue-runtime.spec.ts e2e/catalogue.visual.spec.ts e2e/dynamic-options.spec.ts`
6. `npm run test:browser`
7. `npm run build`

Inspect built `dist/components.html` and its referenced assets as part of validation. Confirm the memory marker survives Vite, the stylesheet still precedes the module script, normal pages still reference the stable shared entry, and the catalogue works from both root and node-style URLs without action/activity endpoint errors.
