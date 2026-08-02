# Script Save And Reload Coordination Plan

## Goal

Make `script.py` saves accurately represent Java Nodel's delayed automatic reload, prevent repeat saves from racing that reload in the same Web UI, preserve local edits, and report reload/readiness failures without claiming the view is current.

## Scope And Decisions

- Web UI only. Java's unlocked, non-atomic script write/reload path remains a documented residual risk for other clients and the first save itself.
- Apply reload coordination only to exact `script.py` saves through `REST/script/save`; other file operations retain current behavior.
- Keep CodeMirror editable while reload is pending, but block further `script.py` saves.
- Treat a changed `REST/hasRestarted` timestamp as reload confirmation. Capture the baseline before saving so a fast reload cannot be missed; a null baseline is valid and the first non-null timestamp confirms startup.
- After 30 seconds without confirmation, enter a persistent “reload not confirmed” warning state. Allow an explicit, confirmed corrective save that supersedes the previous expectation.
- On confirmation, re-read a clean `script.py` buffer from the node. Preserve dirty local text and reconcile it against the saved remote revision without silently overwriting it.
- Do not infer success from temporary REST availability or console text. A timeout means unconfirmed, not definitively failed.

## State Contract

Add a generation-scoped expected-reload state independent of ordinary editor save/list/open operations:

- `idle`: no expected script reload.
- `pending`: script save succeeded; editing remains enabled; `script.py` Save is disabled.
- `unconfirmed`: 30-second deadline elapsed; local state is preserved; a confirmed corrective save is available.
- `refreshing`: a newer start timestamp was observed and node-backed views are being reconciled.
- `verification-failed`: reload was observed but editor/view refresh could not prove current state; local text remains intact and subsequent saves retain normal remote-content checks.

Every expectation carries an ID/generation and pre-save timestamp. Late polls, timers, save completions, and refreshes from superseded expectations must be ignored. A late successful reload may recover `unconfirmed` unless a corrective save has replaced that expectation.

## Implementation Steps

1. **Turn restart polling into a shared expectation coordinator** (`src/data/node-restart-source.ts`).
   - Preserve ordinary external/manual restart notifications.
   - Add a prepare/commit/cancel contract: prepare obtains the current start timestamp before `REST/script/save`; commit arms the expectation only after save success; cancel removes it after save failure.
   - Record timestamp changes that occur between prepare and commit so an immediate Java monitor cycle is not missed.
   - During an expected reload, long-poll again immediately after each bounded response rather than adding the normal five-second idle gap.
   - Emit typed events/results for expected pending, confirmed, timed out, superseded, and disposed states.
   - Support null initial timestamps, transient polling errors, offline periods, late confirmation after timeout, and lifecycle disposal without leaking timers or requests.

2. **Integrate script expectations with editor save snapshots** (`src/components/nodel-editor.ts`, `src/api/nodel-host-client.ts` only if a small API helper is required).
   - After existing conflict/size checks and immediately before saving exact `script.py`, prepare a restart expectation.
   - If baseline acquisition fails, do not issue an untrackable script save; show a bounded retryable error. A successful response with `timestamp: null` is not a failure.
   - Commit the expectation only after `REST/script/save` succeeds; cancel it on save failure, disconnect, or obsolete operation generation.
   - Keep current revision-snapshot behavior: edits made during the save remain visible and dirty.
   - Add reload state to `canSave`: block only `script.py` while pending/refreshing; allow editing, navigation, and non-script file operations subject to existing guards.
   - Keep reload messaging separate from the ordinary `status` field so `handleEditorChange` cannot erase the pending/unconfirmed notice.
   - In `unconfirmed`, re-enable a corrective `script.py` save only through the shared confirmation UI. Explain that the previous reload was not confirmed and that saving replaces the script and starts a new reload expectation.

3. **Reconcile editor content safely after confirmed reload** (`src/components/nodel-editor.ts`).
   - Extend `refreshAfterRestart` to snapshot selected path, document revision, dirty state, and expectation generation before awaiting file/content requests.
   - Refresh the file list and, when `script.py` is selected, fetch its bounded text content and current metadata.
   - If the buffer remained clean and unchanged during the request, replace it with remote content and establish a new clean baseline.
   - If the buffer is dirty or changes during the request, never replace it. If remote content still equals the saved baseline, update metadata and retain “newer edits remain unsaved.” If it differs, preserve local text, mark the baseline conflicted/unknown, and require the existing explicit refresh/discard path before overwriting.
   - Return a structured refresh result distinguishing verified success, local edits preserved, conflict, and failure. Any request failure must preserve local text and return failure rather than resolving as successful refresh.
   - Ensure missing `script.py` continues to use the existing preserved-local-buffer and recreate-confirmation behavior.

