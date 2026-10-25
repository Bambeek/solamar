// Passwords in web pages: tells Solamar about a sent login (so it can offer to save it) and shows saved logins in a
// small list under a login field. Runs in the preload's isolated world: page scripts cannot see these listeners,
// the list (closed shadow root) or the values Solamar sends. Only real user input (isTrusted) counts, so scripts
// and automation cannot pull a password out by faking a click or a submit.
import { ipcRenderer } from 'electron'

const TEXTY = new Set(['text', 'email', 'tel', ''])
const isPassword = (el: unknown): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'password'
const isTexty = (el: unknown): el is HTMLInputElement => el instanceof HTMLInputElement && TEXTY.has(el.type) && !el.readOnly && !el.disabled
const visible = (el: HTMLElement) => {
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'
}
const scopeOf = (el: Element): ParentNode => el.closest('form') ?? document
const passwordsIn = (scope: ParentNode) => [...scope.querySelectorAll<HTMLInputElement>('input[type=password]')].filter(visible)

let lastUser = '' // typed on an earlier step, for sign-ins that ask for the email first

/** The username field for a password field: autocomplete hints first, else the last text field before it. */
function userFieldFor(pw: HTMLInputElement): HTMLInputElement | null {
  const inputs = [...scopeOf(pw).querySelectorAll('input')].filter((i): i is HTMLInputElement => isTexty(i) && visible(i))
  const hinted = inputs.find((i) => /username|email/i.test(i.autocomplete))
  if (hinted) return hinted
  let best: HTMLInputElement | null = null
  for (const i of inputs) if (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) best = i
  return best
}

let sentKey = ''
function capture(scope: ParentNode): void {
  // Only right after the user did something (a submit event is trusted even when a script calls requestSubmit).
  if (!navigator.userActivation?.isActive) return
  const pws = passwordsIn(scope).filter((p) => p.value)
  if (!pws.length) return
  // Sign-up and change-password forms: keep the new password (current, new, confirm -> the middle one).
  const pw = pws.find((p) => p.autocomplete === 'new-password') ?? (pws.length === 3 ? pws[1] : pws[0])
  const user = userFieldFor(pws[0])?.value.trim() || lastUser
  const key = user + '\u0000' + pw.value
  if (key === sentKey) return
  sentKey = key
  ipcRenderer.send('solamar:login-submit', { username: user, password: pw.value })
  // Pages that sign in without navigating: done once the password field is gone.
  const check = (n: number) =>
    setTimeout(() => {
      if (!pw.isConnected || !visible(pw)) ipcRenderer.send('solamar:login-done')
      else if (n > 0) check(n - 1)
    }, 1500)
  check(3)
}

window.addEventListener('submit', (e) => e.isTrusted && e.target instanceof HTMLFormElement && capture(e.target), true)
window.addEventListener(
  'keydown',
  (e) => {
    if (!e.isTrusted || e.key !== 'Enter' || !(isPassword(e.target) || isTexty(e.target))) return
    const scope = scopeOf(e.target as Element)
    if (passwordsIn(scope).some((p) => p.value)) capture(scope)
  },
  true
)
window.addEventListener(
  'click',
  (e) => {
    if (!e.isTrusted) return
    const btn = e.composedPath().find((n): n is HTMLElement => n instanceof HTMLElement && n.matches('button, input[type=submit], input[type=button], [role=button]'))
    if (!btn || btn.localName === 'solamar-logins') return
    const scope = scopeOf(btn)
    if (passwordsIn(scope).some((p) => p.value)) capture(scope)
  },
  true
)
window.addEventListener(
  'change',
  (e) => {
    const t = e.target
    if (e.isTrusted && isTexty(t) && t.value.trim() && (t.type === 'email' || /user|mail|login/i.test(t.autocomplete + ' ' + t.name + ' ' + t.id))) lastUser = t.value.trim()
  },
  true
)

// ---------- the saved-logins list ----------

let logins: { id: string; username: string }[] | null = null
let host: HTMLElement | null = null
let field: HTMLInputElement | null = null

const KEY_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>'
const STYLE = `
  .box { font: 13px/1.3 system-ui, "Segoe UI", sans-serif; min-width: 240px; max-width: 360px; background: #fff; color: #17151f;
    border: 1px solid rgba(23,21,31,.14); border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.18); padding: 4px; }
  button { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 10px;
    border-radius: 7px; cursor: pointer; color: inherit; }
  button:hover, button:focus-visible { background: rgba(124,108,242,.12); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foot { padding: 4px 10px 6px; font-size: 11px; color: #6b6878; }
  @media (prefers-color-scheme: dark) {
    .box { background: #24212e; color: #f2f0f8; border-color: rgba(255,255,255,.12); }
    .foot { color: #a29fb0; }
  }`

