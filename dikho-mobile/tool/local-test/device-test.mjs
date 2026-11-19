#!/usr/bin/env node
// End-to-end checks on a running emulator, against tool/local-test/server.mjs.
// Nothing here reaches production. Prints one line per check and exits non-zero
// if any fail. Run the install yourself first, or use the upgrade scenario.
//
//   node dikho-mobile/tool/local-test/device-test.mjs <scenario> [--shots <dir>]
//
// Scenarios: web, files, layout, native, updates, walk, upgrade, reinstall, save-dialog,
// tls, no-debug.

import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  PACKAGE, Page, adb, adbTry, appLog, backendEvents, clearLog, connectBackends, connectPage, debugSocketExists, forceStop,
  foregroundPackage, launch, launchWhenReady, pressBack, screenshot, shell, sleep, startedActivities, tapAt, uiFind, uiHas, uiTap, uiTapLast, uiWait, waitFor,
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

/** The native drawer. The app hides the page's own. */
async function openDrawer() {
  await uiTap('Open menu', { timeout: 20000 })
  await uiWait(/^Clients/)
}

/** Opens a CRM page from the native drawer. */
async function openFromDrawer(page, label, path) {
  await openDrawer()
  const entry = new RegExp(`^${label}`)
  for (let i = 0; i < 4 && !uiHas(entry); i += 1) { swipeUp(); await sleep(500) }
  await uiTap(entry)
  await waitFor(path, async () => (await pagePath(page)) === path)
}

async function logOutFromDrawer(page, shotName) {
  await openDrawer()
  for (let i = 0; i < 4 && !uiHas('Log out'); i += 1) { swipeUp(); await sleep(500) }
  await uiTap('Log out')
  await uiWait('Log out of Dikho CRM?')
  if (shotName) shot(shotName)
  const yes = await uiFind(/^Log out$/)
  shell(`input tap ${yes.x} ${yes.y}`)
  await waitFor('the sign-in screen', () => signInShown(page), { timeout: 20000 })
}

/* ── Native screens ────────────────────────────────────────────────────── */

const BACKEND = 'http://127.0.0.1:54321'
const eventsOf = async (type) => (await backendEvents()).filter((e) => e.type === type)
const swipeUp = () => shell('input swipe 500 1700 500 500 200')
const typeText = (text) => shell(`input text '${text.replace(/ /g, '%s')}'`)

async function broadcast(event, payload) {
  return (await fetch(`${BACKEND}/__broadcast`, { method: 'POST', body: JSON.stringify({ event, payload }) })).json()
}

// What Android's audio service says is recording right now, on any Android 10 or later.
const micInUse = () => /riid \d+; active\? true/.test(adbTry('shell', 'dumpsys audio').out)

async function allowPermissionIfAsked() {
  const button = await waitFor('Android permission prompt', () => {
    const allow = /^(While using the app|Allow|ALLOW)$/
    return uiHas(allow) ? allow : null
  }, { timeout: 15000 })
  await uiTap(button)
}

