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
