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
- `nodel-control-grid`
- `nodel-control-space`
- `nodel-template`
- `nodel-button`
- `nodel-fader`
- `nodel-meter`
- `nodel-image`
- `nodel-icon`
- `nodel-status-indicator`
- `nodel-collapse`
- `nodel-description`
- `nodel-title`
- `nodel-text`
- `nodel-host-icon`
- `nodel-node-list`
- `nodel-add-node`
- `nodel-node-menu`
- `nodel-diagnostics`
- `nodel-toolkit`
- `nodel-console`
- `nodel-log`
- `nodel-host-log`
- `nodel-diagnostic-charts`
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
- `.nodel-button-success` for positive or completed actions.
- `.nodel-button-info` for informational actions.
- `.nodel-button-warning` for cautionary actions.
- `.nodel-button-danger` for destructive actions such as delete.
- `.nodel-button-soft` for alpha-background semantic buttons.
- `.nodel-button-outline` for semantic buttons with a thicker border and low-alpha background.
- `.nodel-button-ghost` for low-emphasis actions such as “more” or inactive navigation.
- `.nodel-button-link` for link-styled button actions.
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

## Confirm Dialogs

`nodel-app` creates a `nodel-confirm-host` automatically. Components can request confirmation by dispatching a bubbled `nodel-confirm` event with `{ title?, text?, confirmLabel?, cancelLabel?, tone?, resolve }`; the host opens an accessible modal dialog and calls `resolve(true)` only after the user confirms.

Touch controls that support confirmation expose `confirm`, `confirm-title`, `confirm-text`, `confirm-label`, `cancel-label`, and `confirm-tone`. The action is called only after confirmation.

## Toolbar Icon

`nodel-toolbar` accepts:

- `icon-src` for the image path.
- `icon-alt` for alternative text.

Use the stable v2 asset path when authoring pages:

```html
<nodel-toolbar icon-src="./v2/img/logo.png"></nodel-toolbar>
```

The visible title is omitted by default on host pages. On node pages, the toolbar fetches relative `REST/` and uses the node display name as the default title. Set `title` only when the bar needs an explicit override. `icon-alt` defaults to the resolved title when one is available, otherwise it remains empty.

`nodel-node-menu` can be placed in the toolbar action slot on node pages. It renders a hamburger button that opens a right-side drawer with theme selection, node rename, restart, delete, custom UI links, and host reference links.

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

## Touch Controls

Use `nodel-control-grid` for equal-cell touch-control layouts inside normal page columns. It is separate from `nodel-row` and `nodel-column`: rows and columns compose the page, while the control grid divides the width available to controls.

```html
<nodel-row>
  <nodel-column md="6">
    <nodel-control-grid columns="4">
      <nodel-button>Power</nodel-button>
      <nodel-button variant="primary">Arm</nodel-button>
      <nodel-button variant="success">Start</nodel-button>
      <nodel-button variant="danger">Stop</nodel-button>
    </nodel-control-grid>
  </nodel-column>
</nodel-row>
```

Supported `nodel-control-grid` attributes:

- `columns`
- `sm`
- `md`
- `lg`
- `xl`
- `2xl`

Column counts are mobile-first and normalized to 1-12. A grid fills its parent width. Children naturally take the width of one grid cell; if there are more children than columns, they wrap to later rows.

Nested grids are supported for mixed layouts. For example, a future tall fader can sit beside a stack of buttons:

```html
<nodel-control-grid columns="2">
  <nodel-fader label="Volume"></nodel-fader>
  <nodel-control-grid columns="1">
    <nodel-button>Mute</nodel-button>
    <nodel-button>Speech</nodel-button>
    <nodel-button>Music</nodel-button>
  </nodel-control-grid>
</nodel-control-grid>
```

Use `nodel-control-space` for deliberate empty cells. It is scoped to control-grid layout rather than general page spacing.

```html
<nodel-control-grid columns="1">
  <nodel-button>One</nodel-button>
  <nodel-button>Two</nodel-button>
  <nodel-button>Three</nodel-button>
  <nodel-control-space></nodel-control-space>
</nodel-control-grid>
```

