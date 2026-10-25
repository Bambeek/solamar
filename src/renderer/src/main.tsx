import '@fontsource-variable/inter'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/platform.css'
import { createRoot } from 'react-dom/client'
import { Frame } from './Frame'
import { Overlay } from './Overlay'

const overlay = location.hash === '#overlay'
document.documentElement.dataset.view = overlay ? 'overlay' : 'ui'
createRoot(document.getElementById('root')!).render(overlay ? <Overlay /> : <Frame />)
