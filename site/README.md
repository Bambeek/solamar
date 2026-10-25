# Landing page

The marketing and download page for **Solamar**, the browser. Static files only: no build step,
no framework, no external scripts, fonts or images.

```
site/
  index.html      the page
  styles.css      all styles: night harbour in dark mode, comic paper in light mode (follows the system setting)
  brand.js        BRAND config: name, download link, source link, MCP port
  main.js         fills the page from BRAND, copy button, Arc countdown, the screenshot tour
  icon.svg        app icon (copy of build/icon.svg)
  assets/         screenshots of the app's own UI (WebP), the Inter and Barlow Condensed fonts (OFL, licences included)
  assets/comic/   the illustrations (WebP)
  screens.mjs     takes screenshots into screens/ (git-ignored)
  deploy.sh       puts the page on the WSBusinesslab dedi (https://solamar.app); nginx-solamar.app.conf is its vhost
```

The hero and the tour show real screenshots of the app from `screens-app.mjs` (made-up local pages in a real
window); the hero's window has an ordinary article open, so it reads as a browser rather than an illustration.

## Illustrations

Everything in `assets/comic/` was generated locally with ComfyUI (Qwen Image 2.1) for this site: bold comic
style, thick black outlines, no text in the pictures. Props and icons were generated on a plain grey background
and cut out; floor shadows became translucent black so they sit on both themes.

The footer's skyline strip uses `bg-night.webp` (dark) and `bg-day.webp` (light). The other backgrounds and the
props (lighthouse, crane, boxes) illustrate the made-up pages in `screens-app.mjs`.

## Preview

Any static server works, for example from the repo root:

```bash
npx serve site
```

Opening `site/index.html` straight from disk also works; the browser then refuses to load the bundled font over
`file://` and falls back to the system font (Segoe UI on Windows).

## Rename the product

The name lives in two places:

1. `name` (and `slug`, the lower-case id used in the `claude mcp add` command) in `brand.js`
2. the `<title>` in `index.html`

Every other mention on the page is an empty `<span data-brand="name">` that `main.js` fills at load, including the
Claude Code command. If the title and `BRAND.name` disagree, the page logs a warning in the console.

The illustrations have no text in them, so a rename needs no new art. The logo wordmark is set in Barlow Condensed
from the same `data-brand` span.

## Point the download button at a release

Set `downloadUrl` in `brand.js`, for example:

```js
downloadUrl: 'https://github.com/OWNER/REPO/releases/latest',
```

While it starts with `#` (the default is `#download`), every Download button scrolls to the download section, which
says the Windows installer is coming soon. With a real URL the buttons link to it and the "coming soon" notes
disappear. Set `repoUrl` to show a "Source" link in the footer once the code is public.

## Screenshots

```bash
node site/screens.mjs
```

Writes full-page shots `site/screens/{1440,390}-{light,dark}.png` and first-screen shots
`site/screens/hero-{1440,390}-{light,dark}.png`. Reports console errors, failed requests and horizontal overflow. It uses
Playwright's Chromium if installed, otherwise the Edge or Chrome already on the PC.

Sections rise in through CSS scroll-driven animations (`animation-timeline: view()`), so a full-page shot shows
the ones below the first screen slightly shifted and tilted; in a browser they settle as you scroll. Nothing is
ever hidden, and reduced motion turns all of it off.

## Content rules

Only claim what the app does today (see the repo README). No invented numbers, testimonials, user counts or press
logos. Arc is mentioned only for the facts: it stops working on December 22, 2026, and the import reads its local
data read-only. No Arc logos, screenshots or copy.