`nodel-button` renders a touch-sized native button. Without an `action`, it is inert and can be used for examples or custom scripting. With an `action`, it posts to the current node's relative `REST/actions/<name>/call` endpoint, so action-enabled buttons should be used from a node page.

## Templates

Use `nodel-template` with a native HTML `<template>` child when repeated page fragments only differ by a small set of names, labels, actions, or signals. The native template stays inert in source markup, and `nodel-template` renders placeholder-filled clones as siblings so repeated controls remain direct children of their parent layout.

```html
<nodel-control-grid columns="2" md="4">
  <nodel-template name="Zone" repeat="4" start="1">
    <template>
      <nodel-button join="{{item}}" variant="primary" tone="soft">
        {{name}} {{number}}
        <nodel-status-indicator signal="{{item}}Online" label="{{name}} {{number}} online"></nodel-status-indicator>
      </nodel-button>
    </template>
  </nodel-template>
</nodel-control-grid>
```

Define a shared native template once and reuse it from multiple locations with `template="id"`:

```html
<template id="zone-button-template">
  <nodel-button join="{{item}}" variant="primary" tone="soft">
    {{name}} {{number}}
  </nodel-button>
</template>

<nodel-control-grid columns="2" md="4">
  <nodel-template template="zone-button-template" name="Zone" repeat="4"></nodel-template>
</nodel-control-grid>

<nodel-control-grid columns="1">
  <nodel-template template="zone-button-template" name="Output" repeat="2"></nodel-template>
</nodel-control-grid>
```

Supported `nodel-template` attributes:

- `template`: `id` of a shared native `<template>` element. When omitted, the first direct child `<template>` is used.
- `repeat`: number of clones to render, default `1`, clamped to a safe range.
- `start`: first numeric value for `{{number}}`, default `1`.
- `step`: increment between numeric values, default `1`.
- `name`: base name for `{{name}}` and `{{item}}`.
- `data-*`: custom placeholder values. For example, `data-action-prefix="SetZone"` exposes both `{{action-prefix}}` and `{{actionPrefix}}`.

Built-in placeholders:

- `{{index}}`: zero-based iteration index.
- `{{number}}`: numeric value for this clone.
- `{{name}}`: exact `name` attribute value.
- `{{item}}`: `name` followed by `number`, such as `Zone1`.
- `{{repeat}}`: normalized repeat count.

Placeholders are replaced in text nodes and attribute values only. Unknown placeholders are left unchanged, and no JavaScript or raw HTML is evaluated.

Touch media components are child-aware. `nodel-image` and `nodel-icon` occupy a full control-grid cell when they are direct grid children, and render inline when placed inside `nodel-button`. `nodel-status-indicator` is intended for button content for now; inside a button it is overlaid in the top-right corner and stays out of inline or stacked content flow. Components keep their own signal behavior; the button only arranges them.

`nodel-fader` renders a touch-first level slider. It does not include a meter by default; the filled track shows the current set position. Add an explicit `nodel-meter` child when live level display is needed. It defaults to a vertical fader so it naturally occupies a compact control-grid cell and can sit beside a stack of related controls. Dragging is relative to the current value: touching the track begins a drag, but does not jump the level to the touched position. During drag, action calls are throttled and a final exact value is sent when the drag ends. Add `increment` or `nudge` to show +/- controls; `nudge` sets the increment amount and defaults to `step`.

Supported `nodel-fader` attributes:

- `orientation="vertical|horizontal"`
- `compound-align="bottom|center|top"` for vertical faders, or `end|center|start` aliases
- `variant="default|primary|success|info|warning|danger|ghost"`
- `tone="solid|soft|outline"`
- `min`, `max`, `step`
- `unit="percent|db|none"`
- `value`
- `nudge`
- `increment`
- `action`
- `actions="ActionName:phase; OtherAction:phase"` with phases `change`, `live`, and `commit`
- `join="Name"` as shorthand for `action="Name" signal="Name"`
- `arg-type="number|string|json"`
- `disabled`
- `readout="show|hide"`
- `label`
- `live-interval`
- `signal="SignalName"` as shorthand for `value`
- `signals="SignalName:target"` with targets `value`, `label`, and `disabled`

