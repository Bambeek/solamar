document.documentElement.dataset.solamarExt = 'content'
chrome.runtime.sendMessage({ q: 'tab' }).then((r) => {
  document.documentElement.dataset.activeUrl = r.url
  document.documentElement.dataset.fromTab = r.fromTab
})
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.solamarTest) chrome.runtime.sendMessage(e.data.solamarTest)
})
