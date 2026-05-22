# Project Guidance

## Scope

- This guidance applies to the `nodel-webui-ts` subproject.
- Treat `docs/architecture.md` and `docs/web-components.md` as the canonical human-facing design guidance.

## Web Component Markup

- Prefer safe defaults over explicit attributes in page markup.
- Only specify attributes that are required to change behavior or cannot be inferred reliably.
- Every default should remain overrideable with an explicit attribute when a page needs it.
- Keep core UI pages as uncluttered as possible so authoring custom pages remains approachable.

## Shared Styling

- Prefer the shared semantic classes in `src/styles.css` before adding repeated inline Tailwind utility strings.
- Use `.nodel-button`, `.nodel-field`, `.nodel-card`, `.nodel-panel`, `.nodel-popover`, `.nodel-list-item`, `.nodel-menu-item`, and `.nodel-alert` for common controls and surfaces.
- Use variant/state classes such as `.nodel-button-primary`, `.nodel-button-danger`, `.nodel-button-ghost`, `.nodel-menu-item-active`, `.nodel-alert-danger`, `.is-disabled`, and `.is-unreachable` instead of encoding state as raw utility classes.
- Keep one-off Tailwind utilities for layout, spacing, sizing, and component-specific structure when a shared class would be less clear.
