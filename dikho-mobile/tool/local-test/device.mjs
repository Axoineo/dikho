// Helpers for driving the app on an emulator: adb, the system UI through
// uiautomator, and the page through the WebView's DevTools socket. That socket
// exists only in local test builds, which is itself checked in device-test.mjs.

import { execFileSync, spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

export const PACKAGE = 'in.dikho.crm'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function adb(...args) {
  return execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function adbTry(...args) {
  const result = spawnSync('adb', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

export const shell = (command) => adb('shell', command)

export async function waitFor(what, check, { timeout = 30000, every = 400 } = {}) {
  const started = Date.now()
  let last
  while (Date.now() - started < timeout) {
    try {
      last = await check()
      if (last) return last
    } catch (error) {
      last = error
    }
    await sleep(every)
  }
  throw new Error(`Timed out waiting for ${what} (last: ${last})`)
}

export function screenshot(path) {
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 * 1024 * 1024 })
  writeFileSync(path, png)
}

/* ── System UI ─────────────────────────────────────────────────────────── */

function dumpNodes() {
  const { ok } = adbTry('shell', 'uiautomator dump /sdcard/dikho-ui.xml')
  if (!ok) return []
  const xml = adbTry('shell', 'cat /sdcard/dikho-ui.xml').out
  return [...xml.matchAll(/<node [^>]*>/g)].map(([node]) => {
    const attr = (name) => (node.match(new RegExp(`${name}="([^"]*)"`)) ?? [])[1] ?? ''
    const box = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
    return {
      text: attr('text'),
      desc: attr('content-desc'),
      id: attr('resource-id'),
      pkg: attr('package'),
      x: box ? (Number(box[1]) + Number(box[3])) / 2 : 0,
      y: box ? (Number(box[2]) + Number(box[4])) / 2 : 0,
    }
  })
}

const matches = (node, label) => {
  const wanted = label instanceof RegExp ? label : new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
  return wanted.test(node.text) || wanted.test(node.desc)
}

export const uiHas = (label) => dumpNodes().some((node) => matches(node, label))

export const uiWait = (label, options) => waitFor(`"${label}" on screen`, () => uiHas(label), options)

export const uiFind = (label, options) => waitFor(`"${label}" on screen`, () => dumpNodes().find((n) => matches(n, label)), options)

export async function uiTap(label, options) {
  const node = await uiFind(label, options)
  shell(`input tap ${node.x} ${node.y}`)
  return node
}

export const pressBack = () => shell('input keyevent KEYCODE_BACK')

/**
 * A tap by position, for controls that accessibility dumps can miss: uiautomator
 * connecting is what switches on Flutter's semantics, so a dump can race them.
 */
export function tapAt(fractionX, fractionY) {
  const [width, height] = shell('wm size').match(/(\d+)x(\d+)/).slice(1).map(Number)
  shell(`input tap ${Math.round(width * fractionX)} ${Math.round(height * fractionY)}`)
}

export function foregroundPackage() {
  const out = adbTry('shell', 'dumpsys activity activities').out
  return (out.match(/topResumedActivity=.*? ([a-zA-Z0-9_.]+)\//) ?? out.match(/mResumedActivity:.*? ([a-zA-Z0-9_.]+)\//) ?? [])[1] ?? ''
}

export const clearLog = () => adbTry('logcat', '-c')

/** ActivityTaskManager lines: what the app actually asked Android to open. */
export const startedActivities = () => adbTry('logcat', '-d', '-s', 'ActivityTaskManager:I').out
  .split('\n').filter((line) => line.includes('START u0'))

/* ── The page ──────────────────────────────────────────────────────────── */

export class Page {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      const waiter = this.pending.get(message.id)
      if (!waiter) return
      this.pending.delete(message.id)
      if (message.error) waiter.reject(new Error(message.error.message))
      else waiter.resolve(message.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out`))
      }, 20000)
    })
  }

  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
    return result.value
  }

  /**
   * A real tap through Chromium's input pipeline, so it counts as a user gesture.
   * With `blocking`, does not wait for the page: alert() and confirm() stop the
   * renderer until the dialog closes, so the reply would never come in time.
   */
  async tap(selector, { blocking = false } = {}) {
    const point = await this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    })()`)
    if (!point) throw new Error(`No element for ${selector}`)
    const base = { x: point.x, y: point.y, button: 'left', clickCount: 1 }
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...base })
    const released = { type: 'mouseReleased', ...base }
    if (blocking) this.socket.send(JSON.stringify({ id: this.nextId++, method: 'Input.dispatchMouseEvent', params: released }))
    else await this.send('Input.dispatchMouseEvent', released)
  }

  /** Sets a React-controlled field the way typing would. */
  type(selector, value) {
    return this.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) throw new Error('No field ' + ${JSON.stringify(selector)})
      el.focus()
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })()`)
  }

  navigate(url) {
    return this.send('Page.navigate', { url })
  }

  close() {
    this.socket.close()
  }
}

const FORWARD_PORT = 9333

/** Connects to the running app's page. Throws if the app has no debug socket. */
export async function connectPage({ timeout = 30000 } = {}) {
  const socketName = await waitFor('the WebView debug socket', () => {
    const pid = adbTry('shell', `pidof ${PACKAGE}`).out.trim()
    if (!pid) return null
    const unix = adbTry('shell', 'cat /proc/net/unix').out
    return unix.includes(`webview_devtools_remote_${pid}`) ? `webview_devtools_remote_${pid}` : null
  }, { timeout })
  adb('forward', `tcp:${FORWARD_PORT}`, `localabstract:${socketName}`)
  const target = await waitFor('a page target', async () => {
    const list = await (await fetch(`http://127.0.0.1:${FORWARD_PORT}/json`)).json()
    return list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
  }, { timeout })
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return new Page(socket)
}

export const debugSocketExists = () => {
  const pid = adbTry('shell', `pidof ${PACKAGE}`).out.trim()
  return pid !== '' && adbTry('shell', 'cat /proc/net/unix').out.includes(`webview_devtools_remote_${pid}`)
}

export function launch() {
  return adb('shell', 'am', 'start', '-W', '-n', `${PACKAGE}/.MainActivity`)
}

/** Right after an upgrade Android may still be finishing the replacement. */
export async function launchWhenReady() {
  await waitFor('the app process', () => {
    launch()
    return adbTry('shell', `pidof ${PACKAGE}`).out.trim() !== ''
  }, { timeout: 45000, every: 2000 })
}

/** What the app logged, in local test builds, since the log was last cleared. */
export const appLog = () => adbTry('logcat', '-d', '-s', 'flutter:I').out

export const forceStop = () => adb('shell', 'am', 'force-stop', PACKAGE)

export function connectBackends({ updateService = true } = {}) {
  for (const port of [5199, 54321]) adb('reverse', `tcp:${port}`, `tcp:${port}`)
  if (updateService) adb('reverse', 'tcp:8799', 'tcp:8799')
  else adbTry('reverse', '--remove', 'tcp:8799')
}

export async function backendEvents() {
  return (await fetch('http://127.0.0.1:54321/__events')).json()
}
