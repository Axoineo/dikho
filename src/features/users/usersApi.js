import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '../../lib/api'

// Every User Management call goes through the API Worker, which verifies the
// caller and hands the change to the database functions that hold the rules
// (src/api/routes/users/index.js). The browser never writes these tables.
export const usersApi = {
  list: () => apiGet('/users'),
  catalog: () => apiGet('/users/catalog'),
  get: (id) => apiGet(`/users/${id}`),
  me: () => apiGet('/users/me'),
  create: (body) => apiPost('/users', body),
  update: (id, patch) => apiPatch(`/users/${id}`, patch),
  setOverrides: (id, overrides) => apiPut(`/users/${id}/permissions`, { overrides }),
  setStatus: (id, status, reason) => apiPost(`/users/${id}/status`, { status, reason }),
  signOut: (id, sessionId = null) => apiPost(`/users/${id}/sign-out`, { session_id: sessionId }),
  resendWelcome: (id) => apiPost(`/users/${id}/welcome`, {}),
  audit: ({ user, before } = {}) => {
    const params = new URLSearchParams()
    if (user) params.set('user', user)
    if (before) params.set('before', String(before))
    const query = params.toString()
    return apiGet(`/users/audit${query ? `?${query}` : ''}`)
  },
  saveTemplate: (template) => apiPost('/users/templates', template),
  deleteTemplate: (id) => apiDelete(`/users/templates/${id}`, {}),
  saveOrgUnit: (unit) => apiPost('/users/org-units', unit),
}
