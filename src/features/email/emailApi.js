import { apiGet, apiPost, apiPatch, apiPut, apiDelete, apiSendForm, apiBlob } from '../../lib/api'

// Client for /api/email. Every call carries the session; the Worker and the
// database decide what this person may see. Nothing here is cached in
// browser storage: message content and tokens never touch localStorage.
const q = (params) => {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) search.set(k, v === true ? '1' : String(v))
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const emailApi = {
  status: () => apiGet('/email/status'),
  accounts: () => apiGet('/email/accounts'),
  createShared: (email_address, display_name) => apiPost('/email/accounts/shared', { email_address, display_name }),
  members: (accountId) => apiGet(`/email/accounts/${accountId}/members`),
  setMember: (accountId, userId, role) => apiPut(`/email/accounts/${accountId}/members/${userId}`, { role }),
  removeMember: (accountId, userId) => apiDelete(`/email/accounts/${accountId}/members/${userId}`),
  directory: () => apiGet('/email/directory'),
  recipients: (text) => apiGet(`/email/recipients${q({ q: text })}`),
  startConnect: (accountId) => apiPost('/email/oauth/google/start', accountId ? { account_id: accountId } : {}),
  completeConnect: (body) => apiPost('/email/oauth/google/complete', body),
  disconnect: (accountId) => apiPost(`/email/accounts/${accountId}/disconnect`, {}),
  removeAccount: (accountId) => apiDelete(`/email/accounts/${accountId}`),
  sync: (accountId) => apiPost(`/email/accounts/${accountId}/sync`, {}),
  labels: (accountId) => apiGet(`/email/accounts/${accountId}/labels`),
  sendAs: (accountId) => apiGet(`/email/accounts/${accountId}/send-as`),

  threads: (params) => apiGet(`/email/threads${q(params)}`),
  search: (accountId, text) => apiGet(`/email/accounts/${accountId}/search${q({ q: text })}`),
  thread: (id) => apiGet(`/email/threads/${id}`),
  updateThread: (id, patch) => apiPatch(`/email/threads/${id}`, patch),
  labelThread: (id, add = [], remove = []) => apiPost(`/email/threads/${id}/labels`, { add, remove }),
  addNote: (id, body) => apiPost(`/email/threads/${id}/notes`, { body }),
  crm: (id) => apiGet(`/email/threads/${id}/crm`),
  link: (id, type, entityId) => apiPut(`/email/threads/${id}/links/${type}/${entityId}`, {}),
  unlink: (id, type, entityId) => apiDelete(`/email/threads/${id}/links/${type}/${entityId}`),
  attachment: (threadId, messageId, attachmentId, name) =>
    apiBlob(`/email/threads/${threadId}/messages/${messageId}/attachments/${attachmentId}${q({ name })}`),

  campaigns: () => apiGet('/email/campaigns'),
  campaign: (id) => apiGet(`/email/campaigns/${id}`),
  createCampaign: (fields) => apiPost('/email/campaigns', fields),
  saveCampaign: (id, fields) => apiPut(`/email/campaigns/${id}`, fields),
  submitCampaign: (id) => apiPost(`/email/campaigns/${id}/submit`, {}),
  decideCampaign: (id, approve, hash, note) => apiPost(`/email/campaigns/${id}/decision`, { approve, hash, note }),
  controlCampaign: (id, action) => apiPost(`/email/campaigns/${id}/control`, { action }),
  duplicateCampaign: (id) => apiPost(`/email/campaigns/${id}/duplicate`, {}),
  testCampaign: (id) => apiPost(`/email/campaigns/${id}/test`, {}),
  audiencePreview: (audience) => apiPost('/email/audience/preview', { audience }),
  audienceOptions: () => apiGet('/email/audience/options'),
  templates: () => apiGet('/email/templates'),
  template: (id, version) => apiGet(`/email/templates/${id}${q({ version })}`),
  createTemplate: (fields) => apiPost('/email/templates', fields),
  saveTemplate: (id, fields) => apiPut(`/email/templates/${id}`, fields),
  archiveTemplate: (id) => apiDelete(`/email/templates/${id}`, {}),
  preference: (email) => apiGet(`/email/preferences${q({ email })}`),
  setPreference: (body) => apiPut('/email/preferences', body),
  analytics: (days) => apiGet(`/email/analytics${q({ days })}`),

  send: (accountId, form) => apiSendForm(`/email/accounts/${accountId}/send`, form),
  drafts: (accountId) => apiGet(`/email/accounts/${accountId}/drafts`),
  draft: (accountId, draftId) => apiGet(`/email/accounts/${accountId}/drafts/${draftId}`),
  saveDraft: (accountId, form, draftId) => draftId
    ? apiSendForm(`/email/accounts/${accountId}/drafts/${draftId}`, form, 'PUT')
    : apiSendForm(`/email/accounts/${accountId}/drafts`, form),
  deleteDraft: (accountId, draftId) => apiDelete(`/email/accounts/${accountId}/drafts/${draftId}`),
}
