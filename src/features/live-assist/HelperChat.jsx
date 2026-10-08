import { HELPER_PHRASES, MAX_CHAT, MAX_NOTE } from './chat'
import { ChatIcon, CloseIcon, Composer, MessageList, PinIcon } from './ChatParts'
import { useTyping } from './useTyping'

const noteStatus = (m, who) => ({
  pinned: 'Pinned on their screen',
  clicked: `${who} clicked it`,
  dismissed: `${who} marked it done`,
  cleared: `Cleared when ${who} changed page`,
  removed: 'Removed',
})[m.status] ?? ''

function CollapseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16M8 10l2 2-2 2" />
    </svg>
  )
}

// The helper's chat, beside their screen rather than over it. Clicking the
// screen arms a pin: the next message (typed or a quick phrase) appears on
// the employee's screen next to that spot, numbered.
export default function HelperChat({ who, chat, live, ended, pin, onClearPin, actions, inputRef }) {
  const typing = useTyping(chat.typingAt)
  const pinned = chat.messages.some((m) => m.kind === 'note' && m.status === 'pinned')

  if (!chat.open) {
    return (
      <aside className="la-hchat is-collapsed">
        <button type="button" className="la-hchat-rail" onClick={actions.toggle} aria-label={`Open chat with ${who}`} title="Open chat">
          <ChatIcon />
          {chat.unread > 0 && <span className="la-badge">{chat.unread}<span className="la-sr"> new</span></span>}
        </button>
      </aside>
    )
  }

  return (
    <aside className="la-hchat" aria-label={`Chat with ${who}`}>
      <header className="la-hchat-head">
        <span>Chat with {who}</span>
        <button type="button" className="la-icon-button" onClick={actions.toggle} aria-label="Hide chat" title="Hide chat"><CollapseIcon /></button>
      </header>
      <MessageList
        messages={chat.messages}
        statusText={(m) => noteStatus(m, who)}
        emptyText={live
          ? 'Type a message, or click their screen first to pin a note to that spot.'
          : 'Chat opens when they share their screen.'}
      />
      {typing && <p className="la-typing">{who} is typing…</p>}
      {live ? (
        <div className="la-hchat-foot">
          <div className="la-quick-row">
            {HELPER_PHRASES.map((phrase) => (
              <button key={phrase} type="button" className="la-quick" onClick={() => actions.send(phrase, pin)}>{phrase}</button>
            ))}
          </div>
          {pin && (
            <div className="la-pin-chip">
              <PinIcon />
              <span>Pins to the spot you clicked</span>
              <button type="button" className="la-icon-button" onClick={onClearPin} aria-label="Send without pinning" title="Send without pinning"><CloseIcon /></button>
            </div>
          )}
          <Composer
            inputRef={inputRef}
            placeholder={pin ? 'Note for that spot' : `Message ${who}`}
            max={pin ? MAX_NOTE : MAX_CHAT}
            onSend={(text) => actions.send(text, pin)}
            onTyping={actions.typing}
            onEscape={pin ? onClearPin : undefined}
          />
          {pinned && <button type="button" className="la-link la-remove-notes" onClick={actions.removeNotes}>Remove notes from their screen</button>}
        </div>
      ) : (
        <p className="la-hchat-off">{ended ? 'Live Assist has ended. This chat was not saved.' : 'Chat opens when they share their screen.'}</p>
      )}
    </aside>
  )
}
