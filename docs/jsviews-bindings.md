# JsViews Binding Guidance

## Why JsViews Stays

JsViews remains the binding layer for schema-driven forms. It is the correct tool for live field updates, JSON schema rendering, and attribute/data synchronization.

## Binding Rules

- Use `{^{}}` for live binding.
- Use `data-link` for element and attribute bindings.
- Prefer explicit template IDs or explicit template strings.
- Keep bindings small and predictable.

## Examples

Live text binding:

```html
<div>{^{>name}}</div>
```

Attribute binding:

```html
<a data-link="href{:url} class{:active ? 'is-active' : 'is-idle'}">{^{>label}}</a>
```

Form field binding:

```html
<input data-link="value{:value} disabled{:disabled}" />
```

## Cleanup

Future form components must tear down linked templates when removed from the DOM.

## Current Non-Form Use

`nodel-node-list` was the first non-schema component to use JsViews in the new UI. It uses a linked template for the filter, page-size selection, item rendering, and highlight binding while the component owns fetch cadence and state refresh.

This is a good use of JsViews because it keeps the list rendering logic concise and close to the v1 behavior while still being isolated behind a web component.

`nodel-console` and `nodel-log` are also JsViews-linked components. Their sources own polling, WebSocket, visibility, sequence, and batching behavior; the components expose linked view-model state and update it with `$.observable(...)` so templates, controls, and rows stay data-bound.

Linked controls must use `data-link` and observable state rather than reading UI state back from the DOM. For example:

```html
<input data-link="filter trigger=true" />
{^{for visibleRows}}
  <span>{^{>alias}}</span>
{{/for}}
```

A build-time `npm run check:jsviews` guard verifies that the JsViews-backed components still link templates and do not bypass them with direct DOM rendering.

`nodel-add-node` remains native DOM because it is primarily an interaction/submit flow rather than a continuously reactive list.

Components that link templates should call `unlinkTemplate(...)` or `$.unlink(...)` in `disconnectedCallback()`.
