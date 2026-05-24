# Architecture Guidance

## Scope

`nodel-webui-ts` is the new UI. `nodel-webui-js` is v1 and is reference-only for future work.

Do not modify v1 code for new UI work. Legacy-loader remains the compatibility path for old pages and XML/custom UI content.

## Rules

- Use TypeScript.
- Use custom elements for UI composition.
- Use Tailwind CSS for the base styling system.
- Use Tailwind utilities and named Nodel Tailwind tokens for local component styling.
- Use shared semantic styling classes from `src/styles.css` for repeated controls, surfaces, state variants, and public page-authoring primitives.
- Keep JsViews for schema-form generation and live data binding.
- Do not add placeholder code.
- Do not copy v1 implementation patterns unless a behavior is being intentionally re-created.
- Keep page markup minimal by relying on safe web-component defaults; see `web-components.md`.

## Current Base Layer

The first UI layer is intentionally small:

- `nodel-app` manages theme state.
- `nodel-toolbar` renders the top bar.
- `nodel-page` renders page sections.
- `nodel-row` and `nodel-column` provide simple layout primitives.
- `nodel-collapse` renders reusable collapsible panels.
- `nodel-description` renders the current node description from `REST/` as markdown with a collapsed preview.
- `nodel-theme-toggle` switches between light and dark themes using the `theme` attribute.
- `nodel-text` provides default body text styling.
- `nodel-node-list` encapsulates the v1-style locals/network node lists with JsViews-backed data binding.
- `nodel-add-node` encapsulates the add-node UI and recipe/node lookup flow.
- `nodel-diagnostics` renders the host diagnostics table.
- `nodel-console` renders the node console history and command prompt.
- `nodel-log` renders the node activity stream with hold, filter, and row-limit controls.
- `nodel-actsig` renders current-node actions and signals from their JSON schemas with lazy JsViews form materialization.
- `nodel-editor` renders the node file browser/editor with CodeMirror 6 and JsViews-linked controls.

Node list and add-node behavior intentionally preserve the existing v1 look and feel, including the host icon algorithm and the local vs network list split.

Node Activity behavior intentionally preserves the important v1 console/activity mechanics while keeping the implementation inside v2 web components. Description data uses the v1-style relative `REST/` `desc` field, rendered through a sanitized markdown component. Console data uses visible-only relative `REST/console` polling. Activity uses one visible-only WebSocket for the active node with polling fallback through relative `REST/activity`. Actions/signals are loaded from relative `REST/actions` and `REST/events`, paired/grouped like v1, and rendered from JSON schema using JsViews with lazy section expansion rather than the old large-form `Enable` gate. Components that can summarize themselves inside `nodel-collapse` use bubbled `nodel-collapse-preview` events with plain-text preview details rather than coupling directly to the collapse component.

Node editor behavior intentionally preserves the v1 file endpoints while using CodeMirror 6 rather than CodeMirror 5. The editor shell, file browser, controls, and status state are JsViews-linked. CodeMirror owns only the editor viewport. Custom layout hints are maintained in `src/editor/nodel-document-definition.ts` and should be updated whenever a public `nodel-*` component is added.

`nodel-app` also owns page navigation. It discovers declared `nodel-page` elements, creates the toolbar navigation model, tracks the active page, and hides inactive pages with the `hidden` attribute. Nested `nodel-page` elements create toolbar submenu groups. This preserves the v1 behavior concept without using Bootstrap dropdowns or jQuery page switching.

## Styling Layer

Tailwind is the primary styling layer. Use utilities directly for local layout, spacing, sizing, typography, responsive behavior, and simple color styling. Use the Nodel token utilities from `tailwind.config.ts`, such as `text-nodel-muted`, `text-nodel-fg`, `bg-nodel-surface`, `border-nodel-border`, `ring-nodel-accent`, `rounded-control`, `rounded-card`, and `rounded-panel`, instead of repeated arbitrary CSS-variable utilities.

Common UI primitives still live in `src/styles.css` as semantic classes backed by Tailwind tokens. Use `.nodel-button`, `.nodel-field`, `.nodel-card`, `.nodel-panel`, `.nodel-popover`, `.nodel-list-item`, `.nodel-menu-item`, and `.nodel-alert` for repeated controls, surfaces, and user-authored page primitives.

Use variant and state classes such as `.nodel-button-primary`, `.nodel-button-danger`, `.nodel-button-ghost`, `.nodel-menu-item-active`, `.nodel-alert-danger`, `.is-disabled`, and `.is-unreachable` when behavior or public API drives appearance. Keep raw CSS for theme variable definitions, custom-element defaults, generated markdown content, CodeMirror/editor styling, CSS-variable-driven layout, third-party widgets, and complex runtime selectors.

## Stable Head Contract

User-authored pages should reference the stable v2 entry files, not the Vite source entry:

```html
<link rel="stylesheet" href="./v2/nodel-webui.css" />
<script type="module" src="./v2/nodel-webui.js"></script>
```

The page title can then be controlled by `nodel-app title="..."`.

Vite source pages may reference `/src/main.ts` during local dev. Built/deployed pages should reference the stable v2 support files.

## Test Deployment

The deploy script follows the v1 convention of a root page plus versioned support files.

`npm run deploy:preview` writes the same structure inside the project at `nodel-webui-ts/build/deploy-preview/`. Use this for local smoke tests that should not touch a running Nodel content directory.

`npm run deploy` writes to the Nodel custom content root, defaulting to `/opt/nodel/custom/content/`.

Both deployment commands write:

- `index.htm` into the target content root as the non-visual redirector.
- visual pages such as `nodes.html`, `nodel.html`, and `elements.html` into the target content root.
- built JavaScript and CSS under the `v2/` support folder in that same target.

This lets the custom content root override the built-in default document and visual pages for testing without replacing the built-in v1 support files. The support folder can be changed with `--support-subdir`, but `v2` is the default convention for this UI.

## JsViews

JsViews stays in the stack for schema-driven forms.

Future form code should use:

- `{^{}}` for live bindings.
- `data-link` for element and attribute bindings.
- Explicit cleanup when linked DOM is removed.

See `jsviews-bindings.md` for examples.
