# Web Components Guidance

## Naming

Use the `nodel-` prefix for all UI custom elements.

## Component Model

Components should be small and declarative. Prefer simple attributes over large imperative APIs.

## Markup Defaults

Core page markup should stay as uncluttered as possible.

Prefer safe defaults over explicit attributes. Only specify attributes that change behavior or cannot be inferred reliably. Every default should remain overrideable with an explicit attribute when a page needs it.

Examples:

- Use `<nodel-app>` when the default title and theme are acceptable.
- Use `<nodel-column>` for a full-width column because `span="12"` is the default.
- Omit `nav-id` when the title-derived hash is stable enough.
- Specify `nav-id`, `theme`, `span`, `scope`, or behavior flags only when the page needs a non-default value.

## Current Elements

- `nodel-app`
- `nodel-toolbar`
- `nodel-page`
- `nodel-row`
- `nodel-column`
- `nodel-collapse`
- `nodel-description`
- `nodel-text`
- `nodel-host-icon`
- `nodel-node-list`
- `nodel-add-node`
- `nodel-node-menu`
- `nodel-diagnostics`
- `nodel-console`
- `nodel-log`
- `nodel-actsig`
- `nodel-params`
- `nodel-bindings`
- `nodel-editor`
- `nodel-theme-toggle`
- `nodel-toast-host`

## Shared Styling Classes

Tailwind utilities are preferred for local component layout, spacing, sizing, typography, responsive behavior, and simple color styling. Use named Nodel token utilities such as `text-nodel-muted`, `text-nodel-fg`, `bg-nodel-surface`, `border-nodel-border`, `ring-nodel-accent`, `rounded-control`, `rounded-card`, and `rounded-panel` instead of repeated arbitrary utilities such as `text-[rgb(var(--nodel-muted))]`.

Use the shared semantic classes from `src/styles.css` for repeated controls, surfaces, state variants, and stable page-authoring primitives. These classes are included in the built `v2/nodel-webui.css`, so they are safer for user-authored pages than relying on arbitrary Tailwind utility classes that may not be present in the production build.

- `.nodel-button` for ordinary buttons and button-like labels or links.
- `.nodel-button-primary` for primary actions such as save, create, or submit.
- `.nodel-button-danger` for destructive actions such as delete.
- `.nodel-button-ghost` for low-emphasis actions such as “more” or inactive navigation.
- `.nodel-button-compact` for smaller buttons inside dense toolbars.
- `.nodel-field` for text inputs, search inputs, and selects.
- `.nodel-field-compact` for smaller select/input controls inside dense toolbars.
- `.nodel-card` for simple bordered surfaces and list rows.
- `.nodel-panel` for larger section containers.
- `.nodel-popover` for dropdowns, autocomplete panels, and floating menus.
- `.nodel-list-item` for linked rows or selectable rows.
- `.nodel-menu-item` for menu and autocomplete result buttons.
- `.nodel-menu-item-active` for the active menu item.
- `.nodel-section-heading` for small uppercase section/table headings.
- `.nodel-alert` for neutral loading or status messages.
- `.nodel-alert-sm` and `.nodel-alert-md` for compact and standard alert spacing.
- `.nodel-alert-danger` for error messages.
- `.nodel-toast-host` and `.nodel-toast` for app-level notifications.

Prefer semantic state classes over raw visual utility classes when state or public component API drives appearance. For example, use `.is-disabled`, `.is-unreachable`, or `.nodel-menu-item-active` when state drives appearance.

One-off Tailwind utilities are appropriate for layout and component-specific structure, such as `flex`, `grid`, `gap-3`, `w-full`, `min-w-0`, `text-nodel-muted`, `bg-nodel-surface`, or responsive column classes.

```html
<button type="button" class="nodel-button nodel-button-primary">Save</button>

<input class="nodel-field w-full" type="search" placeholder="Filter" />

<div class="nodel-panel p-4">
  <p class="nodel-alert px-4 py-3 text-sm">Loading...</p>
</div>
```

Shared styling is backed by theme tokens such as `--nodel-bg`, `--nodel-fg`, `--nodel-surface`, `--nodel-border`, `--nodel-accent`, `--nodel-danger`, and radius tokens such as `--nodel-radius-control`, `--nodel-radius-card`, `--nodel-radius-panel`, and `--nodel-radius-popover`. Project-wide visual tokens should be added to `tailwind.config.ts` so component templates can use named utilities rather than repeated arbitrary values.

