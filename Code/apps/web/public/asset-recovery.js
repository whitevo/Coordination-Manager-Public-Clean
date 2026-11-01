/* global window, document, URL, console */
;(function () {
  var appReady = false
  var handlingFailure = false
  var storagePrefix = 'assetRecovery:'

  function isAssetError(error) {
    var message = typeof error === 'string' ? error : error && error.message
    return typeof message === 'string' &&
      /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading chunk .+ failed|Loading CSS chunk .+ failed/i.test(message)
  }

  function showRecovery() {
    function show() {
      if (document.getElementById('asset-recovery-notice')) return
      var notice = document.createElement('section')
      notice.id = 'asset-recovery-notice'
      notice.setAttribute('role', 'alert')
      notice.className = 'fixed bottom-4 left-4 right-4 z-[100] rounded-lg border bg-background p-4 text-foreground shadow-lg'
      var message = document.createElement('p')
      message.textContent = 'Some application files could not load. Save or copy any unsaved work, then reload this page. If you are offline, reconnect first.'
      var button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Reload this page'
      button.className = 'mt-2 rounded-lg bg-primary px-4 py-2 text-primary-foreground'
      button.addEventListener('click', function () { window.location.reload() })
      notice.appendChild(message)
      notice.appendChild(button)
      document.body.appendChild(notice)
    }
    if (document.body) show()
    else document.addEventListener('DOMContentLoaded', show, { once: true })
  }

  function recover() {
    if (handlingFailure) return
    handlingFailure = true
    console.error('Application asset loading failed; offering bounded recovery.')
    if (!appReady && window.navigator.onLine !== false) {
      var entry = document.querySelector('script[type="module"][src]')
      // A different entry hash gives a later deployment its own recovery attempt.
      var key = storagePrefix + (entry ? entry.getAttribute('src') : window.location.pathname)
      try {
        if (!window.sessionStorage.getItem(key)) {
          window.sessionStorage.setItem(key, '1')
          window.location.reload()
          return
        }
      } catch (error) {
        // Without a persistent guard, automatic reload could loop.
        console.warn('Automatic asset recovery disabled: session storage unavailable.', error)
      }
    }
    showRecovery()
  }

  window.__assetRecovery = {
    markReady: function () { appReady = true },
    handleError: function (error) {
      if (!isAssetError(error)) return false
      recover()
      return true
    }
  }

  window.addEventListener('vite:preloadError', function (event) {
    // Keep the original rejection: suppressing it can make React.lazy receive
    // undefined instead of a module and obscure the actual asset failure.
    window.__assetRecovery.handleError(event.payload)
  })
  window.addEventListener('unhandledrejection', function (event) {
    window.__assetRecovery.handleError(event.reason)
  })
  window.addEventListener('error', function (event) {
    var target = event.target
    if (!target || (target.tagName !== 'SCRIPT' && target.tagName !== 'LINK')) return
    if (target.tagName === 'LINK' && target.rel !== 'stylesheet' && target.rel !== 'modulepreload') return
    var source = target.src || target.href
    if (!source) return
    var url = new URL(source, window.location.href)
    if (url.origin === window.location.origin && url.pathname.indexOf('/assets/') === 0) recover()
  }, true)
})()
