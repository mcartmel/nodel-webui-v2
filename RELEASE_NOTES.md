# Release Notes

## Unreleased

### Toolchain

- Project tooling now requires Node.js `24.15.0` and npm `11.12.1`.

### Component Contract

- `v2/nodel-components.json` publishes the deterministic schema 1 component
  contract used by the catalogue and editor tooling, including audience,
  registration, completion, consumption, binding, event, and style metadata.
- `release.json` uses schema 5. Its `componentContract` entry pins the path,
  schema, and SHA-256 of `v2/nodel-components.json` alongside the existing
  tested-`dist` inventory and release evidence.

### Performance And Review Impact

- `STAGE5_APPROVED_BUNDLE_BASELINE_2026-08-08` approves the clean Stage 4
  production build as the Stage 5 uncompressed and independently gzipped-file baseline.
  Rationale: Stage 5 baseline is the clean Stage 4 production build; each maximum is a reviewed five percent headroom for maintenance without automatic ratcheting.
  Each budget has reviewed five percent headroom for maintenance; budgets never
  auto-ratchet and intentional changes require this policy, inventory tests, and
  release-note evidence to change together.
- Review output reports component-contract breaking/additive/informational/operational
  impact together with stable-entry, CSS, CodeMirror, catalogue, and `v2/`
  bundle impact.

### Compatibility And Public API

- **Breaking:** None. Supported markup and wire contracts are unchanged.
- **Additive:** Schema-1 public component-contract metadata and allowlisted lazy-load fallback are additive.
- **Informational/operational:** Removal of the unreleased, nonfunctional node-list `show-filter` and `show-total` declarations requires no migration.

### Editor Assistance And Recovery

- Native HTML/XML completion remains alongside Nodel completion, page/document scaffolds, curated styles, and static phase, target, class, and navigation hints. Diagnostics are bounded and advisory; the editor does not look up or validate action or signal point names.
- Lazy component failures preserve child content and offer an adjacent accessible Retry/Reload control plus a generation-deduplicated app toast.

### Quality And Supply Chain

- Strict TypeScript, lint, selected per-file coverage gates, and property tests remain required; dependency advisory policy, pinned actions, and Dependabot provide supply-chain review.
- Release evidence includes deterministic CycloneDX `SBOM.cdx.json`, `THIRD-PARTY-LICENSES.json`, schema-5 hash binding, and archive verification.

### Maintenance Boundaries

- Stage 6 behavior-preserving decompositions keep editor session/file/restart/upload, bindings controller/model/lookup, app navigation/restart/connectivity, and actsig model/controller concerns separate from their adapters, composition roots, DOM, timers, and events. Component-contract modules are the fifth hotspot boundary.

## 0.1.2

### Compatibility

- Requires Node.js `>=20.12` in the Node 20 release line for project tooling.
- Targets the tested Java Nodel API contract recorded by the release metadata.
- The legacy V1 loader and V1 page path remain available for pages that have
  not migrated.

### Migration

- V2 provides explicit `nodel-link`, page action, footer, Markdown,
  title/clock, control, editor, and responsive APIs described in
  `docs/web-components.md`.
- Existing V1 assets and pages are preserved by default in the future Java
  production merge. The V2 `index.htm` collision requires recorded approval.

### Security and Limitations

- `confirm-mode="code"` is client-side operator protection. It does not replace backend authentication or authorization.
- Exact visibility matching is case-sensitive.
- Nodel's unlocked, unconditional script writes remain outside this UI's
  atomicity guarantees; Java file symlink handling remains a trust boundary.
- Isolated deployment uses a verified staged, best-effort recoverable two-rename
  replacement. An interruption can leave a backup that must be recovered by an
  operator; it is not an atomic or crash-proof deployment transaction.
- Authored/custom V2 pages default to a blocking offline modal, while core
  administration pages retain a fixed offline overlay.

### Deployment Warning

This repository has no production installer. `deploy:preview` is local-only;
an isolated test deployment is destructive and must use a disposable host.
Do not treat a custom content target as production installation. Production
Java packaging, V1/V2 merging, cache handling, approvals, and rollback are a
future integration step.

### Handoff and Rollback

Use [the production handoff runbook](docs/release-handoff.md) for checksums,
provenance, Java `dev`/`master` evidence, V1/V2 smoke tests, and approvals.
Rollback by reinstalling the previous verified Java artifact and complete
`content.zip`, restarting or clearing the Java-managed web UI cache according
to the Java process, and verifying both V1 and V2. Do not delete individual
hashed V2 chunks.

### Release Evidence

- `release.json` uses schema 3. It records the release process environment and
  CI run URL, canonical tested-`dist` SHA-256 inventory digest, and normalized,
  hash-pinned Java `dev` and `master` reports in `java-handoff/`.
- Tagged releases checkpoint `dist/` before browser tests and recheck those exact
  deployment bytes after smoke testing and packaging.
- GitHub environment and release records remain the evidence for approval
  identities and timestamps; the manifest records only the environment name and
  CI run URL.
- Archive verification checks the exact ZIP root, path safety, duplicate paths,
  and the per-file SHA-256 inventory before checksum, attestation, or upload.
- Release and bundle budgets have no automatic ratchet; intentional changes require review evidence.