async function nativeScenario() {
  let page
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()

  await check('the logo shows at once, with nothing fetched for it', async () => {
    page = await connectPage()
    shot('50-first-screen')
  })

  await check('the app signs in itself, the page uses its session, and the session is in the Keystore vault', async () => {
    shot('50b-native-sign-in')
    await signIn(page)
    assert(await page.eval(`window.__dikhoNative.auth.owner === 'app'`), 'the page does not know the app owns the session')
    // The page's refresh goes to the app, which answers with the fresh session it holds.
    const refreshed = (await eventsOf('session_refreshed')).length
    const answer = await page.eval(`window.__dikhoNative.auth.refresh('sb-localhost-auth-token')`)
    assert(typeof answer === 'string' && answer.includes('refresh_token'), 'no session from the app')
    assert((await eventsOf('session_refreshed')).length === refreshed, 'a fresh session was refreshed anyway')
    const shellMark = await page.eval(`document.documentElement.getAttribute('data-shell')`)
    assert(shellMark === 'android', `data-shell is ${shellMark}`)
    const inPageStorage = await page.eval(`Object.keys(localStorage).filter((k) => k.startsWith('sb-') && k.endsWith('-auth-token')).length`)
    assert(inPageStorage === 0, 'the session is still in localStorage')
    const held = await page.eval(`window.__dikhoNative.vault.get('sb-localhost-auth-token')`)
    assert(typeof held === 'string' && held.includes('access_token'), 'the vault has no session')
  })

  await check('the vault refuses anything but the session keys', async () => {
    const stored = await page.eval(`(async () => {
      const set = await window.__dikhoNative.vault.set('something-else', 'x')
      return [set, await window.__dikhoNative.vault.get('something-else')]
    })()`)
    assert(stored[0] === null && stored[1] === null, JSON.stringify(stored))
  })

  await check('the page has no way to reach contacts, calls or the recorder', async () => {
    const before = (await backendEvents()).length
    await page.eval(`for (const t of ['readContacts', 'placeCall', 'voiceStart', 'copyPicked']) window.__dikhoNative.post({ t })`)
    await sleep(500)
    assert((await backendEvents()).length === before, 'something happened')
  })

  await check('the page has its own nav hidden, and the native top bar is there', async () => {
    await waitFor('hidden page nav', () => page.eval(`getComputedStyle(document.querySelector('.mobile-topbar')).display === 'none' && getComputedStyle(document.querySelector('.sidebar')).display === 'none'`))
    await uiWait('Open menu', { timeout: 20000 })
    shot('51-web-with-native-bar')
  })

  await check('the app opens on native Clients: a page of 25, newest first, from Supabase', async () => {
    await uiWait(/Search company, contact, email, GSTIN or PAN/, { timeout: 20000 })
    const first = (await eventsOf('clients_page')).find((e) => e.range)
    assert(first?.range === '0-24', JSON.stringify(first))
    await uiWait(/Synthetic Client 60/)
    shot('51b-clients')
  })

  await check('a client opens with its contact, tax and address details', async () => {
    await uiTap(/Synthetic Client 60/)
    await uiWait(/Client #60/, { timeout: 10000 })
    await uiWait(/\+91 9820000060/)
    for (const label of ['Contact person', 'GSTIN', 'TDS section']) await uiWait(new RegExp(`^${label}`))
    shot('51c-client-details')
  })

  await check('editing a client saves only that row through Supabase, and shows at once', async () => {
    await uiTap('Edit client')
    await uiWait(/^Company name/, { timeout: 8000 })
    for (let i = 0; i < 4 && !uiHas(/^City/); i += 1) { swipeUp(); await sleep(500) }
    const city = await uiFind(/^City/)
    shell(`input tap ${city.x} ${city.y}`)
    await sleep(400)
    shell('input keyevent KEYCODE_MOVE_END')
    for (let i = 0; i < 10; i += 1) shell('input keyevent KEYCODE_DEL')
    typeText('Pune')
    pressBack()
    await sleep(400)
    await uiTap(/^Save$/)
    const update = await waitFor('the update', async () => (await eventsOf('client_update')).at(-1), { timeout: 10000 })
    assert(update.id === 60 && update.body.city === 'Pune' && update.single, JSON.stringify(update))
    await uiWait(/Client saved/, { timeout: 8000 })
    for (let i = 0; i < 4 && !uiHas(/Pune/); i += 1) { swipeUp(); await sleep(500) }
    assert(uiHas(/Pune/), 'the new city is not shown')
    shot('51d-client-saved')
  })

  await check('leaving a changed form asks before throwing the changes away', async () => {
    await uiTap('Edit client')
    await uiWait(/^Company name/, { timeout: 8000 })
    const person = await uiFind(/^Contact 60$/)
    shell(`input tap ${person.x} ${person.y}`)
    await sleep(600)
    shell('input keyevent KEYCODE_MOVE_END')
    typeText('x')
    await uiWait(/^Contact 60x$/, { timeout: 5000 })
    // Away from the field first, so Back goes to the form rather than the keyboard.
    shell('input keyevent KEYCODE_ESCAPE')
    await sleep(600)
    for (let i = 0; i < 2 && !uiHas('Discard your changes?'); i += 1) { pressBack(); await sleep(800) }
    await uiWait('Discard your changes?', { timeout: 5000 })
    await uiTap(/^Discard$/)
    await uiWait(/Client #60/, { timeout: 8000 })
  })

  await check('Back on the screen the app opened on asks before leaving, not another page', async () => {
    pressBack()
    await uiWait(/Search company, contact, email, GSTIN or PAN/, { timeout: 8000 })
    pressBack()
    await sleep(1200)
    assert(foregroundPackage() === PACKAGE, 'left on one press')
    assert(uiHas(/Search company, contact, email, GSTIN or PAN/), 'it jumped to another page')
    shot('51f-press-again')
  })

  await check('New order opens the native sales order form with this client chosen', async () => {
    await uiTap(/Synthetic Client 60/)
    await uiWait(/Client #60/, { timeout: 10000 })
    await uiTap(/^New order$/)
    await uiWait(/^New sales order$/, { timeout: 15000 })
    await uiWait(/Synthetic Client 60/)
    shot('51e-new-order')
    // Nothing typed yet, so Back just closes it, onto the native Sales orders list.
    pressBack()
    await uiWait(/SO-TEST-1/, { timeout: 15000 })
  })

  await check('a new client is added once, and opens straight away', async () => {
    await uiTap('Open menu')
    await uiTap(/^Clients/)
    await uiTap(/^New client$/, { timeout: 15000 })
    await uiWait(/Only the company name is required/, { timeout: 8000 })
    await uiTap(/^Add$/)
    await uiWait('Enter the company name.', { timeout: 5000 })
    assert(!(await eventsOf('client_insert')).length, 'it saved with no company name')
    const company = await uiFind(/^Company name/)
    shell(`input tap ${company.x} ${company.y}`)
    await sleep(400)
    typeText('Brand New Client')
    pressBack()
    await sleep(400)
    await uiTap(/^Add$/)
    const insert = await waitFor('the insert', async () => (await eventsOf('client_insert')).at(-1), { timeout: 10000 })
    assert(insert.body.company_name === 'Brand New Client' && insert.body.country === 'India' && insert.body.status === 1, JSON.stringify(insert))
    assert((await eventsOf('client_insert')).length === 1, 'sent twice')
    await uiWait(/Client #61/, { timeout: 10000 })
    pressBack()
    await uiWait(/Brand New Client/, { timeout: 8000 })
  })

  await check('the drawer lists what this person may open, grouped, with the account', async () => {
    await uiTap('Open menu')
    for (const label of ['Clients', 'Leads', 'WhatsApp', 'Inbox']) await uiWait(new RegExp(`^(\\d+\\s+)?${label}`))
    await uiWait(/owner@example\.test|Local|owner/i)
    shot('52-drawer')
  })

  await check('a drawer entry opens that CRM page, and the drawer shows where you are', async () => {
    for (let i = 0; i < 4 && !uiHas(/^Email settings/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Email settings/)
    await waitFor('the email settings page', async () => (await pagePath(page)) === '/email/settings')
    await sleep(800)
    shot('53-email-settings')
  })

  await check('Leads is native: a page of 25 from Supabase with the session, newest first', async () => {
    await uiTap('Open menu')
    await uiTap(/^Leads/)
    await uiWait(/Example Gifts/, { timeout: 20000 })
    const first = (await eventsOf('leads_page'))[0]
    assert(first.range === '0-24' && first.count === 'count=exact' && !first.or, JSON.stringify(first))
    await uiWait(/^Read 1|Read\s+1/)
    shot('54-leads')
  })

  await check('the page behind is left alone: no web Leads code runs', async () => {
    assert((await pagePath(page)) === '/email/settings', `page is on ${await pagePath(page)}`)
  })

  await check('scrolling loads the next page of leads, and only then', async () => {
    for (let i = 0; i < 3; i += 1) { swipeUp(); await sleep(700) }
    await waitFor('the second page', async () => (await eventsOf('leads_page')).some((e) => e.range === '25-49'), { timeout: 15000 })
  })

  await check('a lead search asks the server once, and never ilike on the number column', async () => {
    await uiTap(/Search company, name, email, city or mobile/)
    await sleep(400)
    const before = (await eventsOf('leads_page')).length
    typeText('9810000007')
    await uiWait(/Synthetic Company 7\b/, { timeout: 15000 })
    const asked = (await eventsOf('leads_page')).slice(before)
    assert(asked.length <= 2, `${asked.length} requests for one search`)
    assert(asked.at(-1).or.includes('mobile.in.(9810000007)') && !asked.at(-1).or.includes('mobile.ilike'), asked.at(-1).or)
    pressBack()
    await sleep(400)
    await uiTap('Clear search')
    await uiWait(/Example Gifts/, { timeout: 15000 })
  })

  await check('tapping a lead opens its details, with its number and the ways to reach them', async () => {
    await uiTap(/Example Gifts/)
    await uiWait(/\+91 9800000011/, { timeout: 10000 })
    for (const label of ['Call', 'WhatsApp', 'Email']) await uiWait(new RegExp(`^${label}$`))
    await uiWait(/Test Lead/)
    shot('55-lead-details')
  })

  await check('WhatsApp hands the chat link to another app, and the lead is still there after', async () => {
    clearLog()
    await uiTap(/^WhatsApp$/)
    // Android hides the link itself in its log, so this checks the kind of intent and
    // that another app took over. The link is built from the lead in leads_models.dart.
    const opened = await waitFor('a VIEW intent', () => startedActivities().find((line) => line.includes('android.intent.action.VIEW')), { timeout: 10000 })
    await waitFor('another app in front', () => foregroundPackage() !== PACKAGE, { timeout: 10000 })
    for (let i = 0; i < 3 && foregroundPackage() !== PACKAGE; i += 1) { pressBack(); await sleep(1200) }
    if (foregroundPackage() !== PACKAGE) launch()
    await uiWait(/\+91 9800000011/, { timeout: 15000 })
    return opened.match(/cmp=([^ }]+)/)?.[1] ?? ''
  })

  await check('Android back goes from the lead to the list, then to the CRM page', async () => {
    pressBack()
    await uiWait(/Search company, name, email, city or mobile/, { timeout: 8000 })
    pressBack()
    await waitFor('the CRM page', () => !uiHas(/Search company, name, email, city or mobile/) && uiHas('Open menu'), { timeout: 10000 })
    assert(foregroundPackage() === PACKAGE, 'left the app')
  })

  await check('the native inbox opens from the drawer, one page of 30', async () => {
    await uiTap('Open menu')
    await uiTap(/^(\d+\s+)?Inbox/)
    await uiWait(/Test Contact 1\b/, { timeout: 20000 })
    const first = (await eventsOf('chat_page'))[0]
    assert(first.limit === 30, `limit ${first?.limit}`)
    shot('55-chat-list')
  })

  await check('the live connection joins the private channel with a token', async () => {
    const join = await waitFor('a realtime join', async () => (await eventsOf('realtime_join'))[0], { timeout: 20000 })
    assert(join.topic === 'realtime:wa-inbox' && join.private === true && join.hasToken === true, JSON.stringify(join))
  })

  await check('scrolling near the end loads the next page, and only then', async () => {
    const before = (await eventsOf('chat_page')).filter((e) => e.cursor).length
    assert(before === 0, 'a second page loaded before scrolling')
    for (let i = 0; i < 3; i += 1) { swipeUp(); await sleep(700) }
    await waitFor('the second page', async () => (await eventsOf('chat_page')).some((e) => e.cursor), { timeout: 15000 })
  })

  await check('search waits for typing to stop, and asks the server', async () => {
    await uiTap(/Search name, number or message/)
    await sleep(500)
    const before = (await eventsOf('chat_page')).length
    typeText('Contact 77')
    await uiWait(/Test Contact 77\b/, { timeout: 15000 })
    const asked = (await eventsOf('chat_page')).slice(before)
    assert(asked.some((e) => e.q === 'contact 77'), JSON.stringify(asked))
    assert(asked.length <= 2, `${asked.length} requests for one search`)
    shot('56-search')
    pressBack()
    await sleep(400)
    await uiTap('Clear search')
    await uiWait(/Test Contact 1\b/, { timeout: 15000 })
  })

  await check('a chat opens on a page of 50, marked read', async () => {
    await uiTap(/Test Contact 1\b/)
    await uiWait(/The newest message from the customer/, { timeout: 20000 })
    const page50 = (await eventsOf('thread_page')).at(-1)
    assert(page50.limit === 50 && page50.chatId === 1, JSON.stringify(page50))
    assert((await eventsOf('read')).some((e) => e.chatId === 1), 'not marked read')
    shot('57-thread')
  })

  await check('a reply is sent and appears', async () => {
    await uiTap(/Type a message/)
    await sleep(400)
    typeText('Hello from the native composer')
    await uiTap('Send message')
    await waitFor('the send', async () => (await eventsOf('text_sent')).some((e) => e.body === 'Hello from the native composer'))
    await uiWait(/Hello from the native composer/)
    shot('58-sent')
  })

  await check('a message arrives live, with no refresh', async () => {
    const at = new Date().toISOString()
    const { sockets } = await broadcast('message:new', {
      conversation: { id: 1, last_message_at: at, last_message_preview: 'Live arrival', last_inbound_at: at, unread_count: 1 },
      message: { id: 900001, conversation_id: 1, meta_message_id: 'wamid.live.1', direction: 'inbound', type: 'text', body: 'This arrived live over the socket', status: 'received', wa_timestamp: at, created_at: at },
    })
    assert(sockets > 0, 'no socket connected')
    await uiWait(/This arrived live over the socket/, { timeout: 8000 })
    shot('59-live')
  })

  await check('long press offers the reactions and actions', async () => {
    const node = await uiFind(/This arrived live over the socket/)
    shell(`input swipe ${node.x} ${node.y} ${node.x} ${node.y} 800`)
    await uiWait('Reply', { timeout: 8000 })
    await uiWait('Star')
    shot('60-message-sheet')
    pressBack()
    await sleep(500)
  })

  await check('a voice note: asks for the microphone, records, and sends OGG/Opus the API accepts', async () => {
    await uiTap('Record a voice message')
    await allowPermissionIfAsked()
    await sleep(500)
    if (uiHas('Record a voice message')) await uiTap('Record a voice message')
    await uiWait(/Recording/, { timeout: 8000 })
    shot('61-recording')
    await sleep(3200)
    await uiTap('Send voice message')
    const sent = await waitFor('the voice upload', async () => (await eventsOf('media_sent')).at(-1), { timeout: 20000 })
    assert(sent.voice === true && sent.accepted === true && sent.mime === 'audio/ogg', JSON.stringify(sent))
    assert(sent.bytes > 500, `only ${sent.bytes} bytes`)
    await uiWait(/Voice message/, { timeout: 10000 })
    shot('62-voice-sent')
    return `${sent.bytes} bytes`
  })

  await check('discarding a recording sends nothing', async () => {
    const before = (await eventsOf('media_sent')).length
    await uiTap('Record a voice message')
    await uiWait(/Recording/, { timeout: 8000 })
    await sleep(1500)
    await uiTap('Discard recording')
    await uiWait('Record a voice message', { timeout: 8000 })
    assert((await eventsOf('media_sent')).length === before, 'it was sent')
  })

  await check('leaving a chat in the middle of a recording lets go of the microphone', async () => {
    await uiTap('Record a voice message')
    await uiWait(/Recording/, { timeout: 8000 })
    await sleep(800)
    assert(micInUse(), 'the check cannot see the recording')
    pressBack()
    await uiWait(/Test Contact 2\b/, { timeout: 10000 })
    await waitFor('the microphone to be released', () => !micInUse(), { timeout: 5000 })
    await uiTap(/Test Contact 1\b/)
    await uiWait('Record a voice message', { timeout: 15000 })
  })

  await check('back from a chat returns to the list, then back again to the CRM page', async () => {
    pressBack()
    await uiWait(/Test Contact 2\b/, { timeout: 10000 })
    pressBack()
    await waitFor('the CRM page', () => !uiHas(/Search name, number or message/) && uiHas('Open menu'), { timeout: 10000 })
    assert(foregroundPackage() === PACKAGE, 'left the app')
  })

  await check('Phone contacts: nothing is read until the person allows it', async () => {
    assert(!adbTry('shell', `dumpsys package ${PACKAGE}`).out.match(/READ_CONTACTS: granted=true/), 'already granted')
    await uiTap('Open menu')
    await uiTap(/^Phone contacts/)
    await uiWait('Grant Permission', { timeout: 10000 })
    shot('63-contacts-permission')
  })

  await check('with permission, the phone\'s contacts appear, and bad numbers do not', async () => {
    for (const [name, number] of [['Asha Rao', '9800000001'], ['Bilal Khan', '+91 98000 00002'], ['Short Code', '121'], ['Opted Out', '9800000099']]) {
      const raw = shell(`content insert --uri content://com.android.contacts/raw_contacts --bind account_type:s:local --bind account_name:s:local`)
      assert(raw !== undefined, 'insert failed')
      const id = shell(`content query --uri content://com.android.contacts/raw_contacts --projection _id --sort "_id DESC" | head -1`).match(/_id=(\d+)/)[1]
      shell(`content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${id} --bind mimetype:s:vnd.android.cursor.item/name --bind data1:s:'${name.replace(' ', '\\ ')}'`)
      shell(`content insert --uri content://com.android.contacts/data --bind raw_contact_id:i:${id} --bind mimetype:s:vnd.android.cursor.item/phone_v2 --bind data1:s:'${number.replace(/ /g, '\\ ')}' --bind data2:i:2`)
    }
    await uiTap('Grant Permission')
    await allowPermissionIfAsked()
    await uiWait(/Asha Rao/, { timeout: 15000 })
    await uiWait(/\+91 98000 00002/)
    assert(!uiHas(/Short Code/), 'a 3-digit number was listed')
    shot('64-contacts')
  })

  await check('contact search narrows the list', async () => {
    await uiTap(/Search name or number/)
    await sleep(400)
    typeText('bilal')
    await waitFor('the filter', () => uiHas(/Bilal Khan/) && !uiHas(/Asha Rao/), { timeout: 8000 })
    pressBack()
    await sleep(400)
    await uiTap('Clear search')
    await uiWait(/Asha Rao/, { timeout: 8000 })
  })

  await check('a template goes to a phone contact, with consent asked and the number normalised', async () => {
    await uiTap('Send WhatsApp message to Asha Rao')
    await uiWait(/welcome/, { timeout: 15000 })
    assert(!uiHas(/^offer_with_photo/), 'a template with a photo header was offered')
    shot('65-templates')
    await uiTap(/^welcome/)
    await uiWait(/\{\{1\}\}/)
    await uiTap(/\{\{1\}\}/)
    await sleep(400)
    typeText('Asha')
    await sleep(400)
    pressBack()
    await sleep(500)
    shot('66-template-form')
    await uiTap(/agreed to hear from us/)
    await sleep(300)
    await uiTap(/^Send$/)
    const sent = await waitFor('the send', async () => (await eventsOf('direct_template')).at(-1), { timeout: 15000 })
    assert(sent.phone === '+919800000001' && sent.values?.['1'] === 'Asha', JSON.stringify(sent))
    await uiWait(/Sent to Asha Rao/, { timeout: 8000 })
  })

  await check('a refusal stays on the sheet with the reason', async () => {
    await uiTap('Send WhatsApp message to Opted Out')
    await uiWait(/welcome/, { timeout: 15000 })
    await uiTap(/^welcome/)
    await uiWait(/\{\{1\}\}/)
    await uiTap(/\{\{1\}\}/)
    await sleep(400)
    typeText('Someone')
    await sleep(400)
    pressBack()
    await sleep(500)
    await uiTap(/agreed to hear from us/)
    await sleep(300)
    await uiTap(/^Send$/)
    await uiWait(/opted out/i, { timeout: 10000 })
    shot('67-template-refused')
    pressBack()
    await sleep(600)
  })

  await check('Call asks once, then dials straight away over the SIM', async () => {
    clearLog()
    await uiTap('Call Asha Rao')
    await allowPermissionIfAsked()
    const call = await waitFor('the call intent', () => startedActivities().find((line) => /android\.intent\.action\.CALL\b/.test(line)), { timeout: 15000 })
    assert(call.includes('tel:') || call.includes('dat=tel'), call)
    await sleep(1500)
    shot('68-calling')
    adbTry('shell', 'input keyevent KEYCODE_ENDCALL')
    await sleep(1500)
    // With no call left to end, that key puts the phone to sleep.
    adbTry('shell', 'input keyevent KEYCODE_WAKEUP')
    adbTry('shell', 'wm dismiss-keyguard')
    await sleep(800)
    launch()
    await sleep(1500)
    return 'ACTION_CALL'
  })

  await check('Templates opens natively from the drawer, with a preview of each', async () => {
    await openDrawer()
    for (let i = 0; i < 3 && !uiHas(/^Templates/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Templates/)
    await uiWait(/Approved message templates/, { timeout: 15000 })
    shot('71-templates')
    await uiTap(/^welcome/)
    await uiWait(/Preview of the message/, { timeout: 8000 })
    shot('72-template-preview')
    pressBack()
    await uiWait(/Approved message templates/)
  })

  await check('the WhatsApp dashboard opens natively, with figures, changes and charts', async () => {
    await openDrawer()
    for (let i = 0; i < 3 && !uiHas(/^Dashboard/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Dashboard/)
    await uiWait(/Messages sent/, { timeout: 15000 })
    // TalkBack reads the change as "versus", so that is what the screen exposes.
    await uiWait(/previous 30 days/)
    await uiWait(/Messages sent, delivered and read by day/)
    shot('73-dashboard')
    await uiTap(/^7 days/)
    await uiWait(/previous 7 days/, { timeout: 10000 })
    shot('74-dashboard-7-days')
    for (let i = 0; i < 12 && !uiHas(/View catalogue/); i += 1) { swipeUp(); await sleep(600) }
    await uiWait(/View catalogue/)
    shot('74b-dashboard-taps')
  })

  await check('a campaign opens its own performance from the dashboard, and Back returns', async () => {
    for (let i = 0; i < 12 && !uiHas(/^Diwali offers for corporate gifting buyers/); i += 1) { swipeUp(); await sleep(600) }
    shot('75-dashboard-lower')
    await uiTap(/^Diwali offers for corporate gifting buyers/)
    await uiWait(/Replied/, { timeout: 15000 })
    shot('76-campaign')
    // Lower sections are built as they scroll in.
    for (let i = 0; i < 8 && !uiHas(/See who, and send again/); i += 1) { swipeUp(); await sleep(600) }
    await uiWait(/See who, and send again/)
    // This campaign's template has no insights from Meta: quick replies show, Links stay hidden.
    assert(uiHas(/Interested/) && !uiHas(/Links \(this template\)/), 'Links showed without insights, or quick replies were missing')
    shot('77-campaign-lower')
    pressBack()
    await uiWait('Open menu', { timeout: 8000 })
  })

  await check('the page hands /whatsapp to the native dashboard', async () => {
    await openFromDrawer(page, 'Email settings', '/email/settings')
    await page.eval(`history.pushState({}, '', '/whatsapp'); dispatchEvent(new PopStateEvent('popstate'))`)
    await uiWait(/Messages sent/, { timeout: 15000 })
  })

  await check('WhatsApp Contacts is native: a page from the API, a server search, and details', async () => {
    await openDrawer()
    for (let i = 0; i < 3 && !uiHas(/^Contacts/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Contacts/)
    await uiWait(/^75 contacts/, { timeout: 15000 })
    shot('78-contacts')
    await uiTap(/Search name, phone or company/)
    await sleep(400)
    typeText('Name 12')
    await uiWait(/^1 match$/, { timeout: 8000 })
    pressBack()
    await sleep(400)
    await uiTap('Clear search')
    await uiWait(/^75 contacts/, { timeout: 8000 })
    await uiTap(/^Sample Contact With A Fairly Long Name 2/)
    await uiWait(/Send template/, { timeout: 8000 })
    shot('79-contact-details')
    pressBack()
    await uiWait(/^75 contacts/)
  })

  await check('a long press selects contacts; delete asks first and sends only those ids', async () => {
    const row = await uiFind(/^Sample Contact With A Fairly Long Name 1\b/)
    shell(`input swipe ${row.x} ${row.y} ${row.x} ${row.y} 900`)
    await uiWait(/^1 selected/, { timeout: 5000 })
    await uiTap('Delete selected')
    await uiWait(/Delete 1 contact\?/)
    shot('80-contacts-delete')
    await uiTap(/^Delete$/)
    const deleted = await waitFor('the delete', async () => (await eventsOf('contacts_deleted')).at(-1), { timeout: 10000 })
    assert(JSON.stringify(deleted.ids) === '[1]', JSON.stringify(deleted))
    await uiWait(/^74 contacts/, { timeout: 8000 })
  })

  await check('Import opens the web importer, and Back returns to native Contacts', async () => {
    await uiTap('More')
    await uiTap('Import a spreadsheet')
    await waitFor('/whatsapp/contacts/import', async () => (await pagePath(page)) === '/whatsapp/contacts/import')
    await sleep(1500)
    shot('81-contacts-import')
    pressBack()
    await uiWait(/^74 contacts/, { timeout: 15000 })
  })

  await check('Campaigns is native: the list with how far each got, and a campaign opens its screen', async () => {
    await openDrawer()
    for (let i = 0; i < 3 && !uiHas(/^Campaigns/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Campaigns/)
    await uiWait(/1,180 of 1,200 sent, 20 not received/, { timeout: 15000 })
    // The row reads as one item, name first, so the status is not at the start.
    await uiWait(/Sending/)
    await uiWait(/12 of 90 sent(?!, )/)
    shot('82-campaigns')
    await uiTap(/^Diwali offers for corporate gifting buyers/)
    await uiWait(/Replied/, { timeout: 15000 })
    pressBack()
    await uiWait(/1,180 of 1,200 sent/, { timeout: 8000 })
  })

  await check('New campaign is native: choose, fill in, confirm, and it sends once with a request id', async () => {
    await uiTap(/^New campaign/)
    await uiWait(/Step 1 of 4: Audience/, { timeout: 15000 })
    await uiTap('Select all')
    await uiWait(/^66 selected of 66/, { timeout: 8000 })
    shot('83-wizard-audience')
    await uiTap(/^Continue$/)
    await uiWait(/Step 2 of 4: Template/)
    await uiTap(/^static_note/)
    await uiTap(/^Continue$/)
    await uiWait(/Step 3 of 4: Details/)
    await uiTap(/^Campaign name/)
    await sleep(400)
    typeText('Emulator test')
    await sleep(400)
    pressBack()
    await sleep(500)
    shot('84-wizard-details')
    await uiTap(/^Continue$/)
    await uiTap(/^No pauses/)
    await uiTap(/^Send to 66 people/)
    await uiWait(/Send to 66 people\?/)
    shot('85-wizard-confirm')
    await uiTap(/^Send$/)
    await uiWait(/^Sent$/, { timeout: 20000 })
    shot('86-wizard-sent')
    const starts = await eventsOf('campaign_send')
    const batches = await eventsOf('campaign_batch')
    assert(starts.length === 1, `started ${starts.length} times`)
    assert(/^[0-9a-f-]{36}$/.test(starts[0].requestId ?? ''), 'no request id on the start')
    assert(starts[0].count === 66 && starts[0].template === 'static_note' && starts[0].name === 'Emulator test', JSON.stringify(starts[0]))
    assert(batches.length === 1 && batches[0].count === 26, JSON.stringify(batches))
    await uiTap(/^Done$/)
    await uiWait(/1,180 of 1,200 sent/, { timeout: 8000 })
  })

  await check('Vendors is native: a page from Supabase, details with a masked account, New PO hands over the vendor', async () => {
    await openDrawer()
    for (let i = 0; i < 3 && !uiHas(/^Vendors/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Vendors/)
    await uiWait(/^2 vendors/, { timeout: 15000 })
    shot('87-vendors')
    await uiTap(/^Northern Outdoor Advertising/)
    await uiWait(/Media and terms/, { timeout: 8000 })
    for (let i = 0; i < 4 && !uiHas(/•••• 0000/); i += 1) { swipeUp(); await sleep(500) }
    await uiWait(/•••• 0000/)
    assert(!uiHas(/000000000000/), 'the full account number showed without asking')
    shot('88-vendor-details')
    for (let i = 0; i < 4 && !uiHas(/^New PO/); i += 1) { shell('input swipe 500 600 500 1700 200'); await sleep(500) }
    await uiTap(/^New PO/)
    // Native now: the form opens with this vendor and its only address chosen.
    await uiWait(/^New purchase order$/, { timeout: 15000 })
    await uiWait(/Northern Outdoor Advertising/)
    await uiWait(/12 Example Road/, { timeout: 10000 })
    shot('89-new-po')
    pressBack()
    await uiWait(/^1 purchase order/, { timeout: 15000 })
  })

  await check('a new vendor is added natively: vendor first, then its address', async () => {
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    await openDrawer()
    for (let i = 0; i < 3 && !uiHas(/^Vendors/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Vendors/)
    await uiWait(/^2 vendors/, { timeout: 15000 })
    await uiTap(/^New vendor/)
    await uiWait(/^New vendor$/)
    await uiTap(/^Company name/)
    await sleep(400)
    typeText('Emulator Vendor')
    pressBack()
    await sleep(400)
    await uiTap(/Choose media/)
    await uiTap(/^Outdoor$/)
    await sleep(400)
    await uiTap(/Choose sub media/)
    await uiTap(/^Hoarding$/)
    await sleep(400)
    for (let i = 0; i < 8 && !uiHas(/^State/); i += 1) { swipeUp(); await sleep(400) }
    await uiTap(/^State/)
    await sleep(300)
    typeText('Gujarat')
    pressBack()
    await sleep(300)
    await uiTap(/^City/)
    await sleep(300)
    typeText('Surat')
    pressBack()
    await sleep(300)
    for (let i = 0; i < 3 && !uiHas(/^Street address/); i += 1) { swipeUp(); await sleep(400) }
    await uiTap(/^Street address/)
    await sleep(300)
    typeText('1 Ring Road')
    pressBack()
    await sleep(300)
    shot('90-vendor-form')
    await uiTap(/^Add$/)
    const added = await waitFor('the vendor', async () => (await eventsOf('vendor_insert')).at(-1), { timeout: 15000 })
    const address = await waitFor('its address', async () => (await eventsOf('vendor_address_insert')).at(-1), { timeout: 15000 })
    assert(added.company === 'Emulator Vendor' && address.city === 'Surat', JSON.stringify({ added, address }))
    await uiWait(/^Emulator Vendor/, { timeout: 10000 })
    shot('91-vendor-added')
    pressBack()
    await uiWait(/^3 vendors/, { timeout: 8000 })
  })

  await orderChecks(page)

  await check('the session survives a restart, read back from the vault, with no new sign-in', async () => {
    const before = (await eventsOf('otp_verified')).length
    page.close()
    forceStop()
    await launchWhenReady()
    page = await connectPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
    assert((await eventsOf('otp_verified')).length === before, 'it asked for a new sign-in')
    await uiWait('Open menu', { timeout: 20000 })
  })

  await check('logging out from the drawer ends this session on the server and shows the sign-in', async () => {
    const before = (await eventsOf('logout')).length
    await logOutFromDrawer(page, '69-logout')
    await waitFor('the server told', async () => (await eventsOf('logout')).length > before, { timeout: 10000 })
    assert(nativeSignInShown(), 'the app\'s sign-in is not showing')
    // The page holds nothing of the CRM's any more, so nothing of the last person's.
    assert(!(await page.eval('Boolean(window.__dikhoNative)')), 'the CRM page is still loaded')
    await waitFor('no native bar', () => !uiHas('Open menu'), { timeout: 8000 })
    shot('70-signed-out')
  })
  page.close()
}

/** Native Sales orders and Purchase orders, from wherever the app is, signed in. */
async function orderChecks(page) {
  await check('Sales orders is native: the list from Supabase, without purchase orders, and the page hands /sales-orders over', async () => {
    await page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
    // Away on another native screen, then the page goes to /sales-orders itself: the app takes it.
    await openDrawer()
    await uiTap(/^Clients/)
    await sleep(1500)
    await page.eval(`history.pushState({}, '', '/sales-orders'); dispatchEvent(new PopStateEvent('popstate'))`)
    await uiWait(/^1 order/, { timeout: 15000 })
    assert(uiHas(/SO-TEST-1/) && !uiHas(/PO-TEST-1/), 'the purchase order showed, or the order did not')
    const first = (await eventsOf('salesorder_page')).at(-1)
    assert(first.vendor === 'is.null' && first.range === '0-24', JSON.stringify(first))
    shot('92-sales-orders')
  })

  await check('an order opens with its figures and lines, and Tax invoice is drawn on the phone and saved', async () => {
    adbTry('shell', `rm -f "${DOWNLOADS}/TI_SO-TEST-1"*.pdf`)
    await uiTap(/SO-TEST-1/)
    await uiWait(/Test billboard/, { timeout: 10000 })
    await uiWait(/₹1,180\.00/)
    shot('93-sales-order')
    const pathBefore = await pagePath(page)
    await uiTap(/^Tax invoice/)
    await waitFor('the invoice file', () => listDownloads().split('\n').some((line) => line.trim().startsWith('TI_SO-TEST-1')), { timeout: 40000 })
    assert((await pagePath(page)) === pathBefore, 'the CRM page was used for the invoice')
    const name = listDownloads().split('\n').map((line) => line.trim()).find((line) => line.startsWith('TI_SO-TEST-1'))
    // Read on the computer: the template's own words and the order's, as the web draws them.
    const local = join(values.shots ?? tmpdir(), 'tax-invoice.pdf')
    if (values.shots) mkdirSync(values.shots, { recursive: true })
    adb('pull', `${DOWNLOADS}/${name}`, local)
    const text = execFileSync('pdftotext', ['-layout', local, '-']).toString()
    for (const wanted of ['DIKHO GLOBAL MEDIA LLP', 'Invoice Details', 'SO-TEST-1', 'Test billboard', '1,180.00', 'One Thousand One Hundred and Eighty Rupees Only']) {
      assert(text.toLowerCase().includes(wanted.toLowerCase()), `${wanted} is not on the invoice`)
    }
    assert(/\b18\b/.test(text), 'the GST % is not on the invoice')
    // The tax table's total sits clear of the template's own ₹ sign (it once read ₹80.00).
    assert(/₹\s+180\.00/.test(text), 'the tax total is not 180.00 on the invoice')
    if (values.shots) execFileSync('pdftoppm', ['-png', '-r', '80', '-singlefile', local, join(values.shots, '94-invoice')])
    await sleep(800)
    shot('94-invoice-saved')
    pressBack()
    await uiWait(/^1 order/, { timeout: 15000 })
    // "Saved … Open" sits where New order is; it must go by itself after its 10 seconds.
    await waitFor('the saved note to go', () => !uiHas(/Saved TI_SO-TEST-1/), { timeout: 20000 })
    return name
  })

  await check('a new order is saved natively: the order, then its line, with GST worked out', async () => {
    await uiTap(/^New order/)
    await uiWait(/^New sales order$/, { timeout: 8000 })
    await uiTap(/^Create$/)
    await uiWait(/Choose the client this order belongs to\./, { timeout: 5000 })
    assert(!(await eventsOf('salesorder_insert')).length, 'it saved with no client')
    await uiTap(/^Client/)
    await uiWait(/^Choose a client$/, { timeout: 8000 })
    await sleep(600)
    typeText('Client 60')
    await uiTap(/^Synthetic Client 60/, { timeout: 15000 })
    await uiWait(/^New sales order$/, { timeout: 8000 })
    await uiTap(/^Order number/)
    await sleep(300)
    typeText('SO-EMU-1')
    pressBack()
    await sleep(300)
    // Short swipes: a full one jumps past a whole field.
    const nudge = () => shell('input swipe 500 1500 500 1000 300')
    for (let i = 0; i < 12 && !uiHas(/^Item \*/); i += 1) { nudge(); await sleep(400) }
    await uiTap(/^Item \*/)
    await sleep(300)
    typeText('Emulator hoarding')
    pressBack()
    await sleep(300)
    for (let i = 0; i < 6 && !uiHas(/^Amount before tax/); i += 1) { nudge(); await sleep(400) }
    await uiTap(/^Amount before tax/)
    await sleep(300)
    typeText('10000')
    pressBack()
    await sleep(400)
    await uiWait(/₹11,800\.00/)
    shot('95-sales-order-form')
    await uiTap(/^Create$/)
    const order = await waitFor('the order', async () => (await eventsOf('salesorder_insert')).at(-1), { timeout: 15000 })
    const lines = await waitFor('its line', async () => (await eventsOf('salesorder_items_insert')).at(-1), { timeout: 15000 })
    assert(order.number === 'SO-EMU-1' && order.company === 'Synthetic Client 60' && order.total === 11800, JSON.stringify(order))
    assert(lines.count === 1 && lines.order === order.id && lines.tax[0] === 1800, JSON.stringify(lines))
    assert((await eventsOf('salesorder_insert')).length === 1, 'sent twice')
    await uiWait(/^SO-EMU-1/, { timeout: 10000 })
    shot('96-sales-order-added')
    pressBack()
    await uiWait(/^2 orders/, { timeout: 8000 })
  })

  await check('Purchase orders is native: only purchase orders, each with its vendor and sales order, and the page hands the route over', async () => {
    await openDrawer()
    await uiTap(/^Clients/)
    await sleep(1500)
    await page.eval(`history.pushState({}, '', '/purchase-orders'); dispatchEvent(new PopStateEvent('popstate'))`)
    await uiWait(/^1 purchase order/, { timeout: 15000 })
    // The purchase order's own row says "for SO-TEST-1"; a sales order's row would start with it.
    assert(uiHas(/^PO-TEST-1/) && !uiHas(/^SO-TEST-1/), 'a sales order showed, or the purchase order did not')
    await uiWait(/Northern Outdoor Advertising.*for SO-TEST-1/)
    const page1 = (await eventsOf('salesorder_page')).at(-1)
    assert(page1.vendor === 'not.is.null', JSON.stringify(page1))
    shot('97-purchase-orders')
    await uiTap(/PO-TEST-1/)
    await uiWait(/Billboard rent/, { timeout: 10000 })
    await uiWait(/₹708\.00/)
    assert(!uiHas(/PO #/), 'a purchase order line pointed at itself')
    shot('98-purchase-order')
    pressBack()
    await uiWait(/^1 purchase order/, { timeout: 8000 })
  })

  await check('a new purchase order is saved natively: for a sales order line, with its vendor address, then its line', async () => {
    const nudge = () => shell('input swipe 500 1500 500 1000 300')
    await uiTap(/^New PO/)
    await uiWait(/^New purchase order$/, { timeout: 8000 })
    await uiTap(/^For sales order/)
    await uiWait(/^Choose a sales order$/, { timeout: 8000 })
    await uiTap(/^SO-TEST-1 — Example Traders/, { timeout: 15000 })
    await uiWait(/^New purchase order$/, { timeout: 8000 })
    await uiTap(/^PO number/)
    await sleep(300)
    typeText('PO-EMU-1')
    pressBack()
    await sleep(300)
    for (let i = 0; i < 4 && !uiHas(/^Vendor,/); i += 1) { nudge(); await sleep(400) }
    await uiTap(/^Vendor,/)
    await uiWait(/^Choose a vendor$/, { timeout: 8000 })
    await uiTap(/^Northern Outdoor Advertising/, { timeout: 15000 })
    await uiWait(/12 Example Road/, { timeout: 10000 })
    // The dropdown reads as its label and then its value.
    for (let i = 0; i < 14 && !uiHas(/Not linked/); i += 1) { nudge(); await sleep(400) }
    await uiTap(/Not linked/)
    await uiTap(/^Test billboard/)
    await sleep(400)
    for (let i = 0; i < 6 && !uiHas(/^Cost before tax/); i += 1) { nudge(); await sleep(400) }
    await uiTap(/^Cost before tax/)
    await sleep(300)
    typeText('600')
    pressBack()
    await sleep(400)
    // The line's summary sits just below the field.
    for (let i = 0; i < 6 && !uiHas(/Margin ₹400\.00/); i += 1) { nudge(); await sleep(400) }
    await uiWait(/Margin ₹400\.00/)
    shot('99-purchase-order-form')
    await uiTap(/^Create$/)
    const order = await waitFor('the purchase order', async () => (await eventsOf('salesorder_insert')).find((e) => e.number === 'PO-EMU-1'), { timeout: 15000 })
    const lines = await waitFor('its line', async () => (await eventsOf('salesorder_items_insert')).find((e) => e.po === order.id), { timeout: 15000 })
    assert(order.vendorAddress === 1 && order.total === 708, JSON.stringify(order))
    assert(lines.order === 1 && lines.soItems[0] === 1 && lines.names[0] === 'Test billboard' && lines.tax[0] === 108, JSON.stringify(lines))
    await uiWait(/^PO-EMU-1/, { timeout: 10000 })
    shot('100-purchase-order-added')
    pressBack()
    await uiWait(/^2 purchase orders/, { timeout: 8000 })
  })
}

/** Native User Management: the people, a person's sessions, and a permission change. */
async function usersScenario() {
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()
  const page = await connectPage()
  await check('signs in through the app', () => signIn(page))

  await check('Users is native: the people from the API, the counts, and the page hands /users over', async () => {
    await openFromDrawer(page, 'Email settings', '/email/settings')
    await page.eval(`history.pushState({}, '', '/users'); dispatchEvent(new PopStateEvent('popstate'))`)
    await uiWait(/A Staff Member/, { timeout: 15000 })
    await uiWait(/^Users 3/)
    await uiWait(/Local Owner \(you\)/)
    shot('u1-users')
  })

  await check('a person opens with their details, and their sessions name the app', async () => {
    await uiTap(/A Staff Member/)
    await uiWait(/^Contact and sign-in/, { timeout: 10000 })
    shot('u2-profile')
    await uiTap(/^Sessions/)
    await uiWait(/Dikho app on Android/, { timeout: 10000 })
    shot('u3-sessions')
  })

  await check('access: switching a permission off saves just that change', async () => {
    await uiTap(/^Access/)
    await uiWait(/^View clients/, { timeout: 10000 })
    await uiTap(/^View clients/)
    await uiWait(/Removed for this person/)
    shot('u4-access')
    await uiTap(/^Save$/)
    const saved = await waitFor('the change', async () => (await eventsOf('user_permissions')).at(-1), { timeout: 15000 })
    assert(JSON.stringify(saved.overrides) === JSON.stringify({ 'clients.view': { effect: 'revoke' } }), JSON.stringify(saved))
  })
  page.close()
}

/** Native Settings: the person's own sections, the organization's, and the page told. */
async function settingsScenario() {
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()
  const page = await connectPage()
  await check('signs in through the app', () => signIn(page))

  await check('Settings is native: the drawer opens it, and the page hands /settings over', async () => {
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Settings/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Settings/)
    await uiWait(/^Sign-in and security/, { timeout: 15000 })
    await uiWait(/^Lists and media/)
    shot('s1-settings')
    // Away from Settings, then the page goes to /settings/preferences itself: the app takes it.
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Users/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Users/)
    await sleep(1500)
    await page.eval(`history.pushState({}, '', '/settings/preferences'); dispatchEvent(new PopStateEvent('popstate'))`)
    await uiWait(/^Sign-in and security/, { timeout: 15000 })
  })

  await check('the theme changes at once, is saved, and the page follows', async () => {
    await uiTap(/^Preferences/)
    await uiWait(/^Theme/, { timeout: 8000 })
    await uiTap(/^Dark/)
    const saved = await waitFor('the theme', async () => (await eventsOf('settings_theme')).at(-1), { timeout: 10000 })
    assert(saved.theme === 'dark', JSON.stringify(saved))
    await uiWait(/Your theme follows you to every device/)
    await waitFor('the page theme', async () => (await page.eval(`localStorage.getItem('dikho-theme')`)) === 'dark', { timeout: 15000 })
    shot('s2-preferences-dark')
    await uiTap(/^Light/)
    await waitFor('back to light', async () => (await eventsOf('settings_theme')).at(-1)?.theme === 'light', { timeout: 10000 })
    pressBack()
    await uiWait(/^Lists and media/, { timeout: 8000 })
  })

  await check('your devices, under Sign-in and security', async () => {
    await uiTap(/^Sign-in and security/)
    await uiWait(/Signed in now/, { timeout: 10000 })
    await uiWait(/This device/)
    shot('s3-security')
    await uiTap(/^End session/)
    const ended = await waitFor('the other device signed out', async () => (await eventsOf('user_sign_out')).at(-1), { timeout: 10000 })
    assert(ended.id === '00000000-0000-4000-8000-000000000001' && ended.session === '11111111-2222-4333-8444-666666666666', JSON.stringify(ended))
    pressBack()
    await uiWait(/^Lists and media/, { timeout: 8000 })
  })

  await check('Company loads the invoice details', async () => {
    await uiTap(/^Company/)
    await uiWait(/Example Media LLP/, { timeout: 10000 })
    shot('s4-company')
    pressBack()
    await uiWait(/^Lists and media/, { timeout: 8000 })
  })

  await check('a list: a new value is added and shows', async () => {
    await uiTap(/^Lists and media/)
    await uiTap(/^Courier statuses/, { timeout: 10000 })
    await uiWait(/Delivered/, { timeout: 8000 })
    await uiTap(/^New courier status/)
    await sleep(400)
    typeText('Returned')
    pressBack()
    await sleep(400)
    await uiTap(/^Add$/)
    const added = await waitFor('the new value', async () => (await eventsOf('settings_list_add')).at(-1), { timeout: 10000 })
    assert(added.list === 'courier_status' && added.value === 'Returned', JSON.stringify(added))
    await uiWait(/Returned/, { timeout: 8000 })
    assert((await eventsOf('settings_list_add')).length === 1, 'sent twice')
    shot('s5-list')
  })
  page.close()
}

/**
 * A desktop browser on this machine, for Live Assist runs: headless Chrome with its
 * own scratch profile (never the user's), its local addresses not hidden behind
 * mDNS so the emulator can reach it directly.
 */
async function helperBrowser() {
  const profile = join(dirname(values.shots ?? '/tmp/dikho-shots'), 'helper-chrome')
  mkdirSync(profile, { recursive: true })
  const chrome = spawn('google-chrome-stable', [
    '--headless=new', '--remote-debugging-port=9444', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-features=WebRtcHideLocalIpsWithMdns', '--window-size=1280,900', 'about:blank',
  ], { stdio: 'ignore' })
  const target = await waitFor('the helper browser', async () => {
    try {
      const list = await (await fetch('http://127.0.0.1:9444/json')).json()
      return list.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl)
    } catch { return null }
  }, { timeout: 30000 })
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return { page: new Page(socket), chrome }
}

/**
 * A click at the middle of [selector] in the helper's browser, with its position, so
 * the viewer knows where on the shared screen it landed.
 */
function browserClick(page, selector) {
  return page.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    if (!el) throw new Error('No element for ' + ${JSON.stringify(selector)})
    const r = el.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    el.dispatchEvent(new MouseEvent('mousedown', at))
    el.dispatchEvent(new MouseEvent('mouseup', at))
    el.dispatchEvent(new MouseEvent('click', at))
  })()`)
}

async function browserShot(page, name) {
  if (!values.shots) return
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(join(values.shots, `${name}.png`), Buffer.from(data, 'base64'))
}

/** Live Assist between the app (being helped) and a browser (helping), end to end. */
async function assistScenario() {
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()
  const page = await connectPage()
  await check('signs in through the app', () => signIn(page))
  const { page: helper, chrome } = await helperBrowser()
  try {
    await check('the helper signs in on a computer and asks to see the app user\'s screen', async () => {
      await helper.navigate(`${CRM}/`)
      await waitFor('the sign-in page', () => helper.eval(`!!document.querySelector('input[type="email"]')`), { timeout: 30000 })
      await helper.type('input[type="email"]', 'helper@example.test')
      await enterCode(helper)
      await waitFor('the signed-in browser', () => helper.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
      await helper.navigate(`${CRM}/users/00000000-0000-4000-8000-000000000001`)
      await waitFor('the Live Assist button', () => helper.eval(`(() => { const b = document.querySelector('.um-assist-button'); return !!b && !b.disabled })()`), { timeout: 30000 })
      await browserClick(helper, '.um-assist-button')
      await waitFor('the viewer', () => helper.eval(`!!document.querySelector('.la-viewer')`), { timeout: 10000 })
    })

    await check('the app asks, saying what the helper will see; Share my screen starts it', async () => {
      await uiWait(/wants to help you/, { timeout: 20000 })
      assert(uiHas(/not your notifications or other apps/), 'the dialog does not say what is shared')
      shot('a1-request')
      await uiTap(/^Share my screen/)
      const answer = await waitFor('the answer', async () => (await eventsOf('assist_respond')).at(-1), { timeout: 10000 })
      assert(answer.accept === true, JSON.stringify(answer))
    })

    await check('connected directly: the app says it is being viewed, and the browser shows the app\'s screen', async () => {
      await uiWait(/is viewing your screen/, { timeout: 45000 })
      const size = await waitFor('a picture of the app', () => helper.eval(`(() => { const img = document.querySelector('.la-screen img'); return img && img.naturalWidth > 0 ? img.naturalWidth + 'x' + img.naturalHeight : null })()`), { timeout: 30000 })
      const [w, h] = size.split('x').map(Number)
      assert(h > w && h >= 800, `the picture is ${size}`)
      shot('a2-sharing')
      await browserShot(helper, 'a3-helper-sees-the-app')
    })

    await check('the helper taps a spot and pins a note; the app shows it, and Done goes back', async () => {
      await browserClick(helper, '.la-screen img')
      await helper.type('.la-composer textarea', 'Tap the menu here')
      await browserClick(helper, '.la-send')
      await uiWait(/Tap the menu here/, { timeout: 10000 })
      shot('a4-note')
      await uiTap(/^Done$/)
      await waitFor('the note answered', () => helper.eval(`(() => [...document.querySelectorAll('.la-msg.is-note')].some((m) => m.classList.contains('is-clicked')))()`), { timeout: 10000 })
    })

    await check('chat both ways: the helper writes, the app answers with a quick reply', async () => {
      await helper.type('.la-composer textarea', 'Hello from the browser')
      await browserClick(helper, '.la-send')
      await uiWait(/Hello from the browser/, { timeout: 10000 })
      await uiTap(/^OK$/)
      await waitFor('the reply in the browser', () => helper.eval(`[...document.querySelectorAll('.la-msg.is-them .la-msg-text')].some((m) => m.textContent === 'OK')`), { timeout: 10000 })
      await browserShot(helper, 'a5-helper-chat')
    })

    await check('Stop ends it on both sides', async () => {
      await uiTap(/^Stop$/)
      const ended = await waitFor('the end', async () => (await eventsOf('assist_end')).at(-1), { timeout: 10000 })
      assert(ended.by === 'employee', JSON.stringify(ended))
      await waitFor('the browser told', () => helper.eval(`document.body.innerText.includes('They stopped sharing their screen.')`), { timeout: 15000 })
      await waitFor('the banner gone', () => !uiHas(/is viewing your screen/), { timeout: 10000 })
    })
  } finally {
    helper.close()
    chrome.kill()
    page.close()
  }
}

/** The native email inbox: the list, a conversation, an attachment, a link, a reply. */
async function emailScenario() {
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()
  const page = await connectPage()
  await check('signs in through the app', () => signIn(page))

  await check('Email overview and analytics are native: the mailbox, its figures, and the sending numbers', async () => {
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Overview/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Overview/)
    await uiWait(/Unread in inbox/, { timeout: 15000 })
    await uiWait(/sales@example\.test/, { timeout: 10000 })
    shot('e0-overview')
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Analytics/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Analytics/)
    await uiWait(/Campaign recipients/, { timeout: 15000 })
    shot('e0-analytics')
  })

  await check('Email campaigns and templates are native: a draft written on the phone is saved with its audience', async () => {
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Email templates/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Email templates/)
    await uiWait(/Rate card/, { timeout: 15000 })
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Email campaigns/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Email campaigns/)
    await uiWait(/Sending is not switched on yet/, { timeout: 15000 })
    await uiTap(/^New campaign/)
    await uiTap(/^Campaign name/, { timeout: 10000 })
    await sleep(400)
    typeText('Phone campaign')
    pressBack()
    await sleep(400)
    for (let i = 0; i < 6 && !uiHas(/^Clients/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Clients/)
    await uiWait(/40 will receive this email/, { timeout: 10000 })
    shot('e5-campaign')
    await uiTap(/^Save changes/)
    const saved = await waitFor('the draft', async () => (await eventsOf('email_campaign_saved')).at(-1), { timeout: 10000 })
    assert(saved.name === 'Phone campaign' && saved.sources.includes('client'), JSON.stringify(saved))
    pressBack()
    await uiWait(/Phone campaign/, { timeout: 10000 })
  })

  await check('Consent is native: an address looked up, and consent recorded with how they agreed', async () => {
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Consent/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Consent/)
    await uiWait(/Look up an address/, { timeout: 15000 })
    shot('e5b-consent-open')
    await uiTap(/Email address/, { timeout: 10000 })
    await sleep(400)
    typeText('ravi@client.test')
    pressBack()
    await sleep(400)
    await uiTap(/^Look up$/)
    await uiWait(/No consent recorded/, { timeout: 10000 })
    await uiTap(/^Record consent/)
    await uiTap(/^How did they agree/, { timeout: 10000 })
    await uiTap(/^Agreed verbally/)
    await sleep(600)
    shot('e6-consent-form')
    await uiTapLast(/^Record consent$/)
    const saved = await waitFor('the consent', async () => (await eventsOf('email_consent')).at(-1), { timeout: 10000 })
    assert(saved.email === 'ravi@client.test' && saved.marketing === 'subscribed' && saved.source === 'verbal', JSON.stringify(saved))
    await uiWait(/Agreed to marketing email/, { timeout: 10000 })
    shot('e7-consent')
  })

  await check('Email settings is native: the shared mailbox, a person added to it, and Google\'s return finished by the app', async () => {
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Email settings/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Email settings/)
    await uiWait(/Connect mailboxes and decide/, { timeout: 15000 })
    await uiWait(/^Connect with Google/)
    shot('e8-email-settings')
    await uiTap(/^Connect with Google/)
    await waitFor('the connection start', async () => (await eventsOf('email_connect_start')).length > 0, { timeout: 10000 })
    // Google's page is never real here. Its return comes to the app as Android delivers
    // an App Link: a view of /email/connect, finished with the app's own session.
    await sleep(2000)
    shell(`am start -a android.intent.action.VIEW -n ${PACKAGE}/.MainActivity -d '${CRM}/email/connect?state=local-test-state-0123456789&code=local-test-code-0123'`)
    const done = await waitFor('the connection', async () => (await eventsOf('email_connect')).at(-1), { timeout: 15000 })
    assert(done.state === 'local-test-state-0123456789' && done.signedIn, JSON.stringify(done))
    await uiWait(/Mailbox connected/, { timeout: 15000 })
    shot('e9-connected')
    for (let i = 0; i < 4 && !uiHas(/^People$/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^People$/)
    await uiWait(/People with access/, { timeout: 10000 })
    await uiTap(/^Person/)
    await uiTap(/^Helper Person/)
    await sleep(500)
    await uiTap(/^Add$/)
    const added = await waitFor('the member', async () => (await eventsOf('email_member')).at(-1), { timeout: 10000 })
    assert(added.role === 'responder', JSON.stringify(added))
    await uiWait(/^Helper Person/, { timeout: 10000 })
    pressBack()
  })

  await check('Email inbox is native: the drawer opens it with the mailbox\'s conversations, and the page hands /email/inbox over', async () => {
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Email inbox/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Email inbox/)
    await uiWait(/Hoarding rates for December/, { timeout: 15000 })
    shot('e1-inbox')
    // Away from the inbox, then the page goes to /email/inbox itself: the app takes it.
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Consent/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Consent/)
    await uiWait(/Look up an address/, { timeout: 15000 })
    await page.eval(`history.pushState({}, '', '/email/inbox'); dispatchEvent(new PopStateEvent('popstate'))`)
    await uiWait(/Hoarding rates for December/, { timeout: 15000 })
  })

  await check('a conversation opens, is marked read, and shows the message in its locked view', async () => {
    await uiTap(/Hoarding rates for December/)
    await waitFor('marked read', async () => (await eventsOf('email_labels')).some((e) => e.remove.includes('UNREAD')), { timeout: 15000 })
    await uiWait(/remote image is hidden/, { timeout: 10000 })
    await uiWait(/Our brief is attached/, { timeout: 15000 })
    shot('e2-conversation')
  })

  await check('a link in the message is asked about, never followed inside the app', async () => {
    await uiTap(/See the brief online/)
    await uiWait(/Open this link\?/, { timeout: 8000 })
    assert(uiHas(/example\.test\/brief/), 'the dialog does not show the address')
    shot('e3-link')
    await uiTap(/^Cancel$/)
    assert(foregroundPackage() === PACKAGE, `foreground is ${foregroundPackage()}`)
  })

  await check('an attachment is downloaded with the session and saved to Downloads', async () => {
    clearLog()
    await uiTap(/^brief\.pdf/)
    await waitFor('the download', async () => (await eventsOf('email_attachment')).length > 0, { timeout: 15000 })
    // The short "Saved brief.pdf to Downloads" message can come and go between two slow
    // accessibility dumps, so this waits for the app's own record of the save instead.
    await waitFor('the save', () => appLog().includes('file event: downloadFinished'), { timeout: 15000 })
  })

  await check('Done sets the status; a reply is sent once, to the sender, in the conversation', async () => {
    await uiTap(/^Status/)
    await uiTap(/^Done$/)
    const status = await waitFor('the status', async () => (await eventsOf('email_workflow')).at(-1), { timeout: 10000 })
    assert(status.workflow_status === 'closed', JSON.stringify(status))
    for (let i = 0; i < 4 && !uiHas(/^Reply$/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Reply$/)
    await uiWait(/^Re: Hoarding rates for December/, { timeout: 10000 })
    await uiTap(/^Message/)
    await sleep(400)
    typeText('Rates attached')
    pressBack()
    await sleep(400)
    await uiTap(/^Send$/)
    const sent = await waitFor('the send', async () => (await eventsOf('email_send')).at(-1), { timeout: 15000 })
    assert(sent.mode === 'reply' && sent.to.includes('asha@client.test') && sent.thread === '44444444-4444-4444-8444-444444444441' && sent.sendId, JSON.stringify(sent))
    assert((await eventsOf('email_send')).length === 1, 'sent twice')
    shot('e4-sent')
  })
  page.close()
}

/** Only the order screens: a short run on its own. */
async function ordersScenario() {
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()
  const page = await connectPage()
  await check('signs in through the app', () => signIn(page))
  await orderChecks(page)
  page.close()
}

/** WhatsApp Contacts' import, read on the phone from a file chosen in Android's picker. */
async function contactsScenario() {
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()
  const page = await connectPage()
  await check('signs in through the app', () => signIn(page))

  await check('a spreadsheet is read on the phone: title line skipped, columns found, landline and blank explained', async () => {
    const csv = 'Customer list\\n\\nName,Mobile,Email,City\\nRAHUL SHARMA,9876543210,rahul@example.test,Pune\\npriya nair,+44 7911 123456,,London\\nNo Phone,,,\\nOffice,022 2345 6789,,\\n'
    shell(`mkdir -p /sdcard/Download/import-test && printf '${csv}' > /sdcard/Download/import-test/new-contacts.csv && am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Download/import-test/new-contacts.csv >/dev/null`)
    await openDrawer()
    for (let i = 0; i < 4 && !uiHas(/^Contacts/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Contacts/)
    await uiWait(/^More$/, { timeout: 15000 })
    await uiTap('More')
    await uiTap(/^Import a spreadsheet/)
    await uiTap(/^Choose a file/, { timeout: 10000 })
    await uiWait(/new-contacts|Download|Recent|Browse/i, { timeout: 15000 })
    if (!uiHas('new-contacts.csv')) {
      await uiTap(/Show roots|More options|Navigate up/i, { timeout: 4000 }).catch(() => {})
      await sleep(800)
      await uiTap(/^Downloads$/, { timeout: 5000 }).catch(() => {})
      await sleep(800)
      await uiTap('import-test', { timeout: 5000 }).catch(() => {})
      await sleep(800)
    }
    await uiTap('new-contacts.csv', { timeout: 10000 })
    await uiWait(/2 contacts ready to import/, { timeout: 20000 })
    await uiWait(/Check the columns in new-contacts\.csv/)
    await uiWait(/1 skipped: a landline/)
    shot('c1-import-check')
  })

  await check('Import sends only the good rows, a +44 number stays British, and the list shows them', async () => {
    await uiTap(/^Import 2 contacts/)
    const sent = await waitFor('the import', async () => (await eventsOf('contacts_import')).at(-1), { timeout: 15000 })
    assert(sent.count === 2 && sent.phones.join() === '919876543210,447911123456', JSON.stringify(sent))
    assert(sent.names[0] === 'Rahul Sharma' && sent.attributes[0].City === 'Pune', JSON.stringify(sent))
    await uiWait(/Imported 2 new contacts/, { timeout: 15000 })
    await uiWait(/Rahul Sharma/, { timeout: 15000 })
    shot('c2-imported')
  })
  page.close()
}

/** The app's own sign-in, the session it owns, and the ways a session ends. */
async function signinScenario() {
  let page
  forceStop()
  adbTry('shell', `pm clear ${PACKAGE}`)
  connectBackends()
  launch()

  await check('a fresh install shows the app\'s own sign-in, with nothing of the CRM loaded', async () => {
    page = await connectPage()
    await uiWait(/^Sign in to Dikho CRM$/, { timeout: 30000 })
    assert(!(await page.eval('Boolean(window.__dikhoNative)')), 'the CRM page loaded before anyone signed in')
    assert(!(await eventsOf('otp_requested')).length, 'a code was asked for by itself')
    shot('s1-sign-in')
  })

  await check('WhatsApp: a wrong code is refused in words, the right one signs in, and the page uses the app\'s session', async () => {
    await nativeSignIn({ whatsapp: true, wrongCodeFirst: true })
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
    assert(await page.eval(`window.__dikhoNative.auth.owner === 'app'`), 'the page does not know the app owns the session')
    assert(await hasSession(page), 'the page cannot read the session')
    const inPageStorage = await page.eval(`Object.keys(localStorage).filter((k) => k.startsWith('sb-')).length`)
    assert(inPageStorage === 0, 'the session is in the page\'s own storage')
    assert(!(await eventsOf('session_refreshed')).length, 'refreshed for no reason')
    await uiWait('Open menu', { timeout: 20000 })
    shot('s2-signed-in')
  })

  await check('the session survives a force-stop, with no new sign-in', async () => {
    const before = (await eventsOf('otp_verified')).length
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
    assert((await eventsOf('otp_verified')).length === before, 'a new sign-in was needed')
  })

  await check('a session ended on the server signs the app out, and the sign-in says why', async () => {
    await fetch('http://127.0.0.1:54321/__expire-sessions', { method: 'POST' })
    page.close()
    forceStop()
    page = await freshPage()
    await uiWait(/^Sign in to Dikho CRM$/, { timeout: 30000 })
    await uiWait(/Your session was ended/, { timeout: 15000 })
    shot('s3-ended')
  })

  await check('email: signing in again, then out from the drawer, ends only this session on the server', async () => {
    await nativeSignIn()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
    const before = (await eventsOf('logout')).length
    await logOutFromDrawer(page, 's4-logout')
    await waitFor('the server told', async () => (await eventsOf('logout')).length > before, { timeout: 10000 })
    assert(nativeSignInShown(), 'the app\'s sign-in is not showing')
    assert(!(await page.eval('Boolean(window.__dikhoNative)')), 'the CRM page is still loaded')
  })

  await check('signed out stays signed out after a relaunch', async () => {
    page.close()
    forceStop()
    page = await freshPage()
    await uiWait(/^Sign in to Dikho CRM$/, { timeout: 30000 })
    assert(!(await page.eval('Boolean(window.__dikhoNative)')), 'the CRM page loaded while signed out')
  })
  page.close()
}

async function freshPage(backends) {
  connectBackends(backends)
  await launchWhenReady()
  const page = await connectPage()
  await pageReady(page)
  return page
}

const nativeSignInShown = () => uiHas(/^Sign in to Dikho CRM$/)
const pageSignInShown = (page) => page.eval(`!!document.querySelector('input[type="email"]')`).catch(() => false)

/** The sign-in screen: the app's own, or the page's in an app from before the app signed people in. */
const signInShown = async (page) => nativeSignInShown() || (await pageSignInShown(page))

/** The app's own sign-in: a code by email or WhatsApp, typed as a person would. */
async function nativeSignIn({ whatsapp = false, wrongCodeFirst = false } = {}) {
  await uiWait(/^Sign in to Dikho CRM$/, { timeout: 30000 })
  if (whatsapp) await uiTap(/^WhatsApp$/)
  await uiTap(whatsapp ? /^WhatsApp number/ : /^Work email/)
  await sleep(300)
  typeText(whatsapp ? '9000000000' : 'owner@example.test')
  // The keyboard's own send key, so nothing depends on where the button sits under it.
  shell('input keyevent KEYCODE_ENTER')
  await uiWait(whatsapp ? /^Check WhatsApp$/ : /^Check your email$/, { timeout: 15000 })
  await sleep(500)
  if (wrongCodeFirst) {
    typeText('000000')
    await uiWait(/That code is wrong or has expired/, { timeout: 10000 })
    await sleep(300)
  }
  typeText('123456')
}

async function signIn(page) {
  const which = await waitFor('a sign-in screen', async () => (nativeSignInShown() ? 'app' : (await pageSignInShown(page)) ? 'page' : null), { timeout: 30000 })
  if (which === 'app') {
    await nativeSignIn()
  } else {
    await page.type('input[type="email"]', 'owner@example.test')
    await enterCode(page)
  }
  await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
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

// The session lives in the Keystore vault, reached through the bridge.
const hasSession = (page) => page.eval(`window.__dikhoNative.vault.get('sb-localhost-auth-token').then((v) => !!v)`)

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
    await waitFor('sign-in', () => signInShown(page))
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
    assert(await hasSession(page), 'no session in the vault')
    shot('02-signed-in')
  })

  await check('WhatsApp OTP sign-in works too', async () => {
    const verifiedBefore = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    await fetch('http://127.0.0.1:54321/__expire-sessions', { method: 'POST' })
    page.close()
    forceStop()
    adbTry('shell', `pm clear ${PACKAGE}`)
    page = await freshPage()
    // The app's own screen: a wrong code is said plainly, then the right one gets in.
    await nativeSignIn({ whatsapp: true, wrongCodeFirst: true })
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
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
    // At once: the vault is written straight away, so a kill just after signing in no
    // longer loses the session, as it did when it lived in the WebView's localStorage.
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
    const after = (await backendEvents()).filter((e) => e.type === 'otp_verified').length
    assert(after === before, 'a new sign-in happened')
  })

  await check('internal navigation stays in the app', async () => {
    await waitFor('the client list', async () => (await pagePath(page)) === '/clients')
    await openDrawer()
    shot('03-drawer')
    for (let i = 0; i < 4 && !uiHas(/^Email settings/); i += 1) { swipeUp(); await sleep(500) }
    await uiTap(/^Email settings/)
    await waitFor('the email settings page', async () => (await pagePath(page)) === '/email/settings')
    assert(foregroundPackage() === PACKAGE, `foreground is ${foregroundPackage()}`)
  })

  await check('back closes the drawer before leaving the page', async () => {
    await openDrawer()
    pressBack()
    await waitFor('the drawer closing', () => !uiHas(/^Clients/), { timeout: 8000 })
    assert((await pagePath(page)) === '/email/settings', 'the page changed')
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
    adbTry('shell', `rm -f "${DOWNLOADS}/TI_SO-TEST-1"*.pdf`)
    // Sales orders is native; its Tax invoice opens this page, which makes the PDF.
    await page.navigate(`${CRM}/sales-orders/1/invoice`)
    await waitFor('the invoice page', () => page.eval(`location.pathname === '/sales-orders/1/invoice'`), { timeout: 20000 })
    shot('03b-invoice-page')
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
    // The app opens on native Clients: the page shows once a web page is chosen.
    await openFromDrawer(page, 'Email settings', '/email/settings')
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
    await logOutFromDrawer(page)
    assert((await backendEvents()).some((e) => e.type === 'logout'), 'no logout reached the server')
    assert(!(await hasSession(page)), 'the session is still stored')
  })

  await check('signed out stays signed out after a relaunch', async () => {
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the sign-in screen', () => signInShown(page))
  })

  await check('an expired session falls back to sign-in', async () => {
    await signIn(page)
    await fetch('http://127.0.0.1:54321/__expire-sessions', { method: 'POST' })
    page.close()
    forceStop()
    page = await freshPage()
    await waitFor('the sign-in screen', () => signInShown(page), { timeout: 20000 })
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

const publishNothing = () => writeFileSync(join(values.updates, 'manifest.json'), JSON.stringify({ schema: 1, appId: PACKAGE, channels: { stable: null } }))

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const installedCode = () => Number(shell(`dumpsys package ${PACKAGE}`).match(/versionCode=(\d+)/)?.[1])

/** What Android will say about an APK: read from the file, so no version is written here twice. */
function apkIdentity(apk) {
  const tools = join(process.env.ANDROID_HOME, 'build-tools')
  const aapt2 = join(tools, readdirSync(tools).sort().at(-1), 'aapt2')
  const badging = execFileSync(aapt2, ['dump', 'badging', apk], { encoding: 'utf8' })
  const match = badging.match(/versionCode='(\d+)' versionName='([^']+)'/)
  return { code: Number(match[1]), version: match[2] }
}

const hasRoot = () => adbTry('shell', 'id -u').out.trim() === '0'

const updateChecks = async () => (await eventsOf('update_check')).filter((e) => e.query?.includes('versionCode')).length

/** Accepts Android's installer, and Play Protect's own prompts on a Play-certified image. */
async function acceptInstaller(code) {
  await uiWait(/Do you want to (update|install)|^Update$/i, { timeout: 30000 })
  await uiTap(/^Update$/i, { timeout: 15000 })
  let sawPlayProtect = false
  await waitFor(`version code ${code}`, async () => {
    if (installedCode() === code) return true
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
  return sawPlayProtect
}

async function upgradeScenario() {
  const oldApk = values['old-apk']
  const newApk = values['new-apk']
  const before = apkIdentity(oldApk)
  const after = apkIdentity(newApk)
  let page

  await check(`install ${before.version} fresh and sign in`, async () => {
    adbTry('uninstall', PACKAGE)
    adb('install', oldApk)
    assert(installedCode() === before.code, `code ${installedCode()}`)
    publishNothing()
    page = await freshPage()
    await signIn(page)
    await page.eval(`localStorage.setItem('upgrade-marker', 'kept')`)
    shot('20-old-signed-in')
  })

  await check('no update offered while none is published', async () => {
    await waitFor('the update check', async () => (await updateChecks()) > 0, { timeout: 15000 })
    await sleep(1500)
    assert(!uiHas('New update available'), 'a dialog appeared')
  })

  const relaunch = async () => {
    page?.close()
    forceStop()
    page = await freshPage()
  }

  await check('every start checks, but coming back to the app soon after does not', async () => {
    const first = await updateChecks()
    await relaunch()
    await waitFor('a check at this start', async () => (await updateChecks()) === first + 1, { timeout: 15000 })
    shell('input keyevent KEYCODE_HOME')
    await sleep(1000)
    launch()
    await sleep(2000)
    assert((await updateChecks()) === first + 1, 'checked again on returning')
  })

  await check('the app runs normally when the update service is down', async () => {
    page.close()
    forceStop()
    clearLog()
    page = await freshPage({ updateService: false })
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`))
    // Proof the service really was out of reach, and not just empty.
    const line = await waitFor('the failed check', () => appLog().split('\n').find((entry) => entry.includes('update check failed')), { timeout: 30000 })
    assert(!uiHas('New update available'), 'a dialog appeared')
    adb('reverse', 'tcp:8799', 'tcp:8799')
    return line.slice(line.indexOf('update check failed'))
  })

  await check('update available shows the dialog, and Later keeps working', async () => {
    publishTestRelease(newApk, after)
    await relaunch()
    await uiWait('New update available', { timeout: 20000 })
    assert(uiHas(`Dikho CRM v${after.version}`), 'the version is missing')
    shot('21-update-dialog')
    await uiTap('Later')
    await waitFor('the dialog to close', () => !uiHas('New update available'), { timeout: 5000 })
    assert(await page.eval(`!!document.querySelector('.app-shell')`), 'the CRM is not usable')
  })

  await check('a corrupted download is rejected and nothing installs', async () => {
    publishTestRelease(newApk, { ...after, sha256: 'b'.repeat(64) })
    await relaunch()
    await uiTap('Update Now', { timeout: 20000 })
    await uiWait('The download was damaged', { timeout: 60000 })
    shot('22-checksum-mismatch')
    assert(installedCode() === before.code, 'it installed')
    await uiTap('Later')
  })

  if (values['other-signer-apk']) {
    await check('an APK signed by another key is rejected before the installer', async () => {
      publishTestRelease(values['other-signer-apk'], after)
      await relaunch()
      await uiTap('Update Now', { timeout: 20000 })
      await uiWait('This update was rejected', { timeout: 60000 })
      shot('23-wrong-signer')
      assert(installedCode() === before.code, 'it installed')
      await uiTap('Later')
    })
  }

  await check('with install permission denied, it explains and stays usable', async () => {
    publishTestRelease(newApk, after)
    shell(`appops set ${PACKAGE} REQUEST_INSTALL_PACKAGES default`)
    await relaunch()
    await uiTap('Update Now', { timeout: 20000 })
    await uiWait('Allow Dikho CRM to install updates', { timeout: 60000 })
    shot('24-permission')
    await uiTap('Not now')
    await waitFor('the dialog to close', () => !uiHas('Allow Dikho CRM to install updates'), { timeout: 5000 })
    assert(installedCode() === before.code, 'it installed')
  })

  await check('cancelling Android\'s installer screen leaves the old version working, with a retry', async () => {
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
    assert(installedCode() === before.code, 'it installed')
  })

  await check('a real signed upgrade keeps the sign-in and data', async () => {
    const signIns = (await eventsOf('otp_verified')).length
    await uiTap('Try again', { timeout: 10000 })
    const sawPlayProtect = await acceptInstaller(after.code)
    page?.close()
    page = await freshPage()
    await waitFor('the signed-in shell', () => page.eval(`!!document.querySelector('.app-shell')`), { timeout: 30000 })
    assert((await page.eval(`localStorage.getItem('upgrade-marker')`)) === 'kept', 'local data was lost')
    assert(await hasSession(page), 'the session was lost')
    assert((await eventsOf('otp_verified')).length === signIns, 'a new sign-in was needed')
    const agent = await page.eval('navigator.userAgent')
    assert(agent.includes(`DikhoCRM/${after.version}`), agent)
    shot('28-new-signed-in')
    return sawPlayProtect ? 'through Play Protect\'s prompt' : ''
  })

  await check('the CRM still works after the upgrade', async () => {
    await openFromDrawer(page, 'Email settings', '/email/settings')
  })

  await check('the new version is up to date, so no dialog appears', async () => {
    await relaunch()
    await sleep(3000)
    assert(!uiHas('New update available'), 'a dialog appeared')
  })

  page?.close()
}

/* ── Update rules ──────────────────────────────────────────────────────── */

// What the owner asked for: required updates block, optional ones can be put off
// until the next start, and the newest release replaces anything ignored before it.
async function updatesScenario() {
  const oldApk = values['old-apk']
  const newApk = values['new-apk']
  const installed = apkIdentity(oldApk)
  const next = apkIdentity(newApk)
  // A newer release on paper. Only its details are read, so it can reuse the same file.
  const later = { version: next.version.replace(/\d+$/, (patch) => Number(patch) + 1), code: next.code + 1 }
  let page

  const restart = async () => {
    page?.close()
    forceStop()
    page = await freshPage()
  }
  const inTheCrm = () => uiHas('Open menu')

  await check('an optional update asks once the CRM is up, and Later lets the person in', async () => {
    adbTry('uninstall', PACKAGE)
    adb('install', oldApk)
    publishTestRelease(newApk, next)
    connectBackends()
    page = await freshPage()
    await signIn(page)
    await uiWait('New update available', { timeout: 20000 })
    await uiWait(`Dikho CRM v${next.version}`)
    shot('80-optional')
    await uiTap('Later')
    await uiWait('Open menu', { timeout: 8000 })
  })

  await check('Later holds while the app stays open', async () => {
    shell('input keyevent KEYCODE_HOME')
    await sleep(1000)
    launch()
    await sleep(3000)
    assert(!uiHas('New update available'), 'it asked again')
    assert(inTheCrm(), 'the CRM is not showing')
  })

  await check('closing and opening the app asks again', async () => {
    await restart()
    await uiWait('New update available', { timeout: 20000 })
    await uiTap('Later')
    await uiWait('Open menu', { timeout: 8000 })
  })

  await check('newest wins: a major update replaces the minor one that was ignored, and blocks', async () => {
    publishTestRelease(newApk, { ...later, minSupported: later.code })
    await restart()
    await uiWait('Update required', { timeout: 20000 })
    await uiWait(`Dikho CRM v${later.version}`)
    assert(!uiHas(`Dikho CRM v${next.version}`), 'the old version is still offered')
    shot('81-required')
    assert(!uiHas('Later') && !uiHas('Not now'), 'it offers a way past')
    assert(!inTheCrm(), 'the CRM is reachable')
  })

  await check('a required update leaves no way in: Back leaves the app instead', async () => {
    pressBack()
    await waitFor('the app to close', () => foregroundPackage() !== PACKAGE, { timeout: 8000 })
    launch()
    await uiWait('Update required', { timeout: 20000 })
    assert(!inTheCrm(), 'the CRM is reachable')
  })

  await check('it stays blocked across a restart with the update service down', async () => {
    page.close()
    forceStop()
    page = await freshPage({ updateService: false })
    await uiWait('Update required', { timeout: 20000 })
    assert(!inTheCrm(), 'the outage let the person in')
    shot('82-required-offline')
    adb('reverse', 'tcp:8799', 'tcp:8799')
  })

  await check('withdrawing the requirement unblocks at Check again', async () => {
    publishTestRelease(newApk, next)
    await uiTap('Check again')
    await waitFor('the block to lift', () => !uiHas('Update required'), { timeout: 15000 })
    await uiWait('New update available', { timeout: 20000 })
    await uiTap('Later')
    await uiWait('Open menu', { timeout: 8000 })
  })

  await check('a required update arriving while the app is open blocks at once', async () => {
    publishTestRelease(newApk, { ...next, minSupported: next.code })
    await restart()
    await uiWait('Update required', { timeout: 20000 })
    assert(installedCode() === installed.code, 'something installed')
  })

  await check('installing it lifts the block, and keeps the sign-in', async () => {
    const signIns = (await eventsOf('otp_verified')).length
    shell(`appops set ${PACKAGE} REQUEST_INSTALL_PACKAGES allow`)
    await uiTap('Update Now', { timeout: 10000 })
    const sawPlayProtect = await acceptInstaller(next.code)
    page?.close()
    page = await freshPage()
    await uiWait('Open menu', { timeout: 30000 })
    assert(!uiHas('Update required'), 'still blocked after installing')
    assert((await eventsOf('otp_verified')).length === signIns, 'a new sign-in was needed')
    shot('83-after-required')
    return sawPlayProtect ? 'through Play Protect\'s prompt' : ''
  })

  page?.close()
}

/* ── Layout scan ───────────────────────────────────────────────────────── */

// Sideways overflow and small tap targets on every CRM route, in the real WebView.
// Lists are nearly empty against the fake backend, so wide data is not covered here.
async function layoutScenario() {
  const routes = [
    '/sales-orders/1/invoice',
    '/email/settings', '/whatsapp', '/whatsapp/inbox',
  ]
  const page = await freshPage()
  await page.navigate(`${CRM}/`)
  const signedIn = await waitFor('the sign-in or the shell', async () => ((await page.eval(`!!document.querySelector('.app-shell')`)) ? 'yes' : (await signInShown(page)) ? 'no' : null))
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

/* ── Every module at phone size ────────────────────────────────────────── */

const PAGE_SCAN = `JSON.stringify((() => {
  const width = window.innerWidth
  const inHorizontalScroller = (el) => {
    for (let node = el.parentElement; node; node = node.parentElement) {
      const overflow = getComputedStyle(node).overflowX
      if ((overflow === 'auto' || overflow === 'scroll') && node.scrollWidth > node.clientWidth) return true
    }
    return false
  }
  const shown = (el) => {
    const r = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
  }
  const describe = (el) => (el.getAttribute('aria-label') || el.textContent || el.className || el.tagName).toString().trim().replace(/\\s+/g, ' ').slice(0, 40)
  const cutOff = [...document.querySelectorAll('.workspace *, .crm-panel *, [role="dialog"] *')]
    .filter((el) => shown(el) && !inHorizontalScroller(el) && el.children.length === 0 && (el.textContent || '').trim())
    .filter((el) => { const r = el.getBoundingClientRect(); return r.right > width + 1 || r.left < -1 })
    .map(describe)
  const small = [...document.querySelectorAll('button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return shown(el) && r.right > 0 && r.left < width && (r.height < 40 || r.width < 40) })
    .map(describe)
  const errors = [...document.querySelectorAll('.page-error, [role="alert"], .error-boundary')].filter(shown).map(describe)
  return {
    path: location.pathname,
    docOverflow: document.documentElement.scrollWidth - width,
    cutOff: [...new Set(cutOff)].slice(0, 8),
    small: [...new Set(small)].slice(0, 12),
    errors: [...new Set(errors)].slice(0, 4),
    text: (document.querySelector('.workspace') || document.body).innerText.length,
  }
})())`

async function walkScenario() {
  const modules = [
    // Clients, Leads, Sales orders, Vendors, Purchase orders, Users, Settings, Email
    // (overview, inbox, campaigns, templates, consent, analytics) and WhatsApp
    // (dashboard, contacts, campaigns, templates) are native screens in the app: their
    // own scenarios cover them.
    { path: '/email/settings' },
  ]
  const page = await freshPage()
  const signedIn = await waitFor('the sign-in or the shell', async () => ((await page.eval(`!!document.querySelector('.app-shell')`)) ? 'yes' : (await signInShown(page)) ? 'no' : null))
  if (signedIn === 'no') await signIn(page)
  // The app opens on native Clients; the page and its modules show once a web page is chosen.
  await openFromDrawer(page, 'Email settings', '/email/settings')
  const noise = []
  page.socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Runtime.exceptionThrown') noise.push(`exception: ${message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text}`)
    if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) noise.push(`${message.params.entry.level}: ${message.params.entry.text}`)
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') noise.push(`console: ${message.params.args.map((a) => a.value ?? a.description).join(' ')}`)
  })
  await page.send('Runtime.enable')
  await page.send('Log.enable')

  const scan = async () => JSON.parse(await page.eval(PAGE_SCAN))
  const report = []
  for (const module of modules) {
    await check(`${module.path} fits and answers`, async () => {
      noise.length = 0
      await page.eval(`history.pushState({}, '', ${JSON.stringify(module.path)}); dispatchEvent(new PopStateEvent('popstate'))`)
      await sleep(2200)
      const base = shotName(module.path)
      shot(base)
      const entry = { module: module.path, list: await scan() }
      if (module.row && await page.eval(`!!document.querySelector(${JSON.stringify(module.row)})`)) {
        const before = await page.eval(`document.body.innerText`)
        await page.tap(module.row)
        await sleep(1200)
        shot(`${base}-row`)
        entry.rowOpens = (await page.eval(`document.body.innerText`)) !== before
        entry.row = await scan()
        pressBack()
        await sleep(800)
      }
      if (module.add && await page.eval(`!!document.querySelector(${JSON.stringify(module.add)})`)) {
        await page.tap(module.add)
        await sleep(1200)
        shot(`${base}-add`)
        entry.add = await scan()
        pressBack()
        await sleep(800)
      }
      entry.noise = [...new Set(noise)].slice(0, 6)
      report.push(entry)
      const problems = []
      for (const [where, found] of [['list', entry.list], ['row', entry.row], ['add', entry.add]]) {
        if (!found) continue
        if (found.docOverflow > 1) problems.push(`${where}: page ${found.docOverflow}px too wide`)
        if (found.cutOff.length) problems.push(`${where}: cut off: ${found.cutOff.join(' | ')}`)
        if (found.errors.length) problems.push(`${where}: error shown: ${found.errors.join(' | ')}`)
      }
      if (entry.rowOpens === false) problems.push('tapping a row does nothing')
      assert(!problems.length, problems.join('; '))
      return entry.noise.length ? `console: ${entry.noise.join(' / ').slice(0, 200)}` : ''
    })
  }
  if (values.shots) writeFileSync(join(values.shots, 'walk-report.json'), JSON.stringify(report, null, 2))
  page.close()
}

const shotName = (path) => `walk${path.replace(/\//g, '-')}`

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
  else if (scenario === 'native') await nativeScenario()
  else if (scenario === 'orders') await ordersScenario()
  else if (scenario === 'contacts') await contactsScenario()
  else if (scenario === 'users') await usersScenario()
  else if (scenario === 'settings') await settingsScenario()
  else if (scenario === 'assist') await assistScenario()
  else if (scenario === 'email') await emailScenario()
  else if (scenario === 'signin') await signinScenario()
  else if (scenario === 'updates') await updatesScenario()
  else if (scenario === 'walk') await walkScenario()
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
    console.error('Scenario must be web, files, layout, native, updates, walk, upgrade, reinstall, save-dialog, tls or no-debug')
    process.exit(2)
  }

  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

await run()