`nodel-meter` renders a read-only signal-driven level meter. It can be a standalone control-grid tile or a compact child inside a fader rail. Percent values default to `0..100`; dB values default to `-60..+10`. Percent and raw numeric meters default to `curve="linear"`; dB meters default to `curve="vu"` for audio-style display. Override the display curve with `curve="linear"`, `curve="vu"`, or the `curve="audio"` alias.

Supported `nodel-meter` attributes:

- `signal="SignalName"` as shorthand for `value`
- `signals="SignalName:target"` with targets `value`, `peak`, and `label`
- `value`
- `min`, `max`
- `unit="percent|db|none"`
- `curve="linear|vu|audio"`
- `orientation="vertical|horizontal"`
- `warn`, `danger`
- `peak="off|hold"`
- `readout="show|hide"`
- `label`

`nodel-toggle` renders a touch switch for boolean actions and signal feedback. It is switch-only: use `nodel-segmented` with two options when an Off/On segmented look is desired. Toggle states are `off`, `on`, `partially-off`, and `partially-on`; partial states use warning styling and expose `aria-checked="mixed"`.

The default toggle surface is transparent, matching the fader's no-card treatment. Use `tone="soft"` or `tone="outline"` when a page needs a tile-like container. Visible state text is hidden by default because the switch visual and ARIA state carry the state; set `state-label="show"` if text such as `On` or `Partial On` should be rendered.

Supported `nodel-toggle` attributes:

- `action`
- `actions="ActionName:phase; OtherAction:phase"` with phases `toggle`, `on`, and `off`
- `join="Name"` as shorthand for `action="Name" signal="Name"`
- `on-arg`, default `true`
- `off-arg`, default `false`
- `arg-type="boolean|string|number|json"`
- `value`
- `on-value`, `off-value`, `partial-on-value`, `partial-off-value`
- `label`
- `on-label`, `off-label`
- `state-label="hide|show"`
- `variant="default|primary|success|info|warning|danger"`
- `off-variant="default|primary|success|info|warning|danger"`
- `tone="solid|soft|outline"`
- `disabled`
- `confirm`, `confirm-title`, `confirm-text`, `confirm-label`, `cancel-label`, `confirm-tone`
- `signal="SignalName"` as shorthand for `state`
- `signals="SignalName:target"` with targets `state`, `label`, and `disabled`

```html
<nodel-toggle label="Power" action="SetPower" signal="Power"></nodel-toggle>
<nodel-toggle join="Power" variant="success" off-variant="danger"></nodel-toggle>
<nodel-toggle signal="Power" actions="PowerOn:on; PowerOff:off"></nodel-toggle>
<nodel-toggle label="Shutdown" action="Shutdown" confirm-text="Shut down the device?" confirm-tone="danger"></nodel-toggle>
```

`nodel-segmented` renders a mutually exclusive option group using direct `nodel-button` children. The group preserves child content, marks the matching child active from `value`/`signal`, and captures child clicks so one shared group action is called.

Supported `nodel-segmented` attributes:

- `action`
- `actions="ActionName:phase; OtherAction:phase"` with phase `select`
- `join="Name"` as shorthand for `action="Name" signal="Name"`
- `arg-type="string|number|boolean|json"`
- `value`
- `variant="default|primary|success|info|warning|danger"`
- `tone="solid|soft|outline"`
- `orientation="horizontal|vertical"`
- `disabled`
- `allow-deselect`
- `label`
- `confirm`, `confirm-title`, `confirm-text`, `confirm-label`, `cancel-label`, `confirm-tone`
- `signal="SignalName"` as shorthand for `value`
- `signals="SignalName:target"` with targets `value`, `label`, and `disabled`

Child `nodel-button` options use `value` first, then `arg`, then their text content as the selection value. Option-level confirm attributes override the group confirm settings for that option.

```html
<nodel-segmented label="Source" action="SetSource" signal="Source">
  <nodel-button value="HDMI 1">HDMI 1</nodel-button>
  <nodel-button value="HDMI 2">HDMI 2</nodel-button>
  <nodel-button value="USB-C">USB-C</nodel-button>
</nodel-segmented>
```

Faders preserve compound children and place them in a compact rail in source order. The rail has no separate card or border treatment by default; it relies on proximity to keep related status, meter, and button controls visually grouped while allowing each child component to keep its own signal/action behavior. The rail defaults to bottom/end alignment; set `compound-align="top"`, `compound-align="center"`, or `compound-align="bottom"` when a vertical fader needs different placement.

