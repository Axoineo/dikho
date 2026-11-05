// Runs at document start, in the CRM's own origin only: WebViewBridge.kt pins
// both this script and the DikhoAndroid object to that origin, so a page from
// anywhere else never sees either.
//
// Android WebView cannot save a blob: or data: link by itself, and the CRM
// creates most of its files that way (invoices, Excel exports, attachments). It
// also revokes the URL immediately after clicking, so the Blob has to be
// captured at creation. This hands those files to native code and does nothing
// else, apart from a clipboard fallback below. It exposes no API to the page.
(function () {
  'use strict'

  var bridge = window.DikhoAndroid
  if (!bridge || window.top !== window || window.__dikhoBridgeReady) return
  window.__dikhoBridgeReady = true

  var MAX_BYTES = 100 * 1024 * 1024
  var CHUNK_BYTES = 512 * 1024
  var ACK_TIMEOUT_MS = 30000
  var MAX_COPY_CHARS = 65536

  var blobs = new Map()
  var waiting = new Map()
  var nextId = 1

  var nativeCreate = URL.createObjectURL
  var nativeRevoke = URL.revokeObjectURL
  URL.createObjectURL = function (object) {
    var url = nativeCreate.call(URL, object)
    if (object instanceof Blob) blobs.set(url, object)
    return url
  }
  URL.revokeObjectURL = function (url) {
    blobs.delete(url)
    nativeRevoke.call(URL, url)
  }

  function post(message) {
    bridge.postMessage(JSON.stringify(message))
  }

  bridge.onmessage = function (event) {
    var settle = waiting.get(event.data)
    if (!settle) return
    waiting.delete(event.data)
    settle(true)
  }

  function ack(key) {
    return new Promise(function (resolve) {
      waiting.set(key, resolve)
      setTimeout(function () {
        if (waiting.delete(key)) resolve(false)
      }, ACK_TIMEOUT_MS)
    })
  }

  function base64Of(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader()
      reader.onerror = function () { reject(reader.error) }
      reader.onload = function () {
        var text = String(reader.result)
        resolve(text.slice(text.indexOf(',') + 1))
      }
      reader.readAsDataURL(blob)
    })
  }

  async function sendBlob(blob, name) {
    if (blob.size > MAX_BYTES) {
      post({ t: 'tooLarge', name: name })
      return
    }
    var id = String(nextId++)
    post({ t: 'begin', id: id, name: name, mime: blob.type, size: blob.size })
    try {
      for (var offset = 0, seq = 0; offset < blob.size; offset += CHUNK_BYTES, seq++) {
        var data = await base64Of(blob.slice(offset, offset + CHUNK_BYTES))
        var received = ack(id + ':' + seq)
        post({ t: 'chunk', id: id, seq: seq, data: data })
        if (!(await received)) throw new Error('no ack')
      }
      post({ t: 'end', id: id })
    } catch (error) {
      post({ t: 'abort', id: id })
    }
  }

  // Decoded here rather than with fetch(), which connect-src would block once the
  // CRM's Content-Security-Policy is enforced.
  function blobFromDataUrl(url) {
    var comma = url.indexOf(',')
    var meta = url.slice(5, comma)
    var isBase64 = /;base64$/i.test(meta)
    var body = url.slice(comma + 1)
    var text = isBase64 ? atob(body) : decodeURIComponent(body)
    var bytes = new Uint8Array(text.length)
    for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i)
    return new Blob([bytes], { type: meta.replace(/;base64$/i, '') })
  }

  function intercept(anchor, event) {
    var href = anchor.href
    var isBlob = href.indexOf('blob:') === 0
    var isData = href.indexOf('data:') === 0
    if (!isBlob && !isData && !anchor.hasAttribute('download')) return false

    if (event) event.preventDefault()
    var name = anchor.getAttribute('download') || ''
    if (isBlob) {
      var blob = blobs.get(href)
      if (blob) sendBlob(blob, name)
      else post({ t: 'lost', name: name })
    } else if (isData) {
      try {
        sendBlob(blobFromDataUrl(href), name)
      } catch (error) {
        post({ t: 'lost', name: name })
      }
    } else {
      post({ t: 'url', url: href, name: name })
    }
    return true
  }

  document.addEventListener('click', function (event) {
    var path = event.composedPath()
    for (var i = 0; i < path.length; i++) {
      var node = path[i]
      if (node instanceof HTMLAnchorElement && node.href) {
        intercept(node, event)
        return
      }
    }
  }, true)

  // An anchor that was never attached to the page fires no document event.
  var nativeClick = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (!this.isConnected && this.href && intercept(this, null)) return
    nativeClick.call(this)
  }

  // Some WebView versions refuse navigator.clipboard outright. The CRM's copy
  // buttons should not depend on which version a phone happens to have.
  var clipboard = navigator.clipboard
  if (clipboard && clipboard.writeText) {
    var nativeWrite = clipboard.writeText.bind(clipboard)
    clipboard.writeText = function (text) {
      return nativeWrite(text).catch(function () {
        post({ t: 'copy', text: String(text).slice(0, MAX_COPY_CHARS) })
      })
    }
  }

  // The native bars take the colours the page really shows at its top and bottom
  // edges. That is more honest than following the theme: the sign-in screen stays
  // light even when the rest of the CRM is dark, and a read needs no knowledge of
  // which screen is showing.
  function colourAt(x, y) {
    for (var el = document.elementFromPoint(x, y); el; el = el.parentElement) {
      var colour = getComputedStyle(el).backgroundColor
      if (colour.indexOf('rgb') !== 0) continue
      var parts = colour.match(/[\d.]+/g).map(Number)
      if (parts.length === 3 || parts[3] > 0.5) return (parts[0] << 16) | (parts[1] << 8) | parts[2]
    }
    return 0xffffff
  }

  var lastEdges = ''
  function reportEdges() {
    if (!document.body) return
    var top = colourAt(window.innerWidth / 2, 1)
    var bottom = colourAt(window.innerWidth / 2, window.innerHeight - 1)
    var edges = top + ':' + bottom
    if (edges === lastEdges) return
    lastEdges = edges
    post({ t: 'chrome', top: top, bottom: bottom })
  }

  // Twice: once after React commits, once after a theme fade has finished.
  var timers = []
  function scheduleEdges() {
    timers.forEach(clearTimeout)
    timers = [setTimeout(reportEdges, 60), setTimeout(reportEdges, 450)]
  }

  function watchEdges() {
    var watcher = new MutationObserver(scheduleEdges)
    watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    watcher.observe(document.body, { childList: true })
    var root = document.getElementById('root')
    if (root) watcher.observe(root, { childList: true })
    var splash = document.getElementById('dk-splash')
    if (splash) watcher.observe(splash, { attributes: true, attributeFilter: ['class'] })
    window.addEventListener('resize', scheduleEdges)
    scheduleEdges()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchEdges)
  else watchEdges()
})()
