# Environment reality (verified on this machine)

> This file records the machine the engine grew up on. Run `probe doctor` for yours; treat these values
> as examples, not requirements. The engine only requires Node 20+; rendering additionally needs a
> Chrome/Chromium binary, and Eagle is optional.

Not assumptions. Re-verify before relying on any of it after an upgrade.

## Models

The pipeline runs on OpenCode with mixed models — free tiers and DeepSeek, not Claude-only. Two
consequences:

- **Prefer mechanical checks to prompt rules.** `sloplint`, `probe.mjs build`, axe and the render tier are
  deterministic; a long list of "always/never" in a prompt is not. Where a rule matters, encode it in a
  script or a validation.
- **Name skills explicitly.** Do not rely on a weaker model auto-selecting the right skill from
  descriptions. The agent's runbook names the stage, the skill and the command.

No part of this pipeline calls a model at runtime.

## Eagle

- Library path resolves as `sources.path` → `$EAGLE_LIBRARY` → the library Eagle currently has open (`GET /api/v2/library/info`) → the old Inspirations default. With several libraries, or after a merge, trust the app's answer, not a path in a config.
- **Metadata does not need file access.** `POST /api/v2/item/get` pages 1,000 at a time with `total`, filters, and `palettes`; `library/info` carries the folder tree. Ingest uses this first and only falls back to the index cache on an older Eagle.
- **Images still need file access from the raw API** — no endpoint returns bytes: `item/thumbnail`, `item/file`, `item/preview` are 404 on v2, and the skill server on `:41596` returns `filePath`/`thumbnailPath` only. But an Eagle **preview server plugin** runs inside Eagle where file access is free, and serves item bytes over HTTP. Media Preview Server (tuki0918, v0.3.4) listens on port 41532 while its window is open, and `GET /api/items/{id}/file` returns the *original* with the correct content type — including font files (2,208 in this library). Set `EAGLE_MEDIA_URL="http://127.0.0.1:41532/api/items/{id}/file"` (or `sources.mediaServer`) so `serve` redirects and `analyze` fetches to a temp file, both of which work without any file access from this process.
- **Prefer a local library.** A process not launched by a GUI app is denied `~/Library/Mobile Documents` (TCC), and iCloud offloading makes Eagle answer `File does not exist` for items whose files are not local. `export EAGLE_LIBRARY="$HOME/Pictures/Eagle/Inspirations.library"` fixes both without granting Full Disk Access.
- Index: JSON-lines under `~/Library/Application Support/Eagle/library-caches/`, filename hashed — match
  by item count, then read in one pass.
- **No working search.** `keyword`, `name`, `tags` and `folders` filters return empty. Page
  `/api/item/list` (500/call) and filter client-side, or read `images/<id>.info/metadata.json`.
- **Thumbnails are WebP with a `.png` name.** Sniff bytes, never trust the extension.
- Metadata is cheap; looking is expensive. Breadth from metadata, depth on six captures.
- Tags are the project↔Eagle join, not folders.
- Web API on `:41595` works; the MCP plugin is not installed. Write-back needs the app running.
- Read-only during a probe; `record` is the only writer and is a dry run unless `--apply`.

## Browsers

Helium (0.20.1.1, Chromium 156) is the daily browser. **Do not automate it** — profile collision and
silent engine changes under existing evidence.

Automation binaries already on disk:

| Binary | Version | Path |
|---|---|---|
| Playwright Chromium | Chrome for Testing 156.0.8078.4 | `~/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` |
| Puppeteer cache | Chrome for Testing 131.0.6778.204 | `~/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` |

`puppeteer-core` is installed in `~/Developer/tools/design-pipeline` (24.43.1) and the render tier is
**verified working** with the Playwright 156 binary: `sloplint --render` wrote five frames (1280×800,
1440×900, 1920×1080 folds, plus 1440 and 375 full pages) and ran the gates.

Use the wrapper, which resolves puppeteer and an automation browser from any project with no environment
variables:

```bash
"$HOME/Developer/tools/design-pipeline/bin/sloplint" <files|--url …> --render
```

It prefers `CHROME_PATH` if set, then Playwright's Chrome for Testing 156, then Puppeteer's 131. It never
picks `/Applications` — that is where the daily browser lives.

`npm audit` reports high-severity advisories in puppeteer-core's tree (`extract-zip`, `basic-ftp`,
`chromium-bidi`, `zod`). They sit on paths this pipeline does not use — no archive extraction, no FTP,
local browser only — so the practical risk is low. **Do not run `npm audit fix --force`**: it moves
puppeteer-core off the pinned major and breaks the render tier. Revisit when puppeteer ships a fixed
release.

Puppeteer 24.43 targets a slightly older Chrome than 156; if a future render misbehaves, fall back to the
131 build and record which pair produced the screenshots.

## Penpot

- Hosted MCP at `https://design.penpot.app/mcp/stream?userToken=…`; launcher resolves the key at spawn
  time from `~/.dsh/.env` (authoritative) with `process.env` as fallback.
- Remote mode exposes four tools: `execute_code`, `high_level_overview`, `penpot_api_info`,
  `export_shape`. No `import_image`; use `uploadMediaUrl` (server-side fetch, so hotlink-protected URLs
  fail) or `uploadMediaData`.
- `execute_code` mutates the live file immediately. Checkpoint before risky edits.
- A superseded key authenticates and then reports an empty instance set. "No instance connected" is a
  credential symptom, not a plugin one.
- **Both keys in play at the time of writing are exposed. Regenerate in Penpot, update the plugin and
  `~/.dsh/.env` together.**

## Tokens

A project may have `tokens.json`, a CSS custom-property file, both, or neither. Declare the canonical
one in `00-brief.md`. Two sources of truth with no check is how drift survives.

`system.tokensFile` in the probe config is optional. Declared and present → token refs are validated
(a stale ref is fatal). Absent → no check, and the spec's `pendingTokens` is the record of what must be
added.

## Writes that need a human first

Deploying, publishing, pushing to a shared branch, deleting a shared component, rewriting global tokens,
regenerating a credential. Name the blast radius and the rollback before doing any of them.