## Toast Notifications

`nodel-app` creates a `nodel-toast-host` automatically. Components can request app-level notifications by dispatching a bubbled `nodel-toast` event with `{ message, detail?, tone?, durationMs?, persistent?, id? }`.

Use `tone="success"` for completed saves, `tone="info"` for progress, `tone="warning"` for partial completion, and `tone="danger"` for failures. Reuse `id` to update an existing toast, such as replacing a persistent restart progress toast with the final refresh result.

## Toolbar Icon

`nodel-toolbar` accepts:

- `icon-src` for the image path.
- `icon-alt` for alternative text.

Use the stable v2 asset path when authoring pages:

```html
<nodel-toolbar icon-src="./v2/img/logo.png"></nodel-toolbar>
```

The visible title is omitted by default on host pages. On node pages, the toolbar fetches relative `REST/` and uses the node display name as the default title. Set `title` only when the bar needs an explicit override. `icon-alt` defaults to the resolved title when one is available, otherwise it remains empty.

`nodel-node-menu` can be placed in the toolbar action slot on node pages. It renders a hamburger button that opens a right-side drawer with theme selection, node rename, restart, delete, custom UI links, Toolkit, and Diagnostics.

## Page Navigation

`nodel-app` automatically builds toolbar navigation from declared `nodel-page` elements.

A top-level page becomes a top-level navigation item:

```html
<nodel-page title="Overview">...</nodel-page>
```

A top-level page containing direct child pages becomes a menu group. The child pages become submenu items:

```html
<nodel-page title="Areas">
  <nodel-page title="Upstairs">...</nodel-page>
  <nodel-page title="Downstairs">...</nodel-page>
</nodel-page>
```

Use `nav-id` when a page needs a stable explicit hash target:

```html
<nodel-page title="Main Overview" nav-id="Overview">...</nodel-page>
```

If `nav-id` is omitted, the ID is generated from the title by keeping only ASCII letters and digits, matching the v1 concept.

Prefer omitting `nav-id` on core pages unless the generated title-based ID is not sufficient.

## Theme

`nodel-app` owns theme resolution. The theme is controlled with the `theme` attribute and mirrored to `document.documentElement.dataset.theme`.

Omit `theme` to use the stored preference, then the system color scheme. Explicit `theme="light"` or `theme="dark"` overrides both.

`nodel-theme-toggle` renders an accessible slider switch and persists the selected light/dark preference. It is included in `nodel-node-menu` by default on node pages. It uses Font Awesome's free solid `sun` and `moon` icons by default. The icon imports are isolated in `src/icons/fontawesome.ts` so a licensed Font Awesome Pro package can be enabled later by changing that wrapper rather than the component API.

## Layout

Use `nodel-row` and `nodel-column` for page composition. Keep the markup close to the shape of the page, not the implementation details.

`nodel-row` uses a responsive 12-column grid. `nodel-column` defaults to full width, equivalent to `span="12"`.

Responsive column spans follow Tailwind's mobile-first breakpoint model using Tailwind's default breakpoint widths:

- `span` applies at all sizes unless a breakpoint overrides it.
- `sm` applies from `640px`.
- `md` applies from `768px`.
- `lg` applies from `1024px`.
- `xl` applies from `1280px`.
- `2xl` applies from `1536px`.

Use `md="6"` for full width on small screens and half width from medium screens upward.

```html
<nodel-row>
  <nodel-column>Full width</nodel-column>
</nodel-row>

<nodel-row>
  <nodel-column md="6">Left half on medium screens</nodel-column>
  <nodel-column md="6">Right half on medium screens</nodel-column>
</nodel-row>

<nodel-row>
  <nodel-column md="6" lg="4" xl="3">Responsive content</nodel-column>
</nodel-row>
```

`nodel-page title="..."` is used for generated navigation labels. It does not render a visible page heading. Add explicit heading/content components inside the page when a visible title is needed.

## Collapsible Sections

Use `nodel-collapse` for reusable collapsible panels. It is closed by default, matching the v1 editor section behavior. Add `open` when a section should start expanded. Add `preview` for fallback summary text while collapsed.

