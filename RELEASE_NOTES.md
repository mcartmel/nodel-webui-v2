# Release Notes

## Unreleased

### Material Design Icons

- Added `mdi:` names to `nodel-icon`, including buttons, control grids, and
  signal-driven icon changes. MDI uses the existing sizing, tone, theme,
  accessibility, and loading/fallback behaviour. Font Awesome names and Nodel
  aliases remain unchanged; `mdi:` takes precedence over retained `family` and
  `style` attributes, allowing name-only signals to switch libraries.
- Both public Free and isolated Pro-local builds include the 7,205 non-brand
  icons from pinned `@mdi/svg@7.4.47`. The 242 upstream Brand / Logo entries
  are excluded. Upstream aliases and category terms support editor search;
  completion inserts canonical `mdi:` names rather than runtime aliases.
- Icon artifacts move to schema 2 with explicit library ownership. Deploy or
  roll back the complete matching `v2/` asset set; mixing old artifacts with
  the new runtime is unsupported. MDI definitions remain local, hashed,
  lazily loaded, and cached, with no CDN or icon font dependency.
- Added editor completion/diagnostics, copyable catalogue examples, and
  no-build page checks for library switching and light/dark presentation.

### Performance Budget Evidence

- `APPROVED_CURRENT_DIST_INVENTORY_XML_RAW_2026-11-20`: Current dist
  verification measured total offline `v2/` inventory at `11864128` raw /
  `2892457` gzip bytes and CodeMirror XML at `151912` raw / `42775` gzip bytes.
  Only inventory raw/gzip and XML raw baselines change: inventory maxima are
  `12110000` / `2950000` (approximately two-percent rounded headroom), while
  XML raw max is `152000` for minimal headroom. XML gzip and ordinary initial
  page budgets remain unchanged.
- Rationale: Current dist verification measured dist-v2-inventory at 11864128 raw / 2892457 gzip bytes and CodeMirror XML at 151912 raw / 42775 gzip bytes. Only the offline inventory raw/gzip and XML raw baselines change, using approximately 2% rounded inventory headroom and minimal XML raw headroom; XML gzip and ordinary initial-page budgets remain unchanged.
- `APPROVED_CATALOGUE_COPY_CSS_2026-11-17`: After removing the unused icon
  descendant rule and consolidating the copy-overlay state selectors, the local
  preview measured `187828` raw / `24046` gzip bytes, down
  from CI's pre-optimization `188020` / `24068` and above the previous maxima
  `187730` / `23903`. These measured values are the only changed baselines;
  established five-percent raw / two-percent gzip headroom yields maxima
  `197220` / `24527`. Restoring the reduced-motion rule's original specificity
  keeps its no-transition override effective. Every other metric and budget
  remains unchanged. The separate parser-dependency approval below remains in
  force.
- Rationale: Local preview after restoring reduced-motion selector specificity measured stable-css at 187828 raw / 24046 gzip bytes, down from CI's pre-optimization 188020 / 24068 and above prior maxima 187730 / 23903. These measured values become the only updated baselines: existing 5% raw / 2% gzip headroom sets maxima 197220 / 24527. All other metrics and budgets remain unchanged; the separate parser-dependency approval remains intact.
- `APPROVED_PARSER_DEPENDENCIES_2026-11-17`: CI run `43994373770` measured
  Java at `74801` raw / `28280` gzip bytes and XML at `151378` raw / `42638`
  gzip bytes. Upstream `@lezer/java` `1.1.3` -> `1.1.5` contributes `7021`
  raw / `2598` gzip bytes to Java; `@lezer/lr` `1.4.10` -> `1.4.12`
  contributes approximately `445` raw / `120` gzip bytes to XML. These grammar
  and reuse fixes are retained rather than pinned or rolled back. Only Java
  raw/gzip and XML gzip baselines are updated with five percent headroom; all
  other baselines and limits remain unchanged.
- Rationale: CI run 43994373770 measured Java at 74801 raw / 28280 gzip bytes and XML at 151378 raw / 42638 gzip bytes. Upstream @lezer/java 1.1.3->1.1.5 contributes 7021 raw / 2598 gzip bytes to Java, and @lezer/lr 1.4.10->1.4.12 contributes approximately 445 raw / 120 gzip bytes to XML; these grammar and reuse fixes are retained rather than pinned or rolled back. Only Java raw/gzip and XML gzip baselines are updated with five percent headroom; all other baselines and limits remain unchanged.
- This parser-dependency approval supersedes the earlier editor-freeze budget
  approval only for the three limits above. The separate MDI-specific approval
  remains applicable to its icon and inventory budgets.
