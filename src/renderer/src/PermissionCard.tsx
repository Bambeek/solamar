// Site permission prompt (camera, location, notifications...). A small card under the address field; the page stays usable.
import { Bell, Camera, Clock, Mic, MonitorUp, Music, MapPin, ShieldQuestion, X } from 'lucide-react'
import type { AppState, PermissionRequest } from '@shared/types'
import { call } from './api'

export function permissionText(p: Pick<PermissionRequest, 'permission' | 'detail'>): { what: string; Icon: typeof Bell } {
  switch (p.permission) {
    case 'media':
      return { what: `use your ${p.detail ?? 'camera and microphone'}`, Icon: p.detail === 'microphone' ? Mic : Camera }
    case 'geolocation':
      return { what: 'know your location', Icon: MapPin }
    case 'notifications':
      return { what: 'show notifications', Icon: Bell }
    case 'midi':
      return { what: 'use your MIDI devices', Icon: Music }
    case 'display-capture':
      return { what: 'see your screen', Icon: MonitorUp }
    case 'idle-detection':
      return { what: 'know when you are away', Icon: Clock }
    default:
      return { what: `use ${p.permission}`, Icon: ShieldQuestion }
  }
}

export function PermissionCard({ s }: { s: AppState }) {
  const p = s.permission
  if (!p) return null
  const { what, Icon } = permissionText(p)
  const decide = (answer: 'allow' | 'block' | 'dismiss') => call('permissionDecide', p.id, answer)
  return (
    <div className="permission card" role="alertdialog" aria-labelledby="perm-title">
      <div className="permission-head">
        <span className="permission-icon">
          <Icon size={16} aria-hidden />
        </span>
        <p id="perm-title">
          <strong>{p.site}</strong> wants to {what}
        </p>
        <button className="icon-btn" aria-label="Not now" title="Not now (Esc)" onClick={() => decide('dismiss')}>
          <X size={15} />
        </button>
      </div>
      <div className="permission-foot">
        <button className="btn" onClick={() => decide('block')}>
          Block
        </button>
        <button className="btn primary" onClick={() => decide('allow')} autoFocus>
          Allow
        </button>
      </div>
      <small className="fine">Solamar remembers this for {p.site}. Change it in Settings.</small>
    </div>
  )
}

export function SitePermissions({ s }: { s: AppState }) {
  const entries = Object.entries(s.settings.sitePermissions).sort(([a], [b]) => a.localeCompare(b))
  return (
    <div className="field">
      <span>Site permissions</span>
      <ul className="allow-list">
        {entries.length === 0 && <li className="fine">No answers yet. Solamar asks when a site wants your camera, location or notifications.</li>}
        {entries.map(([key, answer]) => {
          const [site, permission] = key.split('|')
          const { what, Icon } = permissionText({ permission })
          return (
            <li key={key}>
              <Icon size={14} aria-hidden />
              <span>
                {site}: {what.replace(/^use your |^use |^know |^show |^see /, '')}
              </span>
              <span className={answer === 'allow' ? 'ok' : 'warn'}>{answer === 'allow' ? 'Allowed' : 'Blocked'}</span>
              <button className="btn link small" onClick={() => call('forgetPermission', key)}>
                Forget
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
