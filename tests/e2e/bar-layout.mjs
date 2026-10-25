// Bar layout: page area below the top bar and the tab row; titled tabs with a close button each (closing a
// specific tab), middle click, drag to reorder and to pin, folders as groups, Ctrl+S hides the row, and the classic
// sidebar layout still works.
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
const [userData] = process.argv.slice(2)
const site = createServer((q, r) => (r.writeHead(200, { 'content-type': 'text/html' }), r.end(`<meta charset=utf-8><title>Page ${q.url}</title>${q.url}`)))
await new Promise((r) => site.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${site.address().port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (n, ok, d = '') => (results.push(ok), console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' - ' + d : ''}`))
const until = async (fn, ms = 4000) => {
  for (let t = 0; t < ms; t += 100) {
    const v = await fn().catch(() => null)
    if (v) return v
    await sleep(100)
  }
  return null
}
const app = await electron.launch({ args: ['.', '--mute-audio'], env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: userData } })
const win = (pred) => until(async () => app.windows().find(pred), 20000)
const ui = await win((w) => w.url().endsWith('#ui'))
await ui.waitForLoadState('domcontentloaded')
await ui.addStyleTag({ content: '*, :root { transition: none !important; animation: none !important; }' })
const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
const state = () => call('state')
await call('updateSettings', { onboarded: true })
check('bar layout is the default', (await state()).settings.layout === 'bar')
for (const p of ['/a', '/b', '/c', '/d']) await call('openTab', base + p)
await win((w) => w.url() === base + '/d')
const bounds = (u) =>
  app.evaluate(({ webContents, BaseWindow }, u) => {
    const wc = webContents.getAllWebContents().find((w) => w.getURL() === u)
    const v = wc && BaseWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents === wc)
    return v ? v.getBounds() : null
  }, u)
const b = await until(() => bounds(base + '/d'))
check('the page sits below the top bar and the tab row', b?.x === 8 && b?.y === 84, JSON.stringify(b))
const titles = await until(async () => {
  const t = await ui.locator('.htab .htab-title').allInnerTexts()
  return t.join('|') === 'Page /d|Page /c|Page /b|Page /a' ? t : null
}, 8000)
check('each tab shows its title', !!titles && titles.join('|') === 'Page /d|Page /c|Page /b|Page /a', JSON.stringify(titles))
check('each tab has its own close button', (await ui.locator('.htab .htab-close').count()) === 4)

// The Boost button sits in the top bar, not hidden in the address field.
check('the top bar has a Boost button and the address field none', (await ui.locator('.bar-tools .boost-top').count()) === 1 && (await ui.locator('.bar-top .url-pill .boost-btn').count()) === 0)
await ui.locator('.bar-tools .boost-top').click()
check('Boost opens the editor for the site', !!(await until(async () => (await state()).boostEditor)))
await ui.locator('.bar-tools .boost-top').click()
check('pressing it again closes the editor', !!(await until(async () => !(await state()).boostEditor)))

// Close one specific tab with its ×.
await ui.locator('.htab', { hasText: 'Page /b' }).locator('.htab-close').click()
let s = await until(async () => {
  const st = await state()
  return !st.items.some((i) => i.url === base + '/b') ? st : null
})
check('× closes exactly that tab', !!s && s.items.filter((i) => i.kind === 'tab').length === 3)
await ui.locator('.htab', { hasText: 'Page /c' }).click({ button: 'middle' })
s = await until(async () => {
  const st = await state()
  return !st.items.some((i) => i.url === base + '/c') ? st : null
})
check('middle click closes a tab', !!s)

// Drag /a in front of /d (HTML5 drag events with the item id, as the row reads them).
const drag = (fromTitle, toSelector, side) =>
  ui.evaluate(
    ([fromTitle, toSelector, side, items]) => {
      const id = items.find((i) => i.title === fromTitle).id
      const target = document.querySelector(toSelector)
      const r = target.getBoundingClientRect()
      const x = side === 'before' ? r.left + 4 : r.right - 4
      const dt = new DataTransfer()
      dt.setData('application/x-solamar-item', id)
      for (const type of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: r.top + 10, dataTransfer: dt }))
    },
    [fromTitle, toSelector, side, s.items]
  )
s = await state()
await drag('Page /a', '.htab:first-child', 'before')
const order = await until(async () => {
  const t = await ui.locator('.htab .htab-title').allInnerTexts()
  return t[0] === 'Page /a' ? t : null
})
check('dragging reorders tabs', !!order, JSON.stringify(order))

s = await state()
await ui.evaluate(() => document.querySelector('.tab-row').dispatchEvent(new DragEvent('dragstart', { bubbles: true })))
const zone = await until(async () => (await ui.locator('.pin-icons').count()) === 1)
check('the pin area shows up as a drop target while dragging', !!zone)
await drag('Page /d', '.pin-icons', 'after')
s = await until(async () => {
  const st = await state()
  return st.items.find((i) => i.url === base + '/d')?.section === 'pinned' ? st : null
})
check('dropping a tab on the icon area pins it', !!s && !!(await until(async () => (await ui.locator('.pin-icon').count()) === 1)))

// Pin a second tab, then drag it in front of the first: pinned icons reorder.
s = await state()
const second = s.items.find((i) => i.section === 'today' && i.kind === 'tab')
await call('moveItem', second.id, { section: 'pinned', parentId: null, index: 999 })
await until(async () => (await ui.locator('.pin-icon').count()) === 2)
const pinnedOrder = async () => (await state()).items.filter((i) => i.section === 'pinned').sort((a, b) => a.position - b.position).map((i) => i.id)
const firstId = (await pinnedOrder())[0]
await ui.evaluate((id) => {
  const target = document.querySelectorAll('.pin-icon')[0]
  const r = target.getBoundingClientRect()
  const dt = new DataTransfer()
  dt.setData('application/x-solamar-item', id)
  for (const type of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: r.left + 3, clientY: r.top + 10, dataTransfer: dt }))
}, second.id)
const newOrder = await until(async () => {
  const o = await pinnedOrder()
  return o[0] === second.id ? o : null
})
check('pinned icons reorder by dragging', !!newOrder && newOrder[1] === firstId, JSON.stringify(newOrder))

// A folder in today reads as a group.
const folderId = await call('createFolder', 'today', null)
s = await state()
await call('moveItem', s.items.find((i) => i.url === base + '/a').id, { section: 'today', parentId: folderId, index: 0 })
check('a folder shows as a group chip with its tabs', !!(await until(async () => (await ui.locator('.htab-group .htab').count()) === 1)))
await ui.locator('.group-chip').click()
check('clicking the chip folds the group', !!(await until(async () => (await ui.locator('.htab-group.folded .group-count').innerText()) === '1')))

// Ctrl+S hides the row; the page takes the room.
const now = await state()
const visibleUrl = now.items.find((i) => i.id === now.activeId)?.url
await call('run', 'toggleSidebar')
const b2 = await until(async () => {
  const v = await bounds(visibleUrl)
  return v && v.y === 46 ? v : null
})
check('hiding the tab row gives the page its height', !!b2, JSON.stringify({ b2, visibleUrl }))
await call('run', 'toggleSidebar')

await call('updateSettings', { layout: 'sidebar' })
const b3 = await until(async () => {
  const v = await bounds(visibleUrl)
  return v && v.x === (await state()).settings.sidebarWidth ? v : null
})
const classic = await until(async () => (await ui.locator('aside.sidebar').count()) === 1 && (await ui.locator('.tab-row').count()) === 0)
check('the classic sidebar layout still works', !!b3 && !!classic, JSON.stringify(b3))

await app.close()
site.close()
console.log(`${results.filter(Boolean).length}/${results.length} passed`)
