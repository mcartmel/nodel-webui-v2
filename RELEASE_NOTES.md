# Release Notes

## V1 Parity Refinements

- Authored/custom V2 pages now default to a blocking offline modal. Core administration pages explicitly retain a fixed, non-layout-shifting offline overlay.
- Exact visibility matching through `visible-value` and semicolon-separated `visible-values` is case-sensitive.
- `confirm-mode="code"` is client-side operator protection. It does not replace backend authentication or authorization.
- Static, discovered-node, and event-binding links use the explicit `nodel-link` component.
- Node duplication is binary-safe, filters backup/generated files, makes configuration copying opt-in, reports partial results, and writes `script.py` last.
- Page activation actions, footers, signal Markdown, title/clock bindings, retained control parity, responsive order, editor drops, and retained syntax modes use additive V2 APIs.
- The legacy V1 loader and V1 page path remain available for pages that have not migrated.

See `docs/web-components.md` in the source repository for the full V1-to-V2 mapping and intentional differences.
