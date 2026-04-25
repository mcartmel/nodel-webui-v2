# Web Components Guidance

## Naming

Use the `nodel-` prefix for all UI custom elements.

## Component Model

Components should be small and declarative. Prefer simple attributes over large imperative APIs.

## Current Elements

- `nodel-app`
- `nodel-toolbar`
- `nodel-page`
- `nodel-row`
- `nodel-column`
- `nodel-text`
- `nodel-theme-toggle`

## Toolbar Icon

`nodel-toolbar` accepts:

- `icon-src` for the image path.
- `icon-alt` for alternative text.

Use the stable v2 asset path when authoring pages:

```html
<nodel-toolbar title="Nodel" icon-src="./v2/img/logo.png" icon-alt="Nodel"></nodel-toolbar>
```

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

## Theme

`nodel-app` owns theme resolution. The theme is controlled with the `theme` attribute and mirrored to `document.documentElement.dataset.theme`.

`nodel-theme-toggle` renders an accessible slider switch. It uses Font Awesome's free solid `sun` and `moon` icons by default. The icon imports are isolated in `src/icons/fontawesome.ts` so a licensed Font Awesome Pro package can be enabled later by changing that wrapper rather than the component API.

## Layout

Use `nodel-row` and `nodel-column` for page composition. Keep the markup close to the shape of the page, not the implementation details.

`nodel-row` uses a responsive 12-column grid. `nodel-column span="12"` means full width.

Responsive column spans follow Tailwind's mobile-first breakpoint model using Tailwind's default breakpoint widths:

- `span` applies at all sizes unless a breakpoint overrides it.
- `sm` applies from `640px`.
- `md` applies from `768px`.
- `lg` applies from `1024px`.
- `xl` applies from `1280px`.
- `2xl` applies from `1536px`.

Use `span="12" md="6"` for full width on small screens and half width from medium screens upward.

```html
<nodel-row>
  <nodel-column span="12">Full width</nodel-column>
</nodel-row>

<nodel-row>
  <nodel-column span="12" md="6">Left half on medium screens</nodel-column>
  <nodel-column span="12" md="6">Right half on medium screens</nodel-column>
</nodel-row>

<nodel-row>
  <nodel-column span="12" md="6" lg="4" xl="3">Responsive content</nodel-column>
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

## Shadow DOM

Default to the simplest implementation that preserves working Tailwind styling and JsViews integration. If a component later needs isolation, document why before adding Shadow DOM.
