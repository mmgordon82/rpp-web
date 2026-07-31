# rpp-web

Control a Sony REON Pocket Pro from a browser tab. No app, no Sony account, no
backend.

**[obviyus.github.io/rpp-web](https://obviyus.github.io/rpp-web/)**

Unofficial and unaffiliated with Sony. Developed against `RNP-P1` on firmware
`2.2.1`.

## Why

The official app wants a Sony account and a network round trip to change the
cooling level on a device sitting against your neck. This page talks to the
device directly over Web Bluetooth. Everything — the owner key, the linked Tag
address — stays in your browser profile.

## Use

1. Open the page in a [supported browser](#browser-support).
2. Hold the REON button ~2 seconds, until the blue light blinks.
3. Select **Connect**, then choose `RNP-P1`.

Controls appear based on what the device reports it can do, so a different REON
model shows a smaller set rather than broken buttons.

## Features

| | |
| --- | --- |
| Manual | Cool and Warm, 3–5 levels depending on model |
| Smart | Cool, Warm, or Auto with five preferences each |
| Auto switching | Cool ⇄ Warm at configurable ambient temperatures |
| Wave | Pulsing output on Manual modes |
| REON Pocket Tag | Discover, link, and read its climate + battery |
| Auto Start / Stop | Runs when worn, stops when removed |
| Quick Launch | Start from the device button alone |
| Live state | Mode, battery, charging, surface temperature |
| Diagnostics | Every frame read, written, and notified, in hex |

Firmware updates and account-linked features are out of scope — they depend on
Sony services and aren't needed for daily control.

## Browser support

| Platform | Works |
| --- | --- |
| Chrome / Edge on macOS, Windows, Linux | Yes |
| Chrome on Android | Yes |
| Safari, Firefox | No — no Web Bluetooth |
| iOS / iPadOS | Only via a Web Bluetooth browser such as Bluefy |

The page must be served over HTTPS or `localhost`; Web Bluetooth refuses
anything else.

## Development

```sh
bun run dev     # http://localhost:3000
bun test        # protocol fixtures, no device needed
bun run build   # static bundle in dist/
```

Push to `main` deploys to GitHub Pages via `.github/workflows/pages.yml`.

- `src/protocol.js` — pure frame builders and parsers, no I/O
- `src/reon-client.js` — one serialized GATT read/write/notify path
- `src/main.js` — product state and DOM rendering
- `src/protocol.test.js` — byte-level fixtures for every frame

Protocol work belongs in `protocol.js` and is provable with `bun test` alone.

## Protocol notes

Reverse-engineered from the device. Control service
`04ca1501-fd57-404e-8459-c5ef8d765c8d`:

| Short UUID | Purpose |
| --- | --- |
| `1503` | Mode — manual and smart frames, notifies on change |
| `1505` | Auto Start / Stop |
| `1506` | Authentication — Tag registration |
| `1509` | Quick Launch |
| `150a` | Owner key |
| `1580` | Capability bitfield |
| `1581` | Temperature — device surface or Tag climate |
| `1582` | Battery |

Model and firmware come from standard Device Information (`0x180A`).

**Ownership.** On every connect the app writes a 16-byte owner key to `150a`.
The key is generated once and kept in `localStorage`. Clearing site data
generates a new one and re-claims the device on the next connect.

**Tag.** The Tag broadcasts under Sony's company ID `0x012D` with its payload
XOR-obfuscated by a fixed key. Linking writes the Tag's address to `1506`;
afterwards the device relays Tag temperature, humidity, and battery through
`1581`.

## License

MIT. See [LICENSE](LICENSE).
