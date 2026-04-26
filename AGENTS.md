# Project Guidance

## Scope

- This guidance applies to the `nodel-webui-ts` subproject.
- Treat `docs/architecture.md` and `docs/web-components.md` as the canonical human-facing design guidance.

## Web Component Markup

- Prefer safe defaults over explicit attributes in page markup.
- Only specify attributes that are required to change behavior or cannot be inferred reliably.
- Every default should remain overrideable with an explicit attribute when a page needs it.
- Keep core UI pages as uncluttered as possible so authoring custom pages remains approachable.
