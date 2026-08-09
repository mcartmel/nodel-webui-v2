# Operational Repository Stabilization Plan

## Goal

Make the repository operationally safe and low-noise: current supported tooling, reproducible installs, reviewable dependency automation, immutable vetted CI actions, protected release history, and required green checks before `main` changes.

## Current State

- `main` is clean and green at `c0c2786`; the latest push workflow passed.
- Dependency Graph is enabled and currently reports 436 packages. Dependabot alerts and security updates are enabled, with no open security alerts.
- Secret scanning and push protection are enabled.
- No branch protection or repository rulesets exist. All merge methods are enabled; merged branches are retained.
- Workflow tokens default to read-only and cannot approve PRs. Preserve this.
- `production-release` requires owner review and only accepts `v*` tags. Preserve this.
- The project declares Node `20.12.0`, now EOL, while the validated local environment is Node `24.15.0` and npm `11.12.1`.
- Dependabot PRs #1-#3 predate the latest fix and combine routine updates with incompatible migrations.
- PR #4 (`feat/v1-v2-navigation`) is explicitly excluded: do not inspect, approve, rerun, rebase, edit, close, or merge it in this work.

## Settled Decisions

- Standardize on exact Node `24.15.0` and npm `11.12.1` for development and CI.
- Protect `main` as PR-only with required checks, no force-push/delete, and an owner/admin emergency bypass. Do not require a second reviewer.
- Require linear history; allow squash and rebase merges only.
- Defer npm major migrations. Track and execute them separately rather than accepting grouped migration PRs.
- Replace PR #1 with a manually vetted action update that changes workflow pins and canonical trust evidence atomically.
- Keep automatic dependency submission disabled because the committed lockfile already populates Dependency Graph.
- Enable repository malware alerts. Leave private vulnerability reporting disabled.
- Dependabot PRs are automatically generated, refreshed, and validated, but never automatically approved or merged. A maintainer must explicitly merge after all gates pass.
- User-authored PRs targeting `main` must pass the same dependency review, quality, Java handoff, browser/deployment, freshness, conflict, and conversation-resolution gates. External-contributor workflows may still require the repository owner to approve execution before checks begin.
- No second-person approval is required by the ruleset; a clean, current, fully green PR may be merged by the maintainer. The admin bypass is reserved for emergency recovery.

## Operational Data Flow

1. `.nvmrc` and package metadata define the Node/npm contract.
2. CI reads the Node version from `.nvmrc`, installs the exact npm from package metadata, and runs `npm ci` against the committed lockfile.
3. `security/ci-actions.json` records approved action names, versions, and immutable SHAs; workflow tests require exact agreement.
4. Dependabot generates bounded minor/patch PRs. Dependency review, quality, Java handoff, and browser/deployment checks gate merge.
5. Repository rules prevent direct routine changes to `main` and protect release tags; the production environment remains the final tag-release approval boundary.

## Stage 1: Apply Repository Guardrails

Use repository settings or `gh api`, then read back every setting. Do not change PR #4.

1. Restrict Actions to GitHub-owned actions and reusable workflows only; current workflows use only `actions/*`.
2. Require every action reference to use a full commit SHA at the GitHub repository-policy level.
3. Preserve default workflow token permission `contents: read` and `can_approve_pull_request_reviews: false`.
4. Enable malware alerts. Preserve Dependency Graph, Dependabot alerts/security updates, secret scanning, and push protection.
5. Configure merge policy:
   - disable merge commits;
   - allow squash merge and rebase merge;
   - enable automatic deletion of merged branches;
   - enable the auto-merge capability, but configure no automatic merge rule.
6. Create an active `main` branch ruleset:
   - include `main` only;
   - require a pull request before merge with zero mandatory approvals;
   - require conversation resolution and branch freshness;
   - require linear history;
   - require GitHub Actions checks `dependency-review`, `quality`, `Java handoff (dev)`, `Java handoff (master)`, and `browser-deployment`;
   - block force-push and deletion;
   - allow repository administrators to bypass only for emergency recovery.
7. Create an active `v*` tag ruleset that blocks tag update and deletion, with the same admin emergency bypass. Do not require signed tags in this plan.
8. Verify the existing `production-release` environment still requires the owner reviewer and the `v*` tag deployment policy.

Acceptance:

- GitHub API/UI readback matches all settings above.
- Existing pinned workflows remain permitted.
- A normal contributor cannot directly update, force-push, or delete `main` or an existing `v*` tag.
- The admin bypass remains available but is not the normal merge path.
- Dependabot and user-authored PRs cannot merge while stale, conflicted, missing required checks, failing a required check, or carrying unresolved review conversations.
- For a mergeable non-draft PR, GitHub's native merge box must visibly report all required checks successful, the branch current and conflict-free, and conversations resolved; only then is the manual squash/rebase merge control enabled. No custom “ready to merge” bot or notification is required.

## Stage 2: Migrate the Build Toolchain to Node 24

Deliver this as an independently reviewable PR before dependency refreshes.

1. Set `.nvmrc` to `24.15.0`.
2. Update `package.json` and `package-lock.json`:
   - `engines.node`: `>=24.15 <25`;
   - `engines.npm`: `>=11.12 <12`;
   - `packageManager`: `npm@11.12.1`;
   - `devEngines` must fail on any Node/npm version other than the selected toolchain;
   - update `@types/node` to the latest compatible 24.x release only.
3. Add `.npmrc` with `engine-strict=true` so unsupported local installs fail early.
4. In `.github/workflows/build.yml` and `.github/workflows/release.yml`:
   - replace duplicated Node literals with `node-version-file` (`.nvmrc` or `webui/.nvmrc` for nested checkouts);
   - install exact npm `11.12.1` before every `npm ci` from a directory that does not trigger project `devEngines` prematurely;
   - print and verify Node/npm versions before installation;
   - keep cache paths and Java checkout behavior unchanged.
5. Update `README.md`, `docs/release-handoff.md`, and the Unreleased section of `RELEASE_NOTES.md` to declare Node 24.15/npm 11.12.
6. Preserve historical evidence unchanged in `docs/production-baseline.md` and `test/fixtures/production-refinement-stage0-size-baseline.json`; those correctly record the former Stage 0 declaration.
7. Extend `test/release-guidance.test.ts` or add a focused toolchain test to prove `.nvmrc`, package metadata, workflow setup, npm pinning, and current documentation cannot drift.

Validation:

- Run under exact Node `24.15.0` and npm `11.12.1`.
- Fresh `npm ci` succeeds and leaves package metadata/lockfile unchanged.
- Lint, typecheck, JsViews checks, full unit/coverage suite, dependency evidence, build/release gate, contract diff, bundle budgets, and browser/deployment smoke pass.
- Review built artifact and bundle-budget changes; do not ratchet budgets automatically.
- The PR exercises the newly enabled dependency-review job successfully.

## Stage 3: Replace and Vouch for GitHub Action Updates

Create a manual PR superseding PR #1. Never copy Dependabot SHAs without independently resolving their official release tags.

1. Add `security/ci-actions.json` as the canonical action trust manifest with schema version, action name, human version tag, and full approved SHA.
2. Replace the hardcoded map in `test/release-guidance.test.ts` with manifest-backed validation that:
   - rejects malformed, duplicate, missing, stale, or unused manifest entries;
   - requires every workflow `uses:` entry to be an approved `actions/*` action at the exact 40-character SHA;
   - requires the workflow `# v...` comment to match the manifest version;
   - rejects branch/tag references and non-GitHub-owned actions.
3. Resolve each official tag through GitHub or `git ls-remote`, record the evidence in the PR, and update both workflows plus the manifest atomically. Candidate updates from PR #1, subject to verification:
   - `actions/checkout` `v7.0.1` / `3d3c42e5aac5ba805825da76410c181273ba90b1`;
   - `actions/setup-node` `v7.0.0` / `820762786026740c76f36085b0efc47a31fe5020`;
   - `actions/upload-artifact` `v7.0.1` / `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a`;
   - `actions/download-artifact` `v8.0.1` / `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c`;
   - `actions/attest-build-provenance` `v4.1.1` / `0f67c3f4856b2e3261c31976d6725780e5e4c373`;
   - `actions/dependency-review-action` `v5.0.0` / `a1d282b36b6f3519aa1f3fc636f609c47dddb294`.
4. Preserve least-privilege job permissions, `persist-credentials: false`, artifact boundaries, release environment, and exact-dist handoff semantics.
5. Update release/architecture guidance only where it describes the action-pin approval mechanism.

Validation:

- Manifest/workflow focused tests pass.
- GitHub repository SHA-pinning policy accepts every workflow.
- Pull-request CI and a nonpublishable release rehearsal pass with the new action majors.
- Artifact upload/download, Java handoff, dependency review, provenance attestation configuration, and exact tested-dist flow remain intact.
- Close PR #1 only after this replacement PR is merged; link the replacement in the closing comment.

