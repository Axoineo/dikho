#!/usr/bin/env node
// End-to-end checks on a running emulator, against tool/local-test/server.mjs.
// Nothing here reaches production. Prints one line per check and exits non-zero
// if any fail. Run the install yourself first, or use the upgrade scenario.
//
//   node dikho-mobile/tool/local-test/device-test.mjs <scenario> [--shots <dir>]
//
// Scenarios: web, files, layout, upgrade, reinstall, save-dialog, tls, no-debug.

import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  PACKAGE, adb, adbTry, appLog, backendEvents, clearLog, connectBackends, connectPage, debugSocketExists, forceStop,
  foregroundPackage, launch, launchWhenReady, pressBack, screenshot, shell, sleep, startedActivities, tapAt, uiFind, uiHas, uiTap, uiWait, waitFor,
} from './device.mjs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    shots: { type: 'string' },
    updates: { type: 'string' },
    'old-apk': { type: 'string' },
    'new-apk': { type: 'string' },
    'other-signer-apk': { type: 'string' },
  },
})

const CRM = 'http://localhost:5199'
const PROBE = `${CRM}/__probe.html`
const DOWNLOADS = '/sdcard/Download/Dikho CRM'

const results = []

async function check(name, run) {
  try {
    const detail = await run()
    results.push({ name, ok: true })
    console.log(`PASS  ${name}${detail ? `  (${detail})` : ''}`)
  } catch (error) {
    results.push({ name, ok: false })
    console.log(`FAIL  ${name}\n      ${String(error.message ?? error).split('\n')[0]}`)
    if (values.shots) shot(`FAILED-${name}`)
  }
}

