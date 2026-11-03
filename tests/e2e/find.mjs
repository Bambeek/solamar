// Find in page: Ctrl+F opens the bar over the page, typing searches and counts, Enter and Shift+Enter walk the matches,
// F3 works from the page, Esc closes, the last search comes back, another tab or a navigation closes the bar, and in a
// peek the search covers the peeked page. Keys go through the real input path (sendInputEvent). Local pages, no network.
// Usage: node tests/e2e/find.mjs <userDataDir> [screenshot dir]
import { createServer } from 'node:http'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
const [userData, shots] = process.argv.slice(2)
const site = createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' })
  if (q.url === '/other') return r.end('<!doctype html><title>other</title><p>pear pear</p>')
  r.end(`<!doctype html><title>fruit</title><style>body{font:18px system-ui;margin:40px;max-width:700px;line-height:1.7}</style>
    <h1>Fruit stand</h1><p>An apple a day. The apple tree is old, and the wind moves through it all afternoon.</p>
    <p>Nothing here but pears, plums and one more Apple at the end.</p><p><a href="/other">Other page</a></p>`)
})
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const base = `http://localhost:${site.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))

const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
try {
  const win = async (pred) => {
    for (let i = 0; i < 100; i++) {
      const w = app.windows().find(pred)
      if (w) return w
      await sleep(100)
    }
    throw new Error('no such page')
  }
  const ui = await win((w) => w.url().endsWith('#ui'))
  await ui.waitForLoadState('domcontentloaded')
  const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
  const state = () => call('state')
  await call('updateSettings', { onboarded: true })
  const until = async (test, ms = 3000) => {
    for (let t = 0; t < ms; t += 50) {
      const s = await state()
      if (test(s)) return s
      await sleep(50)
    }
    return state()
  }
  /** A key on the page or on the overlay, the way a real press arrives. */
  const press = (where, keyCode, modifiers = []) =>
    app.evaluate(({ webContents }, [where, keyCode, modifiers]) => {
      const wc = webContents.getAllWebContents().find((w) => w.getURL().includes(where))
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      if (keyCode.length === 1 && !modifiers.includes('control')) wc.sendInputEvent({ type: 'char', keyCode, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    }, [where, keyCode, modifiers])
  const type = async (where, text) => {
    for (const c of text) {
      await press(where, c)
      await sleep(40)
    }
  }

  await call('openTab', base + '/')
  const tab = await win((w) => w.url() === base + '/')
  await tab.waitForLoadState('load')
  await sleep(300)

  await press('localhost', 'F', ['control'])
  let s = await until((x) => x.find)
  check('Ctrl+F on the page opens the bar', s.overlay?.kind === 'find' && !!s.find, JSON.stringify(s.find))
  const overlay = await win((w) => w.url().endsWith('#overlay'))
  await overlay.waitForSelector('.find-bar input')
  const box = await overlay.evaluate(() => {
    const r = document.querySelector('.find-bar').getBoundingClientRect()
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, vw: innerWidth, vh: innerHeight }
  })
  check('the bar fits inside its strip', box.left >= 0 && box.top >= 0 && box.right <= box.vw && box.bottom <= box.vh, JSON.stringify(box))
  check('the bar has the keyboard', await overlay.evaluate(() => document.activeElement === document.querySelector('.find-bar input')))

  await type('#overlay', 'apple')
  s = await until((x) => x.find?.done && x.find.matches > 0)
  const field = () => overlay.evaluate(() => document.querySelector('.find-bar input').value)
  const count = () => overlay.evaluate(() => document.querySelector('.find-count').textContent)
  check('typing letter by letter keeps every letter in the field', (await field()) === 'apple', await field())
  check('it counts the matches, any case', s.find.matches === 3, JSON.stringify(s.find))
  check('the first match is selected', s.find.active === 1 && (await count()) === '1 of 3', await count())
  check('the page does not take the keyboard', await overlay.evaluate(() => document.activeElement === document.querySelector('.find-bar input')))
  if (shots) {
    await overlay.screenshot({ path: join(shots, 'find-bar.png') })
    await tab.screenshot({ path: join(shots, 'find-page.png') }).catch(() => {})
  }

  await press('#overlay', 'Enter')
  s = await until((x) => x.find?.active === 2)
  check('Enter goes to the next match', s.find.active === 2, JSON.stringify(s.find))
  await press('#overlay', 'Enter')
  await press('#overlay', 'Enter')
  s = await until((x) => x.find?.active === 1)
  check('and wraps around at the end', s.find.active === 1, JSON.stringify(s.find))
  await press('#overlay', 'Enter', ['shift'])
  s = await until((x) => x.find?.active === 3)
  check('Shift+Enter goes back', s.find.active === 3, JSON.stringify(s.find))
  await overlay.click('.find-bar button[aria-label="Next match"]')
  s = await until((x) => x.find?.active === 1)
  check('the arrow button goes to the next match', s.find.active === 1, JSON.stringify(s.find))

  await press('localhost', 'F3')
  s = await until((x) => x.find?.active === 2)
  check('F3 from the page goes to the next match', s.find.active === 2, JSON.stringify(s.find))
  const tick = s.find.tick
  await press('localhost', 'F', ['control'])
  s = await until((x) => x.find?.tick > tick)
  const selected = await overlay
    .waitForFunction(() => { const i = document.querySelector('.find-bar input'); return i.selectionStart === 0 && i.selectionEnd === i.value.length && i.value.length > 0 }, null, { timeout: 2000 })
    .then(() => true, () => false)
  check('Ctrl+F again keeps the bar and selects the text', s.find.tick > tick && selected)

  await type('#overlay', 'zzqx')
  s = await until((x) => x.find?.done && x.find.text === 'zzqx')
  check('typing over the selected text replaces it', (await field()) === 'zzqx', await field())
  check('a word that is not there says so', s.find.matches === 0 && (await count()) === 'No results' && (await overlay.locator('.find-bar.none').count()) === 1, await count())
  if (shots) await overlay.screenshot({ path: join(shots, 'find-none.png') })
  check('with nothing found the arrows are off', await overlay.locator('.find-bar button[aria-label="Next match"]').isDisabled())

  await overlay.fill('.find-bar input', 'apple')
  s = await until((x) => x.find?.done && x.find.matches === 3)
  await press('#overlay', 'Escape')
  s = await until((x) => !x.find && !x.overlay)
  check('Esc closes the bar', !s.find && !s.overlay, JSON.stringify(s.overlay))
  check('the match stays selected on the page', /apple/i.test(await tab.evaluate(() => String(getSelection()))))

  await press('localhost', 'F', ['control'])
  s = await until((x) => x.find?.done && x.find.matches === 3)
  check('Ctrl+F brings the last search back and runs it', s.find?.text === 'apple' && s.find.matches === 3, JSON.stringify(s.find))
  await overlay.waitForSelector('.find-bar input')
  check('with its text selected', await overlay.evaluate(() => { const i = document.querySelector('.find-bar input'); return i.value === 'apple' && i.selectionEnd === 5 && i.selectionStart === 0 }))

  await tab.click('a')
  s = await until((x) => !x.find)
  check('a navigation closes the bar', !s.find && !s.overlay, JSON.stringify(s.find))
  await tab.waitForLoadState('load')
  await sleep(200)
  await call('navigate', base + '/').catch(() => {})
  await tab.goto(base + '/').catch(() => {})
  await sleep(300)

  await press('localhost', 'F', ['control'])
  await until((x) => x.find?.done)
  const first = (await state()).window.activeBySpace[(await state()).window.focusedSpaceId]
  await call('openTab', base + '/other')
  s = await until((x) => !x.find)
  check('another tab closes the bar', !s.find && !s.overlay, JSON.stringify(s.find))
  await call('closeTab', (await state()).window.activeBySpace[(await state()).window.focusedSpaceId])
  await until((x) => x.window.activeBySpace[x.window.focusedSpaceId] === first)

  await press('localhost', 'F', ['control'])
  await until((x) => x.find)
  await call('closeTab', first)
  s = await until((x) => !x.find)
  check('closing the tab closes the bar', !s.find && !s.overlay, JSON.stringify(s.find))

  await call('run', 'settings')
  await until((x) => x.overlay?.kind === 'settings')
  await call('run', 'find')
  s = await state()
  check('a dialog keeps the keyboard', s.overlay?.kind === 'settings' && !s.find, JSON.stringify(s.overlay))
  await call('closeOverlay')

  // Peek: the search covers the peeked page; the first Esc closes the search, the second the peek.
  await call('openTab', base + '/other')
  await win((w) => w.url() === base + '/other')
  await sleep(300)
  await call('openPeek', base + '/?peek')
  const peeked = await win((w) => w.url() === base + '/?peek')
  await peeked.waitForLoadState('load')
  await until((x) => x.overlay?.kind === 'peek')
  await press('?peek', 'F', ['control'])
  s = await until((x) => x.find)
  check('Ctrl+F in a peek keeps the peek open', s.overlay?.kind === 'peek' && !!s.find, JSON.stringify(s.overlay))
  await overlay.waitForSelector('.peek-bar .find-bar input')
  await overlay.fill('.peek-bar .find-bar input', 'apple')
  s = await until((x) => x.find?.done && x.find.matches > 0)
  check('it searches the peeked page, not the tab behind', s.find?.matches === 3, JSON.stringify(s.find))
  if (shots) await overlay.screenshot({ path: join(shots, 'find-peek.png') })
  await press('#overlay', 'Escape')
  s = await until((x) => !x.find)
  check('the first Esc closes only the search', !s.find && s.overlay?.kind === 'peek', JSON.stringify(s.overlay))
  await press('?peek', 'Escape')
  s = await until((x) => !x.overlay)
  check('the second Esc closes the peek', !s.overlay, JSON.stringify(s.overlay))

  // From the command bar, and the shortcut is in the editor's list.
  const actions = await call('query', '>find')
  check('the command bar offers it', actions.some((a) => a.action === 'find'), JSON.stringify(actions.map((a) => a.title)))
  check('the shortcut can be changed in Settings', (await state()).settings.shortcuts.find === 'Ctrl+F')
} finally {
  await app.close().catch(() => {})
  site.close()
}
const failed = results.filter((r) => !r).length
console.log(failed ? `${failed} FAILED` : `all ${results.length} passed`)
process.exit(failed ? 1 : 0)
