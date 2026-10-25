chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.q === 'tab') {
    chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => reply({ url: tabs[0]?.url ?? '', fromTab: sender.tab?.url ?? '' }))
    return true
  }
  if (msg.q === 'open') chrome.tabs.create({ url: msg.url }).then((t) => reply({ id: t.id }))
  if (msg.q === 'close') chrome.tabs.remove(sender.tab.id).then(() => reply({ ok: true }))
  return true
})
