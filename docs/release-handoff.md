# Production Release Handoff

This is the canonical operator runbook for handing a validated Nodel Web UI v2
release to the Java Nodel build and release process.

## Terminology and Boundary

- **Deploy preview** writes a validated build to a project-local directory for
  smoke testing. It does not touch a Nodel host.
- **Isolated destructive test deployment** replaces the content of a disposable
  test host target after checking the sibling Java checkout. It is useful for
  testing the V1/V2 merge shape, but it is not production installation.
- **Release preparation** creates the pinned release directory and its
  metadata from an already validated build. It never builds.
- **Future Java production integration** is the consuming Java repository's
  responsibility. It must verify, merge, package, install, and roll back the
  handoff artifact.

There is no production installer in this repository. In particular, no command
here installs production Java host files or mutates a production Nodel service.

## Prerequisites

- Node.js `24.15.0` and npm `11.12.1`, with the repository's pinned lockfile
  installed using `npm ci`.
- A clean, pinned web UI commit or release tag. Record repository, branch/tag,
  full commit, package version, and working-tree status.
- An explicit sibling Java checkout, normally `../nodel`. Do not infer it from
  the web UI checkout or use an unspecified current directory.
- The Java `dev` branch is the prerelease target; `master` is the stable target.
- Generated `build/**` and `.gradle/**` changes are the documented cleanliness
  exception. Other Java checkout changes must be reviewed and recorded.
- Record JDK, Gradle, Node, npm, Java Nodel, and CI/tool versions. Record the
  approval identities, timestamps, and associated CI or release URLs before any
  production integration.

## Local Nonpublishable Rehearsal

Run this complete, nonpublishable rehearsal from the web UI repository. The two
Java reports must come from separate checkouts on their respective branches;
do not reuse a mutable checkout for both targets.

```sh
npm ci
npm run verify:dependencies
npm run build
npm run verify:java-handoff -- --java-checkout ../nodel-dev --expected-branch dev --output build/java-handoff/dev.json
npm run verify:java-handoff -- --java-checkout ../nodel-master --expected-branch master --output build/java-handoff/master.json
npm run verify:dist -- --write
npm run test:browser:dist
npm run deploy:preview
node scripts/deploy.mjs --java-checkout ../nodel-dev --expected-java-branch dev --target build/stage11-host/custom/content
npm run test:deployment:smoke
npm run verify:dist -- --check
npm run release:prepare -- --dist-inventory build/dist-inventory.json --java-dev-report build/java-handoff/dev.json --java-master-report build/java-handoff/master.json
npm run verify:dist -- --check
```

The resulting release is intentionally nonpublishable because local rehearsal
does not assert a GitHub Actions run or protected approval environment. Tagged
CI runs the same evidence flow and additionally records the CI run URL and
`production-release` environment provenance required for publishing.

## Commands and Interfaces

`deploy:test` is the canonical disposable deployment alias. It is
self-contained and pins `../nodel`, `dev`, and
`build/stage11-host/custom/content`; do not append duplicate fixed arguments.
For a different Java checkout or the stable target, verify first and use the
direct interface explicitly:

```sh
node scripts/verify-java-handoff.mjs --java-checkout /work/nodel --expected-branch master --output build/java-handoff/master.json
node scripts/deploy.mjs --java-checkout /work/nodel --expected-java-branch master --target build/stage11-host/custom/content
```

The catalog aliases are also self-contained: they deploy the support root first
and then copy `components.html` into the catalog target. `npm run release:prepare`
only prepares the current `dist/`; run `npm run build` first, or use
`npm run release:build` for a local all-in-one rehearsal. The checkpoint command
writes deterministic canonical JSON below `build/`; `--check` rejects any stale,
extra, missing, symlinked, mutated, or non-canonical deployment byte. Tagged
release preparation requires `--dist-inventory`; local non-publishable rehearsals
may omit it and record a null digest.

The CLI rejects unknown, positional, duplicate, and missing-value arguments.
Deployment targets must be project-build-only targets. The deployer writes a
managed marker, supports `--dry-run`, and refuses a non-empty unmanaged target
unless the operator explicitly supplies the first-use override
`--allow-unmanaged-target`. It stages and verifies the complete inventory, then
performs a verified staged, best-effort recoverable two-rename replacement. It
is not atomic or crash-proof: after interruption, inspect and recover the
retained backup before retrying. A Java checkout selects isolated test mode and
never production installation.

The final stage check closes documented hook and validation ordering windows,
but it does not claim protection from a malicious same-user process that mutates
paths between final filesystem syscall boundaries.

## Manifests and Future Java Flow

`deployment-manifest.json` is the policy and integration mapping. It defines
the stable entry pages, `v2/**` support tree, V1 protected ownership and
collision policy, generated-path cleanliness exception, and the Java branch
mapping (`dev` prerelease, `master` stable).

`release.json` schema 5 (superseding schema 4) is the exact release identity and artifact inventory.
It includes `releaseProcess` (CI run URL, environment name, and the canonical
`dist` inventory SHA-256 digest) and normalized, hash-pinned Java handoff
evidence. Its `componentContract` entry pins `v2/nodel-components.json`, public
contract schema 1, and the exact SHA-256 of the packaged bytes. The standalone bundle verifier validates that contract's package version and recomputes the packaged deployment
subset digest and requires it to match the recorded tested-dist digest. The future Java flow must verify the ZIP,
its SHA-256 checksum, provenance/attestation, and `release.json`, including the
source commit and version. It must compare the package against
`deployment-manifest.json`, merge the V2 additions, and preserve all V1 files
by default. The `index.htm` collision is the exception: changing its default
`preserve-v1` decision requires recorded approval.

