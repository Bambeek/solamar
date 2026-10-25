// Scripts Solamar runs inside web pages for boosts (zap picker) and the mini player (media controls).

/** Isolated world for the zap picker, so the page cannot see or fake its handlers. */
export const BOOST_WORLD = 1002

/**
 * Highlights the element under the mouse; a click resolves with a CSS selector for it, Escape (or zapStopJs)
 * with { stop: true }. Clicks are swallowed so zapping a link or button does not trigger it. The wheel (or the arrow
 * keys) widens or narrows the pick to the element around it, for when the first guess is too small or too big.
 */
export const zapJs = `new Promise((resolve) => {
  if (window.__solamarZapStop) window.__solamarZapStop()
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #e5484d;background:rgba(229,72,77,.14);border-radius:4px;display:none;box-sizing:border-box'
  const tag = document.createElement('div')
  tag.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;display:none;font:12px/1.5 system-ui,sans-serif;color:#fff;background:#e5484d;padding:1px 7px;border-radius:4px;white-space:nowrap'
  document.documentElement.append(box, tag)
  let base = null // what the mouse points at
  let up = 0 // how many elements out from there the pick is
  let picked = null // what a click hides
  const esc = (v) => CSS.escape(v)
  const okId = (id) => id && id.length < 40 && !/\\d{3,}|^\\d|:/.test(id)
  const okClass = (c) => c.length < 40 && !/\\d{3,}|^(css|sc|jsx|emotion|styled)-|__[a-z0-9]{5,}$|^_[a-z0-9]{5,}$|^(is|has)-|hover|active|focus|selected/i.test(c)
  const unique = (sel) => { try { return document.querySelectorAll(sel).length === 1 } catch { return false } }
  const outside = (e) => !e || e === document.documentElement || e === document.body
  // Wrappers and effect layers (a ripple inside a button) cover exactly the element around them: the pick is the
  // outermost of such a chain, the thing a person sees as one element.
  const sameBox = (a, b) => {
    const r = a.getBoundingClientRect()
    const q = b.getBoundingClientRect()
    return Math.abs(r.left - q.left) < 3 && Math.abs(r.top - q.top) < 3 && Math.abs(r.width - q.width) < 3 && Math.abs(r.height - q.height) < 3
  }
  const outer = (e) => {
    while (!outside(e.parentElement) && sameBox(e, e.parentElement)) e = e.parentElement
    return e
  }
  const part = (e, strict) => {
    if (okId(e.id) && unique('#' + esc(e.id))) return { s: '#' + esc(e.id), done: true }
    let s = e.localName
    const cls = [...e.classList].filter(okClass).slice(0, 3)
    s += cls.map((c) => '.' + esc(c)).join('')
    const label = e.getAttribute('data-testid') || e.getAttribute('aria-label')
    if (!cls.length && label && label.length < 60) s += '[' + (e.hasAttribute('data-testid') ? 'data-testid' : 'aria-label') + '="' + label.replace(/"/g, '\\\\"') + '"]'
    const p = e.parentElement
    if (p && (strict || (!cls.length && !label))) {
      const same = [...p.children].filter((c) => c.localName === e.localName)
      if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(e) + 1) + ')'
    }
    return { s, done: false }
  }
  // Short and readable when that is unique, positional when it has to be; always exactly one element.
  const selectorFor = (el) => {
    let sel = ''
    for (const strict of [false, true]) {
      sel = ''
      for (let e = el, depth = 0; e && e !== document.documentElement && depth < 12; e = e.parentElement, depth++) {
        const p = part(e, strict)
        sel = sel ? p.s + ' > ' + sel : p.s
        if (unique(sel)) return sel
        if (p.done) break
      }
    }
    return sel
  }
  const show = () => {
    if (!picked) {
      box.style.display = tag.style.display = 'none'
      return
    }
    const r = picked.getBoundingClientRect()
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
    tag.textContent = picked.localName + '  ' + Math.round(r.width) + ' × ' + Math.round(r.height) + '  ·  scroll: bigger / smaller'
    Object.assign(tag.style, { display: 'block', left: Math.max(4, r.left) + 'px', top: (r.top > 26 ? r.top - 24 : r.bottom + 4) + 'px' })
  }
  const pick = () => {
    picked = null
    if (base) {
      let e = outer(base)
      for (let i = 0; i < up && !outside(e.parentElement); i++) e = outer(e.parentElement)
      picked = e
    }
    show()
  }
  const move = (ev) => {
    const el = document.elementFromPoint(ev.clientX, ev.clientY)
    const next = !el || el === box || el === tag || outside(el) ? null : el
    if (next !== base) {
      base = next
      up = 0
    }
    pick()
  }
  const swallow = (ev) => { if (!ev.isTrusted) return; ev.preventDefault(); ev.stopPropagation(); ev.stopImmediatePropagation() }
  const resize = (dir) => {
    up = Math.max(0, up + dir)
    pick()
  }
  const wheel = (ev) => {
    if (!ev.isTrusted || !base) return
    swallow(ev)
    resize(ev.deltaY < 0 ? 1 : -1)
  }
  const click = (ev) => { if (!ev.isTrusted) return; swallow(ev); if (picked) done({ selector: selectorFor(picked) }) }
  const key = (ev) => {
    if (!ev.isTrusted) return
    if (ev.key === 'Escape') { swallow(ev); done({ stop: true }) }
    else if (ev.key === 'ArrowUp') { swallow(ev); resize(1) }
    else if (ev.key === 'ArrowDown') { swallow(ev); resize(-1) }
    else if (ev.key === 'Enter' && picked) { swallow(ev); done({ selector: selectorFor(picked) }) }
  }
  const types = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'auxclick', 'contextmenu']
  const done = (v) => {
    window.removeEventListener('mousemove', move, true)
    window.removeEventListener('click', click, true)
    window.removeEventListener('keydown', key, true)
    window.removeEventListener('wheel', wheel, true)
    for (const t of types) window.removeEventListener(t, swallow, true)
    box.remove()
    tag.remove()
    window.__solamarZapStop = null
    resolve(v)
  }
  window.addEventListener('mousemove', move, true)
  window.addEventListener('click', click, true)
  window.addEventListener('keydown', key, true)
  window.addEventListener('wheel', wheel, { capture: true, passive: false })
  for (const t of types) window.addEventListener(t, swallow, true)
  window.__solamarZapStop = () => done({ stop: true })
})`