function shot(name) {
  if (!values.shots) return
  mkdirSync(values.shots, { recursive: true })
  screenshot(join(values.shots, `${name.replace(/[^a-z0-9-]+/gi, '_')}.png`))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const pageReady = (page) => waitFor('the page', () => page.eval(`document.readyState === 'complete'`))
const pagePath = (page) => page.eval('location.pathname')
const drawerOpen = (page) => page.eval(`!document.querySelector('.app-shell').classList.contains('sidebar-is-closed')`)

async function openDrawer(page) {
  await waitFor('the open drawer', async () => {
    if (await drawerOpen(page)) return true
    await page.tap('.mobile-topbar-menu')
    await sleep(900)
    return drawerOpen(page)
  }, { timeout: 20000, every: 100 })
}

async function freshPage(backends) {
  connectBackends(backends)
  await launchWhenReady()
  const page = await connectPage()
  await pageReady(page)
  return page
}

async function signIn(page) {
  await waitFor('the sign-in form', () => page.eval(`!!document.querySelector('input[type="email"]')`))
  await page.type('input[type="email"]', 'owner@example.test')
  await enterCode(page)
  await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
}

const codeBoxesShown = (page) => page.eval(`document.querySelectorAll('input[inputmode="numeric"], .otp-input').length >= 6`)

async function enterCode(page) {
  // Focusing the field raises the keyboard and moves the button, so a tap can
  // land where it used to be.
  await waitFor('the code boxes', async () => {
    if (await codeBoxesShown(page)) return true
    await page.tap('.login-button')
    await sleep(1500)
    return codeBoxesShown(page)
  }, { timeout: 30000, every: 100 })
  for (const [index, digit] of [...'123456'].entries()) {
    await page.eval(`(() => {
      const el = document.querySelectorAll('input[inputmode="numeric"], .otp-input')[${index}]
      el.focus()
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '${digit}')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })()`)
    await sleep(60)
  }
}

const sessionKey = `Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'))`
const hasSession = (page) => page.eval(`!!${sessionKey}`)

/* ── CRM flows ─────────────────────────────────────────────────────────── */

async function webScenario() {
  let page

  await check('starts, shows the CRM sign-in with no blank screen', async () => {
    forceStop()
    adbTry('shell', `pm clear ${PACKAGE}`)
    connectBackends()
    const launched = launch()
    const total = launched.match(/TotalTime: (\d+)/)?.[1]
    page = await connectPage()
    await waitFor('sign-in', () => page.eval(`!!document.querySelector('input[type="email"]')`))
    shot('01-sign-in')
    return `activity start ${total} ms`
  })

  await check('user agent identifies the app, with the WebView marker intact', async () => {
    const agent = await page.eval('navigator.userAgent')
    assert(/DikhoCRM\/\d+\.\d+\.\d+/.test(agent), agent)
  })

  await check('email OTP sign-in reaches the signed-in shell', async () => {
    await signIn(page)
    const events = await backendEvents()
    assert(events.some((e) => e.type === 'otp_verified'), 'no otp_verified event')
    assert(await hasSession(page), 'no session in localStorage')
    shot('02-signed-in')
  })

  await check('WhatsApp OTP sign-in works too', async () => {
    const verifiedBefore = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    await fetch('http://127.0.0.1:54321/__expire-sessions', { method: 'POST' })
    page.close()
    forceStop()
    adbTry('shell', `pm clear ${PACKAGE}`)
    page = await freshPage()
    await waitFor('the sign-in form', () => page.eval(`!!document.querySelector('input[type="email"]')`))
    await page.eval(`[...document.querySelectorAll('.login-method-toggle button')].find((b) => /WhatsApp/.test(b.textContent)).click()`)
    await waitFor('the phone field', () => page.eval(`!!document.querySelector('input[type="tel"]')`))
    await page.type('input[type="tel"]', '9000000000')
    await enterCode(page)
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
    const verifiedAfter = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    assert(verifiedAfter > verifiedBefore, 'the code was not verified')
  })

  await check('a wrong code is refused by the backend', async () => {
    const before = (await backendEvents()).length
    const status = await page.eval(`fetch('http://localhost:54321/auth/v1/verify', { method: 'POST', body: JSON.stringify({ token: '000000' }) }).then((r) => r.status)`)
    assert(status === 403, `status ${status}`)
    assert((await backendEvents()).length > before, 'no event')
  })

  await check('session survives force-stop and relaunch with no new sign-in', async () => {
    const before = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    // WebView writes localStorage to disk a few seconds after the page does. A kill
    // inside that window loses a sign-in that had only just happened.
    await sleep(8000)
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
    const after = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    assert(after === before, 'a new sign-in happened')
  })

  await check('internal navigation stays in the app', async () => {
    await waitFor('the client list', async () => (await pagePath(page)) === '/clients')
    await openDrawer(page)
    shot('03-drawer')
    await page.eval(`[...document.querySelectorAll('.sidebar a, .sidebar button')].find((e) => /Vendors/.test(e.textContent)).click()`)
    await waitFor('vendors', async () => (await pagePath(page)) === '/vendors')
    assert(foregroundPackage() === PACKAGE, `foreground is ${foregroundPackage()}`)
  })

  await check('back closes the drawer before leaving the page', async () => {
    await openDrawer(page)
    pressBack()
    await waitFor('the drawer closing', () => page.eval(`document.querySelector('.app-shell').classList.contains('sidebar-is-closed')`))
    assert((await pagePath(page)) === '/vendors', 'the page changed')
  })

  await check('back walks the history', async () => {
    pressBack()
    await waitFor('the previous page', async () => (await pagePath(page)) === '/clients')
  })

  await check('back at the root asks before exiting, then exits', async () => {
    // Relaunch so the history holds only the landing page.
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the client list', async () => (await pagePath(page)) === '/clients')
    pressBack()
    await sleep(3000)
    assert(foregroundPackage() === PACKAGE, 'left on one press')
    // Two presses inside the two-second window, without dumpsys slowing them.
    shell('input keyevent KEYCODE_BACK; sleep 0.4; input keyevent KEYCODE_BACK')
    await waitFor('the app to leave the foreground', () => foregroundPackage() !== PACKAGE, { timeout: 8000 })
  })

  await check('a real tax invoice from the CRM saves as a PDF', async () => {
    page.close()
    page = await freshPage()
    await waitFor('the client list', async () => (await pagePath(page)) === '/clients')
    adbTry('shell', `rm -f "${DOWNLOADS}/TI_SO-TEST-1.pdf"`)
    await page.navigate(`${CRM}/sales-orders`)
    await waitFor('the order row', () => page.eval(`location.pathname === '/sales-orders' && [...document.querySelectorAll('.crm-row')].some((row) => row.textContent.includes('SO-TEST-1'))`), { timeout: 20000 })
    // The CRM's boot splash takes any tap until it has lifted.
    await waitFor('the splash to lift', () => page.eval(`!document.getElementById('dk-splash')`), { timeout: 15000 })
    await page.tap('.crm-row')
    await waitFor('the invoice button', () => page.eval(`[...document.querySelectorAll('.crm-panel button')].some((b) => /invoice/i.test(b.textContent))`), { timeout: 15000 })
    shot('03b-sales-order')
    await page.eval(`window.__invoice = [...document.querySelectorAll('.crm-panel button')].find((b) => /invoice/i.test(b.textContent)); window.__invoice.setAttribute('data-probe-invoice', '1')`)
    await page.tap('[data-probe-invoice]')
    await waitFor('the invoice file', () => listDownloads().split('\n').some((line) => line.trim().startsWith('TI_SO-TEST-1')), { timeout: 40000 })
    const name = listDownloads().split('\n').map((line) => line.trim()).find((line) => line.startsWith('TI_SO-TEST-1'))
    const header = adb('shell', `head -c 4 "${DOWNLOADS}/${name}"`)
    assert(header === '%PDF', `not a PDF: ${JSON.stringify(header)}`)
    const bytes = adb('shell', `stat -c %s "${DOWNLOADS}/${name}"`).trim()
    assert(Number(bytes) > 10000, `only ${bytes} bytes`)
    await sleep(800)
    shot('03c-invoice-saved')
    pressBack()
    return `${name}, ${bytes} bytes`
  })

  await check('the keyboard resizes the page instead of covering it', async () => {
    page?.close()
    page = await freshPage()
    await waitFor('the search box', () => page.eval(`!!document.querySelector('input')`))
    const before = await page.eval('window.innerHeight')
    await page.tap('input')
    shell('input text a')
    const after = await waitFor('the viewport to shrink', async () => {
      const height = await page.eval('window.innerHeight')
      return height < before ? height : null
    }, { timeout: 8000 })
    shot('04-keyboard')
    shell('input keyevent KEYCODE_BACK')
    return `${before} to ${after} css px`
  })

  await check('rotation keeps the page and its state, with no reload', async () => {
    await page.eval('window.__rotationMarker = 1')
    shell('settings put system accelerometer_rotation 0')
    shell('settings put system user_rotation 1')
    await waitFor('landscape', () => page.eval('window.innerWidth > window.innerHeight'), { timeout: 10000 })
    assert(await page.eval('window.__rotationMarker === 1'), 'the page reloaded')
    shot('05-landscape')
    shell('settings put system user_rotation 0')
    await waitFor('portrait', () => page.eval('window.innerHeight > window.innerWidth'), { timeout: 10000 })
  })

  await check('system dark mode reaches the CRM', async () => {
    shell('cmd uimode night yes')
    const dark = await waitFor('dark theme', () => page.eval(`document.documentElement.dataset.theme === 'dark'`), { timeout: 10000 })
    await sleep(1500)
    shot('06-dark')
    shell('cmd uimode night no')
    await waitFor('light theme', () => page.eval(`document.documentElement.dataset.theme !== 'dark'`), { timeout: 10000 })
    return dark ? null : 'not dark'
  })

  await check('the app shows its offline screen, then recovers with the network', async () => {
    page.close()
    forceStop()
    shell('svc wifi disable')
    shell('svc data disable')
    adb('reverse', '--remove-all')
    launch()
    await uiWait(/Can.t reach Dikho CRM/, { timeout: 40000 })
    shot('07-offline')
    connectBackends()
    shell('svc wifi enable')
    shell('svc data enable')
    await waitFor('recovery', () => !uiHas(/Can.t reach Dikho CRM/), { timeout: 40000 })
    page = await connectPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
    shot('08-recovered')
  })

  await check('a link from another app opens only the allowed page', async () => {
    const view = (url) => adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-n', `${PACKAGE}/.MainActivity`, '-d', `'${url}'`)
    const startPath = await pagePath(page)
    view(`${CRM}/users`)
    view('https://evil.example/email/connect?state=x')
    await sleep(2000)
    assert((await pagePath(page)) === startPath, 'a disallowed link navigated the page')
    view(`${CRM}/email/connect?state=probe-state-value&code=probe-code-value`)
    await waitFor('the connection to finish', async () => (await backendEvents()).some((e) => e.type === 'email_connect' && e.state === 'probe-state-value' && e.signedIn), { timeout: 15000 })
    page.close()
    page = await connectPage()
    await waitFor('the settings page', async () => (await pagePath(page)) === '/email/settings', { timeout: 15000 })
    await sleep(2000)
    shot('09-gmail-return')
  })

  await check('the same link works when the app was not running', async () => {
    page.close()
    forceStop()
    adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-n', `${PACKAGE}/.MainActivity`, '-d', `'${CRM}/email/connect?state=cold-start-state&code=probe-code-value'`)
    await waitFor('the connection to finish', async () => (await backendEvents()).some((e) => e.type === 'email_connect' && e.state === 'cold-start-state' && e.signedIn), { timeout: 30000 })
    page = await connectPage()
  })

  await check('a server error shows its own message, and retry recovers', async () => {
    page.close()
    forceStop()
    await fetch('http://127.0.0.1:54321/__spa?mode=error')
    launch()
    await uiWait('Dikho CRM is not responding', { timeout: 30000 })
    shot('09b-server-error')
    await fetch('http://127.0.0.1:54321/__spa?mode=ok')
    await uiTap('Try again')
    await waitFor('recovery', () => !uiHas('Dikho CRM is not responding'), { timeout: 20000 })
    page = await connectPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 20000 })
  })

  await check('a hung server gets a slow notice with a retry, never a blank screen', async () => {
    page.close()
    forceStop()
    await fetch('http://127.0.0.1:54321/__spa?mode=hang')
    launch()
    await uiWait('This is taking longer than usual.', { timeout: 45000 })
    shot('09c-slow')
    await fetch('http://127.0.0.1:54321/__spa?mode=ok')
    await uiTap('Try again')
    await waitFor('recovery', () => !uiHas('This is taking longer than usual.'), { timeout: 20000 })
    page = await connectPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 20000 })
  })

  await check('sign-out invalidates the session on the server and on the device', async () => {
    await openDrawer(page)
    await page.tap('.sidebar-account-main')
    await waitFor('the account menu', () => page.eval(`!!document.querySelector('.sidebar-account-menu-item.is-danger')`))
    await page.tap('.sidebar-account-menu-item.is-danger')
    await waitFor('the sign-in form', () => page.eval(`!!document.querySelector('input[type="email"]')`), { timeout: 15000 })
    assert((await backendEvents()).some((e) => e.type === 'logout'), 'no logout reached the server')
    assert(!(await hasSession(page)), 'the session is still stored')
  })

  await check('signed out stays signed out after a relaunch', async () => {
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the sign-in form', () => page.eval(`!!document.querySelector('input[type="email"]')`))
  })

  await check('an expired session falls back to sign-in', async () => {
    await signIn(page)
    await fetch('http://127.0.0.1:54321/__expire-sessions', { method: 'POST' })
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the sign-in form', () => page.eval(`!!document.querySelector('input[type="email"]')`), { timeout: 20000 })
  })

  page?.close()
}