```html
<nodel-collapse label="Recipe">
  <nodel-editor></nodel-editor>
</nodel-collapse>

<nodel-collapse label="Diagnostics" preview="Loading diagnostics" open>
  <nodel-diagnostics></nodel-diagnostics>
</nodel-collapse>
```

Supported attributes:

- `label="..."`
- `open`
- `preview="..."`

Behavior:

- Uses native disclosure semantics for keyboard and accessibility behavior.
- Reflects user toggles to the host `open` attribute.
- Dispatches `nodel-collapse-toggle` with `{ open: boolean }` when toggled.
- Shows static `preview` text while collapsed when provided.
- Updates its preview from descendant `nodel-collapse-preview` events with `{ text: string }` detail.
- Keeps child content connected while collapsed so nested components retain their normal lifecycle.

Components that support collapse previews should emit plain-text `nodel-collapse-preview` events for meaningful state changes. Keep preview text short and never depend on a direct import or reference to `nodel-collapse`.

## Text

Use `nodel-text` for ordinary body text. It applies the default muted body styling so override pages do not need to repeat Tailwind utility classes.

```html
<nodel-text>
  Core pages can be overridden with plain HTML using the provided web components.
</nodel-text>
```

Supported attributes:

- `tone="muted|default|accent|danger|success"`
- `size="xs|sm|md|lg"`
- `surface="none|card"`

Use `surface="card"` for bordered/padded callouts.

For precise styling overrides, set CSS custom properties on the host:

```html
<nodel-text style="--nodel-text-color: #d97706; --nodel-text-padding: 1rem;">
  Custom text.
</nodel-text>
```

Tailwind utilities in user-authored override pages are not guaranteed to exist in the built CSS unless they are part of the build scan or a safelist. Prefer the shared styling classes above for common UI elements in user-authored pages.

## Description

`nodel-description` renders the current node description from relative `REST/` as markdown. It is intended for node pages such as `nodel.html` and hides itself when the node has no description.

```html
<nodel-description></nodel-description>
```

Behavior:

- Reads `desc` from relative `REST/`, matching the v1 node description source.
- Renders markdown into sanitized HTML.
- Starts collapsed by default with a short preview.
- Shows a fade at the bottom and a `Show more` button only when the rendered description is longer than the collapsed preview.
- Toggles to `Show less` when expanded and reflects the expanded state to the `open` attribute.

Supported attributes:

- `collapsed-height="8rem"`
- `open`

The collapsed height can also be overridden with CSS:

```html
<nodel-description style="--nodel-description-collapsed-height: 10rem;"></nodel-description>
```

## Node Lists

`nodel-node-list` renders local or network-wide nodes.

```html
<nodel-node-list></nodel-node-list>
<nodel-node-list scope="network"></nodel-node-list>
```

Supported attributes:

- `scope="local|network"`
- `poll-interval="2000"`
- `page-size="20"`

Behavior:

- Local scope reads `/REST` and uses `info.nodes`.
- Network scope reads `/REST/nodeURLs`.
- Filters are live and case-insensitive.
- Node icons use the familiar Nodel host identicon generated from `identicon.js` and `xxhashjs`.
- Unreachable network hosts are dimmed.

## Add Node

`nodel-add-node` provides the locals page add-node flow.

```html
<nodel-add-node redirect="false"></nodel-add-node>
```

Supported attributes:

- `redirect="true|false"`
- `recipes="true|false"`
- `duplicate="true|false"`

Behavior:

- Validates the node name.
- Searches recipes from `/REST/recipes/list`.
- Searches existing nodes from `/REST/nodeURLs`.
- Creates from a recipe path or duplicates an existing node.
- Dispatches `nodel-node-created` after success.

The add-node panel is intentionally native HTML and does not depend on Bootstrap.

## Node Activity

`nodel-description`, `nodel-console`, `nodel-log`, and `nodel-editor` are intended for node pages such as `nodel.html`. They use relative REST paths, so they should be rendered from a node context like `/nodes/<node>/nodel.html` or a custom node page.

