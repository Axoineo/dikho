import { useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AccessContext, PAGE_ACCESS, SECTION_LABELS, canOpen, hasPermission, sectionFor } from '../../lib/access'
import { onStaffEvent } from '../../lib/staffBus'
import { LiveAssistContext } from './liveAssistContext'
import { assistApi } from './assistApi'
import { captureThisTab, shareTab, viewTab } from './peer'
import { chatMessage, chatReducer, emptyChat, helperMessage, readEmployeeMessage, readHelperMessage } from './chat'
import { IncomingDialog, EmployeeOverlay } from './EmployeeAssist'
import HelperViewer from './HelperViewer'
import { AskHelpDialog, HelpToasts, MyHelpPill, Notice } from './HelpWidgets'
import './liveAssist.css'

// Live Assist, for whoever is signed in, in either role:
//   employee: answers a request, shares this tab, sees the helper's pointer,
//             highlights, notes and page suggestions, chats, and can stop at
//             any time;
//   helper:   starts a session, watches, points, highlights, pins notes,
//             chats, suggests pages.
// Plus "Ask for help". The rules (who may help whom, one session per person,
// time limits) are the server's; this only drives the screens and the
// browser-to-browser link. Chat lives in memory only (chat.js).

// How long the helper waits for video after the employee accepts before
// calling the connection failed (most networks connect in a few seconds).
const CONNECT_TIMEOUT_MS = 25_000

const END_MESSAGES = {
  declined: 'They chose not to share their screen.',
  expired: 'They did not answer in time.',
  cancelled: 'You cancelled the request.',
  superseded: 'This request was replaced by a newer one.',
  helper_ended: 'You ended Live Assist.',
  employee_ended: 'They stopped sharing their screen.',
  connection_lost: 'The connection was lost.',
  time_limit: 'Live Assist stops after two hours.',
  access_changed: 'Live Assist was stopped because someone\'s access changed.',
  no_connection: 'Could not connect directly to their browser. Some office or mobile networks block this; try from another network.',
  signal_failed: 'Could not open the private channel for this session.',
  busy: 'They are in another Live Assist session right now.',
}

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || name