/* ── Native hooks ──────────────────────────────────────────────────────── */

const listDownloads = () => adbTry('shell', `ls "${DOWNLOADS}"`).out

const downloaded = (name) => waitFor(`${name} in Downloads`, () => listDownloads().split('\n').some((line) => line.trim() === name), { timeout: 20000 })

const remoteSha = (name) => adb('shell', `sha256sum "${DOWNLOADS}/${name}"`).split(' ')[0]

const sha = (text) => createHash('sha256').update(text).digest('hex')

async function filesScenario() {
  const page = await freshPage()
  await page.navigate(PROBE)
  await pageReady(page)
  await waitFor('the probe page', () => page.eval(`!!document.getElementById('blob-revoke')`))
  // Through the media store as well as the disk: a leftover row keeps the name taken.
  adbTry('shell', `content delete --uri content://media/external/file --where "_data LIKE '%/Dikho CRM/%'"`)
  adbTry('shell', `rm -rf "${DOWNLOADS}"`)
  shot('10-probe')

  const result = () => page.eval(`document.getElementById('result').textContent`)
  const tap = (id) => page.tap(`#${id}`)
  const tapDialog = (id) => page.tap(`#${id}`, { blocking: true })

  await check('the bridge exists on the CRM origin and nowhere else', async () => {
    assert(await page.eval(`typeof window.DikhoAndroid === 'object'`), 'missing on the CRM origin')
    const frame = await waitFor('the cross-origin frame report', () => page.eval('window.__frameBridge'))
    assert(frame === 'undefined', `a cross-origin frame sees ${frame}`)
  })

  await check('the bridge ignores malformed messages', async () => {
    await page.eval(`(() => {
      for (const bad of ['{', '[]', 'null', '{"t":"chunk","id":"9","seq":0,"data":"AAAA"}', '{"t":"end","id":"9"}', '{"t":"nonsense"}', '{"t":"begin","id":"x","name":"../../evil.txt","mime":"bad","size":-5}']) {
        window.DikhoAndroid.postMessage(bad)
      }
    })()`)
    await sleep(800)
    assert(!listDownloads().includes('evil'), 'a file was written')
    assert(foregroundPackage() === PACKAGE, 'the app did not survive')
  })

  await check('a blob download survives the page revoking its URL at once', async () => {
    await tap('blob-revoke')
    await downloaded('probe-invoice.pdf')
    assert(remoteSha('probe-invoice.pdf') === sha('%PDF-1.4 probe invoice\n'), 'content differs')
    await sleep(800)
    shot('11-saved')
  })

  await check('Excel export saves', async () => {
    await tap('blob-xlsx')
    await downloaded('probe-export.xlsx')
  })

  await check('a detached anchor saves', async () => {
    await tap('blob-detached')
    await downloaded('probe-detached.txt')
  })

  await check('a data: link saves', async () => {
    await tap('data-link')
    await downloaded('probe-data.txt')
    assert(remoteSha('probe-data.txt') === sha('probe data\n'), 'content differs')
  })

  await check('a 30 MB blob arrives intact', async () => {
    const started = Date.now()
    await tap('blob-large')
    await waitFor('the large file', () => listDownloads().includes('probe-large.bin') && adbTry('shell', `stat -c %s "${DOWNLOADS}/probe-large.bin"`).out.trim() === String(30 * 1024 * 1024), { timeout: 120000 })
    const expected = createHash('sha256').update(Buffer.alloc(30 * 1024 * 1024, 65)).digest('hex')
    await waitFor('the final hash', () => remoteSha('probe-large.bin') === expected, { timeout: 60000 })
    return `${Math.round((Date.now() - started) / 1000)} s`
  })

  await check('Open and Share act on a saved file', async () => {
    clearLog()
    await tap('blob-revoke')
    await waitFor('the save', () => appLog().includes('file event: downloadFinished'), { timeout: 15000 })
    await sleep(600)
    clearLog()
    tapAt(0.87, 0.931)
    await waitFor('a viewer', () => startedActivities().some((line) => line.includes('android.intent.action.VIEW')), { timeout: 8000 })
    await sleep(800)
    if (foregroundPackage() !== PACKAGE) pressBack()
    await waitFor('the app', () => foregroundPackage() === PACKAGE, { timeout: 8000 })
    clearLog()
    await tap('blob-revoke')
    await waitFor('the save', () => appLog().includes('file event: downloadFinished'), { timeout: 15000 })
    await sleep(600)
    clearLog()
    tapAt(0.683, 0.931)
    await waitFor('the share sheet', () => startedActivities().some((line) => /CHOOSER|android.intent.action.SEND/.test(line)), { timeout: 8000 })
    await sleep(800)
    shot('11b-share')
    pressBack()
    await waitFor('the app', () => foregroundPackage() === PACKAGE, { timeout: 8000 })
  })

  await check('an APK from a page can be saved but never opened from here', async () => {
    clearLog()
    await tap('blob-apk')
    await downloaded('probe-installer.apk')
    await waitFor('the save', () => appLog().includes('file event: downloadFinished'), { timeout: 15000 })
    await sleep(600)
    clearLog()
    tapAt(0.87, 0.931)
    await sleep(1200)
    shot('11d-apk-refused')
    assert(!startedActivities().some((line) => /packageinstaller|INSTALL/i.test(line)), 'the installer started')
    assert(foregroundPackage() === PACKAGE, 'the app was left')
  })

  await check('page console output stays out of the system log', async () => {
    clearLog()
    await tap('console-btn')
    await waitFor('the click', async () => (await result()) === 'logged')
    await sleep(500)
    assert(!adbTry('logcat', '-d').out.includes('probe-console-secret'), 'it reached logcat')
  })

  await check('Google sign-in leaves for the system browser, never the WebView', async () => {
    clearLog()
    await tap('oauth-assign')
    await waitFor('the browser to be asked', () => startedActivities().some((line) => line.includes('accounts.google.com')), { timeout: 10000 })
    await sleep(800)
    await waitFor('returning to the app', () => {
      if (foregroundPackage() === PACKAGE) return true
      shell('am start -n in.dikho.crm/.MainActivity')
      return false
    }, { timeout: 15000 })
    assert((await page.eval('location.href')).includes('__probe'), 'the WebView navigated')
  })

  await check('a blob over the size limit is refused with a message', async () => {
    clearLog()
    await tap('blob-oversize')
    await waitFor('the refusal', () => appLog().includes('file event: downloadFailed too_large'), { timeout: 15000 })
    await sleep(600)
    shot('11c-too-large')
    assert(!listDownloads().includes('probe-oversize'), 'it was saved')
  })

  await check('a signed link marked download saves natively', async () => {
    await tap('signed-download')
    await downloaded('probe-signed.pdf')
    assert((await backendEvents()).some((e) => e.type === 'file_fetched' && e.path.includes('probe.pdf')), 'the backend saw no fetch')
  })

  await check('window.open of a signed link fetches natively and asks for a viewer', async () => {
    clearLog()
    await tap('signed-open')
    await waitFor('the fetch', async () => (await backendEvents()).some((e) => e.type === 'file_fetched' && e.path.includes('view.pdf')), { timeout: 15000 })
    await sleep(1500)
    const opened = startedActivities().some((line) => line.includes('android.intent.action.VIEW'))
    const refused = uiHas(/No app on this phone can open/)
    assert(opened || refused, 'neither a viewer nor a message appeared')
    shot('12-view')
    if (foregroundPackage() !== PACKAGE) pressBack()
    assert((await page.eval('location.href')).includes('__probe'), 'the WebView navigated away')
    return opened ? 'viewer opened' : 'no viewer installed, message shown'
  })

  await check('a PDF in an iframe is handed to native code, not left blank', async () => {
    await tap('iframe-pdf')
    await waitFor('the fetch', async () => (await backendEvents()).some((e) => e.type === 'file_fetched' && e.path.includes('doc.pdf')), { timeout: 15000 })
    await sleep(1000)
    if (foregroundPackage() !== PACKAGE) pressBack()
  })

  await check('confirm() shows a dialog and returns the answer', async () => {
    await tapDialog('confirm-btn')
    await uiWait('Delete this probe record?')
    shot('13-confirm')
    await uiTap('Cancel')
    await waitFor('false', async () => (await result()) === 'confirm: false')
    await tapDialog('confirm-btn')
    await uiTap('OK')
    await waitFor('true', async () => (await result()) === 'confirm: true')
  })

  await check('alert() shows a dialog', async () => {
    await tapDialog('alert-btn')
    await uiWait('Probe alert')
    await uiTap('OK')
    await waitFor('return', async () => (await result()) === 'alert returned')
  })

  await check('prompt() shows a dialog and returns the text', async () => {
    await tapDialog('prompt-btn')
    await uiTap('OK')
    await waitFor('the text', async () => (await result()) === 'prompt: default')
  })

  await check('clipboard write works', async () => {
    await tap('clipboard-btn')
    await waitFor('the result', async () => (await result()).startsWith('clipboard'), { timeout: 5000 })
    assert((await result()) === 'clipboard ok', await result())
    // Pasting proves the text arrived, whichever path this WebView took.
    await page.eval(`document.getElementById('text-field').value = ''`)
    await page.tap('#text-field')
    await sleep(600)
    shell('input keyevent KEYCODE_PASTE')
    await waitFor('the paste', async () => (await page.eval(`document.getElementById('text-field').value`)) === 'probe-clipboard', { timeout: 6000 })
    await page.eval('document.activeElement.blur()')
    shell('input keyevent KEYCODE_ESCAPE')
    await sleep(500)
  })

  await check('external links open outside the app', async () => {
    for (const [id, needle] of [['ext-blank', 'example.com'], ['ext-self', 'example.com'], ['tel-link', 'DIAL'], ['wa-link', 'wa.me']]) {
      clearLog()
      await tap(id)
      await waitFor(`${id} to start an activity`, () => startedActivities().some((line) => line.includes(needle)), { timeout: 10000 })
      await sleep(800)
      assert((await page.eval('location.href').catch(() => PROBE)).includes('__probe'), `${id} navigated the WebView`)
      await waitFor('returning to the app', () => {
        if (foregroundPackage() === PACKAGE) return true
        shell('am start -n in.dikho.crm/.MainActivity')
        return false
      }, { timeout: 15000 })
    }
  })

  await check('a link inside a sandboxed email frame opens outside the app', async () => {
    clearLog()
    await tap('sandbox-frame')
    await waitFor('the browser to be asked', () => startedActivities().some((line) => line.includes('example.com')), { timeout: 10000 })
    await sleep(800)
    await waitFor('returning to the app', () => {
      if (foregroundPackage() === PACKAGE) return true
      shell('am start -n in.dikho.crm/.MainActivity')
      return false
    }, { timeout: 15000 })
    assert((await page.eval('location.href')).includes('__probe'), 'the WebView navigated')
  })

  await check('mailto opens a mail app or says none exists', async () => {
    clearLog()
    await tap('mailto-link')
    await sleep(1500)
    const opened = startedActivities().some((line) => line.includes('SENDTO'))
    assert(opened || uiHas(/No app on this phone/), 'nothing happened')
    if (foregroundPackage() !== PACKAGE) shell('am start -n in.dikho.crm/.MainActivity')
    await sleep(800)
  })

  await check('intent:, file: and content: links are refused', async () => {
    for (const id of ['intent-link', 'file-link', 'content-link']) {
      clearLog()
      await tap(id)
      await sleep(1000)
      assert(foregroundPackage() === PACKAGE, `${id} left the app`)
      assert(!startedActivities().some((line) => /intent:|chrome|VIEW/.test(line)), `${id} started an activity`)
      assert((await page.eval('location.href')).includes('__probe'), `${id} navigated`)
    }
  })

  await check('an internal link loads in the app, and back returns', async () => {
    await tap('inner-link')
    await waitFor('the inner page', async () => (await page.eval('location.search')) === '?page=2')
    pressBack()
    await waitFor('the first page', async () => (await page.eval('location.search')) === '')
  })

  await check('upload: the system picker returns a readable file', async () => {
    shell(`mkdir -p /sdcard/Download/probe-upload && printf 'probe upload\\n' > /sdcard/Download/probe-upload/probe-upload.pdf && am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/probe-upload/probe-upload.pdf >/dev/null`)
    await sleep(1000)
    await tap('upload-single')
    await uiWait(/probe-upload|Download|Recent|Browse/i, { timeout: 15000 })
    shot('14-picker')
    if (!uiHas('probe-upload.pdf')) {
      await uiTap(/Show roots|More options|Navigate up/i, { timeout: 4000 }).catch(() => {})
      await sleep(800)
      await uiTap(/^Downloads$/, { timeout: 5000 }).catch(() => {})
      await sleep(800)
      await uiTap('probe-upload', { timeout: 5000 }).catch(() => {})
      await sleep(800)
    }
    await uiTap('probe-upload.pdf', { timeout: 10000 })
    await waitFor('the upload result', async () => (await result()).startsWith('upload-single'), { timeout: 15000 })
    const text = await result()
    assert(text.includes('probe-upload.pdf') && text.includes('read=13'), text)
    return text
  })

  await check('upload: several files can be picked at once', async () => {
    shell(`printf 'second\\n' > /sdcard/Download/probe-upload/probe-second.pdf && am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/probe-upload/probe-second.pdf >/dev/null`)
    await sleep(1500)
    await tap('upload-multi')
    // Selects a first file with a long press, then the second by name. Which file
    // the long press lands on depends on the recent-files list, and is not the point.
    const first = await uiFind('probe-upload.pdf', { timeout: 15000 })
    shell(`input swipe ${first.x} ${first.y} ${first.x} ${first.y} 900`)
    await sleep(800)
    await uiTap('probe-second.pdf', { timeout: 8000 })
    await sleep(500)
    await uiTap(/^Select$/i, { timeout: 8000 })
    await waitFor('the upload result', async () => (await result()).startsWith('upload-multi'), { timeout: 15000 })
    const text = await result()
    const picked = [...text.matchAll(/(\S+\.pdf) type=application\/pdf read=(\d+)/g)]
    assert(picked.length === 2 && picked[0][1] !== picked[1][1], text)
    assert(picked.every((file) => Number(file[2]) > 0), text)
    return text
  })

  await check('upload: cancelling the picker leaves the page working', async () => {
    // As the CRM does after every pick. Without it, cancelling clears the earlier
    // selection and fires a change event, which is standard browser behaviour.
    await page.eval(`document.getElementById('upload-multi').value = ''; document.getElementById('result').textContent = 'before'`)
    await tap('upload-multi')
    await uiWait(/Download|Recent|Browse|probe-upload/i, { timeout: 15000 })
    pressBack()
    await waitFor('the app to return', () => foregroundPackage() === PACKAGE, { timeout: 8000 })
    assert((await result()) === 'before', await result())
    await tapDialog('confirm-btn')
    await uiTap('Cancel')
    await waitFor('the page to respond', async () => (await result()) === 'confirm: false')
  })

  await check('after hours away the page refreshes, unless someone is typing', async () => {
    if (!hasRoot()) return 'NOT RUN: setting the clock needs a rooted image'
    await page.navigate(PROBE)
    await pageReady(page)
    let hoursAway = 0
    const hostNow = () => Math.floor(Date.now() / 1000)
    const away = async () => {
      shell('input keyevent KEYCODE_HOME')
      await sleep(2000)
      hoursAway += 9
      adbTry('shell', `date @${hostNow() + hoursAway * 3600}`)
      shell(`am start -n ${PACKAGE}/.MainActivity`)
      await waitFor('the app', () => foregroundPackage() === PACKAGE, { timeout: 10000 })
      await sleep(2500)
    }
    await page.tap('#text-field')
    await page.eval('window.__staleMarker = 1')
    await away()
    assert((await page.eval('window.__staleMarker')) === 1, 'it reloaded over someone typing')
    await page.eval('document.activeElement.blur()')
    await away()
    await waitFor('the refresh', async () => (await page.eval('window.__staleMarker')) === undefined, { timeout: 10000 })
    adbTry('shell', `date @${hostNow()}`)
  })

  page.close()
}

