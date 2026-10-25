// Screenshots of the real app for the landing page, from hidden windows with throwaway profiles and local test
// pages (no real sites, no personal data). Writes every view of the window as a layer plus a JSON per shot;
// site/shots.py stacks them into site/assets/*.webp.
// Usage: npx electron-vite build && node site/screens-app.mjs <scratch dir>  then  python site/shots.py <scratch dir>/layers
import { mkdirSync, readFile, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const scratch = resolve(process.argv[2] ?? 'site-shots')
const out = join(scratch, 'layers')
mkdirSync(out, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- local pages ----------
// Made-up sites with our own comic art (served from site/assets/comic at /art/), so the shots look like a real day.
const icon = (color, letter) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='${color}'/><text x='16' y='22' font-family='Segoe UI,Arial' font-size='18' font-weight='700' fill='white' text-anchor='middle'>${letter}</text></svg>`)}`
const doc = (title, color, letter, css, body) =>
  `<!doctype html><meta charset=utf-8><link rel=icon href="${icon(color, letter)}"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;font:15px/1.55 'Segoe UI',system-ui,sans-serif;color:#1d1b26;background:#fff}img{display:block;max-width:100%}${css}</style>${body}`
let port = 0
// *.test names (reserved for testing) resolve to this local server, so the address field shows real-looking hosts.
const at = (host, path = '/') => `http://${host}:${port}${path}`

const videoCss = `body{background:#111216;color:#eef}nav{display:flex;align-items:center;gap:14px;padding:12px 24px;border-bottom:1px solid #23252d}nav b{font-size:19px;color:#ff5a4f}nav span{flex:1;max-width:520px;margin:0 auto;height:34px;border-radius:999px;background:#1c1e25;border:1px solid #2b2e38}.wrap{display:grid;grid-template-columns:1fr 330px;gap:22px;padding:20px 24px}.player{position:relative;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000}.player img{width:100%;height:100%;object-fit:cover}.player i{position:absolute;inset:auto auto 18px 18px;width:58px;height:58px;border-radius:50%;background:rgba(255,255,255,.92)}.player i::after{content:'';position:absolute;left:23px;top:18px;border-left:18px solid #111;border-top:11px solid transparent;border-bottom:11px solid transparent}.bar{position:absolute;left:0;right:0;bottom:0;height:4px;background:rgba(255,255,255,.25)}.bar::before{content:'';position:absolute;inset:0 62% 0 0;background:#ff5a4f}h1{font-size:21px;margin:14px 0 6px}.ch{display:flex;align-items:center;gap:10px;color:#aab}.ch u{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#ff8a4c,#7c6cf2)}.ch b{color:#eef}.rec{display:grid;gap:12px;align-content:start}.rec div{display:grid;grid-template-columns:150px 1fr;gap:10px;font-size:13.5px;color:#aab}.rec img{aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:#222}.rec b{display:block;color:#eef;font-size:14px;line-height:1.3;margin-bottom:4px}`
const video = (title, art, channel, views) =>
  doc(title, '#ff5a4f', 'V', videoCss, `<nav><b>Clips</b><span></span></nav><div class=wrap><div><div class=player><img src="/art/${art}"><i></i><div class=bar></div></div><h1>${title}</h1><div class=ch><u></u><div><b>${channel}</b><br>${views}</div></div></div><div class=rec>
    <div><img src="/art/bg-evening.webp"><span><b>Harbour sunset, 3 hours of calm</b>Slow Waves · 410k views</span></div>
    <div><img src="/art/bg-morning.webp"><span><b>Morning focus mix for deep work</b>Desk Radio · 1.1M views</span></div>
    <div><img src="/art/card-zap.webp"><span><b>Why popups are everywhere, and how to stop them</b>Web Explained · 88k views</span></div>
    <div><img src="/art/card-agent.webp"><span><b>Let an AI fill in boring forms for you</b>Tiny Tools · 203k views</span></div></div></div>`)

// An ordinary text page for the window in the site's hero: it should read as a browser with a web page in it.
const blogCss = `body{background:#fbfaf7}header{display:flex;align-items:center;gap:26px;padding:14px 48px;border-bottom:1px solid #e7e3da;background:#fff}header b{font:700 21px/1 Georgia,serif;letter-spacing:-.01em}header span{color:#6b6760;font-size:14px}header i{flex:1}header u{text-decoration:none;font-size:13px;font-weight:600;border:1px solid #d9d4c8;border-radius:999px;padding:6px 14px}.page{display:grid;grid-template-columns:minmax(0,680px) 240px;gap:56px;justify-content:center;padding:34px 48px}.kicker{color:#b4541a;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase}h1{font:700 40px/1.12 Georgia,serif;margin:8px 0 12px;letter-spacing:-.015em}.by{color:#6b6760;font-size:14px;margin-bottom:22px}.fig{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;padding:18px;border:1px solid #e7e3da;border-radius:14px;background:#fff;margin:0 0 8px}.fig div{border:2px dashed #c9c2b3;border-radius:10px;padding:12px;font-size:13px;color:#5d5952}.fig b{display:block;font-size:14px;color:#1d1b26;margin-bottom:6px}.fig em{display:block;height:46px;border-radius:7px;margin-top:8px;background:linear-gradient(135deg,#e9e4d8,#f6f2ea)}.cap{font-size:13px;color:#6b6760;margin:0 0 20px}p{font-size:17px;line-height:1.7;color:#2b2925;margin:0 0 16px}h2{font:700 24px/1.25 Georgia,serif;margin:26px 0 10px}pre{background:#1f2430;color:#e6e1d6;border-radius:10px;padding:14px 16px;font:13px/1.6 Consolas,monospace;overflow:hidden}aside{font-size:14px;color:#4a4740}aside h4{margin:4px 0 10px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#8a857b}aside a{display:block;padding:6px 0 6px 12px;border-left:2px solid #e7e3da;color:#4a4740;text-decoration:none}aside a.on{border-color:#b4541a;color:#1d1b26;font-weight:600}aside .rel{margin-top:30px}aside .rel div{padding:10px 0;border-top:1px solid #ece8df}`
const blog = doc('How your browser keeps every site in its own box', '#b4541a', 'F', blogCss, `<header><b>Field Notes</b><span>Web</span><span>Security</span><span>Tools</span><i></i><u>Subscribe</u></header><div class=page><article><div class=kicker>How it works</div><h1>How your browser keeps every site in its own box</h1><div class=by>Maya Chen · October 24 · 6 min read</div>
  <div class=fig><div><b>news.test</b>Its own process<em></em></div><div><b>mail.test</b>Its own process<em></em></div><div><b>bank.test</b>Its own process<em></em></div></div><p class=cap>Each site runs in a separate, sandboxed process. One tab cannot read another's memory.</p>
  <p>Open a news site, your mail and your bank in three tabs, and it feels like one program. Underneath, the browser has started a separate process for each site and walled it off from the others and from your files.</p>
  <h2>Why one process per site</h2><p>A page that crashes, or a script that misbehaves, takes down only its own process. The rest of your tabs keep working, and nothing it does can reach the data of a site in another tab.</p>
  <pre>// what the browser checks before a frame can touch another
if (frame.site !== target.site) block('cross-site access')</pre></article>
  <aside><h4>On this page</h4><a class=on>One process per site</a><a>The sandbox</a><a>What extensions can see</a><a>Keeping it fast</a><div class=rel><h4>Related</h4><div>Why your tabs fall asleep</div><div>Cookies, explained in five minutes</div><div>What "private" really means</div></div></aside></div>`)

const newsCss = `header{padding:18px 40px 10px;border-bottom:3px solid #1d1b26;display:flex;align-items:baseline;gap:16px}header b{font:700 30px/1 Georgia,serif}header span{color:#777;font-size:13px}.hero{position:relative;margin:22px 40px 0;border-radius:16px;overflow:hidden}.hero img{width:100%;height:270px;object-fit:cover}.hero::after{content:'';position:absolute;inset:35% 0 0;background:linear-gradient(transparent,rgba(10,14,24,.78))}.hero h1{z-index:1;position:absolute;left:24px;right:24px;bottom:18px;margin:0;color:#fff;font:700 30px/1.15 Georgia,serif;text-shadow:0 2px 12px rgba(0,0,0,.6)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;padding:22px 40px}.grid img{height:120px;width:100%;object-fit:contain;background:#f4efe4;border-radius:12px}.grid h3{font:700 17px/1.3 Georgia,serif;margin:10px 0 4px}.grid p{margin:0;color:#555;font-size:14px}`
const news = doc('Morning brief', '#f5a524', 'N', newsCss, `<header><b>The Morning Brief</b><span>Saturday, October 24</span></header><div class=hero><img src="/art/bg-day.webp"><h1>Harbour towns are getting their old ferries back</h1></div><div class=grid>
  <div><img src="/art/lighthouse.webp"><h3>The last lighthouse keeper retires</h3><p>Forty years of night shifts, told in one long walk.</p></div>
  <div><img src="/art/crane.webp"><h3>Ports switch to quieter electric cranes</h3><p>Neighbours say they can finally sleep with the windows open.</p></div>
  <div><img src="/art/boxes.webp"><h3>How to move house without losing a box</h3><p>A simple list that actually works.</p></div></div>`)

const docsCss = `header{background:#12a5b0;color:#fff;padding:18px 44px;font-size:20px;font-weight:600}main{max-width:820px;padding:22px 44px}#banner{display:flex;align-items:center;gap:12px;background:#fff3c4;border:1px solid #f5d76e;padding:14px 18px;border-radius:12px;margin:0 0 20px;font-weight:600}#banner u{margin-left:auto;text-decoration:none;background:#1d1b26;color:#fff;padding:6px 12px;border-radius:8px;font-size:13px}h1{font-size:28px;margin:0 0 8px}p{color:#3a3746;margin:0 0 14px}.row{display:grid;grid-template-columns:1fr 160px;gap:20px;align-items:center}ul{margin:0;padding-left:20px;color:#3a3746}li{margin:4px 0}`
const docsPage = doc('Design notes', '#12a5b0', 'D', docsCss, `<header>Design notes</header><main><div id=banner>Subscribe to our newsletter for weekly design tips!<u>Subscribe</u></div><h1>Top bar, titled tabs, spaces as pills</h1><div class=row><div><p>Every tab keeps its title and its own close button, so three videos from one site are three different tabs. Spaces sit in the top bar, each with its own colour.</p><ul><li>Drag a tab onto the pins to keep it</li><li>Fold a folder into a group</li><li>Hide the row with Ctrl+S when you need room</li></ul></div><img src="/art/compass.webp"></div></main>`)

const codeCss = `header{background:#24292f;color:#fff;padding:16px 36px;font-size:18px}header b{font-weight:600}main{padding:20px 36px;max-width:900px}.tabs{display:flex;gap:18px;border-bottom:1px solid #e1e4e8;padding-bottom:10px;margin-bottom:12px;color:#57606a}.tabs b{color:#1d1b26;border-bottom:2px solid #fd8c73;padding-bottom:9px}.pr{display:flex;gap:12px;align-items:flex-start;padding:12px 4px;border-bottom:1px solid #eef0f2}.pr i{width:16px;height:16px;border-radius:50%;border:3px solid #1a7f37;margin-top:3px;flex:none}.pr b{display:block;font-weight:600}.pr span{color:#57606a;font-size:13px}.lb{display:inline-block;font-size:12px;padding:1px 8px;border-radius:999px;margin-left:6px;color:#fff}`
const codePage = doc('solamar / pull requests', '#24292f', 'H', codeCss, `<header><b>solamar</b> / pull requests</header><main><div class=tabs><b>6 Open</b><span>48 Closed</span></div>
  <div class=pr><i></i><div><b>Settings: sections with art, the gull, search and switches <span class=lb style="background:#7c6cf2">design</span></b><span>#142 opened 2 hours ago</span></div></div>
  <div class=pr><i></i><div><b>Page agent keeps the conversation across requests <span class=lb style="background:#0e8a7e">ai</span></b><span>#141 opened 5 hours ago</span></div></div>
  <div class=pr><i></i><div><b>macOS build next to Windows <span class=lb style="background:#ff8a4c">build</span></b><span>#140 opened yesterday</span></div></div>
  <div class=pr><i></i><div><b>Ads allowed on a site really stop network blocking</b><span>#139 opened yesterday</span></div></div></main>`)

const mailCss = `.app{display:grid;grid-template-columns:200px 1fr;min-height:100vh}aside{background:#f3f5fb;padding:20px 14px;display:grid;align-content:start;gap:4px;color:#45506a}aside b{display:block;background:#3e63dd;color:#fff;border-radius:12px;padding:10px 14px;margin-bottom:12px}aside span{padding:6px 12px;border-radius:8px}aside span:first-of-type{background:#dfe6fb;color:#1d1b26;font-weight:600}.row{display:grid;grid-template-columns:170px 1fr 70px;gap:14px;padding:12px 22px;border-bottom:1px solid #eef0f5}.row b{font-weight:600}.row em{font-style:normal;color:#6a7086}.row.unread{background:#fbfcff}`
const mail = doc('Inbox (12)', '#3e63dd', 'M', mailCss, `<div class=app><aside><b>Compose</b><span>Inbox 12</span><span>Starred</span><span>Sent</span><span>Drafts</span></aside><div>
  <div class="row unread"><b>Anna Kowalska</b><span><b>Design review on Friday?</b> <em>Are you free at 6 for the review…</em></span><em>10:42</em></div>
  <div class="row unread"><b>Ferry Line</b><span><b>Your tickets for Saturday</b> <em>Boarding starts 30 minutes before…</em></span><em>09:15</em></div>
  <div class=row><b>Tom</b><span>Weekend plans <em>Lisbon or the coast? I found a cheap…</em></span><em>Fri</em></div>
  <div class=row><b>Desk Radio</b><span>New mix is live <em>Three hours of calm for deep work…</em></span><em>Thu</em></div>
  <div class=row><b>Bank</b><span>Your statement is ready <em>The statement for October is available…</em></span><em>Wed</em></div></div></div>`)

const tripsCss = `.top{position:relative;height:230px}.top img{width:100%;height:100%;object-fit:cover}.top h1{position:absolute;left:44px;bottom:18px;margin:0;color:#fff;font-size:32px;text-shadow:0 2px 10px rgba(0,0,0,.5)}main{display:grid;grid-template-columns:360px 1fr;gap:30px;padding:24px 44px}.card{border:1px solid #e3e0ec;border-radius:14px;padding:18px}label{display:block;margin:10px 0 4px;font-weight:600;font-size:14px}input{font:inherit;padding:9px 11px;border:1px solid #c9c6d6;border-radius:9px;width:100%}button{font:inherit;font-weight:600;padding:10px 18px;border-radius:9px;border:0;background:#8e4ec6;color:#fff;margin-top:14px}.ideas{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;align-content:start}.ideas div{background:#f6f2fb;border-radius:12px;padding:12px}.ideas b{display:block}`
const trips = doc('Trip planner', '#8e4ec6', 'T', tripsCss, `<div class=top><img src="/art/bg-morning.webp"><h1>Plan a weekend by the sea</h1></div><main><div class=card><label for=name>Name</label><input id=name name=name><label for=city>City</label><input id=city name=city><button>Find trips</button></div><div class=ideas><div><b>Lisbon</b>Trams, tiles and the river</div><div><b>Porto</b>Bridges and port cellars</div><div><b>Gdańsk</b>Old town by the Baltic</div><div><b>Split</b>Ferries to the islands</div></div></main>`)

const loginCss = `body{display:grid;place-items:center;min-height:100vh;background:#f2f7f3}form{background:#fff;padding:26px;border-radius:16px;box-shadow:0 10px 30px rgba(0,0,0,.08);width:340px}label{display:block;margin:10px 0 4px}input{font:inherit;padding:9px 11px;border:1px solid #c9c6d6;border-radius:9px;width:100%}button{font:inherit;padding:10px 16px;border-radius:9px;border:0;background:#30a46c;color:#fff;margin-top:14px;width:100%}`
const chatCss = `main{max-width:560px;margin:0 auto;padding:24px}.msg{background:#f2f1f7;border-radius:14px;padding:10px 14px;margin:8px 0;max-width:420px}label{display:block;margin:14px 0 4px;font-weight:600}textarea{font:inherit;padding:9px 11px;border:1px solid #c9c6d6;border-radius:10px;width:100%}`

const pages = () => ({
  'mail.test/': mail,
  'code.test/': codePage,
  'video.test/lofi': video('Lo-fi beats to code to', 'bg-night.webp', 'Desk Radio', 'Live · 12k watching'),
  'video.test/electron': video('How Electron works, in 18 minutes', 'card-tabs.webp', 'Tiny Tools', '1.2M views · 3 weeks ago'),
  'video.test/synthwave': video('Synthwave mix 2026', 'bg-evening.webp', 'Night Drive', '640k views · 2 months ago'),
  'docs.test/': docsPage,
  'blog.test/': blog,
  'news.test/': news,
  'trips.test/': trips,
  'acme.test/login': doc('Sign in · Acme', '#30a46c', 'A', loginCss, '<form method=post action=/welcome><h2 style="margin:0 0 6px">Sign in to Acme</h2><label for=email>Email</label><input id=email type=email autocomplete=username><label for=pw>Password</label><input id=pw type=password><button id=go>Sign in</button></form>'),
  'acme.test/welcome': doc('Acme dashboard', '#30a46c', 'A', '', '<p style="padding:30px">Welcome back.</p>'),
  'chat.test/': doc('Messages · Anna', '#3e63dd', 'C', chatCss, '<main><h2>Anna</h2><div class=msg>Hey! Are you free on Friday at 6 for the design review?</div><div class=msg>We could do it over coffee.</div><label for=reply>Reply</label><textarea id=reply rows=3></textarea></main>')
})
const artDir = join(process.cwd(), 'site', 'assets', 'comic')
const site = createServer((q, r) => {
  const path = q.url.split('?')[0]
  if (path.startsWith('/art/')) {
    const f = join(artDir, path.slice(5).replace(/[^\w.-]/g, ''))
    return readFile(f, (err, data) => (err ? r.writeHead(404).end() : r.writeHead(200, { 'content-type': 'image/webp' }).end(data)))
  }
  r.writeHead(200, { 'content-type': 'text/html' })
  const key = String(q.headers.host).split(':')[0] + path
  r.end(pages()[key] ?? doc('Page', '#7c6cf2', 'P', '', ''))
})
await new Promise((r) => site.listen(0, '127.0.0.1', r))
port = site.address().port

// ---------- a stand-in for the Claude API: one page agent run and one reply draft ----------
const sse = (res, model, blocks, stop) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`)
  send('message_start', { message: { id: 'msg', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } })
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      send('content_block_start', { index, content_block: { type: 'text', text: '' } })
      send('content_block_delta', { index, delta: { type: 'text_delta', text: b.text } })
    } else {
      send('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } })
      send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } })
    }
    send('content_block_stop', { index })
  })
  send('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } })
  send('message_stop', {})
  res.end()
}
const api = createServer((req, res) => {
  let body = ''
  req.on('data', (d) => (body += d))
  req.on('end', () => {
    if (req.url.startsWith('/v1/models')) return res.writeHead(200, { 'content-type': 'application/json' }), res.end('{"data":[],"has_more":false}')
    const b = JSON.parse(body)
    const sys = JSON.stringify(b.system ?? '') + JSON.stringify(b.messages[0]?.content ?? '')
    if (!b.tools && /search query/i.test(sys)) return sse(res, b.model, [{ type: 'text', text: 'weekend trips from Berlin by train' }], 'end_turn')
    if (!b.tools) return sse(res, b.model, [{ type: 'text', text: 'Friday at 6 works for me! Coffee sounds great, see you at the usual place.' }], 'end_turn')
    const tab = /tab "([^"]+)"/.exec(b.system)?.[1]
    const last = b.messages[b.messages.length - 1]
    const results = Array.isArray(last.content) ? last.content.filter((c) => c.type === 'tool_result') : []
    const text = results.map((r) => (Array.isArray(r.content) ? r.content.map((c) => c.text ?? '').join('') : '')).join('')
    if (!results.length) return sse(res, b.model, [{ type: 'text', text: 'Reading the form.' }, { type: 'tool_use', id: 't1', name: 'page_snapshot', input: { tab } }], 'tool_use')
    if (results[0].tool_use_id === 't1') {
      const name = /\[(e\d+)\] input:text "Name"/.exec(text)?.[1]
      return sse(res, b.model, [{ type: 'text', text: 'Filling in your name.' }, { type: 'tool_use', id: 't2', name: 'type', input: { tab, ref: name, text: 'Ada Lovelace' } }], 'tool_use')
    }
    if (results[0].tool_use_id === 't2') {
      const city = /\[(e\d+)\] input:text "City"/.exec(text)?.[1] ?? /\[(e\d+)\][^\n]*City/.exec(text)?.[1]
      return sse(res, b.model, [{ type: 'text', text: 'And the city.' }, { type: 'tool_use', id: 't3', name: 'page_snapshot', input: { tab } }], 'tool_use')
    }
    if (results[0].tool_use_id === 't3') {
      const city = /\[(e\d+)\] input:text "City"/.exec(text)?.[1]
      return sse(res, b.model, [{ type: 'tool_use', id: 't4', name: 'type', input: { tab, ref: city, text: 'Lisbon' } }], 'tool_use')
    }
    return sse(res, b.model, [{ type: 'text', text: 'Done: Name is Ada Lovelace and City is Lisbon. I did not submit the form, so you can check it first.' }], 'end_turn')
  })
})
await new Promise((r) => api.listen(0, '127.0.0.1', r))

// ---------- helpers ----------
const still = (w) => w.addStyleTag({ content: '*, :root { transition: none !important; animation: none !important; }' }).catch(() => {})
async function launch(dir, extraEnv = {}) {
  const app = await electron.launch({
    // Twice the pixels, so the shots stay sharp on high-density screens; shots.py scales the layer positions to match.
    args: ['.', '--mute-audio', '--force-device-scale-factor=2', '--host-resolver-rules=MAP *.test 127.0.0.1'],
    env: { ...process.env, SOLAMAR_HIDDEN: '1', SOLAMAR_USER_DATA: join(scratch, dir), SOLAMAR_ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.address().port}`, ...extraEnv }
  })
  const win = async (pred) => {
    for (let i = 0; i < 150; i++) {
      const w = app.windows().find(pred)
      if (w) return w
      await sleep(200)
    }
    throw new Error('no window')
  }
  const ui = await win((w) => w.url().endsWith('#ui'))
  await ui.waitForLoadState('domcontentloaded')
  const ov = await win((w) => w.url().endsWith('#overlay'))
  await still(ui)
  await still(ov)
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1280, height: 760 }))
  const call = (m, ...a) => ui.evaluate(([m, a]) => window.solamar.call(m, ...a), [m, a])
  const capture = async (name, crop) => {
    await sleep(500)
    // Hidden or zero-size views (a sleeping tab, a peek that just became a split) are skipped: they cannot be shot.
    const views = (await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].contentView.children.map((c) => ({ url: c.webContents.getURL(), b: c.getBounds(), shown: c.getVisible ? c.getVisible() : true })))).filter((v) => v.shown && v.b.width > 0 && v.b.height > 0)
    const layers = []
    for (const [i, v] of views.entries()) {
      // Two pages can share a URL (a peek that became a split keeps the old target around): try each.
      const overlay = v.url.endsWith('#overlay')
      const file = `${name}-${i}.png`
      let shot = false
      for (const w of app.windows().filter((p) => p.url() === v.url).reverse()) {
        try {
          await w.screenshot({ path: join(out, file), omitBackground: overlay, timeout: 6000 })
          shot = true
          break
        } catch {}
      }
      if (!shot) {
        console.log('  skipped a view that would not paint:', v.url)
        continue
      }
      layers.push({ file, x: v.b.x, y: v.b.y, radius: v.url.includes('#') && !v.url.startsWith('http') ? 0 : 10 })
    }
    writeFileSync(join(out, `${name}.json`), JSON.stringify({ name, win: [1280, 760], layers, ...(crop ? { crop } : {}) }))
    console.log('shot', name)
  }
  const boxIn = async (w, sel, pad = 0, dy = 0) => {
    const b = await w.locator(sel).first().boundingBox()
    return [Math.max(0, Math.round(b.x - pad)), Math.max(0, Math.round(b.y + dy - pad)), Math.round(b.width + pad * 2), Math.round(b.height + pad * 2)]
  }
  return { app, ui, ov, win, call, capture, boxIn }
}