`variant` controls the fader fill colour. `tone` controls the surrounding surface: the default `solid` tone leaves the fader directly on the parent background, while `soft` and `outline` add progressively stronger visual grouping.

The fader readout is rendered inside the track by default. On vertical faders it sits near the top when the value is low and near the bottom when the value is high so it stays away from the thumb.

Vertical faders keep a stable overall height whether or not increment buttons are shown. When increment buttons are hidden, the track grows by the missing button slots so simple faders align with nudged faders. Override `--nodel-fader-length` for the increment-mode track length, or `--nodel-fader-length-no-increment` when no-button faders need a different length.

```html
<nodel-control-grid columns="2">
  <nodel-fader label="Volume" action="SetVolume" signal="Volume" nudge="5">
    <nodel-meter signal="Level" peak="hold" label="Output level"></nodel-meter>
    <nodel-status-indicator signal="Muted" label="Mute state" tone="warning"></nodel-status-indicator>
    <nodel-button action="Mute" variant="warning" tone="soft">Mute</nodel-button>
  </nodel-fader>
  <nodel-control-grid columns="1">
    <nodel-button>Speech</nodel-button>
    <nodel-button>Music</nodel-button>
  </nodel-control-grid>
</nodel-control-grid>
```

Supported `nodel-button` attributes:

- `variant="default|primary|success|info|warning|danger|ghost|link"`
- `tone="solid|soft|outline"`
- `layout="inline|stack"`
- `size="auto|sm|md|lg"`
- `action="ActionName"`
- `actions="ActionName:phase; OtherAction:phase"` with phases `click`, `press`, and `release`
- `join="Name"` as shorthand for `action="Name" signal="Name"`
- `arg="value"`
- `arg-type="string|number|boolean|json"`
- `disabled`
- `active`
- `active-value="value"`
- `confirm`, `confirm-title`, `confirm-text`, `confirm-label`, `cancel-label`, `confirm-tone`
- `signal="SignalName"`
- `signals="SignalName:target"`

`disabled` and `active` are state attributes. They can be set statically, but custom node pages usually let local Nodel signals drive them so the UI follows runtime state.

`variant` chooses the semantic colour or special treatment, while `tone` chooses the visual weight. `tone="solid"` is the default filled treatment. Use `tone="soft"` for lower-emphasis semantic actions and `tone="outline"` when a button needs a stronger border without a filled background.

`size="auto"` is the default and uses the surrounding context. Direct control-grid buttons keep the normal touch size. Buttons inside a `nodel-fader` compound rail default to a compact height matching the fader nudge buttons. Use `size="sm"`, `size="md"`, or `size="lg"` to override this.

```html
<nodel-control-grid columns="2" md="4">
  <nodel-button variant="primary">Save</nodel-button>
  <nodel-button variant="success" tone="soft">Ready</nodel-button>
  <nodel-button variant="warning" tone="outline">Review</nodel-button>
  <nodel-button variant="danger" tone="soft">Delete</nodel-button>
</nodel-control-grid>
```

Signal targets:

- `active` is the shorthand `signal` target. It normally compares the signal value with `arg`. Use `active-value` only when the signal value that means active differs from the action argument. Without either value, truthy active text such as `on`, `true`, or `1` marks the button active.
- `label` updates the button label.
- `disabled` toggles disabled state from truthy/falsey text.

`signal` and `signals` use the same parser. Either may contain one binding or a `;`/`,` separated list. Repeated boolean targets default to last-event-wins for v1 compatibility. Use `target(any)` for OR aggregation or `target(all)` for AND aggregation, such as `signals="ShowRunning:active(any); Override:active(any)"`.

`action` and `actions` also use the same parser. Entries are `ActionName` or `ActionName:phase`. Use `actions` for multiple entries. Momentary buttons are inferred when a `press` or `release` phase is present.

