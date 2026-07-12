# Project Guidance

## Scope

- This guidance applies to the `nodel-webui-v2` project.
- Treat `docs/architecture.md` and `docs/web-components.md` as the canonical human-facing design guidance.

## Web Component Markup

- Prefer safe defaults over explicit attributes in page markup.
- Only specify attributes that are required to change behavior or cannot be inferred reliably.
- Every default should remain overrideable with an explicit attribute when a page needs it.
- Keep core UI pages as uncluttered as possible so authoring custom pages remains approachable.

## Shared Styling

- Use Tailwind utilities first for local layout, spacing, sizing, typography, and straightforward color styling.
- Prefer named Nodel Tailwind tokens such as `text-nodel-muted`, `text-nodel-fg`, `bg-nodel-surface`, `border-nodel-border`, `ring-nodel-accent`, `rounded-control`, `rounded-card`, and `rounded-panel` instead of arbitrary utilities such as `text-[rgb(var(--nodel-muted))]`.
- Add repeated project-wide colors, radii, shadows, or other visual tokens to `tailwind.config.ts` before introducing repeated arbitrary values.
- Use shared semantic classes from `src/styles.css` for stable reusable controls and public page-authoring primitives: `.nodel-button`, `.nodel-field`, `.nodel-card`, `.nodel-panel`, `.nodel-popover`, `.nodel-list-item`, `.nodel-menu-item`, and `.nodel-alert`.
- Use variant/state classes such as `.nodel-button-primary`, `.nodel-button-danger`, `.nodel-button-ghost`, `.nodel-menu-item-active`, `.nodel-alert-danger`, `.is-disabled`, and `.is-unreachable` when state or public component API drives appearance.
- Keep raw CSS for theme token definitions, custom-element defaults, generated markdown content, CodeMirror/editor styling, CSS-variable-driven layout, third-party widgets, and complex runtime selectors.
- Use `nodel-collapse` for collapsible sections instead of ad-hoc disclosure markup.
- Components that summarize state for a parent `nodel-collapse` should emit plain-text `nodel-collapse-preview` events rather than directly depending on the collapse component.
- CodeMirror editor colour changes should use the shared `--nodel-editor-*` CSS variables instead of hard-coded theme-specific values.
