import { Fragment, type ReactNode } from 'react'
import { call } from './api'

// Just enough Markdown for AI replies: paragraphs, line breaks, - and 1. lists, # headings, **bold**, *italic*, `code`
// and [links](https://...). It builds React elements, never an HTML string, so text from a model (or from the page it
// read) cannot add markup. Links open in a new tab.

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|(?<![\w*])\*[^*\n]+\*(?![\w*])|(?<![\w_])_[^_\n]+_(?![\w_]))/

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part
    if (part.startsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    if (part.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part) ?? []
      return (
        <a key={i} href={href} onClick={(e) => (e.preventDefault(), call('openTab', href))}>
          {label}
        </a>
      )
    }
    return <em key={i}>{part.slice(1, -1)}</em>
  })
}

const withBreaks = (lines: string[]) => lines.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)

export function Markdown({ text }: { text: string }) {
  const out: ReactNode[] = []
  const lines = text.replace(/\r/g, '').split('\n')
  let para: string[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{withBreaks(para)}</p>)
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
      out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>)
    }
    para = []
    list = null
  }
  for (const raw of lines) {
    const line = raw.trimEnd()
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line)
    if (!line.trim()) flush()
    else if (item) {
      const ordered = !item[1]
      if (para.length || (list && list.ordered !== ordered)) flush()
      list ??= { ordered, items: [] }
      list.items.push(item[3])
    } else if (/^#{1,6}\s/.test(line)) {
      flush()
      out.push(<p key={out.length} className="md-h"><strong>{inline(line.replace(/^#+\s*/, ''))}</strong></p>)
    } else {
      if (list) flush()
      para.push(line)
    }
  }
  flush()
  return <div className="md">{out}</div>
}