```html
<nodel-button action="SetSource" arg="Chromecast" signal="Source">
  Chromecast
</nodel-button>

<nodel-button action="StartShow" signals="ShowRunning:active; ControlsLocked:disabled">
  Start Show
</nodel-button>

<nodel-button join="Mute" confirm-text="Mute this zone?">
  Mute
</nodel-button>

<nodel-button actions="VolumeUp:press; VolumeStop:release">
  Volume Up
</nodel-button>

<nodel-button actions="PrepareShow; StartShow" signals="Ready:active(all); Unlocked:active(all)">
  Start Show
</nodel-button>

<nodel-button action="SetSource" arg="HDMI1" signal="Source">
  <nodel-icon name="image"></nodel-icon>
  HDMI 1
  <nodel-status-indicator signal="HDMI1Present" label="HDMI 1 signal present"></nodel-status-indicator>
</nodel-button>

<nodel-button action="SetSource" arg="HDMI1" signal="Source" layout="stack">
  <nodel-icon name="image" size="lg"></nodel-icon>
  <nodel-text tone="default" size="lg">HDMI 1</nodel-text>
  <nodel-text tone="muted" size="xs">Projector</nodel-text>
  </nodel-button>
```

`nodel-image` supports:

- `src`
- `alt`
- `label`
- `fit="contain|cover"`
- `shape="none|rounded|circle"`
- `size="auto|sm|md|lg|xl"`
- `variant="plain|soft|bordered"`
- `signal="SignalName"` as shorthand for `src`
- `signals="SignalName:target"` with targets `src`, `alt`, and `label`

`size="auto"` is the default. Standalone images use the available tile space naturally; explicit sizes constrain the media. Inline button images default compact and use the same explicit size values when set. `variant="plain"` is the default media treatment. Use `soft` for a ghost-like background or `bordered` for a card-like tile.

`nodel-icon` supports:

- `name`
- `label`
- `alt`
- `tone="default|muted|accent|success|info|warning|danger"`
- `size="auto|sm|md|lg|xl"`
- `variant="plain|soft|bordered"`
- `signal="SignalName"` as shorthand for `name`
- `signals="SignalName:target"` with targets `name`, `alt`, `label`, and `tone`

Use `label` when visible text should appear with a standalone icon. Use `alt` when the icon needs an accessible name without visible text. `size="auto"` uses the default standalone or inline icon size. Set `sm`, `md`, `lg`, or `xl` when a specific icon scale is required. `variant="plain"` is the default media treatment. Use `soft` for a ghost-like background or `bordered` for a card-like tile.

`nodel-status-indicator` supports:

- `signal="SignalName"` as shorthand for `value`
- `signals="SignalName:target"` with targets `value` and `label`
- `value`
- `on-value`
- `off-value`
- `tone="success|info|warning|danger"`
- `off-tone="off|muted"`
- `label`

Status indicators default to off/dark. Truthy values such as `true`, `1`, `on`, `active`, `present`, `available`, or `signal` turn them on. Falsey values such as `false`, `0`, `off`, `inactive`, `absent`, or an empty value turn them off.

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

## Toolkit

`nodel-toolkit` fetches the host `/REST/toolkit` endpoint and renders the scripting toolkit reference in a read-only CodeMirror view. The default UI exposes it on the standalone `toolkit.html` page rather than inside each node page.

Components that support collapse previews should emit plain-text `nodel-collapse-preview` events for meaningful state changes. Keep preview text short and never depend on a direct import or reference to `nodel-collapse`.

## Text

Use `nodel-title` for visible page and section headings. `nodel-page title="..."` controls navigation labels only; it does not render a visible heading.

```html
<nodel-title level="1">Node Overview</nodel-title>
<nodel-title level="2" tone="accent" signal="SectionTitle">Waiting for title</nodel-title>
```

Supported `nodel-title` attributes:

- `level="1|2|3"`
- `tone="default|muted|accent"`
- `signal="SignalName"` as shorthand for `value`
- `signals="SignalName:target"` with target `value`

Use `nodel-text` for ordinary body text. It applies the default muted body styling so override pages do not need to repeat Tailwind utility classes.

```html
<nodel-text>
  Core pages can be overridden with plain HTML using the provided web components.
</nodel-text>
```

Supported attributes:

- `tone="muted|default|accent|success|info|warning|danger"`
- `size="xs|sm|md|lg|xl"`
- `surface="none|card"`
- `signal="SignalName"` as shorthand for `value`
- `signals="SignalName:target"` with target `value`

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
