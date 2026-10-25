# Solamar

A local-first browser for people leaving Arc: spaces, tabs you can tell apart, an ad blocker built in, and AI that
does things on the page for you. Windows and macOS. Website: [solamar.app](https://solamar.app)

## Download

[Windows](https://github.com/Bambeek/solamar/releases/latest/download/Solamar-Setup.exe) ·
[macOS, Apple silicon](https://github.com/Bambeek/solamar/releases/latest/download/Solamar-arm64.dmg) ·
[macOS, Intel](https://github.com/Bambeek/solamar/releases/latest/download/Solamar-x64.dmg) ·
[all releases](https://github.com/Bambeek/solamar/releases)

The installers are not code-signed yet. Windows may show "Windows protected your PC": More info, then Run anyway.
On a Mac, open it once from System Settings > Privacy & Security > Open Anyway. The Windows app updates itself
from these releases; the Mac app tells you when a new version is out.

- Spaces with their own colours, pinned tabs, favorites, nested folders, today tabs that archive themselves
- Command bar (`Ctrl+T`), every shortcut rebindable, split view, hide the sidebar (`Ctrl+S`)
- **Import from Arc**: reads Arc's sidebar file on this PC (read-only) and brings spaces, pinned tabs, folders, emoji and colours
- Built-in ad and tracker blocking, per-site allow
- Sleeping tabs to save memory
- Optional AI (summarize page, ask the page, tidy tabs): a local model through Ollama, or Claude with your own Anthropic API key
  (stored in the OS keychain), chosen per feature. Off by default
- **Claude Code can drive Solamar**: Settings > Claude Code turns on a local MCP server; copy the `claude mcp add` line it shows.
  Claude Code works in its own Claude space (or tabs you share), asks per site, and anything that sends, buys, submits or deletes
  waits for your click in Solamar. Passwords and card numbers are never typed by AI
- No account, no sync server, no telemetry. Data is one JSON file in the app data folder

## Run

```bash
npm install
npm run dev
```

`npm run build` then `npm start` runs the production build.

## Test

```bash
npm test
npm run typecheck
```

End-to-end (hidden window, throwaway profile, no real API calls), after `npm run build`:

- `node tests/e2e/smoke.mjs <tmp-profile-dir> <screenshot-dir>` - browsing, spaces, Arc import, local AI against a mock Ollama
- `node tests/e2e/agent.mjs <tmp-profile-dir> <screenshot-dir>` - Claude engine against a mock API, MCP server driven by the official MCP client

## Layout

- `src/main` - window and tab views (`browser.ts`), storage, ad block, local AI, Arc import (`arc-parse.ts` is pure and tested)
- `src/preload` - the bridge for Solamar's own UI pages only; web pages get no preload
- `src/renderer` - the frame (sidebar, AI panel) and the overlay (command bar, dialogs)
- `site/` - the website (static files); `MODLOG.md` - Arc's on-disk format, for the importer

## Release

Bump `version` in package.json, commit, then tag and push it (`git tag v0.1.1 && git push origin v0.1.1`). CI
(.github/workflows/build.yml) builds the Windows installer and both Mac disk images, tests the packaged apps and
uploads everything to a draft release; publishing the draft is what the apps' updater and the website see.

## License

GPL-3.0-or-later (see [LICENSE](LICENSE)). Chrome extension support comes from
[electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell), used under its GPL-3.0 option.
