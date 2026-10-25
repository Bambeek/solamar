// Preload for web pages (not Solamar's own UI). Runs before page scripts, in every frame (nodeIntegrationInSubFrames).
import { contextBridge, ipcRenderer, webFrame } from 'electron'
import './page-passwords'
import { firefoxUserAgent, GOOGLE_SIGN_IN_HOSTS } from '@shared/util'

// Ad blocking at document start (the engine side is src/main/adblock.ts). Scriptlets have to patch the page before
// its first script, so they are fetched synchronously and run right here, in this frame's main world.
// webFrame.executeJavaScript runs immediately and, being Solamar's own code rather than the page's, is not subject to
// the page's CSP or Trusted Types (YouTube, Google), unlike eval or a <script> element. Each scriptlet gets its own
// function scope (its helpers stay off window) and its own call, so one that throws cannot stop the others.
function injectAdblockCosmetics(): void {
  let c: { styles: string; scripts: string[] } | null = null
  try {
    c = ipcRenderer.sendSync('solamar:adblock-cosmetics', { url: location.href, ancestors: Array.from(location.ancestorOrigins ?? []) })
  } catch {
    return
  }
  if (!c) return
  if (c.styles) {
    try {
      webFrame.insertCSS(c.styles, { cssOrigin: 'user' })
    } catch {
      // the frame is going away
    }
  }
  for (const s of c.scripts) webFrame.executeJavaScript(`(function () {\n${s}\n})();`).catch(() => {})
}
injectAdblockCosmetics()

// Passkeys: login pages (Meta, Google, GitHub...) ask for a passkey in the background as soon as they load
// ("conditional mediation"). Chrome answers quietly through its autofill list; Electron hands the request straight
// to Windows Hello, which pops the Windows Security dialog over the page. Report conditional mediation as
// unavailable and park any such request, so a passkey prompt only appears when the user presses a passkey button.
contextBridge.executeInMainWorld({
  func: () => {
    const PKC = (window as unknown as { PublicKeyCredential?: { isConditionalMediationAvailable?: () => Promise<boolean> } }).PublicKeyCredential
    if (PKC) PKC.isConditionalMediationAvailable = () => Promise.resolve(false)
    const creds = navigator.credentials
    if (!creds || typeof creds.get !== 'function') return
    const nativeGet = creds.get.bind(creds)
    creds.get = (options?: CredentialRequestOptions) => {
      if (options && (options as { mediation?: string }).mediation === 'conditional') {
        // Never settles unless the page aborts it, like a passkey list the user never opened.
        return new Promise<Credential | null>((_resolve, reject) => {
          const signal = options.signal
          signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')), { once: true })
        })
      }
      return nativeGet(options)
    }
  }
})

// Peek: in pinned tabs and favorites, a plain click on a link to another site opens it over the page (Arc's Peek)
// instead of leaving the app you pinned. Solamar decides; the page only learns that its click was handled.
if (window.top === window) {
  const base = (host: string) => {
    const parts = host.replace(/^www\./, '').split('.')
    // example.co.uk / example.com.pl keep three labels, example.com two
    return parts.slice(parts.length > 2 && parts[parts.length - 2].length <= 3 ? -3 : -2).join('.')
  }
  window.addEventListener('click', (e) => {
    if (!e.isTrusted || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    const a = e.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement && !!n.href)
    if (!a || a.hasAttribute('download')) return
    let url: URL
    try {
      url = new URL(a.href)
    } catch {
      return
    }
    if (!/^https?:$/.test(url.protocol) || base(url.hostname) === base(location.hostname)) return
    if (ipcRenderer.sendSync('solamar:peek-link', url.href) === true) e.preventDefault()
  })
}

// Google sign-in: the page sees the same Firefox identity the request headers carry (see firefoxUserAgent).
if (GOOGLE_SIGN_IN_HOSTS.includes(location.hostname)) {
  contextBridge.executeInMainWorld({
    func: (ua: string) => {
      const get = (v: unknown) => ({ get: () => v, configurable: true })
      Object.defineProperty(Navigator.prototype, 'userAgent', get(ua))
      Object.defineProperty(Navigator.prototype, 'appVersion', get(ua.slice('Mozilla/'.length)))
      Object.defineProperty(Navigator.prototype, 'vendor', get(''))
      Object.defineProperty(Navigator.prototype, 'userAgentData', get(undefined))
      try {
        delete (window as unknown as { chrome?: unknown }).chrome
      } catch {}
    },
    args: [firefoxUserAgent(navigator.userAgent)]
  })
}
