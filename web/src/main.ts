import './style.css'
import { wireInstallAndUpdates } from './pwa'
import { initApp } from './ui'

wireInstallAndUpdates()
initApp(document.getElementById('app')!)