## Stage 4: Make Dependabot Low-Noise and Migration-Aware

Update `.github/dependabot.yml` and its tests in an independent PR.

1. Keep monthly npm and GitHub Actions schedules and bounded open-PR limits.
2. Mark npm groups as applying to version updates and include only minor/patch changes.
3. Keep production and development dependencies separate.
4. Exclude `jquery`, `jsviews`, and exact-pinned `@lezer/markdown` from broad groups so any update is independently reviewable.
5. Temporarily ignore these major lines until their migration issue is executed:
   - `jquery` and `@types/jquery` major updates;
   - Vite, Vitest, `@vitest/coverage-v8`, Tailwind CSS, ESLint, `@eslint/js`, TypeScript, jsdom, and `@types/node` major updates.
6. Keep GitHub Actions grouped because the trust manifest intentionally requires maintainer approval after every generated action update.
7. Ensure security updates remain immediate and independently reviewable rather than being hidden in monthly version groups.
8. Strengthen `test/release-guidance.test.ts` to assert group scope, update types, exclusions, ignores, cadence, and limits.
9. Create linked follow-up issues before adding ignores:
   - jQuery 4 and JsViews compatibility/dual-instance migration;
   - Vite 8 plus Vitest/coverage migration;
   - Tailwind CSS 4 migration;
   - ESLint 10 and future TypeScript compatibility migration;
   - jsdom major migration.

Validation:

- Dependabot accepts the YAML after merge.
- A forced npm update job creates no grouped major migration PR.
- Routine generated groups contain only minor/patch changes and exclude the named sensitive packages.
- Security updates remain enabled and no current alert is suppressed by an ignore rule.

## Stage 5: Retire Stale PRs and Regenerate Safe Updates

Perform remote PR mutations only after Stages 2-4 are merged.

1. Close PR #2 with a comment explaining that its routine updates and jQuery/JsViews migration were intentionally separated.
2. Close PR #3 with a comment citing the superseding Node 24 baseline, incompatible TypeScript peer range, and separated toolchain migrations.
3. Trigger fresh npm Dependabot update jobs from current `main` rather than rerunning stale checks.
4. Review fresh PR contents before merge:
   - no ignored major dependency appears;
   - no jQuery/JsViews or `@lezer/markdown` update is hidden in a broad group;
   - package-lock changes are deterministic;
   - dependency review reports no new high-severity issue;
   - license/SBOM evidence and bundle/contract reports remain valid.
5. Merge safe routine updates only through the protected PR path, using squash for routine bumps.
6. Leave migration-sensitive individual PRs open only when actively being reviewed; otherwise close them with a link to the relevant migration issue.
7. Do not modify PR #4.

## Final Operational Gate

1. Verify `main` is clean, synchronized, protected, and green after all merged operational PRs.
2. Run the complete repository gate on exact Node/npm versions: lint, typecheck, JsViews, coverage, build, contract diff, dependency audit/SBOM/licenses, bundle budgets, browser matrix, deployment smoke, inventory continuity, and nonpublishable release/archive verification.
3. Confirm GitHub API state:
   - Dependency Graph populated and no open Dependabot alerts;
   - malware alerts enabled;
   - automatic dependency submission and private vulnerability reporting remain disabled;
   - Actions restricted to GitHub-owned full-SHA references;
   - default workflow token remains read-only;
   - `main` and `v*` rulesets active with admin emergency bypass;
   - merge commits disabled, squash/rebase enabled, merged branches deleted;
   - production release environment unchanged.
4. Confirm PRs #1-#3 are closed with superseding references and fresh routine dependency PRs are based on current `main`.
5. Confirm PR #4 remains untouched.

## Failure and Rollback

- If Node 24 changes output or tooling behavior unexpectedly, do not weaken gates; revert the Node/toolchain PR as one unit and retain a follow-up issue with captured failures.
- If an action major fails, revert its workflow and trust-manifest entry together. Never retain a workflow/manifest mismatch.
- If repository rules block normal recovery, use the documented admin bypass, repair the rule, and record the bypass reason; never disable force-push/delete protection as a routine workaround.
- If regenerated dependency groups still contain migrations, close them and narrow Dependabot policy before merging anything.
- Do not resolve dependency failures by widening audit exceptions, license policy, coverage thresholds, contract baselines, or bundle budgets without a separate reviewed decision.
