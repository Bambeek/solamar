// Scripts the agent runs inside a page, always in an isolated world (separate JS globals from the page),
// so a page cannot read or forge the element refs. Each builder returns source for executeJavaScriptInIsolatedWorld.

export const AGENT_WORLD = 1001

const HELPERS = `
const H = (globalThis.__solamar ||= { n: 0, map: new Map() });
const clip = (s, n) => (s || '').replace(/\\s+/g, ' ').trim().slice(0, n);
const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.02;
};
const nameOf = (el) => {
  const by = el.getAttribute('aria-labelledby');
  const labelled = by ? by.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ') : '';
  const lab = el.labels && el.labels[0] ? el.labels[0].innerText : '';
  const isBtnInput = el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type);
  return clip(el.getAttribute('aria-label') || labelled || lab || (isBtnInput ? el.value : '') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('alt') || '', 120);
};
const refOf = (el) => {
  if (!el.__solamarRef) { el.__solamarRef = 'e' + (++H.n); H.map.set(el.__solamarRef, new WeakRef(el)); }
  return el.__solamarRef;
};
const byRef = (ref) => { const w = H.map.get(ref); const el = w && w.deref(); return el && el.isConnected ? el : null; };
const info = (el) => {
  const form = el.form || el.closest('form');
  const tag = el.tagName.toLowerCase();
  const sensitive = tag === 'input' && el.type === 'password';
  return {
    ref: refOf(el), tag, type: el.getAttribute('type') || (tag === 'button' ? 'submit' : undefined),
    role: el.getAttribute('role') || undefined, name: nameOf(el),
    href: tag === 'a' ? el.href : undefined, autocomplete: el.getAttribute('autocomplete') || undefined,
    value: sensitive ? undefined : ('value' in el && typeof el.value === 'string' ? clip(el.value, 200) : undefined),
    checked: 'checked' in el ? !!el.checked : undefined, disabled: !!el.disabled,
    inForm: !!form,
    formHasPassword: !!form && !!form.querySelector('input[type=password]'),
    formHasCard: !!form && !!form.querySelector('[autocomplete^=cc-]'),
    formAction: form ? form.action : undefined
  };
};
const INTERACTIVE = 'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=menuitem],[role=option],[role=switch],[role=textbox],[role=combobox],[contenteditable=""],[contenteditable=true],[tabindex]:not([tabindex="-1"])';
`

const wrap = (body: string) => `(() => { ${HELPERS}\n${body} })()`

export function snapshotJs(max = 250): string {
  return wrap(`
    const els = [...document.querySelectorAll(INTERACTIVE)].filter(visible).slice(0, ${max});
    return { url: location.href, title: document.title, elements: els.map(info) };
  `)
}

export function readJs(maxChars = 20000): string {
  return wrap(`
    const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, ${maxChars});
    const links = [...document.querySelectorAll('a[href]')].filter(visible).slice(0, 80).map((a) => ({ text: clip(a.innerText, 80), href: a.href }));
    return { url: location.href, title: document.title, text, links };
  `)
}

export function elementJs(ref: string): string {
  return wrap(`const el = byRef(${JSON.stringify(ref)}); return el ? info(el) : null;`)
}

export function focusedJs(): string {
  return wrap(`const el = document.activeElement; return el && el !== document.body ? info(el) : null;`)
}

export function clickJs(ref: string): string {
  return wrap(`
    const el = byRef(${JSON.stringify(ref)});
    if (!el) return { ok: false, error: 'element not found; take a new snapshot' };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.focus({ preventScroll: true });
    el.click();
    return { ok: true };
  `)
}

export function typeJs(ref: string, text: string): string {
  return wrap(`
    const el = byRef(${JSON.stringify(ref)});
    if (!el) return { ok: false, error: 'element not found; take a new snapshot' };
    el.scrollIntoView({ block: 'center' });
    el.focus();
    const text = ${JSON.stringify(text)};
    if (el.isContentEditable) {
      document.execCommand('selectAll', false);
      document.execCommand('insertText', false, text);
    } else if ('value' in el) {
      // Native setter so frameworks that track value (React, Vue) see the change.
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    } else return { ok: false, error: 'element does not take text' };
    return { ok: true };
  `)
}

export function submitJs(ref: string): string {
  return wrap(`
    const el = byRef(${JSON.stringify(ref)});
    const form = el && (el.form || el.closest('form'));
    if (!form) return { ok: false, error: 'no form to submit' };
    form.requestSubmit ? form.requestSubmit() : form.submit();
    return { ok: true };
  `)
}

export function scrollJs(direction: 'up' | 'down', amount: number): string {
  return wrap(`window.scrollBy({ top: ${direction === 'up' ? -1 : 1} * ${Math.max(1, Math.min(10, amount))} * innerHeight * 0.8 }); return { ok: true, y: scrollY };`)
}

export function hasTextJs(text: string): string {
  return wrap(`return !!document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())});`)
}

// ---------- Write with AI ----------

export interface FieldInfo {
  ref: string
  kind: 'input' | 'textarea' | 'editable'
  name: string
  value: string
  start: number
  end: number
  selected: string
  sensitive: boolean
}

/** The focused text field (or the one the user right-clicked: the last focused editable). */
export function fieldJs(maxChars = 20000): string {
  return wrap(`
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (el && el.isContentEditable) el = el.closest('[contenteditable]:not([contenteditable=false])') || el;
    const textInput = el && el.tagName === 'INPUT' && ['text', 'search', 'email', 'url', 'tel', 'password', ''].includes(el.type || '');
    const kind = !el ? null : el.tagName === 'TEXTAREA' ? 'textarea' : textInput ? 'input' : el.isContentEditable ? 'editable' : null;
    if (!kind) return null;
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const sensitive = el.type === 'password' || /(password|one-time-code|cc-)/.test(ac);
    let value, start = 0, end = 0, selected = '';
    if (kind === 'editable') {
      value = el.innerText;
      const sel = getSelection();
      if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
        selected = sel.toString();
        H.writeRange = sel.getRangeAt(0).cloneRange();
      } else H.writeRange = null;
    } else {
      value = el.value; start = el.selectionStart ?? 0; end = el.selectionEnd ?? 0; selected = value.slice(start, end);
    }
    return { ref: refOf(el), kind, name: nameOf(el), value: sensitive ? '' : value.slice(0, ${maxChars}), start, end, selected: sensitive ? '' : selected, sensitive };
  `)
}

/** Writes text back, replacing the selection (if there was one) or everything. Uses insertText so Ctrl+Z undoes it. */
export function applyFieldJs(ref: string, text: string, replaceSelection: boolean, start: number, end: number): string {
  return wrap(`
    const el = byRef(${JSON.stringify(ref)});
    if (!el) return { ok: false, error: 'The field is gone (the page changed).' };
    const text = ${JSON.stringify(text)};
    el.focus();
    if (el.isContentEditable) {
      const sel = getSelection();
      sel.removeAllRanges();
      if (${replaceSelection} && H.writeRange) sel.addRange(H.writeRange);
      else { const r = document.createRange(); r.selectNodeContents(el); sel.addRange(r); }
      if (!document.execCommand('insertText', false, text)) return { ok: false, error: 'This field did not accept the text.' };
      return { ok: true };
    }
    if (${replaceSelection}) el.setSelectionRange(${start}, ${end}); else el.select();
    if (!document.execCommand('insertText', false, text)) {
      const v = ${replaceSelection} ? el.value.slice(0, ${start}) + text + el.value.slice(${end}) : text;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  `)
}