/* ── Updates ───────────────────────────────────────────────────────────── */

function publishTestRelease(apk, { version, code, minSupported = 1, sha256 } = {}) {
  const dir = values.updates
  const name = `dikho-crm-v${version}.apk`
  mkdirSync(join(dir, 'releases'), { recursive: true })
  copyFileSync(apk, join(dir, 'releases', name))
  const manifest = {
    schema: 1,
    appId: PACKAGE,
    channels: {
      stable: {
        version,
        versionCode: code,
        minSupportedVersionCode: minSupported,
        releaseNotes: 'Device test release.',
        apkUrl: `/releases/${name}`,
        sha256: sha256 ?? sha256File(apk),
        sizeBytes: statSync(apk).size,
        publishedAt: '2026-11-04T00:00:00Z',
      },
    },
  }
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest))
}

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const hasRoot = () => adbTry('shell', 'id -u').out.trim() === '0'

/**
 * Forgets "checked recently" and "Later" so the next launch checks again. A user
 * build of Android has no way to reach one app file, so there it clears the app and
 * reports that the sign-in went with it.
 */
function clearUpdateState() {
  if (hasRoot()) {
    adbTry('shell', `rm -f /data/data/${PACKAGE}/files/update_state.json`)
    return true
  }
  adbTry('shell', `pm clear ${PACKAGE}`)
  return false
}

