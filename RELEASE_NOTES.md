# Release Notes

## Unreleased

### Component Contract

- `v2/nodel-components.json` publishes the deterministic schema 1 component
  contract used by the catalogue and editor tooling, including audience,
  registration, completion, consumption, binding, event, and style metadata.
- `release.json` uses schema 5. Its `componentContract` entry pins the path,
  schema, and SHA-256 of `v2/nodel-components.json` alongside the existing
  tested-`dist` inventory and release evidence.

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