```html
<nodel-page title="Activity">
  <nodel-row>
    <nodel-column>
      <nodel-description></nodel-description>
    </nodel-column>
  </nodel-row>
  <nodel-row>
    <nodel-column>
      <nodel-collapse label="Console" preview="No console output yet" open>
        <nodel-console collapse-preview="last-line"></nodel-console>
      </nodel-collapse>
    </nodel-column>
  </nodel-row>
  <nodel-row>
    <nodel-column>
      <nodel-collapse label="Recipe">
        <nodel-editor></nodel-editor>
      </nodel-collapse>
    </nodel-column>
  </nodel-row>
  <nodel-row>
    <nodel-column>
      <nodel-text><b>Actions &amp; Signals</b></nodel-text>
      <nodel-actsig></nodel-actsig>
    </nodel-column>
  </nodel-row>
  <nodel-row>
    <nodel-column>
      <nodel-text><b>Log</b></nodel-text>
      <nodel-log></nodel-log>
    </nodel-column>
  </nodel-row>
</nodel-page>
```

`nodel-console` behavior:

- Reads console output from relative `REST/console`.
- Keeps the newest 200 console entries.
- Posts entered commands to relative `REST/exec` as `{ "code": "..." }`.
- Supports Enter to submit and Up/Down to move through local command history.
- Pauses polling while its page or browser tab is hidden.
- Set `collapse-preview="last-line"` to emit the newest console line through `nodel-collapse-preview` for a parent `nodel-collapse`.

`nodel-log` behavior:

- Reads activity history/live updates from the current node WebSocket.
- Falls back to relative `REST/activity` polling when the WebSocket is unavailable.
- Coalesces rapid live activity by source/type/alias before rendering.
- Provides filter, Hold, and row-limit controls.
- Pauses streaming/polling while its page or browser tab is hidden.

`nodel-actsig` behavior:

- Reads current-node actions from relative `REST/actions` and signals from relative `REST/events`.
- Pairs actions and signals by matching name, groups them by metadata `group`, and sorts by metadata `order`, matching v1 behavior.
- Builds form controls from each action/signal JSON schema using JsViews live bindings.
- Posts action payloads to relative `REST/actions/<name>/call` and signal override payloads to relative `REST/events/<name>/emit`.
- Keeps signals read-only by default; enable `Override signals` in the component to emit signal values manually.
- Lazily materializes grouped schema forms when a section is expanded and caches hidden activity updates until forms are visible.

`nodel-params` behavior:

- Reads current-node parameter schema from relative `REST/params/schema` and values from relative `REST/params`.
- Builds form controls from the parameter JSON schema using the shared schema form helpers.
- Posts raw parameter payloads to relative `REST/params/save`, matching v1 parameter save behavior.
- Supports nested objects and array add/remove/reorder controls through the shared schema form runtime.

`nodel-bindings` behavior:

- Reads current-node remote binding schema from relative `REST/remote/schema` and values from relative `REST/remote`.
- Renders action and event bindings as grouped rows with status, target node, target action/event, and suggestion state.
- Uses `/REST/nodeURLs` for node lookup and target-node `REST/actions` or `REST/events` for action/event lookup.
- Supports selected-row bulk node assignment, fuzzy match suggestions, and applying high/medium confidence suggestions.
- Posts raw remote binding payloads to relative `REST/remote/save`, matching the v1 backend shape.

`nodel-editor` behavior:

- Lists current node files from relative `REST/files`.
- Selects files from a dropdown rather than a persistent side panel.
- Opens text files from relative `REST/files/contents`.
- Saves `script.py` through relative `REST/script/save`, preserving v1 script behavior.
- Saves other files through relative `REST/files/save`.
- Creates empty text files or uploads local files.
- Deletes files through relative `REST/files/delete`, except `script.py` is protected.
- Uses CodeMirror 6 for editing and Python highlighting for `.py` files.
- Uses theme-aware editor colours for the cursor, selection, matching brackets, active line, search matches, and syntax highlighting.
- Starts at a sensible editor height and supports vertical drag-resize.
- Provides custom layout hints from `src/editor/nodel-document-definition.ts` for v2 `nodel-*` markup.

Supported attributes:

- `default-file="script.py"`

Editor colours can be overridden with CSS custom properties when a page needs a custom palette:

```html
<nodel-editor style="--nodel-editor-cursor: #facc15;"></nodel-editor>
```

These node-page components do not expose imperative public APIs; page authors configure placement through markup and let each component/source manage its own lifecycle.

## Shadow DOM

Default to the simplest implementation that preserves working Tailwind styling and JsViews integration. If a component later needs isolation, document why before adding Shadow DOM.
