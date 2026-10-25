// Optional local AI through Ollama's HTTP API. Only talks to the configured host, which defaults to this PC.

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Only loopback hosts are accepted, so page text never leaves the machine. */
export function isLocalHost(host: string): boolean {
  try {
    const u = new URL(host)
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(u.hostname)
  } catch {
    return false
  }
}

export async function ollamaModels(host: string): Promise<string[]> {
  if (!isLocalHost(host)) throw new Error('Local AI only talks to this computer (127.0.0.1 or localhost).')
  const res = await fetch(new URL('/api/tags', host), { signal: AbortSignal.timeout(2500) })
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`)
  const body = (await res.json()) as { models?: { name: string }[] }
  return (body.models ?? []).map((m) => m.name)
}

/** Streams the assistant reply. `json` asks Ollama for a JSON-only answer. */
export async function* ollamaChat(
  host: string,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
  json = false
): AsyncGenerator<string> {
  if (!isLocalHost(host)) throw new Error('Local AI only talks to this computer (127.0.0.1 or localhost).')
  const res = await fetch(new URL('/api/chat', host), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true, ...(json ? { format: 'json' } : {}) }),
    signal
  })
  if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}: ${await res.text().catch(() => '')}`.trim())
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean }
      if (msg.error) throw new Error(msg.error)
      if (msg.message?.content) yield msg.message.content
    }
  }
}

export const PAGE_TEXT_LIMIT = 12_000

export function summarizePrompt(title: string, url: string, text: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You summarize web pages for the person reading them. Answer in the language of the page. ' +
        'Give a one-sentence gist, then 3 to 6 short bullet points with the key facts. No preamble.'
    },
    { role: 'user', content: `Page: ${title}\nURL: ${url}\n\n${text}` }
  ]
}

export function askPrompt(title: string, url: string, text: string, history: ChatMessage[], question: string): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'You answer questions about the web page below. Use only the page text; say so when the page does not contain the answer. ' +
        'Be brief. Answer in the language of the question.\n\n' +
        `Page: ${title}\nURL: ${url}\n\n${text}`
    },
    ...history.filter((m) => m.role !== 'system'),
    { role: 'user', content: question }
  ]
}

export function tidyPrompt(tabs: { n: number; title: string; host: string }[]): ChatMessage[] {
  return [
    {
      role: 'system',
      content:
        'Group browser tabs into 2 to 6 folders by topic. Reply with JSON only, shaped ' +
        '{"groups":[{"title":"short folder name","tabs":[tab numbers]}]}. Every tab number at most once; leave out tabs that fit nowhere.'
    },
    { role: 'user', content: tabs.map((t) => `${t.n}. ${t.title} (${t.host})`).join('\n') }
  ]
}

/** Parses the tidy answer defensively: numbers that do not exist or repeat are dropped. */
export function parseTidy(answer: string, count: number): { title: string; tabs: number[] }[] {
  let data: any
  try {
    data = JSON.parse(answer)
  } catch {
    const m = answer.match(/\{[\s\S]*\}/)
    if (!m) return []
    try {
      data = JSON.parse(m[0])
    } catch {
      return []
    }
  }
  const used = new Set<number>()
  const groups: { title: string; tabs: number[] }[] = []
  for (const g of Array.isArray(data?.groups) ? data.groups : []) {
    const title = typeof g?.title === 'string' ? g.title.trim().slice(0, 40) : ''
    const tabs: number[] = []
    for (const raw of Array.isArray(g?.tabs) ? g.tabs : []) {
      const n = Number(raw)
      if (Number.isInteger(n) && n >= 1 && n <= count && !used.has(n)) {
        used.add(n)
        tabs.push(n)
      }
    }
    if (title && tabs.length) groups.push({ title, tabs })
  }
  return groups
}