const installedCode = () => Number(shell(`dumpsys package ${PACKAGE}`).match(/versionCode=(\d+)/)?.[1])

async function upgradeScenario() {
  const oldApk = values['old-apk']
  const newApk = values['new-apk']
  let page

  await check('install signed 1.0.0 fresh and sign in', async () => {
    adbTry('uninstall', PACKAGE)
    adb('install', oldApk)
    assert(installedCode() === 1, `code ${installedCode()}`)
    writeFileSync(join(values.updates, 'manifest.json'), JSON.stringify({ schema: 1, appId: PACKAGE, channels: { stable: null } }))
    page = await freshPage()
    await signIn(page)
    await page.eval(`localStorage.setItem('upgrade-marker', 'kept')`)
    shot('20-v1-signed-in')
  })

  await check('no update offered while none is published', async () => {
    await waitFor('the update check', async () => (await backendEvents()).some((e) => e.type === 'update_check'), { timeout: 15000 })
    await sleep(1500)
    assert(!uiHas('New update available'), 'a dialog appeared')
  })

  const relaunch = async () => {
    page?.close()
    forceStop()
    const keptData = clearUpdateState()
    page = await freshPage()
    if (!keptData) {
      await signIn(page)
      await page.eval(`localStorage.setItem('upgrade-marker', 'kept')`)
      // Long enough for the WebView to write that to disk.
      await sleep(8000)
    }
  }

  await check('the check does not repeat within its interval', async () => {
    const before = (await backendEvents()).filter((e) => e.type === 'update_check').length
    page.close()
    forceStop()
    page = await freshPage()
    await sleep(3000)
    const after = (await backendEvents()).filter((e) => e.type === 'update_check').length
    assert(after === before, `${after - before} extra checks`)
  })

  await check('the app runs normally when the update service is down', async () => {
    page.close()
    forceStop()
    const keptData = clearUpdateState()
    clearLog()
    page = await freshPage({ updateService: false })
    if (!keptData) await signIn(page)
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
    // Proof the service really was out of reach, and not just empty.
    const line = await waitFor('the failed check', () => appLog().split('\n').find((entry) => entry.includes('update check failed')), { timeout: 30000 })
    assert(uiHas('Clients') || (await page.eval(`!!document.querySelector('.app-shell')`)), 'the CRM is not usable')
    assert(!uiHas('New update available'), 'a dialog appeared')
    adb('reverse', 'tcp:8799', 'tcp:8799')
    return line.slice(line.indexOf('update check failed'))
  })

  await check('update available shows the dialog, and Later keeps working', async () => {
    publishTestRelease(newApk, { version: '1.1.0', code: 2 })
    await relaunch()
    await uiWait('New update available', { timeout: 20000 })
    assert(uiHas('Dikho CRM v1.1.0'), 'the version is missing')
    shot('21-update-dialog')
    await uiTap('Later')
    await waitFor('the dialog to close', () => !uiHas('New update available'), { timeout: 5000 })
    assert(await page.eval(`!!document.querySelector('.app-shell')`), 'the CRM is not usable')
  })

  await check('a corrupted download is rejected and nothing installs', async () => {
    publishTestRelease(newApk, { version: '1.1.0', code: 2, sha256: 'b'.repeat(64) })
    await relaunch()
    await uiTap('Update Now', { timeout: 20000 })
    await uiWait('The download was damaged', { timeout: 60000 })
    shot('22-checksum-mismatch')
    assert(installedCode() === 1, 'it installed')
    await uiTap('Later')
  })

  if (values['other-signer-apk']) {
    await check('an APK signed by another key is rejected before the installer', async () => {
      publishTestRelease(values['other-signer-apk'], { version: '1.1.0', code: 2 })
      await relaunch()
      await uiTap('Update Now', { timeout: 20000 })
      await uiWait('This update was rejected', { timeout: 60000 })
      shot('23-wrong-signer')
      assert(installedCode() === 1, 'it installed')
      await uiTap('Later')
    })
  }

  await check('with install permission denied, it explains and stays usable', async () => {
    publishTestRelease(newApk, { version: '1.1.0', code: 2 })
    shell(`appops set ${PACKAGE} REQUEST_INSTALL_PACKAGES default`)
    await relaunch()
    await uiTap('Update Now', { timeout: 20000 })
    await uiWait('Allow Dikho CRM to install updates', { timeout: 60000 })
    shot('24-permission')
    await uiTap('Not now')
    await waitFor('the dialog to close', () => !uiHas('Allow Dikho CRM to install updates'), { timeout: 5000 })
    assert(installedCode() === 1, 'it installed')
  })

  await check('cancelling Android\'s installer screen leaves 1.0.0 working, with a retry', async () => {
    await relaunch()
    await uiTap('Update Now', { timeout: 20000 })
    await uiWait('Allow Dikho CRM to install updates', { timeout: 60000 })
    await uiTap('Open settings')
    await waitFor('the settings screen', () => foregroundPackage() !== PACKAGE, { timeout: 8000 })
    shot('25-settings')
    shell(`appops set ${PACKAGE} REQUEST_INSTALL_PACKAGES allow`)
    pressBack()
    await uiWait(/Do you want to (update|install)|Update/i, { timeout: 30000 })
    shot('26-installer')
    await uiTap(/^Cancel$/i, { timeout: 15000 })
    await uiWait('Update not installed', { timeout: 20000 })
    shot('27-installer-cancelled')
    assert(installedCode() === 1, 'it installed')
  })

  await check('a real signed upgrade to 1.1.0 keeps the sign-in and data', async () => {
    const before = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    await uiTap('Try again', { timeout: 10000 })
    await uiWait(/Do you want to (update|install)|^Update$/i, { timeout: 30000 })
    await uiTap(/^Update$/i, { timeout: 15000 })
    // A Play-certified build adds Play Protect's own prompts for an app it has not
    // seen before. A real person meets these too, so they are walked through here.
    let sawPlayProtect = false
    await waitFor('version code 2', async () => {
      if (installedCode() === 2) return true
      for (const label of ['Scan app', /^Install anyway$/i, /^Install$/i, /^Got it$/i, /^OK$/i]) {
        if (uiHas(label)) {
          sawPlayProtect = true
          shot(`28a-play-protect-${String(label).replace(/[^a-z]/gi, '')}`)
          await uiTap(label, { timeout: 4000 }).catch(() => {})
          break
        }
      }
      return false
    }, { timeout: 240000, every: 2500 })
    page?.close()
    page = await freshPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
    assert((await page.eval(`localStorage.getItem('upgrade-marker')`)) === 'kept', 'local data was lost')
    assert(await hasSession(page), 'the session was lost')
    const after = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    assert(after === before, 'a new sign-in was needed')
    const agent = await page.eval('navigator.userAgent')
    assert(agent.includes('DikhoCRM/1.1.0'), agent)
    shot('28-v1.1-signed-in')
    return sawPlayProtect ? 'through Play Protect\'s prompt' : ''
  })

  await check('the CRM still works after the upgrade', async () => {
    await openDrawer(page)
    await page.eval(`[...document.querySelectorAll('.sidebar a, .sidebar button')].find((e) => /Vendors/.test(e.textContent)).click()`)
    await waitFor('vendors', async () => (await pagePath(page)) === '/vendors')
  })

  await check('1.1.0 is up to date, so no dialog appears', async () => {
    await relaunch()
    await sleep(3000)
    assert(!uiHas('New update available'), 'a dialog appeared')
  })

  page?.close()
}

