# Production Baseline

## Purpose

This document records the Stage 0 baseline before production-readiness refactors. It is evidence for later comparisons, not a requirement to preserve inefficient loading or polling behavior.

## Provenance

- Captured: 2026-08-01
- Web UI revision: `3c5e0b30f3d0157a66221a37d6c8586c326df513` plus the Stage 0 contract-only changes
- Java Nodel revision: `19756071383d696682688ab436c77c0a1f80c783`
- Build command: `npm run build:preview`
- Vite: `6.4.2`
- Capturing environment: Node `v24.15.0`, npm `11.12.1`
- Declared project runtime remains `.nvmrc` Node `20.12.0`; the environment difference is recorded for reproducibility and is not an expansion of supported versions.

The Java response and request fixtures are in `test/fixtures/java-nodel-api.json`. The no-build page used for browser contract coverage is `e2e/fixtures/no-build-authored-page.html` and is not included as a Vite HTML input.

## Build Size

Vite's production size report for the principal assets is:

| Asset | Minified | Gzip |
| --- | ---: | ---: |
| `v2/nodel-webui.js` | 544.78 kB | 146.68 kB |
| `v2/nodel-webui.css` | 162.97 kB | 20.41 kB |
| `v2/chunks/shell-*.js` | 2.57 kB | 1.21 kB |
| `v2/chunks/groovy-*.js` | 4.14 kB | 1.77 kB |
| `v2/chunks/index-DvevalOb.js` | 14.03 kB | 6.10 kB |
| `v2/chunks/index-BDFw853g.js` | 14.83 kB | 6.00 kB |
| `v2/chunks/index-D6tRNUka.js` | 26.53 kB | 8.82 kB |
| `v2/chunks/index-DL-IIkR6.js` | 27.24 kB | 12.29 kB |
| `v2/chunks/index-D3zOZvR7.js` | 28.73 kB | 11.68 kB |
| `v2/chunks/index-DLKQwt2_.js` | 40.77 kB | 16.77 kB |
| `v2/chunks/index-DlDbvxr5.js` | 44.19 kB | 15.34 kB |
| `v2/chunks/index-Bhivi2uf.js` | 45.14 kB | 19.18 kB |
| `v2/chunks/jsviews-*.js` | 78.43 kB | 33.81 kB |
| `v2/chunks/index-BZaqMgQR.js` | 84.67 kB | 33.52 kB |
| `v2/chunks/codemirror-editor-*.js` | 445.89 kB | 141.72 kB |
| `v2/chunks/auto-*.js` (Chart.js) | 208.31 kB | 71.54 kB |
| `components.html` | 111.36 kB | 13.82 kB |

The main bundle currently exceeds Vite's 500 kB warning threshold. CodeMirror and Chart.js are already dynamic chunks. JsViews has a dynamic chunk but is bootstrapped unconditionally by `main.ts`.

## Initial Request Topology

The shipped-page capture used the built preview on Chromium, an 800 ms post-`DOMContentLoaded` window, source-backed successful REST stubs, and a rejected node WebSocket handshake. Hashed chunk filenames are represented with `*` because hashes are build-specific. Counts include the document request.

| Page | HTTP requests | Captured initial requests |
| --- | ---: | --- |
| No-build authored fixture | 4 | Fixture HTML, `v2/nodel-webui.css`, `v2/nodel-webui.js`, `v2/chunks/jsviews-*.js`; no REST request and no WebSocket for unbound controls. |
| `components.html` | 5 | HTML, stable CSS/JS, logo, JsViews chunk; no REST request or WebSocket. |
| `nodes.html` | 8 | HTML, stable CSS/JS, logo, JsViews chunk, `/REST/diagnostics`, `/build.json`, `/REST`. |
| `/nodes/Demo/nodel.html` | 28 plus one WebSocket | HTML, node-relative stable CSS/JS and logo, JsViews and CodeMirror chunks, six node-detail `REST/` requests, restart status, two file-list requests, capabilities, console, actions, events, params schema/value, remote schema/value, five activity fallback requests, and one `/nodes/Demo` WebSocket attempt. The repeated initial calls are baseline behavior to remove or consolidate later, not a target. |
| `toolkit.html` | 9 | HTML, stable CSS/JS, logo, `/REST/toolkit`, CodeMirror, JsViews, and two CodeMirror language-support chunks. |

`e2e/authored-page-contract.spec.ts` continuously verifies that a page unknown to Vite upgrades initial and later-inserted components through stable assets, contains no catalogue marker, imports no `/src/` module, and makes no REST call for unbound controls.

## Polling And Reconnect Baseline

The rates below are the configured steady-state upper bounds for successful requests after the immediate initial request. They exclude response duration and failure backoff. Visible-only sources abort or stop scheduling when hidden, giving zero steady-state requests per minute after any in-flight request settles.

| Source | Visible-state interval/behavior | Approximate requests/minute | Hidden/offline behavior |
| --- | --- | ---: | --- |
| Local/network node list | 2 seconds by default, overrideable with `poll-interval` | 30 | Paused by the shared visible-only source runtime |
| Node console | 1 second; initial `max=200`, incremental `max=9999` | 60 | Paused when no subscriber is visible |
| Node activity polling fallback | 1 second; WebSocket preferred; 5-second WebSocket reconnect delay | 60 while polling | Socket/polling stopped when no subscriber is visible or browser is offline |
| Host log | 1 second; initial `max=200`, incremental `max=9999` | 60 | Paused when hidden |
| Diagnostic measurements | 10 seconds | 6 | Paused when hidden |
| Node restart watcher | 5-second scheduling plus a 5-second long-poll timeout after the initial timestamp | Up to 6 completed long-poll cycles | Reschedules without requesting while offline or outside a node page |

The generic polling runtime currently increases a failed-source delay by one interval per consecutive failure and does not impose a maximum. This is a recorded baseline, not the target recovery policy.

## Refresh Procedure

After an intentional loading, polling, or distribution change:

1. Run `npm run build:preview` and update the principal size table.
2. Run the no-build authored-page browser contract in Chromium, Firefox, and WebKit.
3. Capture requests from `DOMContentLoaded` through the same 800 ms window with deterministic REST stubs, recording HTTP requests and WebSockets separately.
4. Update polling/reconnect rows only when behavior and tests changed intentionally.
5. Record the new web UI and Java contract revisions.
