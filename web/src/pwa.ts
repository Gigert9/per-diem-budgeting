function isIos(): boolean {
  const ua = window.navigator.userAgent.toLowerCase()
  const isAppleDevice = /iphone|ipad|ipod/.test(ua)
  return isAppleDevice
}

function isInStandaloneMode(): boolean {
  // iOS Safari
  // @ts-expect-error - navigator.standalone exists on iOS
  if (typeof navigator.standalone === 'boolean') return navigator.standalone
  // Other browsers
  return window.matchMedia('(display-mode: standalone)').matches
}

export function wireInstallAndUpdates(): void {
  // Offline caching + update check.
  // On open, ask the browser to check for a newer service worker.
  // If a new SW activates, reload once to pick up new assets.
  const reloadedKey = 'budgetapp__reloaded_for_update'
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js')
        // Check for updates on open.
        await reg.update()

        const maybeApplyWaiting = async () => {
          const waiting = reg.waiting
          if (!waiting) return
          waiting.postMessage({ type: 'SKIP_WAITING' })
        }

        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          if (!sw) return
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              void maybeApplyWaiting()
            }
          })
        })

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (sessionStorage.getItem(reloadedKey) === '1') return
          sessionStorage.setItem(reloadedKey, '1')
          window.location.reload()
        })

        // If there's already an updated SW waiting, apply it.
        await maybeApplyWaiting()
      } catch {
        // no-op
      }
    })
  }

  // Install button
  let deferredPrompt: any = null
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    window.dispatchEvent(new CustomEvent('budgetapp:canInstall', { detail: true }))
  })

  window.addEventListener('budgetapp:installClick', async () => {
    if (isInStandaloneMode()) return

    if (isIos()) {
      window.dispatchEvent(new CustomEvent('budgetapp:showInstallHelp', { detail: true }))
      return
    }

    if (!deferredPrompt) return
    deferredPrompt.prompt()
    try {
      await deferredPrompt.userChoice
    } finally {
      deferredPrompt = null
      window.dispatchEvent(new CustomEvent('budgetapp:canInstall', { detail: false }))
    }
  })
}
