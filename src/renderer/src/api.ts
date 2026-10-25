import { useEffect, useState } from 'react'
import type { AppState } from '@shared/types'

interface SolamarBridge {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>
  onState(cb: (s: AppState) => void): () => void
}

declare global {
  interface Window {
    solamar: SolamarBridge
  }
}

export const call = <T = unknown>(method: string, ...args: unknown[]) => window.solamar.call<T>(method, ...args)

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null)
  useEffect(() => {
    const off = window.solamar.onState(setState)
    call<AppState>('state').then((s) => setState((cur) => cur ?? s))
    return off
  }, [])
  return state
}

export function useSystemDark(): boolean {
  const mq = matchMedia('(prefers-color-scheme: dark)')
  const [dark, setDark] = useState(mq.matches)
  useEffect(() => {
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}
