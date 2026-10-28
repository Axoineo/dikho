// Settings the whole dashboard reads: the organization's display formats and
// dropdown values (public.get_settings()), and the signed-in person's own
// preferences (returned by public.my_access()). A small store rather than a
// React context, so plain helpers (formatters, form defaults) can read it too.
//
// Until the settings migration is applied the functions do not exist; every
// reader then falls back to the values that used to be fixed in code, so the
// dashboard works either way.
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { setDisplayFormats } from './format'

const PREFS_KEY = 'dikho-prefs'

function cachedPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')
    return value && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

let state = { loaded: false, available: true, organization: {}, lists: [], preferences: cachedPreferences() }
const listeners = new Set()

function emit(changes) {
  state = { ...state, ...changes }
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Re-renders when settings or preferences change. */
export function useSettings() {
  return useSyncExternalStore(subscribe, () => state)
}

export function getSettings() {
  return state
}

// Density applies before React renders, so a compact table never flashes tall.
document.documentElement.dataset.density = state.preferences.density === 'compact' ? 'compact' : 'comfortable'

export async function loadSettings() {
  const { data, error } = await supabase.rpc('get_settings')
  if (error) {
    emit({ loaded: true, available: error.code !== 'PGRST202' })
    return
  }
  const organization = data?.organization || {}
  setDisplayFormats({ date: organization.date_format, number: organization.number_format })
  emit({ loaded: true, available: true, organization, lists: Array.isArray(data?.lists) ? data.lists : [] })
}

export function applyPreferences(preferences) {
  const value = preferences && typeof preferences === 'object' ? preferences : {}
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(value)) } catch { /* private window: fine */ }
  document.documentElement.dataset.density = value.density === 'compact' ? 'compact' : 'comfortable'
  emit({ preferences: value })
}

/**
 * The values a dropdown offers: the visible ones from Settings, in order, or
 * `fallback` (the old built-in list) when Settings has none for this list.
 * `current` is kept even when it is hidden or unknown, so editing a record
 * never silently drops the value it already has.
 */
export function listValues(listKey, fallback = [], current) {
  const rows = state.lists.filter((row) => row.list_key === listKey)
  const values = rows.length ? rows.filter((row) => !row.hidden).map((row) => row.value) : [...fallback]
  if (current && !values.includes(current)) values.push(current)
  return values
}

/** Like listValues, for lists whose values have a separate name (row colours). */
export function listOptions(listKey, fallback = [], current) {
  const rows = state.lists.filter((row) => row.list_key === listKey)
  const options = rows.length
    ? rows.filter((row) => !row.hidden).map((row) => ({ value: row.value, label: row.label || row.value }))
    : fallback.map((option) => ({ ...option }))
  if (current && !options.some((option) => option.value === current)) {
    const known = rows.find((row) => row.value === current) || fallback.find((option) => option.value === current)
    options.push({ value: current, label: known?.label || current })
  }
  return options
}

/** The person's rows-per-page choice, if it is one this table offers. */
export function preferredPageSize(sizes) {
  const wanted = Number(state.preferences.page_size)
  return sizes.includes(wanted) ? wanted : sizes[0]
}

/* ── Saving ─────────────────────────────────────────────────────────────── */

function friendly(error) {
  if (error.code === 'PGRST202') return 'This needs a database update that has not been applied yet.'
  return error.message || 'That did not work. Try again.'
}

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    const failure = new Error(friendly(error))
    failure.code = error.code
    throw failure
  }
  return data
}

export const settingsApi = {
  setMyPreferences: (changes) => call('set_my_preferences', { p_changes: changes }),
  updateOrganization: (changes) => call('update_organization_settings', { p_changes: changes }),
  getCompany: () => call('get_organization_profile'),
  updateCompany: (changes) => call('update_organization_profile', { p_changes: changes }),
  addOption: (list, value, label = null) => call('add_list_option', { p_list: list, p_value: value, p_label: label }),
  setOptionHidden: (id, hidden) => call('set_list_option_hidden', { p_id: id, p_hidden: hidden }),
  moveOption: (id, direction) => call('move_list_option', { p_id: id, p_direction: direction }),
  saveMedia: (id, name, hidden = null) => call('save_media', { p_id: id ?? null, p_name: name ?? null, p_hidden: hidden }),
  saveSubMedia: (id, mediaId, name, hidden = null) => call('save_sub_media', { p_id: id ?? null, p_media_id: mediaId ?? null, p_name: name ?? null, p_hidden: hidden }),
}