- `APPROVED_MDI_OFFLINE_ASSETS_2026-11-16`: the approved full non-brand MDI
  catalogue increases only the offline icon-artifact and total `v2/` budgets.
  Measured with Node `24.15.0`, npm `11.12.1`, and `build:preview` plus
  `report:bundle-budget`: icons are `8615311` raw / `1950455` gzip bytes
  (maxima `9046077` / `2047978`); total `v2/` is `11348518` raw / `2738723`
  gzip bytes (maxima `11580000` / `2795000`). The pre-feature HEAD `1c5def8`
  measured icons `2758285` / `666125` and total `v2/` `5484534` / `1451828`.
  Lazy-loading the icon loader preserves all existing initial and editor
  limits: initial closure is `393671` / `105913`, versus pre-feature
  `403737` / `109768`. CSS is unchanged at `186935` / `23895`.
  The preview contains 90 icon shards (64 MDI), with the largest reported at
  approximately 95.75 kB raw, below the unchanged 128 KiB shard ceiling. The
  index is approximately 7.52 kB and the searchable catalogue 3.18 MB raw;
  rendering a glyph does not fetch that searchable catalogue.
- Rationale: Measured MDI non-brand assets update only free-icon-artifact to 8615311 raw / 1950455 gzip bytes with five percent headroom, and dist-v2-inventory to 11348518 raw / 2738723 gzip bytes with two percent rounded headroom. All initial JavaScript, CSS, editor, and other metric baselines and limits remain unchanged.
- `APPROVED_BINDINGS_UI_CSS_2026-09-28`: the user approved preserving the refined bindings layout. Only the `stable-css` gzip budget changes, from baseline `22244` / max `23357` to reviewed baseline `23434` / max `23903`; all raw limits and other metric limits are unchanged. The final no-help build measured `23344` gzip bytes, within the approved allowance.
- Rationale: Reviewed bindings UI refinements set only stable-css gzip baseline to 23434 bytes and maximum to 23903 bytes, with two percent headroom. The stable-css raw baseline and maximum, and all other metrics and budgets, remain unchanged.
- `APPROVED_CATALOGUE_STRUCTURE_2026-09-18`: Catalogue reorganization covers 39 pages, 59 paired examples, and 67 copy blocks; only `components-html` is rebaselined to reviewed actual raw `175483` / max `184258` and gzip `20145` / max `21153`, with five percent headroom. All other metrics and budgets remain unchanged.
- Rationale: Catalogue reorganization covers 39 pages, 59 paired examples, and 67 copy blocks; only components-html is rebaselined to reviewed actual raw 175483 / gzip 20145 with five percent headroom. All other metrics and budgets remain unchanged.
- Catalogue reorganization is an HTML-only structural change; no other performance budget role is ratcheted.
- `APPROVED_BACKGROUND_ASSETS_2026-09-16`: measured increase from preserving four detailed background SVG assets is approved only for `dist-v2-inventory`, rebased to raw `5448589` / max `5560000` and gzip `1442562` / max `1475000`. The reviewed budget is approximately two percent headroom with rounding; all other metric baselines and limits remain unchanged, and no production JavaScript or CSS roles are ratcheted.
- Rationale: Measured increase from preserving four detailed background SVG assets is approved only for dist-v2-inventory: baseline 5448589 raw / 1442562 gzip bytes, with reviewed two percent rounded budgets of 5560000 raw / 1475000 gzip bytes. All other metric baselines and limits remain unchanged; no production JavaScript or CSS roles are ratcheted.

## 0.2.0

### Toolchain

- Project tooling now requires Node.js `24.15.0` and npm `11.12.1`.

### Edge Readout And Display Pages

- Added the opt-in `nodel-readout` edge-ring layout with named notch positions and percentage depth. Existing compact rings and ordinary pages are unchanged, so the addition is migration-free.
- Added the opt-in `nodel-page bleed` leaf-page containment override for edge-to-edge display compositions. It is migration-free and does not change viewport allocation or fill defaults; use it with `min-height="viewport"` and a direct `nodel-control-grid fill` when required.

### Keyboard Shortcuts

- **Additive:** Added the nonvisual, app-global `nodel-shortcut` component. Direct children of `nodel-app` can bind exact keyboard chords to ordered current-node `trigger` actions, with existing typed arguments, confirmation, visibility, disabled, singleflight, and error semantics. The addition is migration-free; existing pages and `nodel-button`, including native `hidden`, are unchanged.

### Performance Budget Evidence

- `STAGE8_APPROVED_SHORTCUT_EAGER_CATALOGUE_BASELINE_2026-08-28`: shortcut eager-catalogue measurements set `codemirror-language-html` to raw `271633`/max `285215`, gzip `92689`/max `97324`, and `codemirror-language-xml` to raw `144439`/max `151661`, gzip `40512`/max `42538`; each maximum is `ceil(measured actual * 1.05)`. Other roles were not ratcheted.
- Rationale: Shortcut eager-catalogue measurements raised only HTML/XML language baselines; each affected maximum is measured actual plus reviewed five percent headroom, with no automatic ratcheting elsewhere.

