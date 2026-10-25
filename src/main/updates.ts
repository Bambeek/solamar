// Updates from GitHub Releases (Bambeek/solamar, see `publish` in electron-builder.yml). The packaged Windows app
// checks at start and every six hours, downloads a new version in the background and installs it on the next quit,
// or right away from the notice or Settings > About. macOS installs updates only into a signed app, so until there is
// an Apple Developer ID the Mac build just says a new version is out and opens its release page. Personal builds
// never update themselves: a public release would replace them with the public build.
import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '@shared/types'

const { autoUpdater } = electronUpdater
const EVERY_MS = 6 * 60 * 60 * 1000
export const RELEASES_URL = 'https://github.com/Bambeek/solamar/releases/latest'

export class Updates {
  state: UpdateState
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly changed: () => void,
    private readonly announce: (state: UpdateState) => void
  ) {
    const personal = typeof __SOLAMAR_PERSONAL__ !== 'undefined' && __SOLAMAR_PERSONAL__
    const off = !app.isPackaged ? 'dev' : personal ? 'personal' : process.env.SOLAMAR_NO_UPDATES === '1' ? 'dev' : null
    this.state = { status: off ? 'off' : 'idle', version: app.getVersion(), offReason: off ?? undefined }
  }

  start(): void {
    if (this.state.status === 'off') return
    const manual = process.platform === 'darwin'
    autoUpdater.autoDownload = !manual
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = null
    // Tests point the app at a local feed; everyone else gets the GitHub one baked into app-update.yml.
    if (process.env.SOLAMAR_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.SOLAMAR_UPDATE_URL })
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-not-available', () => this.set({ status: 'current', checkedAt: Date.now() }))
    autoUpdater.on('update-available', (info) => {
      this.set({ status: manual ? 'manual' : 'downloading', next: info.version, progress: 0, checkedAt: Date.now() })
      if (manual) this.announce(this.state)
    })
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', progress: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', next: info.version, progress: 100 })
      this.announce(this.state)
    })
    autoUpdater.on('error', (err) => this.set({ status: 'error', error: String(err?.message ?? err).split('\n')[0].slice(0, 200), checkedAt: Date.now() }))
    setTimeout(() => void this.check(), 15_000).unref() // after start-up, not during it
    this.timer = setInterval(() => void this.check(), EVERY_MS)
    this.timer.unref()
  }

  async check(): Promise<void> {
    if (this.state.status === 'off' || this.state.status === 'downloading' || this.state.status === 'ready') return
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ status: 'error', error: String((err as Error)?.message ?? err).split('\n')[0].slice(0, 200), checkedAt: Date.now() })
    }
  }

  /** Quits and runs the downloaded installer, which starts Solamar again. */
  install(): void {
    if (this.state.status === 'ready') autoUpdater.quitAndInstall(false, true)
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    if (patch.status && patch.status !== 'error') delete this.state.error
    this.changed()
  }
}