Before release preparation, run the canonical `npm run verify:dependencies`
command. It performs the audit, SBOM, and license generation and verification,
writing source-generated evidence below `build/dependency-evidence/`; release
preparation fails if either artifact is missing, stale, substituted, or not
bound to the exact lockfile, license policy, and notices. The release root
contains `SBOM.cdx.json` and `THIRD-PARTY-LICENSES.json`, and `release.json`
records their exact descriptors and hashes. Archive verification validates the
same evidence and bindings.

The future Java flow must preserve all V1 files by default.

Approval identities and timestamps remain evidence in the GitHub environment
and release records. The manifest deliberately records the approval environment
name and CI run URL, not an identity assertion.

This Java integration is future work; this repository does not claim automatic
Java packaging or installation.

## Handoff Package Layout

The production handoff package has this ZIP-root layout:

```text
components.html
index.htm
nodel.html
nodes.html
toolkit.html
v2/                         # complete V2 tree, including nodel-components.json and hashed chunks/assets
release.json                # exact identity and hashed artifact inventory
deployment-manifest.json    # policy/integration mapping
SBOM.cdx.json               # deterministic production CycloneDX evidence
THIRD-PARTY-LICENSES.json   # deterministic production license evidence
PRODUCTION_HANDOFF.md       # operator handoff copy of this runbook
RELEASE_NOTES.md
LICENSE
THIRD-PARTY-NOTICES.md
java-handoff/dev.json           # normalized, hash-pinned Java dev evidence
java-handoff/master.json        # normalized, hash-pinned Java master evidence
```

The five entry pages are the complete stable page set. The complete `v2/`
tree is required; copying only `v2/nodel-webui.js` or the stylesheet omits
the machine-readable component contract, hashed runtime chunks, and assets. The ZIP root is the content root, not an
additional enclosing project directory. The Java reports include the exact V1
hashed file inventory and inventory hash used for collision review.

Archive creation fixes file ordering and source timestamps, and archive
verification pins root layout, safe paths, and content hashes. It does not claim
bit-for-bit reproducible ZIP bytes across ZIP implementations or environments.

## V1 and V2 Content Rules

The V1 source tree and its assets remain owned by the Java distribution. V1
pages, stylesheets, scripts, images, fonts, configuration, and other existing
content must remain unless the Java release process explicitly approves a
collision. The V2 package adds the five entry pages and the complete `v2/`
tree. It does not authorize deleting or replacing unrelated V1 files.

The explicit V2 routes are `index.htm`, `nodes.html`, `nodel.html`,
`toolkit.html`, and `components.html`, with support under `v2/`. The V1
`index.htm` remains preserved by default during a production Java merge despite
being present in the V2 bundle. The index collision must be checked and its
replacement approved explicitly; do not silently overwrite it.

Before merge, check for every V1 path that would be overwritten, duplicate
paths with case-sensitive comparison, missing V1 assets, and unexpected files
outside the declared V2 inventory. A collision report is release evidence.

## Isolated Test Deployment

1. Create an isolated, disposable host working directory and use a target such
   as `build/stage11-host/custom/content`.
2. Run the Java handoff check against the intended branch, then run the test
   deployment. Review the dry-run report and collision list before the real
   replacement.
3. Validate the target: all five entry pages, the complete `v2/` tree, the
   managed marker, V1 preservation policy, and browser/API smoke tests. The
   deployment smoke covers static layout, stable assets, catalogue memory
   runtime, and recoverable offline shells; it does not test Java packaging,
   a live Java API, or production rollback.
4. Stop the isolated host and discard its working directory after validation.
5. If any target is not disposable, snapshot it first and obtain explicit
   operator approval. Never use `/opt/shared` custom content for this test.

Managed targets may be replaced by the deployer after inventory verification.
An existing non-empty unmanaged target requires the explicit first-use
override. This safeguard does not make a target production-safe.

## Production Release Checklist

- Confirm tag/version, full commit, branch, repository, clean working tree, and
  the generated `build/**`/`.gradle/**` exception if applicable.
- Verify the ZIP contents, per-file hashes in the artifact inventory, exact
  root/path safety, duplicate-path rejection, ZIP SHA-256, provenance
  attestation, and `release.json` identity.
- Record JDK/Gradle/Node/npm/tool versions and approval identities, timestamps,
  and CI or release URLs.
- Produce evidence for both Java targets: `dev` prerelease and `master` stable.
- Run V1 smoke tests and V2 smoke tests, including all five routes, the full
  support tree, representative legacy assets, and the V1 index decision.
- Rehearse rollback and record the previous verified package checksum before
  any production Java integration.
- Have the Java release owner verify the manifest comparison, V1-preserving
  merge, cache behavior, and deployment security settings.

## Production Rollback

To roll back, reinstall the previous verified Java artifact and its verified `content.zip`, then
clear or restart the Java-managed web UI cache according to the Java process.
Verify representative V1 pages/assets and all V2 routes after restart.
Do not manually delete random `v2` chunks: hashed files are an inventory unit
and partial deletion can break the stable loader. Roll back the complete
verified artifact instead.

## Known Limitations

- Java file symlink handling remains a trust boundary for the consuming Java
  integration and must be validated there.
- Nodel's unlocked, unconditional script writes are not made atomic by this
  web UI release or by this handoff.
- The `index.htm` replacement decision remains approval-required.
- Future Java production integration is required for packaging, V1/V2 merge,
  installation, cache policy, headers, rollback, and production approvals.