function hide(): void {
  host?.remove()
  host = null
  field = null
}

function isLoginField(el: unknown): el is HTMLInputElement {
  if (isPassword(el)) return el.autocomplete !== 'new-password'
  if (!isTexty(el)) return false
  const pw = passwordsIn(scopeOf(el))[0]
  return (!!pw && userFieldFor(pw) === el) || /username/.test(el.autocomplete)
}

function show(f: HTMLInputElement): void {
  if (!logins?.length || !visible(f)) return
  hide()
  field = f
  host = document.createElement('solamar-logins')
  const r = f.getBoundingClientRect()
  host.style.cssText = `all: initial; position: fixed; z-index: 2147483647; left: ${Math.round(r.left)}px; top: ${Math.round(r.bottom + 4)}px;`
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent = STYLE
  const box = document.createElement('div')
  box.className = 'box'
  box.setAttribute('role', 'listbox')
  box.setAttribute('aria-label', 'Saved logins')
  for (const l of logins) {
    const b = document.createElement('button')
    b.setAttribute('role', 'option')
    b.innerHTML = KEY_ICON
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = l.username || '(no username)'
    b.append(name)
    b.addEventListener('mousedown', (e) => e.preventDefault()) // keep focus in the field
    b.addEventListener('click', (e) => e.isTrusted && void fill(l.id, f))
    b.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide(), f.focus()
      if (e.key === 'ArrowDown') (b.nextElementSibling as HTMLElement | null)?.focus()
      if (e.key === 'ArrowUp') ((b.previousElementSibling as HTMLElement | null) ?? f).focus()
    })
    box.append(b)
  }
  const foot = document.createElement('div')
  foot.className = 'foot'
  foot.textContent = 'Saved in Solamar'
  box.append(foot)
  root.append(style, box)
  host.addEventListener('solamar-focus-first', () => (box.firstElementChild as HTMLElement | null)?.focus())
  document.documentElement.append(host)
}

/** Keeps the list under its field when the page scrolls. */
function place(): void {
  if (!host || !field) return
  if (!field.isConnected || !visible(field)) return hide()
  const r = field.getBoundingClientRect()
  host.style.left = Math.round(r.left) + 'px'
  host.style.top = Math.round(r.bottom + 4) + 'px'
}

function setValue(el: HTMLInputElement, v: string): void {
  // The prototype's setter, so frameworks that track the value (React) see a real change.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

async function fill(id: string, f: HTMLInputElement): Promise<void> {
  const cred = (await ipcRenderer.invoke('solamar:login-fill', id).catch(() => null)) as { username: string; password: string } | null
  hide()
  if (!cred) return
  const pw = isPassword(f) ? f : (passwordsIn(scopeOf(f))[0] ?? null)
  const user = pw ? userFieldFor(pw) : f
  if (user && cred.username) setValue(user, cred.username)
  if (pw) setValue(pw, cred.password)
  sentKey = cred.username + '\u0000' + cred.password // came from Solamar: no "save?" for it
  ;(pw ?? f).focus()
}

window.addEventListener(
  'focusin',
  (e) => {
    const t = e.target
    if (!e.isTrusted || !isLoginField(t)) return
    const load = logins ? Promise.resolve() : ipcRenderer.invoke('solamar:logins').then((l) => void (logins = Array.isArray(l) ? l : []), () => void (logins = []))
    void load.then(() => document.activeElement === t && show(t))
  },
  true
)
window.addEventListener(
  'focusout',
  (e) => {
    if (e.target === field && (e as FocusEvent).relatedTarget !== host) setTimeout(() => !host?.matches(':focus-within') && hide(), 120)
  },
  true
)
window.addEventListener(
  'keydown',
  (e) => {
    if (!host || e.target !== field) return
    if (e.key === 'Escape') hide()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      // The list lives in a closed shadow root: reach its first option through the host we kept.
      host.dispatchEvent(new CustomEvent('solamar-focus-first'))
    } else if (e.key.length === 1 || e.key === 'Backspace') hide()
  },
  true
)
window.addEventListener('scroll', place, true)
window.addEventListener('resize', place)