4. **Coordinate accurate app-level UX** (`src/components/nodel-app.ts`).
   - Subscribe once to the shared restart coordinator and remove duplicate independent polling ownership.
   - For a successful non-script save, retain the existing `File saved` toast.
   - For `script.py`, replace it with a persistent `script.py saved. Waiting for node reload...` toast and matching accessible editor status.
   - On timeout, replace the pending toast with a warning: reload was not confirmed within 30 seconds, local edits are preserved, Console should be checked, and corrective save is available.
   - On confirmation, show `Node restarted. Refreshing view...`, pass expectation details to restart-aware children, and aggregate both rejected promises and explicit unsuccessful refresh results.
   - Use accurate completion text: distinguish fully verified refresh, preserved unsaved editor changes, and partial/failed verification. Never show `View is up to date` when the editor returned false/conflict/failure.
   - Refresh console/activity on confirmation and on timeout so current diagnostics are available, but do not parse console strings as a readiness contract or navigate the user automatically.

5. **Document the contract and residual risk** (`docs/architecture.md`).
   - Document pre-save timestamp capture, pending-save gating, 30-second unconfirmed recovery, clean-versus-dirty reconciliation, and the meaning of reload confirmation.
   - State that UI coordination prevents repeat saves from this page but cannot make Java's unconditional script write atomic, prevent other clients from writing, or prove failure from a timeout.
   - Note that `hasRestarted` advances only after Java reaches its successful start-timestamp update; a broken or long-running startup may remain unconfirmed.

## Validation

### Restart Coordinator Tests

- Baseline captured before save; prepare canceled on failed/obsolete save.
- Timestamp changes before and after expectation commit are both detected exactly once.
- Null baseline resolves on the first non-null timestamp.
- Expected reload polling has no extra idle gap and remains bounded.
- Transient request failures retain pending state; 30 seconds yields `unconfirmed`.
- Late confirmation recovers an unconfirmed expectation; a corrective save supersedes stale timers/results.
- Disconnect/dispose aborts polling and removes timers/listeners.

### Editor Tests

- Editing during the save and during reload pending remains enabled; the saved snapshot and newer dirty revision remain distinct.
- A second `script.py` save is blocked while pending, including keyboard save, while non-script behavior is unchanged.
- Timeout preserves the document and requires confirmation before corrective save; cancel performs no request.
- Confirmed reload replaces only an unchanged clean buffer.
- Dirty edits survive confirmation, file-list refresh, content reads, and out-of-order completions; saved-baseline matches update metadata without clearing dirty state.
- Remote content differing from the saved baseline preserves local text and exposes conflict instead of overwriting.
- Refresh/list/content failures return unsuccessful results and preserve local state.
- A clean or dirty selected file disappearing during reload keeps the existing local-buffer recovery semantics.

### App And Integration Tests

- Script save produces pending, timeout, refreshing, verified, dirty-preserved, and verification-failed toast/status sequences with accessible live-region output.
- Explicit `false`/failure results from `nodel-editor.refreshAfterRestart` produce the warning toast rather than `View is up to date`.
- Manual/external restarts still refresh all restart-aware components when no script expectation exists.
- Mock `REST/script/save`, `REST/hasRestarted`, file-list, and file-content endpoints in one race-focused integration/E2E scenario: save, type immediately, reject a second save, delay restart, then confirm reload without losing local edits.
- Add scenarios for timeout plus corrective save, temporary node unavailability, lost save response followed by conflict detection, and reload confirmation after the timeout.

### Gates

- Run focused editor, restart-source, app-restart, host-client, and browser integration tests.
- Run `npm run typecheck`, `npm run check:jsviews`, the full unit suite, `npm run build`, and `git diff --check`.
- Manually validate against a disposable Java Nodel node with a normal script, a syntax/startup failure, a startup exceeding 30 seconds, and edits made immediately after Save.

## Acceptance Criteria

- The Web UI cannot issue a second `script.py` save while the previous save's reload is pending.
- Users can continue typing, and no restart/refresh continuation silently replaces newer local edits.
- A broken or unconfirmed reload does not permanently lock script editing; corrective save requires explicit confirmation.
- Clean buffers reflect server content after confirmed reload; dirty buffers remain local and visibly unsaved/conflicted.
- App success messaging is shown only when all restart refreshes report verified success.
- Existing non-script editor behavior and external/manual restart handling remain compatible.
- The Java atomic-write/concurrent-client limitation is explicit and is not presented as solved by this Web UI plan.
