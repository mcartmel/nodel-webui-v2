# Inactive Page Media Deferral Plan

## Goal

Resolve issue #16 by preventing `nodel-image` from creating native image media while any containing app-managed `nodel-page` is inactive, loading the latest source when the route becomes active, and detaching the media again when the route is hidden. Follow the existing `visibility-scope` and connected-component conventions rather than adding a public page lifecycle event API.

## Current State

- `nodel-app` owns navigation and eventually applies `hidden`, `active`, and `data-active-page` in `src/components/nodel-app.ts`, but the initial sync is queued in a microtask.
- `nodel-image` currently renders `<img src="...">` synchronously from `connectedCallback()` and signal-driven attribute changes, before inactive pages are necessarily hidden.
- `observeNodelVisibility()` already centralizes ancestor-page, document, online, and Nodel-connectivity visibility for polling and activity sources. Its initial callback is synchronous; the implementation now watches `hidden`/`active` and child-list changes needed for page reparenting.
- Existing signal controls remain subscribed while connected. Hidden subscribers do not keep the shared activity transport running by themselves, but can receive retained/live batches when another visible subscriber keeps that transport active.
- Applying `hidden` after an `<img>` exists cannot undo the initial request or guarantee release of decoded browser memory.

## Settled Decisions

- Keep `nodel-app` as the sole owner of route selection and page state. Do not add author-facing attributes, page activation events, or component-specific navigation coupling.
- Reuse `observeNodelVisibility()` with internal options that allow media to observe connection/page activity without treating document-hidden or offline states as reasons to remove an active-page image. Existing callers retain their current defaults and behavior.
- Treat an app-managed page as inactive until `nodel-app` has applied `active`, even if `hidden` has not yet been assigned. Any inactive ancestor in a nested route makes the descendant inactive.
- Track active pages in an app-owned internal `WeakMap`; navigation claims the selected group and leaf, and `nodel-page.disconnectedCallback()` unconditionally releases its claim before descendants can reconnect. App reset retains conditional owner clearing for pages still under that app.
- Add a synchronous initial page-suspension barrier in `nodel-app` before queued navigation. The real navigation transition still selects the startup hash/fallback page, dispatches navigation state, and invokes its activation action exactly once.
- Keep `nodel-image` connected and retain its host attributes, datasets, accessible name, and frame/placeholder while inactive. Only the native `.nodel-image-media` element is activation-dependent.
- Keep the existing signal binding installed for the component's connected lifetime, matching other signal-aware controls. A hidden image may retain a newer signal value if the shared activity source is active elsewhere, but it must not create or request native media until activated.
- Do not dispose/recreate signal bindings on every route transition; doing so can lose retained activity when the image is the last subscriber and would diverge from the shared activity-source convention.
- Images outside `nodel-page`, and standalone pages outside `nodel-app`, remain active as today. An explicitly `hidden` standalone page still suppresses descendant media.
- Do not use `loading="lazy"` as the fix; browser lazy-loading is not a reliable hidden-route lifecycle and does not detach media after navigation.

## Lifecycle

1. When `nodel-app` connects or reconnects, it synchronously marks all descendant pages inactive without running navigation actions.
2. `nodel-image` registers its visibility observer before creating media. The initial callback sees app pages without `active` as inactive and renders only the existing non-loading placeholder shell.
3. The queued navigation sync selects the startup hash, retained route, or first page and atomically applies active state to the selected leaf and any containing group page.
4. The visibility observer then renders `<img>` only for images whose complete page ancestry is active.
5. Signal updates continue to normalize through existing host attributes. While inactive, rendering preserves state/accessibility but emits no `<img>`; activation uses the latest safe `src`.
6. Navigation away removes the native image immediately after the page-state mutation is observed. Reconnection starts from the same suspended state and waits for the current navigation transition.
7. Page and app child-list changes rediscover navigation structure, while arbitrary internal subtree mutations do not trigger navigation rescans. Component disconnection disposes both visibility and signal subscriptions and leaves no live native media that could restart before reconnection state is known.

## Implementation Steps

### 1. Generalize The Existing Visibility Scope

Update `src/data/visibility-scope.ts` without changing existing caller defaults:

1. Store per-observer policy alongside the element, handler, and last state.
2. Add optional internal controls for suspending on document visibility and network/Nodel connectivity; both default to the current `true` behavior.
3. Extract the ancestor-page check so it returns inactive when any ancestor:
   - is `nodel-page[hidden]`; or
   - is a `nodel-page` managed by a containing `nodel-app` but does not yet have `active`.
4. Preserve disconnection as inactive for every policy.
5. Keep the current shared event listeners, mutation observer, connectivity subscription, deduplicated notifications, exception isolation, and final-subscriber cleanup.
6. Continue watching both `hidden` and `active`; do not infer visibility from arbitrary CSS or generic hidden ancestors.
7. Extend `test/visibility-scope.test.ts` for pre-navigation app pages, active/inactive nested ancestors, standalone pages, and a media policy that ignores offline/document-hidden transitions while still reacting to page transitions and disconnection.

Acceptance:

- Existing data/activity observers still pause for hidden documents, offline/connectivity failures, and inactive pages.
- An app page without `active` is inactive before navigation settles.
- A page-only media observer remains active through connectivity changes when its route is active.
- No duplicate notification or global-listener leak is introduced.

### 2. Establish Initial Page State Before Descendant Work

Update `src/components/nodel-app.ts`:

1. Extract the existing “hide all pages and clear active state” loop from `applyNavigationTransition()` into a private helper.
2. Invoke that helper synchronously at the start of each app connection, before signal subscriptions, component loading, or queued navigation can allow descendant work.
3. Reuse the helper inside normal navigation transitions, then apply the selected visibility states exactly as today.
4. Do not call `AppNavigationController.sync()` early and do not consume `initialPageActivated`; the queued transition remains the only initial selection/action transition.
5. Preserve page IDs/navigation metadata needed by the controller and toolbar. Only reset visibility/active markers.
6. Observe child-list changes through the app subtree, queueing navigation only for direct app-child mutations or added/removed `nodel-page` structure; keep direct-child connectivity presentation updates.

Extend `test/nodel-navigation.test.ts` and `test/nodel-page-actions.test.ts` to prove:

- all app-managed pages are suspended synchronously before the initial navigation microtask;
- the normal default and startup-hash routes become active after sync;
- nested startup hashes activate both the group and selected leaf only;
- initial and hash-selected page actions still run exactly once;
- reconnecting after a hash change does not transiently reactivate old media or duplicate the old/new page action;
- mutation rediscovery and explicit reselection retain their existing action semantics.
- removing and reinserting an active nested leaf releases its claim synchronously, keeps media absent until queued navigation, and restores the selected leaf media after reclaim.

### 3. Make `nodel-image` Page-Visibility Aware

Update `src/components/nodel-image.ts`:

1. Add one visibility disposer and one private boolean representing whether native media may be attached.
2. In `connectedCallback()`, install the page-only visibility observer before synchronizing signal bindings. Let its synchronous initial callback perform the first render.
3. Make `render()` emit `.nodel-image-media` only when the component is page-active and `safeImageSrc()` accepts a non-empty source; otherwise retain the current placeholder shell.
4. Preserve current `data-fit`, `data-shape`, `data-size`, and `data-source-state` values. A valid but inactive source remains `ready`; do not add a new public paused state.
5. Preserve existing role/name precedence, nested `alt` behavior, unavailable labeling for rejected sources, and safe URL/HTML handling while inactive and after reactivation.
6. Keep signal handlers writing `src`, `alt`, and `label` through the existing attribute path. Attribute changes render against the current visibility state and resynchronize bindings exactly as today.
7. On a visibility transition to inactive, synchronously replace the native image with the placeholder. On activation, render from the latest safe host source.
8. In `disconnectedCallback()`, dispose the signal controller and visibility observer idempotently, mark media inactive, and remove any native image so a later reconnection cannot briefly reuse stale active media.
9. Do not add direct `closest('nodel-page')` navigation listeners, a second signal subscription, custom media fetching, `Image.decode()`, or manual caches.

Extend `test/nodel-control-media.test.ts` or add a focused image-visibility test covering:

- an image outside a page still renders immediately;
- a valid static source in an inactive app page has `data-source-state="ready"` and correct host accessibility but no `<img>`;
- activation creates the image with the existing source and correct nested `alt` behavior;
- hiding removes it and reactivation restores it;
- a hidden signal update changes retained host state but creates no native image; activation renders the latest value;
- repeated hide/show cycles create only one current image and do not duplicate signal subscriptions;
- disconnect/reconnect starts suspended until navigation is current;
- unsafe, empty, labelled, unlabelled, and `aria-labelledby` states preserve existing behavior;
- active-page static media remains attached through browser/Nodel offline state because media uses the page-only policy.

### 4. Add Browser-Level Resource Verification

Add a focused authored-page fixture under `e2e/fixtures/` and a Playwright spec following `e2e/authored-page-contract.spec.ts` request-routing conventions:

1. Serve the fixture through stable built `/v2/nodel-webui.js` and CSS assets, with an Overview route, one or more detail routes, and a nested route.
2. Register request listeners/routes before `page.goto()` and fulfill unique test image URLs with a valid small image response.
3. Start on Overview and assert no inactive detail image URL is requested and no inactive `nodel-image` contains `.nodel-image-media`.
4. Start directly on a nested hash and assert only the selected leaf's media is attached/requested; inactive sibling and unrelated page media remain dormant.
5. Navigate to a detail route and assert its image is requested only after activation.
6. Navigate away, assert the native image is removed, change its `src` while hidden, and assert the new URL is not requested until reactivation.
7. Include a data-image source assertion based on native-element absence; do not claim request interception can measure data-URL decoding.
8. Run the focused resource test once for Chromium, Firefox, and WebKit desktop projects; skip visual/mobile/forced-colour variants because the contract is lifecycle/resource behavior, not appearance.

Browser acceptance is based on native media absence and request timing. Removing an `<img>` permits the browser to release decoded resources but does not guarantee immediate cancellation of an already-started request or deterministic cache/memory eviction.

### 5. Document The Contract

Update the canonical guidance only; no component registry change is needed because no public attribute or event is added:

1. In `docs/architecture.md`, state that app navigation establishes a suspended page state before descendants initialize and that visibility-aware work uses the shared scope.
2. In the `nodel-image` section of `docs/web-components.md`, state that native image media is attached only while its containing app route is active, source/signal state is retained while inactive, and standalone images are unaffected.
3. Avoid promising reduced authored DOM size or immediate decoded-memory reclamation.

## Validation

Run:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run check:jsviews`
4. Focused Vitest coverage for visibility scope, navigation, page actions, activity source, and control media
5. `npm test`
6. `npm run build:preview`
7. Focused Playwright media-resource spec across Chromium, Firefox, and WebKit desktop
8. `npm run test:browser`
9. `git diff --check`

Manually inspect the built authored-page fixture in browser developer tools to confirm inactive pages contain no native `<img>`, activating a page creates only its current image, and returning to Overview detaches detail-page media.

## Risks And Safeguards

- Initial page suspension must not invoke or suppress activation actions; retain the existing queued controller transition and regression-test exact action counts.
- Nested routes require every selected ancestor to be active; test group/leaf and sibling transitions explicitly.
- Shared signal activity may still update hidden host attributes when another visible control owns the transport. This is intentional state retention; native media is the expensive boundary being suspended.
- A data URL already authored in HTML or retained in the host `src` attribute still contributes to DOM/source size. The fix prevents native image loading/decoding, not authored payload storage.
- Browser caches may retain compressed or decoded resources after detachment. Do not use nondeterministic memory totals as a release gate.
- The generalized visibility helper must preserve current defaults so polling, activity, offline, and document-visibility behavior for existing components does not regress.

## Out Of Scope

- Generic DOM virtualization or disconnecting inactive page subtrees.
- Automatic suspension of arbitrary custom elements, video/audio/canvas, QR codes, charts, or future media components without a separate component-specific requirement.
- Changing activity-source fan-out, signal replay semantics, or host-attribute reflection.
- Removing authored data URLs from page markup or guaranteeing immediate browser memory/cache eviction.
- Adding public page lifecycle events, authoring attributes, compatibility aliases, or legacy v1 loader changes.
