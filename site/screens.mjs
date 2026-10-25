// Screenshots of the landing page: the first screen, then the whole page, at desktop and phone widths in dark and
// light. Usage (from the repo root, Playwright is a dev dependency): node site/screens.mjs
// Output: site/screens/hero-<width>-<scheme>.png and site/screens/<width>-<scheme>.png (git-ignored).
// Also reports console errors, failed requests and horizontal overflow, and exits non-zero if any are found.
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, readFile } from 'node:fs'
import { dirname, extname, join, normalize, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'screens')
mkdirSync(out, { recursive: true })

// Serve the folder over http (fonts do not load from file:// URLs).
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = normalize(join(here, path.endsWith('/') ? path + 'index.html' : path))
  if (!file.startsWith(here + sep)) { res.writeHead(403).end(); return }
  readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }).end(data)
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

let problems = 0

// Playwright's own Chromium if it is installed, otherwise the Edge or Chrome already on the PC.
async function launch() {
  for (const opts of [{}, { channel: 'msedge' }, { channel: 'chrome' }]) {
    try { return await chromium.launch(opts) } catch { /* try the next one */ }
  }
  throw new Error('No browser found. Run: npx playwright install chromium')
}

async function open(browser, width, colorScheme) {
  const context = await browser.newContext({ viewport: { width, height: width > 800 ? 900 : 844 }, colorScheme, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`) })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`))
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()}: ${r.url()}`) })
  await page.goto(base, { waitUntil: 'load' })
  await page.evaluate(async () => {
    document.querySelectorAll('img[loading="lazy"]').forEach((img) => { img.loading = 'eager' })
    await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r })))
    await document.fonts.ready
  })
  return { context, page, errors }
}

const browser = await launch()
try {
  for (const width of [1440, 390]) {
    for (const colorScheme of ['dark', 'light']) {
      const { context, page, errors } = await open(browser, width, colorScheme)
      await page.waitForTimeout(2600)
      await page.screenshot({ path: join(out, `hero-${width}-${colorScheme}.png`) })
      // A full-page shot does not scroll: scroll through once like a reader, then back to the top.
      await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms))
        for (let y = 0; y < document.documentElement.scrollHeight; y += 450) { window.scrollTo(0, y); await wait(70) }
        window.scrollTo(0, 0)
      })
      await page.waitForTimeout(1500)
      const overflow = await page.evaluate(() => {
        const doc = document.documentElement
        const wide = [...document.querySelectorAll('body *')].filter((el) => {
          // inside a row that scrolls on its own (the tour's chips on a phone) is fine
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (/auto|scroll/.test(getComputedStyle(a).overflowX)) return false
          const r = el.getBoundingClientRect()
          return r.width > 0 && r.right > doc.clientWidth + 1
        }).slice(0, 6).map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').join('.'))
        return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, wide }
      })
      await page.screenshot({ path: join(out, `${width}-${colorScheme}.png`), fullPage: true })
      if (overflow.scrollWidth > overflow.clientWidth || overflow.wide.length) {
        problems++
        console.log(`overflow ${width} ${colorScheme}:`, JSON.stringify(overflow))
      }
      if (errors.length) { problems++; console.log(`${width} ${colorScheme}:\n  ` + errors.join('\n  ')) }
      await context.close()
    }
  }
} finally {
  await browser.close()
  server.close()
}
console.log(problems ? `${problems} problem(s)` : 'clean')
process.exitCode = problems ? 1 : 0
