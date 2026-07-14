# QR Code Component Plan

## Goal

Add a public `nodel-qrcode` custom element that covers the useful v1 `qrcode` behavior with v2 naming, signal binding, accessibility, safe rendering, catalogue coverage, and documentation. This is additive; the v1 loader and v1 XML remain unchanged.

## Confirmed v1 Contract

The v1 implementation in `nodel-webui-js/src/templates.xsl`, `nodel.js`, and `qrcode.css` provides:

- Static content from `text` and live replacement from `event`.
- A numeric square `height`, defaulting to 128 px.
- Optional visible `help` text below the symbol.
- Fixed black modules on a white background with high error correction.
- An empty white square before any content is available.
- Complete symbol replacement when a matching signal/event changes.

The old global `davidshimjs-qrcodejs` renderer, payload-bearing DOM title, canvas fallback code, and exact 2 px padding are implementation details, not compatibility requirements.

## Product Decisions

- Add `nodel-qrcode`; do not overload `nodel-image`.
- Use idiomatic v2 attributes only: `value`, `signal`, and `signals`. Do not add `text` or `event` aliases; document migration instead.
- Preserve payload bytes exactly. Do not trim `value`; whitespace can be intentional QR content.
- Use fixed high (`H`) error correction and black-on-white output. Do not expose correction or colour customization.
- Use `size` in CSS pixels, default 128, clamped to 64–1024; invalid values fall back to 128. Keep the rendered symbol responsive when its container is narrower.
- Include a standards-compliant four-module white quiet zone inside the rendered SVG.
- Preserve v1 empty behavior with a same-size white placeholder.
- Never retain a stale QR after an encoding failure. Clear to the white placeholder, show `QR code unavailable`, set error state, and emit a payload-safe error event.
- Use the established MIT-licensed `qrcode` package and its synchronous `create()` matrix API. Add `@types/qrcode` for TypeScript. Build the SVG with DOM APIs rather than injecting the package's SVG string or depending on canvas.

## Public Contract

Example:

```html
<nodel-qrcode
  value="https://example.org/visit"
  signal="VisitorLink"
  size="160"
  label="Current visitor link"
  help="Scan to open the visitor guide">
</nodel-qrcode>
```

Supported attributes:

- `value`: exact string encoded into the QR symbol.
- `size`: requested square size in pixels; normalized as described above.
- `help`: optional visible caption below the symbol.
- `label`, `aria-label`, `aria-labelledby`: accessible naming, following existing media component precedence.
- `signal="SignalName[.path]"`: shorthand binding to `value`.
- `signals="SignalName[.path]:target"`: targets `value`, `help`, and `label`.
- Global `visibility` binding continues to work through the existing bootstrap.

Reflect observable state on the host:

- `data-state="empty"`: `value` is exactly empty; show only the white placeholder.
- `data-state="ready"`: a valid QR matrix is rendered.
- `data-state="error"`: non-empty content could not be encoded; show the placeholder and inline error text.
- `data-size`: normalized numeric size for diagnostics and styling.

Dispatch a non-cancelable bubbled `nodel-qrcode-error` event on an encoding failure. Detail is `{ message: "QR code unavailable", reason: "encoding-failed" }`; never include the encoded value or the encoder's payload-bearing error text. Do not emit a toast.

Migration example:

```html
<!-- v1 -->
<qrcode text="https://example.org" event="DynamicQRCode" height="128" help="Open link" />

<!-- v2 -->
<nodel-qrcode value="https://example.org" signal="DynamicQRCode" size="128" help="Open link"></nodel-qrcode>
```

## Rendering And Accessibility

- Create the component shell once with an SVG frame, optional help node, and hidden error status node.
- Encode non-empty values with `QRCode.create(value, { errorCorrectionLevel: 'H' })`.
- Convert the returned bit matrix into one SVG path of dark module rectangles plus a white background rectangle. Include four modules of quiet zone in the `viewBox`, use `shape-rendering="crispEdges"`, and keep the SVG square with `preserveAspectRatio`.
- Construct SVG elements/attributes with `createElementNS`; signal or attribute content must never become markup.
- Keep module/background colours literal black/white and apply `forced-color-adjust: none` so dark themes and forced colours cannot corrupt scan contrast.
- Put `role="img"` and the resolved accessible name on the SVG, not a wrapper that would hide the live error status from assistive technology.
- Accessible-name precedence: external `aria-labelledby`, explicit `aria-label`, `label`, then `QR code`. Give the help node a stable generated ID and reference it with `aria-describedby` when present.
- Render help with `textContent`. Render encoding error text in a separate `role="status"`, `aria-live="polite"` node. Do not expose the raw value through `title`, visible text, event details, or error text.
- Empty content is not an encoding error. Null/undefined signals format to the existing empty string and return the component to `empty`.
- Numeric, boolean, object, and array signal values continue to use the shared signal formatter; strings remain unchanged and structured values encode as their existing JSON string representation.

