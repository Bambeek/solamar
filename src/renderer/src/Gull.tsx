import { useEffect, useRef, useState } from 'react'
import base from './assets/gull/base.webp'
import blink from './assets/gull/blink.webp'
import wave from './assets/gull/wave.webp'
import surprised from './assets/gull/surprised.webp'
import laugh from './assets/gull/laugh.webp'
import spyglass from './assets/gull/spyglass.webp'
import salute from './assets/gull/salute.webp'
import dizzy from './assets/gull/dizzy.webp'
import head from './assets/gull/head.webp'
import headBlink from './assets/gull/head-blink.webp'

// The gull: Solamar's mascot in the AI panel. Frames are poses of one drawing (made locally with Qwen Image), stacked
// and shown one at a time, so a pose change never waits for an image to load. It blinks now and then, waves or looks
// through its spyglass when left alone, reacts when clicked and gets dizzy when clicked too often.

const FRAMES = { base, blink, wave, surprised, laugh, spyglass, salute, dizzy }
type Pose = keyof typeof FRAMES
export type GullMood = 'idle' | 'working' | 'done'

const LINES = ['Ahoy!', 'Squawk!', 'Hey, that tickles!', 'Aye aye, captain!', 'Need a hand? I have two wings.', 'Land ho!', 'Any fish on this page?']
const CLICK_POSES: Pose[] = ['surprised', 'laugh', 'salute']
const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]
const still = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** Calls `fn` again and again, each time after a random pause; stops on unmount. */
function useEvery(minMs: number, maxMs: number, fn: () => void, on = true) {
  const latest = useRef(fn)
  latest.current = fn
  useEffect(() => {
    if (!on || still()) return
    let t: ReturnType<typeof setTimeout>
    const next = () => (t = setTimeout(() => (latest.current(), next()), rand(minMs, maxMs)))
    next()
    return () => clearTimeout(t)
  }, [minMs, maxMs, on])
}

/** The whole gull, for empty states. Click it. */
export function Gull({ mood = 'idle', className = '' }: { mood?: GullMood; className?: string }) {
  const [pose, setPose] = useState<Pose>('base')
  const [act, setAct] = useState('') // CSS class for the body motion of the moment: hop, wiggle, wobble
  const [line, setLine] = useState<{ text: string; id: number } | null>(null)
  const busyUntil = useRef(0) // an action (click, idle wave) owns the pose until then
  const clicks = useRef<number[]>([])
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const later = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms))
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const rest: Pose = mood === 'working' ? 'spyglass' : 'base'
  useEffect(() => {
    if (Date.now() > busyUntil.current) setPose(mood === 'working' ? 'spyglass' : mood === 'done' ? 'salute' : 'base')
    if (mood === 'done') later(1600, () => Date.now() > busyUntil.current && setPose('base'))
  }, [mood]) // eslint-disable-line react-hooks/exhaustive-deps

  const perform = (p: Pose, ms: number, motion = '', text?: string) => {
    busyUntil.current = Date.now() + ms
    setPose(p)
    setAct('')
    requestAnimationFrame(() => setAct(motion))
    if (text) setLine({ text, id: Date.now() })
    later(ms, () => {
      if (Date.now() < busyUntil.current - 50) return
      setPose(rest)
      setAct('')
      setLine(null)
    })
  }

  useEvery(2500, 6500, () => {
    if (Date.now() < busyUntil.current || rest !== 'base') return
    setPose('blink')
    later(140, () => Date.now() > busyUntil.current && setPose('base'))
    if (Math.random() < 0.25) later(320, () => (setPose('blink'), later(130, () => Date.now() > busyUntil.current && setPose('base'))))
  })
  useEvery(14000, 26000, () => {
    if (Date.now() < busyUntil.current || mood !== 'idle') return
    if (Math.random() < 0.6) perform('wave', 1800, 'wiggle')
    else perform('spyglass', 2400)
  })

  const dizzyUntil = useRef(0)
  const poke = () => {
    const now = Date.now()
    if (now < dizzyUntil.current) return // still seeing stars
    clicks.current = [...clicks.current.filter((t) => now - t < 2500), now]
    if (clicks.current.length >= 5) {
      clicks.current = []
      dizzyUntil.current = now + 2600
      return perform('dizzy', 2600, 'wobble', 'Whoa… too many clicks')
    }
    perform(pick(CLICK_POSES), 1400, 'hop', pick(LINES))
  }

  return (
    <button type="button" className={['gull', act, className].filter(Boolean).join(' ')} onClick={poke} aria-label="The gull. Click it." title="">
      <span className="gull-body">
        {(Object.keys(FRAMES) as Pose[]).map((p) => (
          <img key={p} src={FRAMES[p]} alt="" draggable={false} className={p === pose ? 'on' : ''} />
        ))}
      </span>
      {act === 'hop' && (
        <span className="gull-feathers" aria-hidden>
          <i />
          <i />
          <i />
        </span>
      )}
      {line && (
        <span className="gull-says" key={line.id} role="status">
          {line.text}
        </span>
      )}
    </button>
  )
}

/** The gull's head, for the header and next to replies: blinks on its own, bobs while working, hops when clicked. */
export function GullHead({ working = false, className = '' }: { working?: boolean; className?: string }) {
  const [closed, setClosed] = useState(false)
  const [hop, setHop] = useState(0)
  useEvery(3000, 8000, () => {
    setClosed(true)
    setTimeout(() => setClosed(false), 140)
  })
  return (
    <span
      className={['gull-head', working && 'working', hop % 2 ? 'hop-a' : hop ? 'hop-b' : '', className].filter(Boolean).join(' ')}
      onClick={() => setHop((h) => h + 1)}
      aria-hidden
    >
      <img src={head} alt="" draggable={false} className={closed ? '' : 'on'} />
      <img src={headBlink} alt="" draggable={false} className={closed ? 'on' : ''} />
    </span>
  )
}
