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

The preview is written to `build/deploy-preview/`. Production deployment defaults to `/opt/nodel/custom/content/`:

```sh
npm run deploy
```

The production deploy command clears its target before copying the built site. Use `--target` through `scripts/deploy.mjs` when deploying elsewhere.

Built pages use stable `v2/nodel-webui.js` and `v2/nodel-webui.css` entry paths. The built `components.html` page is the user-facing catalogue of UI components and copyable authoring examples. See [the architecture guidance](docs/architecture.md) and [web component guidance](docs/web-components.md) for further implementation and authoring details.

## Releases

Pushing a `v`-prefixed version tag that matches `package.json`, such as `v0.2.0`, builds and tests the project before publishing a GitHub Release. Each release includes a versioned ZIP containing the deployable pages and complete `v2/` support directory, plus a SHA-256 checksum and build provenance attestation.

Consumers should pin a specific release version and verify its checksum before unpacking the archive. The archive contents can be used directly as Nodel web content; consumers do not need Node.js or the source project.

## License

Nodel Web UI v2 is licensed under the [Mozilla Public License 2.0](LICENSE).