/* ── Layout scan ───────────────────────────────────────────────────────── */

// Sideways overflow and small tap targets on every CRM route, in the real WebView.
// Lists are nearly empty against the fake backend, so wide data is not covered here.
async function layoutScenario() {
  const routes = [
    '/clients', '/leads', '/vendors', '/sales-orders', '/purchase-orders', '/users', '/settings',
    '/settings/profile', '/settings/preferences', '/settings/security',
    '/email', '/email/inbox', '/email/settings', '/whatsapp', '/whatsapp/inbox',
  ]
  const page = await freshPage()
  await page.navigate(`${CRM}/`)
  const signedIn = await waitFor('the sign-in or the shell', () => page.eval(`document.querySelector('.app-shell') ? 'yes' : (document.querySelector('input[type="email"]') ? 'no' : null)`))
  if (signedIn === 'no') await signIn(page)
  for (const route of routes) {
    await check(`no sideways overflow on ${route}`, async () => {
      await page.navigate(`${CRM}${route}`)
      await waitFor('the shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 20000 })
      await sleep(1500)
      const scan = JSON.parse(await page.eval(`JSON.stringify((() => {
        const docOverflow = document.documentElement.scrollWidth - window.innerWidth
        const small = [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')].filter((el) => {
          const r = el.getBoundingClientRect()
          const shown = r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth && getComputedStyle(el).visibility !== 'hidden'
          return shown && (r.height < 32 || r.width < 32) && !el.closest('.sidebar')
        }).map((el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).trim().slice(0, 24))
        return { docOverflow, width: window.innerWidth, small }
      })())`))
      assert(scan.docOverflow <= 1, `page is ${scan.docOverflow}px wider than the ${scan.width}px screen`)
      return scan.small.length ? `under 32px: ${[...new Set(scan.small)].slice(0, 6).join(' | ')}` : ''
    })
  }
  page.close()
}

/* ── Reinstall ─────────────────────────────────────────────────────────── */

// The app used to crash here. A file saved by an earlier install stays in the media
// store. If it is then removed from disk behind the store's back, the new install
// cannot see the row, and Android refuses the name when the save is published.
async function reinstallScenario() {
  const apk = values['old-apk']
  const saveOnce = async () => {
    const page = await freshPage()
    await page.navigate(PROBE)
    await pageReady(page)
    await waitFor('the probe page', () => page.eval(`!!document.getElementById('blob-conflict')`))
    const pid = adbTry('shell', `pidof ${PACKAGE}`).out.trim()
    clearLog()
    await page.tap('#blob-conflict')
    await waitFor('the result', () => /file event: download(Finished|Failed)/.test(appLog()), { timeout: 20000 })
    await sleep(1000)
    const alive = adbTry('shell', `pidof ${PACKAGE}`).out.trim() === pid
    const log = appLog()
    page.close()
    return { alive, log }
  }
  const names = () => listDownloads().split('\n').map((line) => line.trim()).filter((line) => line.startsWith('probe-conflict'))

  adbTry('shell', `content delete --uri content://media/external/file --where "_data LIKE '%/Dikho CRM/%'"`)
  adbTry('shell', `rm -rf "${DOWNLOADS}"`)
  adbTry('uninstall', PACKAGE)
  adb('install', apk)

  await check('a first install saves the file', async () => {
    const { alive } = await saveOnce()
    assert(alive, 'the app crashed')
    assert(names().includes('probe-conflict.pdf'), names().join(', '))
  })

  await check('after a reinstall, saving a name the media store still holds does not crash', async () => {
    forceStop()
    adbTry('uninstall', PACKAGE)
    // Under the storage layer, so the media store keeps its row. Through /sdcard it
    // would notice and clean up, which is the case that never failed.
    adbTry('shell', 'rm "/data/media/0/Download/Dikho CRM/probe-conflict.pdf"')
    adb('install', apk)
    const { alive, log } = await saveOnce()
    assert(alive, 'the app crashed')
    assert(log.includes('file event: downloadFinished'), 'the save did not finish')
    const saved = names()
    assert(saved.length > 0, 'nothing was saved')
    // Whichever name Android settled on, the newest file holds what was saved.
    const newest = adb('shell', `ls -t "${DOWNLOADS}"`).split('\n').map((line) => line.trim()).find((line) => line.startsWith('probe-conflict'))
    assert(remoteSha(newest) === sha('conflict'), 'content differs')
    return saved.join(', ')
  })
}

/* ── Single-purpose builds ─────────────────────────────────────────────── */

// Needs a build with --dart-define=FORCE_SAVE_DIALOG=true: the path Android 7 to 9 take.
async function saveDialogScenario() {
  const page = await freshPage()
  await page.navigate(PROBE)
  await pageReady(page)
  await waitFor('the probe page', () => page.eval(`!!document.getElementById('blob-revoke')`))
  const target = '/sdcard/Download/probe-invoice.pdf'
  adbTry('shell', `rm -f "${target}"`)

  await check('the system save dialog is offered, and cancelling it saves nothing', async () => {
    await page.tap('#blob-revoke')
    await uiFind(/^SAVE$/i, { timeout: 15000 })
    shot('30-save-dialog')
    pressBack()
    await waitFor('the app', () => foregroundPackage() === PACKAGE, { timeout: 10000 })
    assert(await page.eval('document.title.length >= 0'), 'the page stopped responding')
  })

  await check('saving through the dialog writes the real content', async () => {
    clearLog()
    await page.tap('#blob-revoke')
    await uiTap(/^SAVE$/i, { timeout: 15000 })
    await waitFor('the save', () => appLog().includes('file event: downloadFinished'), { timeout: 15000 })
    const found = adbTry('shell', 'find /sdcard/Download /sdcard/Documents -name "probe-invoice*.pdf"').out.split('\n').map((line) => line.trim()).filter(Boolean).at(-1)
    assert(found, 'no file found')
    assert(adb('shell', `sha256sum "${found}"`).split(' ')[0] === sha('%PDF-1.4 probe invoice\n'), 'content differs')
    return found
  })
  page.close()
}

// Needs a build pointing UPDATE_BASE_URL at a real https host that answers with
// something other than the update API: the failure reason then proves whether the
// TLS handshake succeeded.
async function tlsScenario() {
  clearLog()
  connectBackends()
  await launchWhenReady()
  await check('the update client completes TLS to a real Cloudflare host from the device', async () => {
    const line = await waitFor('the update check', () => appLog().split('\n').find((entry) => entry.includes('update check failed')), { timeout: 45000 })
    assert(line.includes('malformed response'), line)
    return line.slice(line.indexOf('update check failed'))
  })
}

async function run() {
  const scenario = positionals[0]
  // A software-rendered emulator can trip Android's "not responding" dialog for
  // its own System UI, which then takes every key press meant for the app.
  shell('settings put global hide_error_dialogs 1')
  // Root sets the clock in the "hours away" check. Restarts adbd, so before anything else.
  adbTry('root')
  await sleep(2500)
  adb('wait-for-device')
  // A run that was cut short can leave the fake server misbehaving on purpose.
  await fetch('http://127.0.0.1:54321/__spa?mode=ok')
  await fetch('http://127.0.0.1:54321/__clear-releases')
  if (scenario === 'web') await webScenario()
  else if (scenario === 'files') await filesScenario()
  else if (scenario === 'upgrade') await upgradeScenario()
  else if (scenario === 'save-dialog') await saveDialogScenario()
  else if (scenario === 'reinstall') await reinstallScenario()
  else if (scenario === 'layout') await layoutScenario()
  else if (scenario === 'tls') await tlsScenario()
  else if (scenario === 'no-debug') {
    await check('a production build exposes no WebView debug socket and is not debuggable', async () => {
      launch()
      await sleep(8000)
      assert(adbTry('shell', `pidof ${PACKAGE}`).out.trim() !== '', 'the app is not running')
      assert(!shell(`dumpsys package ${PACKAGE}`).includes('DEBUGGABLE'), 'the app is debuggable')
      assert(adbTry('shell', `run-as ${PACKAGE} ls`).out.includes('not debuggable'), 'run-as was allowed')
      shot('40-production-sign-in')
      // A userdebug Android image switches WebView debugging on for every app, so
      // the socket proves nothing there. Only a user build can answer this.
      const osDebuggable = adbTry('shell', 'getprop ro.debuggable').out.trim() === '1'
      if (osDebuggable) return 'SOCKET NOT CHECKED: this OS image is a debug build'
      assert(!debugSocketExists(), 'the debug socket exists')
      return `no socket on ${adbTry('shell', 'getprop ro.build.type').out.trim()} build`
    })
  } else {
    console.error('Scenario must be web, files, layout, upgrade, reinstall, save-dialog, tls or no-debug')
    process.exit(2)
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

await run()
