import { apiGet, apiPost } from '../../lib/api'

// Every call goes through the API Worker, which records the session and tells
// the other side (src/api/routes/assist/index.js). The video itself never does.
export const assistApi = {
  state: () => apiGet('/assist/state'),
  start: (employeeId, helpRequestId = null) => apiPost('/assist/sessions', { employee_id: employeeId, help_request_id: helpRequestId }),
  respond: (sessionId, accept) => apiPost(`/assist/sessions/${sessionId}/respond`, { accept }),
  end: (sessionId, reason = null) => apiPost(`/assist/sessions/${sessionId}/end`, { reason }),
  askHelp: (message, section) => apiPost('/assist/help', { message: message || null, section }),
  cancelHelp: (requestId) => apiPost(`/assist/help/${requestId}/cancel`, {}),
}
