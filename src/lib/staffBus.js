// Relays events from the signed-in person's private Realtime channel
// (`staff:<user id>`, joined once in AuthenticatedLayout) to whatever screen
// needs them, so the channel is never joined twice. Only the Worker can
// publish on that channel; see src/api/services/userAdmin.js notifyStaff.
const target = new EventTarget()

export const STAFF_EVENTS = ['assist_request', 'assist_response', 'assist_ended', 'help_request', 'help_closed']

export function emitStaffEvent(event, payload) {
  target.dispatchEvent(new CustomEvent(event, { detail: payload }))
}

export function onStaffEvent(event, handler) {
  const listener = (e) => handler(e.detail)
  target.addEventListener(event, listener)
  return () => target.removeEventListener(event, listener)
}