### Icon Catalogue And Local Builds

- The public `components.html` catalogue now demonstrates canonical Free `tv`,
  Classic Regular, Brands, manifest defaults, and the preserved Nodel `power`
  alias. It contains no Pro-only markup.
- `nodel-icon` family/style availability and defaults are read from the
  installed `v2/nodel-icons.json`; the runtime resolves its declared catalogue
  and shards relative to the stable `v2/nodel-webui.js` entry, including for
  authored pages created after the build or served below a node path. Missing or
  unavailable records retain the image fallback and expose loading/ready/
  fallback state.
- The icon index, searchable catalogue, and every declared shard are part of
  the complete `v2/` installation unit. Copying only the stable JavaScript and
  CSS entries is unsupported because hashed runtime and icon assets may be
  referenced.
- Public releases remain Free-only. The complete Free icon artifacts add the
  reviewed `free-icon-artifact` budget metric and intentional offline payload
  cost; Pro-local output is measured separately and is not part of that public
  maximum.
- `build:pro:preview`, `build:pro`, and `deploy:local:pro` isolate licensed
  output in ignored `build/pro-dist/`. Directory and exact-version token source
  modes require the supported Font Awesome major; Pro output cannot replace
  `dist/`, public release evidence, or public dependency manifests. License
  holders are responsible for licensed local output and deployment.

### Dependency Operations

- Dependabot uses monthly minor/patch version groups; sensitive updates remain individual, major migrations are tracked in issues #7-#11, and security updates remain unrestricted and immediate.

### Component Contract

- `v2/nodel-components.json` publishes the deterministic schema 1 component
  contract used by the catalogue and editor tooling, including audience,
  registration, completion, consumption, binding, event, and style metadata.
- `release.json` uses schema 6. Its `componentContract` entry pins the path,
  schema, and SHA-256 of `v2/nodel-components.json`, while its Free `iconCatalogue`
  entry binds `v2/nodel-icons.json` with its schema and SHA-256 alongside the
  existing tested-`dist` inventory and release evidence.

### Performance And Review Impact

- `STAGE7_APPROVED_EDGE_READOUT_DISPLAY_PAGE_BASELINE_2026-08-28` records the reviewed edge-readout/display-page baseline. Edge-readout/display-page baselines reflect deterministic CSS and public catalogue growth; each maximum retains reviewed five percent headroom without automatic ratcheting.

- `STAGE6_APPROVED_FREE_ICON_BASELINE_2026-08-20` records the measured Free icon artifact raw/gzip, total `v2/` inventory, stable-entry closure, and expanded `components.html` catalogue baselines. Stage 6 baselines are measured from the deterministic public build; each maximum retains reviewed five percent headroom without automatic ratcheting. The increase is intentional: the complete offline Free catalogue, official searchable metadata, and public examples are shipped while Pro-local output remains isolated and separately reported.

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

- **Breaking:** Toolbar host identity is now opt-in for custom pages. Existing custom pages must add the presence attribute `show-host-icon` to retain host identity; shipped core pages already opt in.
- **Additive:** The `show-host-icon` attribute, schema-1 public component-contract metadata, and allowlisted lazy-load fallback are additive.
- **Informational/operational:** Removal of the unreleased, nonfunctional node-list `show-filter` and `show-total` declarations requires no migration.

### Editor Assistance And Recovery

- Native HTML/XML completion remains alongside Nodel completion, page/document scaffolds, curated styles, and static phase, target, class, and navigation hints. Diagnostics are bounded and advisory; the editor does not look up or validate action or signal point names.
- Lazy component failures preserve child content and offer an adjacent accessible Retry/Reload control plus a generation-deduplicated app toast.

### Quality And Supply Chain

- Strict TypeScript, lint, selected per-file coverage gates, and property tests remain required; dependency advisory policy, pinned actions, and Dependabot provide supply-chain review. Repository policy permits only GitHub-owned actions at full commit SHAs, while `security/ci-actions.json` records the independently verified release tags and approved SHAs that must change atomically with workflows.
- Release evidence includes deterministic CycloneDX `SBOM.cdx.json`, `THIRD-PARTY-LICENSES.json`, schema-6 hash binding, and archive verification. Public evidence is generated from the Free root lockfile only; license holders are responsible for licensed Pro-local output, while pre-built public artifacts remain Free-only.
- schema 5 release evidence is retained only as historical migration context; its schema-5 hash binding is superseded by schema 6, which public release preparation now requires with the inventoried Free icon catalogue.

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
