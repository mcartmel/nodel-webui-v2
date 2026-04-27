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
- `nodel-text`
- `nodel-node-list`
- `nodel-add-node`
- `nodel-theme-toggle`

## Toolbar Icon

`nodel-toolbar` accepts:

- `icon-src` for the image path.
- `icon-alt` for alternative text.

Use the stable v2 asset path when authoring pages:

```html
<nodel-toolbar icon-src="./v2/img/logo.png"></nodel-toolbar>
```

The visible title is omitted by default on host pages. On node pages, the toolbar fetches relative `REST/` and uses the node display name as the default title. Set `title` only when the bar needs an explicit override. `icon-alt` defaults to the resolved title when one is available, otherwise it remains empty.

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

Omit `theme` when the default light theme is acceptable.

`nodel-theme-toggle` renders an accessible slider switch. It uses Font Awesome's free solid `sun` and `moon` icons by default. The icon imports are isolated in `src/icons/fontawesome.ts` so a licensed Font Awesome Pro package can be enabled later by changing that wrapper rather than the component API.

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

Tailwind utilities in user-authored override pages are not guaranteed to exist in the built CSS unless they are part of the build scan or a safelist.

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

## Shadow DOM

Default to the simplest implementation that preserves working Tailwind styling and JsViews integration. If a component later needs isolation, document why before adding Shadow DOM.