// ---------- main profile ----------
{
  const { app, ui, ov, win, call, capture, boxIn } = await launch('main', {})
  await call('updateSettings', { onboarded: true, layout: 'bar', ai: { enabled: true, engine: 'anthropic', features: {} }, agent: { mcpEnabled: true, port: 47990 } })
  await call('setAnthropicKey', 'sk-ant-test-local-mock')
  let s = await call('state')
  const personal = s.spaces[0]
  await call('updateSpace', personal.id, { theme: { ...personal.theme, color: '#7c6cf2', mode: 'dark' } })
  await call('createSpace', { title: 'Work', icon: 'briefcase', theme: { color: '#3e63dd', mode: 'dark', texture: 'none', intensity: 0.7 } })
  await call('createSpace', { title: 'Side project', icon: 'code', theme: { color: '#12a5b0', mode: 'dark', texture: 'none', intensity: 0.7 } })
  await call('switchSpace', personal.id)
  const urls = { news: at('news.test'), docs: at('docs.test'), synth: at('video.test', '/synthwave'), lofi: at('video.test', '/lofi'), electron: at('video.test', '/electron'), blog: at('blog.test'), code: at('code.test'), mail: at('mail.test') }
  for (const k of ['news', 'docs', 'synth', 'lofi', 'electron', 'blog', 'code', 'mail']) await call('openTab', urls[k])
  s = await call('state')
  const by = (k) => s.items.find((i) => i.url === urls[k])
  await call('moveItem', by('mail').id, { section: 'favorites', parentId: null, index: 0 })
  await call('activate', by('code').id)
  await call('run', 'pinTab')
  const group = await call('createFolder', 'today', null)
  await call('rename', group, 'Reading')
  await call('moveItem', by('news').id, { section: 'today', parentId: group, index: 0 })
  await call('moveItem', by('docs').id, { section: 'today', parentId: group, index: 1 })
  // The hero's window shows an ordinary article; the shots after it go back to the video tab.
  await call('activate', by('blog').id)
  await sleep(1500)

  await capture('window-dark')
  await call('updateSpace', personal.id, { theme: { ...personal.theme, color: '#7c6cf2', mode: 'light' } })
  await sleep(600)
  await capture('window-light')
  await call('updateSpace', personal.id, { theme: { ...personal.theme, color: '#7c6cf2', mode: 'dark' } })
  await call('activate', by('electron').id)
  await sleep(400)

  // The classic Arc-style sidebar, one setting away
  await call('updateSettings', { layout: 'sidebar' })
  await sleep(1200)
  await capture('tour-sidebar')
  await call('updateSettings', { layout: 'bar' })
  await sleep(900)

  // Peek from the pinned tab
  await call('activate', by('code').id)
  await sleep(500)
  await call('openPeek', at('news.test') + '?peek')
  await win((w) => w.url() === at('news.test') + '?peek')
  await sleep(1200)
  await capture('peek')
  await call('closeOverlay')

  // Boost: warm colours, serif font, the newsletter banner zapped
  await call('activate', by('docs').id)
  await sleep(600)
  await call('openBoost')
  for (let i = 0; i < 40 && !(s = await call('state')).boostEditor; i++) await sleep(100)
  await call('updateBoost', s.boostEditor.id, { filter: 'sepia', font: 'serif', zaps: ['#banner'] })
  await sleep(1200)
  await capture('boost')
  await call('closeBoost')
  await sleep(400)

  // Command bar with AI
  await call('openOverlay', 'command', { mode: 'new' })
  await sleep(300)
  await ov.locator('input').first().fill('what is a good weekend trip from berlin')
  await sleep(900)
  await capture('command', await boxIn(ov, '.dialog, .command, [role=dialog]', 14))
  await capture('tour-command')
  await call('closeOverlay')

  // Split view: a video next to the tab after it in the row (the Reading group's news page)
  await call('activate', by('synth').id)
  await sleep(500)
  await call('run', 'splitView')
  await sleep(1400)
  console.log('  split:', (await call('state')).window.split.length, 'tabs')
  await capture('tour-split')
  await call('unsplit')
  await sleep(600)

  // Settings > Appearance
  await call('openOverlay', 'settings', { tab: 'appearance' })
  await ov.waitForSelector('.settings')
  await sleep(900)
  await capture('tour-settings')
  await call('closeOverlay')

  // Page agent with the API stand-in
  await call('openTab', at('trips.test'))
  await win((w) => w.url() === at('trips.test'))
  await sleep(800)
  await ui.evaluate(() => void window.solamar.call('agentRun', 'Fill in this trip form: my name is Ada Lovelace, city Lisbon. Do not submit.'))
  for (let i = 0; i < 100; i++) {
    const st = await call('state')
    if (st.pageAgent && !st.pageAgent.running) break
    await sleep(150)
  }
  await call('aiPanel', true)
  await sleep(1000)
  await capture('agent')
  await call('aiPanel', false)
  await sleep(500)

  // Reply draft
  await call('openTab', at('chat.test'))
  const chat = await win((w) => w.url() === at('chat.test'))
  await chat.waitForLoadState('load')
  await chat.click('#reply')
  await call('aiWriteStart')
  await sleep(300)
  await call('aiWriteRun', 'reply', '')
  for (let i = 0; i < 60; i++) {
    const st = await call('state')
    if (st.write?.result && !st.write.busy) break
    await sleep(100)
  }
  await sleep(500)
  await capture('reply', await boxIn(ov, '.dialog.write', 14))
  await call('closeOverlay')

  // Save password card
  await call('openTab', at('acme.test', '/login'))
  const login = await win((w) => w.url() === at('acme.test', '/login'))
  await login.waitForLoadState('load')
  await login.fill('#email', 'ada@example.test')
  await login.fill('#pw', 'not-a-real-password')
  await login.click('#go')
  for (let i = 0; i < 50; i++) {
    if ((await call('state')).savePassword) break
    await sleep(100)
  }
  await sleep(500)
  const ovBounds = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].contentView.children.find((c) => c.webContents.getURL().endsWith('#overlay'))?.getBounds())
  const card = await ov.locator('.permission').first().boundingBox()
  await capture('save-password', [ovBounds.x + Math.round(card.x) - 12, ovBounds.y + Math.round(card.y) - 10, Math.round(card.width) + 24, Math.round(card.height) + 20])
  await call('savePasswordDecide', 'dismiss')

  await app.close()
}

// ---------- first run ----------
{
  const { app, call, capture } = await launch('fresh', {})
  const s = await call('state')
  await call('updateSpace', s.spaces[0].id, { theme: { ...s.spaces[0].theme, color: '#7c6cf2', mode: 'light' } })
  await sleep(800)
  await capture('welcome')
  await app.close()
}

site.close()
api.close()
console.log('layers in', out)