export const zapStopJs = 'window.__solamarZapStop && window.__solamarZapStop()'

export type MediaAction = 'info' | 'toggle' | 'pause' | 'pip' | 'pipEnter' | 'pipExit'

/**
 * Finds the page's main media element (the one playing, else the biggest video) and reads or controls it.
 * Runs in the page's own world: mediaSession metadata and Picture-in-Picture belong to it.
 */
export function mediaJs(action: MediaAction): string {
  return `(() => {
  const all = [...document.querySelectorAll('video, audio')]
  const area = (m) => { const r = m.getBoundingClientRect(); return r.width * r.height }
  const m = all.find((x) => !x.paused) || all.filter((x) => x.localName === 'video').sort((a, b) => area(b) - area(a))[0] || all[0]
  const action = ${JSON.stringify(action)}
  if (action === 'info') {
    const md = navigator.mediaSession && navigator.mediaSession.metadata
    return { title: String((md && md.title) || document.title || '').slice(0, 200), artist: String((md && md.artist) || '').slice(0, 200), video: !!m && m.localName === 'video', playing: !!m && !m.paused, found: !!m }
  }
  if (action === 'pipExit') { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); return true }
  if (!m) return false
  if (action === 'toggle') { if (m.paused) m.play().catch(() => {}); else m.pause(); return true }
  if (action === 'pause') { m.pause(); return true }
  if (m.localName !== 'video') return false
  if (action === 'pip') { if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {}); else m.requestPictureInPicture().catch(() => {}); return true }
  if (action === 'pipEnter') { if (!m.paused && !m.muted && !document.pictureInPictureElement && m.videoWidth > 0) m.requestPictureInPicture().catch(() => {}); return true }
  return false
})()`
}
