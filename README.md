# rpp-web

Unofficial, local-first Web Bluetooth controller for the Sony REON Pocket Pro.
Tested with the `RNP-P1` on firmware `2.2.1`.

## Use

Open <https://obviyus.github.io/rpp-web/> in Chrome on macOS or Android.

Hold the REON button for about two seconds until the blue light blinks. Select
**Connect**, then choose `RNP-P1`.

The app runs entirely in the browser. The owner key stays in the browser
profile. No Sony account, backend, analytics, or cloud service.

## Features

- Capability-based controls: unsupported modes stay hidden
- Manual Cool and Warm levels
- Smart Cool and Smart Warm with five preferences
- REON Pocket Tag discovery and linking
- Smart Cool ⇄ Warm preferences and switching temperatures
- Wave mode
- Auto Start / Stop when worn or removed
- Quick Launch from the device button
- Live mode, battery, charging, surface temperature, and Tag climate state
- Model and firmware details
- Local protocol diagnostics

Firmware installation and Sony-account features are intentionally excluded.
They depend on Sony services and are not required for daily device control.

## Local development

```sh
bun run dev
```

Then open <http://localhost:3000> in Chrome. Build and test with:

```sh
bun run build
bun test
```

`main` deploys automatically to GitHub Pages through
`.github/workflows/pages.yml`.

## Architecture

- `src/protocol.js`: pure frame builders and parsers
- `src/reon-client.js`: one serialized GATT read/write/notify path
- `src/main.js`: product state and DOM rendering
- `src/protocol.test.js`: byte-level protocol fixtures

This project is not affiliated with or endorsed by Sony.
