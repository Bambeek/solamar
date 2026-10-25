// Moving the window by its top bar. CSS app-region dragging is not honoured for child views of a BaseWindow on
// Windows, so the bar also drags by hand; when the native drag does work, these handlers simply never fire.
import type React from 'react'
import { call } from './api'

const INTERACTIVE = 'button, input, select, textarea, a, [role="separator"], .no-drag'

export function startWindowDrag(e: React.PointerEvent<HTMLElement>): void {
  if (e.button !== 0 || (e.target as HTMLElement).closest(INTERACTIVE)) return
  e.preventDefault()
  const el = e.currentTarget
  el.setPointerCapture(e.pointerId)
  call('windowDrag', 'start', e.screenX, e.screenY)
  let frame = 0
  let x = e.screenX
  let y = e.screenY
  const move = (ev: PointerEvent) => {
    x = ev.screenX
    y = ev.screenY
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0
        call('windowDrag', 'move', x, y)
      })
  }
  const end = () => {
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', end)
    el.removeEventListener('lostpointercapture', end)
    cancelAnimationFrame(frame)
    call('windowDrag', 'end', x, y)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', end)
  el.addEventListener('lostpointercapture', end)
}

export function toggleMaximizeOnDoubleClick(e: React.MouseEvent<HTMLElement>): void {
  if ((e.target as HTMLElement).closest(INTERACTIVE)) return
  call('windowControl', 'maximize')
}
