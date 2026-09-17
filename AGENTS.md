# Project Guidance

## Scope

- This guidance applies to the `nodel-webui-v2` project.
- Treat `docs/architecture.md` and `docs/web-components.md` as the canonical human-facing design guidance.

## Testing and Verification

- During implementation, prefer focused tests for changed behavior and affected integration points. Use `npm test -- <test-file-or-path-filter>`; add `-t "<test-name-pattern>"` when narrower coverage is appropriate.
- Validate each meaningful change with relevant checks: `npm run typecheck`, linting, `npm run check:jsviews` for template changes, and diff review. Use `npx eslint <changed-files>` for focused lint checks.
- Reserve the full Vitest suite (`npm test`) for final verification, after implementation is complete and focused tests and relevant checks pass. Do not run it after every edit or intermediate implementation stage.
- `npm run build` and `npm run build:pro` include the full Vitest suite. Reserve these gated builds for final verification; use `npm run build:preview` or `npm run build:pro:preview` for intermediate build checks. Preview builds do not replace final verification.
- Avoid duplicate full-suite runs on unchanged code. A successful final gated build satisfies the full Vitest suite requirement.
- When delegating implementation, keep each task's validation focused and coordinate a single final full-suite run for the integrated changes.
- Run browser, visual, deployment, and release checks when relevant to the affected behavior or required by the delivery workflow. Passing Vitest alone does not establish that these checks passed.
- If final verification fails, fix the issue and rerun focused checks first, then repeat the affected final gate after substantive fixes.
- Documentation-only changes do not require the full suite unless they affect executable examples, configuration, or behavior.
- Report the checks run and their results, including any skipped or blocked verification. Never imply that unrun checks passed.

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
