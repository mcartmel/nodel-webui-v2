# Nodel Web UI v2

Nodel Web UI v2 is the next-generation browser interface for [Nodel](https://github.com/museumsvictoria/nodel). It replaces the legacy `nodel-webui-js` interface with a TypeScript, Vite, Tailwind CSS, JsViews, and custom-elements implementation.

The project is under active development. It remains Nodel-specific: host pages call Nodel REST endpoints, and node pages expect to be served beneath `/nodes/<node>/`.

## Requirements

- Node.js 20.12 or later in the Node 20 release line
- npm
- A Nodel host for testing host and node API behavior

## Development

```sh
npm ci
npm run dev
```

The Vite development server exposes the source page entries. Features that call Nodel APIs require a compatible host and routing context.

## Validation

```sh
npm run typecheck
npm run check:jsviews
npm test
npm run build
```

`npm run build` runs all validation steps before writing the production site to `dist/`.

## Deployment

Create a local deployment preview without changing a running Nodel host:

```sh
npm run deploy:preview
```

The preview is written to `build/deploy-preview/`. `npm run deploy:preview` is
a local convenience command and builds first. CI builds once, then invokes the
deploy script directly and runs `npm run test:deployment:smoke` against both
that preview and the managed test layout without rebuilding.
There is no production deployment command in this repository. Use the isolated
test deployment tooling only with a disposable host, then hand the validated
release bundle to the Java Nodel release process. See
[the production handoff runbook](docs/release-handoff.md).

Built pages use stable `v2/nodel-webui.js` and `v2/nodel-webui.css` entry paths, with the machine-readable authoring contract at `v2/nodel-components.json`. The built `components.html` page is the user-facing catalogue of UI components and copyable authoring examples. See [the architecture guidance](docs/architecture.md) and [web component guidance](docs/web-components.md) for further implementation and authoring details.

## Releases

Pushing a `v`-prefixed version tag that matches `package.json`, such as
`v0.2.0`, builds once, records `build/dist-inventory.json`, browser-tests that
exact `dist/`, deploys and smoke-tests the unchanged files, rechecks the
checkpoint before and after packaging, then publishes a GitHub Release. Each release includes a
versioned ZIP containing the deployable pages, complete `v2/` support directory,
schema 4 `release.json`, normalized Java `dev` and `master` handoff reports, a
SHA-256 checksum, and build provenance attestation.

Consumers should pin a specific release version and verify its checksum and
provenance before unpacking the archive. Production installation, V1/V2
merging, and rollback belong to the Java Nodel integration process. Follow
[the production handoff runbook](docs/release-handoff.md); this repository does
not automatically install Java production content.

For a local release rehearsal, build before preparing the bundle:

```sh
npm run build
npm run verify:dist -- --write
npm run release:prepare -- --dist-inventory build/dist-inventory.json
```

`npm run release:build` remains a build-and-package convenience command for a
non-publishable rehearsal; a checkpoint is optional locally. `release:prepare`
intentionally does not build, so CI can package the exact already-tested
`dist/` directory. Tagged/publishable preparation requires the checkpoint.

## License

Nodel Web UI v2 is licensed under the [Mozilla Public License 2.0](LICENSE).