## Implementation Steps

1. Add `qrcode` to runtime dependencies and `@types/qrcode` to development dependencies in `package.json`/`package-lock.json`.
2. Add `src/components/nodel-qrcode.ts`:
   - Define observed attributes and 128/64/1024 sizing constants.
   - Create a stable shell and generated help ID.
   - Separate shell/accessibility updates from value encoding so size/help/label changes do not re-encode or repeat error events.
   - Render ready, empty, and error SVG states and reflect host datasets.
   - Subscribe through `createSignalBindingController`, defaulting `signal` to `value` and supporting `value`, `help`, and `label` targets.
   - Dispose signal subscriptions on disconnect and register `nodel-qrcode` once.
3. Import the component from `src/main.ts` with the other public media components.
4. Extend `src/styles.css`:
   - Add `nodel-qrcode` to custom-element transition, block display, `:not(:defined)`, width, group/status direct-child, and media/layout selector lists where applicable.
   - Add centred responsive shell/frame/SVG styles, matched-width help/error typography, and fixed black/white/forced-colour-safe QR paint.
   - Keep QR output square and prevent theme surface styles from changing its quiet zone.
5. Add `nodel-qrcode` metadata and a concise snippet to `src/editor/nodel-document-definition.ts`, including `value`, `size`, `help`, accessibility attributes, and signal targets.
6. Add a QR section to the Media page in `components.html` with a default-size static example and a labelled/helped signal-ready example using a non-sensitive fallback value. Keep live markup and displayed source exactly matched.
7. Update canonical documentation:
   - Add `nodel-qrcode` to `docs/web-components.md` current elements and Media documentation; describe states, fixed scan-safe rendering, size bounds, event, signal targets, and v1 migration.
   - Add the QR encoder/SVG rendering boundary to `docs/architecture.md`, noting that encoded content is converted to a matrix and never injected as markup.
8. Update catalogue/editor coverage in `test/nodel-document-definition.test.ts` so every public main import remains documented and represented in `components.html`.

## Tests

Add `test/nodel-qrcode.test.ts` using the existing hoisted node-activity source mock:

- Static ASCII and Unicode values produce `data-state="ready"`, a square SVG with four-module quiet zone, white background, and non-empty dark-module path.
- Leading/trailing whitespace is encoded rather than trimmed.
- Missing/empty values produce `data-state="empty"`, preserve the requested size, contain no dark modules, and emit no error.
- Default, valid explicit, invalid, minimum-clamped, and maximum-clamped sizes reflect correctly.
- `signal` updates replace the path; `signals` can update `value`, `help`, and `label`; an empty signal clears the symbol.
- Help and labels are inserted as text, linked through accessible attributes, and cannot inject HTML.
- Accessible-name precedence works for `aria-labelledby`, `aria-label`, `label`, and the default.
- An over-capacity value clears dark modules, shows the inline error, sets `data-state="error"`, and emits one payload-safe `nodel-qrcode-error` without the raw value.
- A later valid value recovers from error to ready and hides the error.
- Disconnecting disposes the signal subscription.

Browser coverage:

- Add a focused `qr-codes.png` catalogue baseline in `e2e/catalogue.visual.spec.ts` for light/dark desktop and existing mobile projects.
- Include the QR catalogue example in the Axe representative views in `e2e/catalogue.accessibility.spec.ts`.
- In the forced-colours project, assert the QR background remains white and modules remain black.
- Verify the example has no overflow at mobile width and the SVG remains square/responsive.

## Validation

Run:

1. `npm run typecheck`
2. `npm run check:jsviews`
3. `npm test`
4. `npm run build:preview`
5. `npx playwright test e2e/catalogue.visual.spec.ts --update-snapshots`
6. `npx playwright test e2e/catalogue.visual.spec.ts e2e/catalogue.accessibility.spec.ts`
7. `npm run test:browser`
8. `git diff --check`

Inspect the production bundle output to confirm the browser build does not include Node-only PNG/CLI code from `qrcode`; if it does, replace the top-level import with the package's browser/core entry through a typed local wrapper rather than accepting avoidable bundle growth.

## Out Of Scope

- V1 XML/XSL or legacy-loader changes.
- Actions, click-to-open behavior, downloading/copying, camera scanning, logos, styled modules, transparent/custom colours, correction-level controls, binary segment APIs, or author-selected QR versions/masks.
- Retaining stale QR output after an invalid update.
- Treating missing activity transport or a signal that has not emitted as an error; the component remains in its static or empty state, matching other simple signal-bound media components.
