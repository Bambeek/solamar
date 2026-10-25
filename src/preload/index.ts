// Bridge for Solamar's own UI pages only (sidebar frame and overlay). Web pages never get this preload.
import { contextBridge, ipcRenderer } from 'electron'
import { injectBrowserAction } from 'electron-chrome-extensions/browser-action'
import type { AppState } from '@shared/types'

const api = {
  call: <T = unknown>(method: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke('solamar:call', method, ...args),
  onState: (cb: (s: AppState) => void) => {
    const fn = (_e: unknown, s: AppState) => cb(s)
    ipcRenderer.on('solamar:state', fn)
    return () => ipcRenderer.removeListener('solamar:state', fn)
  }
}

contextBridge.exposeInMainWorld('solamar', api)

// <browser-action-list>: the extensions toolbar in the sidebar (frame only, not the overlay).
if (location.hash === '#ui') injectBrowserAction()

export type SolamarApi = typeof api