export default function LiveAssistProvider({ children }) {
  const access = useContext(AccessContext)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const canHelp = hasPermission(access, 'live_assist.use')

  const [incoming, setIncoming] = useState(null)
  const [employee, setEmployee] = useState(null) // { session, phase }
  const [overlay, setOverlay] = useState({ pointer: null, highlight: null, suggestion: null })
  const [helper, setHelper] = useState(null) // { session, phase, reason, stream, section }
  const [myHelp, setMyHelp] = useState(null)
  const [helpRequests, setHelpRequests] = useState([])
  const [dismissed, setDismissed] = useState(() => new Set())
  const [askOpen, setAskOpen] = useState(false)
  const [notice, setNotice] = useState(null)
  const [employeeChat, dispatchEmployeeChat] = useReducer(chatReducer, emptyChat)
  const [helperChat, dispatchHelperChat] = useReducer(chatReducer, emptyChat)
  const employeePeer = useRef(null)
  const helperPeer = useRef(null)
  const connectTimer = useRef(null)
  // Latest sessions for the notice handlers below, which must not be
  // re-registered (or run side effects inside state updaters) on every change.
  const helperRef = useRef(null)
  const employeeRef = useRef(null)
  const employeeChatRef = useRef(emptyChat)
  // The helper's next note number; a ref so two quick notes never share one.
  const nextNote = useRef(1)
  useEffect(() => { helperRef.current = helper }, [helper])
  useEffect(() => { employeeRef.current = employee }, [employee])
  useEffect(() => { employeeChatRef.current = employeeChat }, [employeeChat])

  const say = useCallback((text) => setNotice({ text, at: Date.now() }), [])

  // ── Load what is already in flight (a page reload, a second tab) ────────
  useEffect(() => {
    if (!access?.user_id) return
    let cancelled = false
    assistApi.state().then((state) => {
      if (cancelled) return
      if (state.incoming && Date.parse(state.incoming.expires_at) > Date.now()) setIncoming(state.incoming)
      setMyHelp(state.my_help_request ?? null)
      setHelpRequests(state.help_requests ?? [])
      // A reload cuts the shared tab and the connection, so a session still
      // marked live from before cannot continue: close it on both sides.
      for (const session of state.sessions ?? []) assistApi.end(session.id, 'connection_lost').catch(() => {})
    }, () => {})
    return () => { cancelled = true }
  }, [access?.user_id])

  // ── Employee side ───────────────────────────────────────────────────────
  const closeEmployee = useCallback(() => {
    employeePeer.current?.close()
    employeePeer.current = null
    setEmployee(null)
    setOverlay({ pointer: null, highlight: null, suggestion: null })
    dispatchEmployeeChat({ type: 'reset' })
  }, [])

  const stopSharing = useCallback(async (reason = null) => {
    const id = employee?.session.id
    closeEmployee()
    if (id) await assistApi.end(id, reason).catch(() => {})
  }, [employee, closeEmployee])

  const handleHelperMessage = useCallback((message) => {
    const inRange = (v) => typeof v === 'number' && v >= 0 && v <= 1
    if (message.t === 'pointer' && inRange(message.x) && inRange(message.y)) {
      setOverlay((o) => ({ ...o, pointer: { x: message.x, y: message.y, at: Date.now() } }))
    } else if (message.t === 'pointer_hide') {
      setOverlay((o) => ({ ...o, pointer: null }))
    } else if (message.t === 'highlight' && inRange(message.x) && inRange(message.y)) {
      setOverlay((o) => ({ ...o, highlight: { x: message.x, y: message.y, at: Date.now() } }))
    } else if (message.t === 'goto') {
      // Only a page of this app, never an arbitrary address.
      const page = PAGE_ACCESS.find((p) => p.path === message.path)
      if (page) setOverlay((o) => ({ ...o, suggestion: { path: page.path, label: SECTION_LABELS[page.section] ?? page.path, at: Date.now() } }))
    } else {
      const chat = readHelperMessage(message)
      if (chat) dispatchEmployeeChat({ type: 'receive', message: chat, now: Date.now() })
    }
  }, [])

  const acceptIncoming = useCallback(async () => {
    const session = incoming
    if (!session) return { ok: false }
    let stream
    try {
      // Must run straight from the click: browsers only open the share
      // picker in direct response to the person's action.
      stream = await captureThisTab()
    } catch (err) {
      if (err.code === 'unsupported') return { ok: false, message: 'Sharing your screen needs Chrome or Edge on a computer.' }
      if (err.code === 'not_tab') return { ok: false, message: 'Please share this Dikho tab, not a window or your whole screen.' }
      return { ok: false, message: 'Screen sharing was not started. Try again, and choose this tab.' }
    }
    let answer
    try {
      answer = await assistApi.respond(session.id, true)
    } catch (err) {
      for (const t of stream.getTracks()) t.stop()
      setIncoming(null)
      return { ok: false, message: err.message }
    }
    setIncoming(null)
    if (answer.status !== 'active') {
      for (const t of stream.getTracks()) t.stop()
      say(END_MESSAGES[answer.end_reason] ?? 'Live Assist could not start.')
      return { ok: true }
    }
    // The browser's own "Stop sharing" bar ends it too.
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      closeEmployee()
      assistApi.end(answer.id).catch(() => {})
    })
    employeePeer.current = shareTab({
      sessionId: answer.id,
      stream,
      onData: handleHelperMessage,
      onState: (state) => {
        if (state === 'connected') setEmployee((e) => (e ? { ...e, phase: 'live' } : e))
        if (state === 'failed' || state === 'signal_failed') {
          closeEmployee()
          assistApi.end(answer.id, 'connection_lost').catch(() => {})
          say('Live Assist ended: the connection was lost.')
        }
      },
    })
    dispatchEmployeeChat({ type: 'reset' })
    setEmployee({ session: answer, phase: 'connecting' })
    return { ok: true }
  }, [incoming, handleHelperMessage, closeEmployee, say])

  const declineIncoming = useCallback(async () => {
    const id = incoming?.id
    setIncoming(null)
    if (id) await assistApi.respond(id, false).catch(() => {})
  }, [incoming])

  // Tell the helper which section this tab is on (never the full address).
  const section = sectionFor(pathname)
  useEffect(() => {
    if (employee?.phase === 'live') employeePeer.current?.send({ t: 'section', section })
  }, [section, employee?.phase])

  // Notes and highlights point at things on one page; on another page they
  // would point at the wrong things, so they go, and the helper is told.
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    setOverlay((o) => (o.highlight ? { ...o, highlight: null } : o))
    if (employeeChatRef.current.notes.length) {
      dispatchEmployeeChat({ type: 'clear_notes' })
      employeePeer.current?.send({ t: 'notes_cleared' })
    }
  }, [pathname])

  // Stable, so the overlay's timers and listeners do not restart.
  const employeeChatActions = useMemo(() => ({
    toggle: () => dispatchEmployeeChat({ type: 'toggle' }),
    open: () => dispatchEmployeeChat({ type: 'open' }),
    close: () => dispatchEmployeeChat({ type: 'close' }),
    dismissPeek: () => dispatchEmployeeChat({ type: 'dismiss_peek' }),
    send: (text) => {
      const message = chatMessage(text)
      if (!message) return
      employeePeer.current?.send(message)
      dispatchEmployeeChat({ type: 'send', message, now: Date.now() })
    },
    typing: () => employeePeer.current?.send({ t: 'typing' }),
    noteDone: (id, how) => {
      employeePeer.current?.send({ t: 'note_done', id, how })
      dispatchEmployeeChat({ type: 'note_done', id, how })
    },
  }), [])

  // ── Helper side ─────────────────────────────────────────────────────────
  const closeHelperPeer = useCallback(() => {
    clearTimeout(connectTimer.current)
    helperPeer.current?.close()
    helperPeer.current = null
  }, [])

  const finishHelper = useCallback((reason) => {
    closeHelperPeer()
    setHelper((h) => (h ? { ...h, phase: 'ended', reason, stream: null } : h))
  }, [closeHelperPeer])

  const startAssist = useCallback(async (member, helpRequestId = null) => {
    if (helper && helper.phase !== 'ended') {
      say('Finish your current Live Assist session first.')
      return
    }
    // A tab being shared must never show another session's viewer.
    if (employeeRef.current) {
      say('Stop sharing your screen before you help someone.')
      return
    }
    let session
    try {
      session = await assistApi.start(member.user_id, helpRequestId)
    } catch (err) {
      say(err.message)
      return
    }
    if (helpRequestId) setHelpRequests((list) => list.filter((r) => r.id !== helpRequestId))
    nextNote.current = 1
    dispatchHelperChat({ type: 'reset' })
    dispatchHelperChat({ type: 'open' })
    setHelper({ session, phase: 'waiting', reason: null, stream: null, section: null })
    helperPeer.current = viewTab({
      sessionId: session.id,
      onStream: (stream) => setHelper((h) => (h ? { ...h, stream } : h)),
      onData: (message) => {
        if (message.t === 'section') {
          if (message.section === null || typeof message.section === 'string') setHelper((h) => (h ? { ...h, section: message.section } : h))
          return
        }
        const chat = readEmployeeMessage(message)
        if (!chat) return
        if (chat.t === 'notes_cleared') nextNote.current = 1
        dispatchHelperChat({ type: 'receive', message: chat, now: Date.now() })
      },
      onState: (state) => {
        if (state === 'connected') {
          clearTimeout(connectTimer.current)
          setHelper((h) => (h && h.phase !== 'ended' ? { ...h, phase: 'live' } : h))
        } else if (state === 'failed' || state === 'signal_failed') {
          assistApi.end(session.id, 'connection_lost').catch(() => {})
          finishHelper(state === 'signal_failed' ? 'signal_failed' : 'no_connection')
        }
      },
    })
  }, [helper, say, finishHelper])

  const endHelper = useCallback(async () => {
    const id = helper?.session.id
    const wasWaiting = helper?.phase === 'waiting'
    finishHelper(wasWaiting ? 'cancelled' : 'helper_ended')
    if (id) await assistApi.end(id).catch(() => {})
  }, [helper, finishHelper])

  const closeViewer = useCallback(() => {
    closeHelperPeer()
    setHelper(null)
    dispatchHelperChat({ type: 'reset' })
  }, [closeHelperPeer])

  const helperChatActions = useMemo(() => ({
    toggle: () => dispatchHelperChat({ type: 'toggle' }),
    open: () => dispatchHelperChat({ type: 'open' }),
    send: (text, pin) => {
      const message = helperMessage(text, pin, nextNote.current)
      if (!message) return
      if (message.t === 'note') nextNote.current = message.n + 1
      helperPeer.current?.send(message)
      dispatchHelperChat({ type: 'send', message, now: Date.now() })
    },
    typing: () => helperPeer.current?.send({ t: 'typing' }),
    removeNotes: () => {
      nextNote.current = 1
      helperPeer.current?.send({ t: 'note_remove', id: 'all' })
      dispatchHelperChat({ type: 'remove_notes' })
    },
  }), [])

  const sendToEmployee = useCallback((message) => helperPeer.current?.send(message), [])

  // A request waits 60 seconds for an answer.
  useEffect(() => {
    if (helper?.phase !== 'waiting') return
    const wait = Date.parse(helper.session.expires_at) - Date.now() + 1500
    const t = setTimeout(() => finishHelper('expired'), Math.max(wait, 1000))
    return () => clearTimeout(t)
  }, [helper?.phase, helper?.session.expires_at, finishHelper])

  // ── Notices from the server ─────────────────────────────────────────────
  useEffect(() => {
    const offs = [
      onStaffEvent('assist_request', (session) => {
        if (!session?.id || session.employee_id !== access?.user_id) return
        setIncoming(session)
        if (session.from_help_request) setMyHelp(null)
      }),
      onStaffEvent('assist_response', (session) => {
        const h = helperRef.current
        if (!h || h.session.id !== session?.id || h.phase === 'ended') return
        if (session.status === 'active') {
          clearTimeout(connectTimer.current)
          connectTimer.current = setTimeout(() => {
            assistApi.end(session.id, 'connection_lost').catch(() => {})
            finishHelper('no_connection')
          }, CONNECT_TIMEOUT_MS)
          setHelper((cur) => (cur && cur.session.id === session.id
            ? { ...cur, phase: cur.phase === 'live' ? 'live' : 'connecting', session: { ...cur.session, ...session } }
            : cur))
        } else {
          finishHelper(session.end_reason ?? 'declined')
        }
      }),
      onStaffEvent('assist_ended', (session) => {
        if (!session?.id) return
        setIncoming((i) => (i?.id === session.id ? null : i))
        const h = helperRef.current
        if (h && h.session.id === session.id && h.phase !== 'ended') finishHelper(session.end_reason)
        if (employeeRef.current?.session.id === session.id) {
          closeEmployee()
          say(session.end_reason === 'helper_ended' ? `${session.helper_name} ended Live Assist.` : 'Live Assist ended.')
        }
      }),
      onStaffEvent('help_request', (request) => {
        if (!request?.id || !canHelp) return
        setHelpRequests((list) => (list.some((r) => r.id === request.id) ? list : [...list, request]))
      }),
      onStaffEvent('help_closed', ({ request_id: id } = {}) => {
        setHelpRequests((list) => list.filter((r) => r.id !== id))
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [access?.user_id, canHelp, closeEmployee, finishHelper, say])

  // An unanswered request and my own help request both time out.
  useEffect(() => {
    if (!incoming) return
    const t = setTimeout(() => setIncoming(null), Math.max(Date.parse(incoming.expires_at) - Date.now(), 0))
    return () => clearTimeout(t)
  }, [incoming])
  useEffect(() => {
    if (!myHelp) return
    const t = setTimeout(() => setMyHelp(null), Math.max(Date.parse(myHelp.expires_at) - Date.now(), 0))
    return () => clearTimeout(t)
  }, [myHelp])

  // Close everything if this layout unmounts (sign-out).
  useEffect(() => () => {
    employeePeer.current?.close()
    helperPeer.current?.close()
    clearTimeout(connectTimer.current)
  }, [])

  // ── Ask for help ────────────────────────────────────────────────────────
  const askForHelp = useCallback(async (message, helperId = null) => {
    const result = await assistApi.askHelp(message, section, helperId)
    if (result.helpers_notified === 0) {
      await assistApi.cancelHelp(result.request_id).catch(() => {})
      say('Nobody can take Live Assist requests for your account yet. Ask an Owner to set it up.')
      return
    }
    setMyHelp({ id: result.request_id, expires_at: result.expires_at, helper_name: result.helper_name ?? null })
    if (result.already_open) say('You have already asked. Someone will be with you shortly.')
    else if (result.helper_name) say(`${firstName(result.helper_name)} has been asked. You will get a request to share your screen.`)
    else say('Help is on the way. You will get a request to share your screen.')
  }, [section, say])

  const cancelHelp = useCallback(async () => {
    const id = myHelp?.id
    setMyHelp(null)
    if (id) await assistApi.cancelHelp(id).catch(() => {})
  }, [myHelp])

  // Stable handlers for the employee overlay: its timers key off them.
  const onGo = useCallback((path) => {
    setOverlay((o) => ({ ...o, suggestion: null }))
    if (canOpen(access, path)) navigate(path)
    else say('Your account does not include that page.')
  }, [access, navigate, say])
  const onDismissSuggestion = useCallback(() => setOverlay((o) => ({ ...o, suggestion: null })), [])
  const onHighlightDone = useCallback(() => setOverlay((o) => ({ ...o, highlight: null })), [])
  const onStop = useCallback(() => { stopSharing() }, [stopSharing])

  const openRequests = useMemo(() => helpRequests.filter((r) => !dismissed.has(r.id)), [helpRequests, dismissed])

  const helping = Boolean(helper && helper.phase !== 'ended')
  const value = useMemo(() => ({
    canHelp,
    helpRequests,
    helpRequestFor: (userId) => helpRequests.find((r) => r.requester_id === userId) ?? null,
    startAssist,
    // In a session in either role: one at a time per person.
    busy: helping || Boolean(employee),
    openAskHelp: () => setAskOpen(true),
    hasOpenHelpRequest: Boolean(myHelp),
  }), [canHelp, helpRequests, startAssist, helping, employee, myHelp])

  return (
    <LiveAssistContext.Provider value={value}>
      {children}

      {incoming && !employee && !helping && (
        <IncomingDialog session={incoming} onAccept={acceptIncoming} onDecline={declineIncoming} />
      )}
      {employee && (
        <EmployeeOverlay
          session={employee.session}
          phase={employee.phase}
          overlay={overlay}
          chat={employeeChat}
          chatActions={employeeChatActions}
          onStop={onStop}
          onGo={onGo}
          onDismissSuggestion={onDismissSuggestion}
          onHighlightDone={onHighlightDone}
        />
      )}
      {helper && (
        <HelperViewer
          helper={helper}
          chat={helperChat}
          chatActions={helperChatActions}
          endMessages={END_MESSAGES}
          onSend={sendToEmployee}
          onEnd={endHelper}
          onClose={closeViewer}
        />
      )}

      {canHelp && !helper && openRequests.length > 0 && (
        <HelpToasts
          requests={openRequests}
          onHelp={(request) => startAssist({ user_id: request.requester_id, full_name: request.requester_name }, request.id)}
          onDismiss={(id) => setDismissed((d) => new Set(d).add(id))}
        />
      )}
      {myHelp && !employee && !incoming && <MyHelpPill helperName={myHelp.helper_name} onCancel={cancelHelp} />}
      {askOpen && (
        <AskHelpDialog
          onClose={() => setAskOpen(false)}
          onSend={async (message, helperId) => { await askForHelp(message, helperId); setAskOpen(false) }}
          already={Boolean(myHelp)}
        />
      )}
      {notice && <Notice key={notice.at} text={notice.text} onDone={() => setNotice(null)} />}
    </LiveAssistContext.Provider>
  )
}
