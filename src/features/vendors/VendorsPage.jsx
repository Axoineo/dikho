import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { formatValue, getValue } from '../../lib/format'
import { isActiveStatus } from '../../lib/status'
import { Icon } from '../../components/Icon'
import { ContactHoverAction } from '../../components/ContactHoverAction'
import { SearchableSelect } from '../../components/SearchableSelect'
import VendorDetails from './VendorDetails'
import AddVendorModal from './AddVendorModal'
import {
  EMPTY_VENDOR_FILTERS, VENDOR_COLUMN_COUNT, VENDORS_PAGE_SIZE,
  vendorSelect, applyVendorFilters, primaryAddress,
  isSlashSearch, resolveSlashSearch, buildSlashInput,
  uniqueOptions, fetchAllPaged, SLASH_PATH_HINT, needsAddressJoin,
  SLASH_CHAIN, normalizeToken
} from './vendorFilters'

export default function VendorsPage() {
  // ── Catalogs that both the dropdowns and the "/" chain resolve against ────
  const [mediaOptions, setMediaOptions] = useState([])
  const [subMediaOptions, setSubMediaOptions] = useState([])
  const [addressFacets, setAddressFacets] = useState([])
  const [catalogReady, setCatalogReady] = useState(false)

  // ── Search: `searchInput` drives the UI, `appliedSearch` drives the query ─
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [suggestIndex, setSuggestIndex] = useState(0)
  const searchInputRef = useRef(null)
  const searchShellRef = useRef(null)

  const [filters, setFilters] = useState(EMPTY_VENDOR_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const [vendors, setVendors] = useState([])
  const [page, setPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  // Bumping `refresh` re-runs the loader even when nothing else changed. It is
  // a fresh object every time on purpose: the previous implementation reset
  // page/query/filters to values they already held, React bailed out of all
  // three updates, and a newly added vendor only showed up after a reload.
  const [refresh, setRefresh] = useState({ key: 0, silent: false })

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')

  const [showForm, setShowForm] = useState(false)
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [selectedVendorAddress, setSelectedVendorAddress] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [selectingAll, setSelectingAll] = useState(false)
  const [showSharePopover, setShowSharePopover] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)

  /* ── Data loading ─────────────────────────────────────────────────────── */

  // Reloaded after every save too: a new vendor can introduce a state, city or
  // country that the filters and the "/" chain should immediately offer.
  useEffect(() => {
    let cancelled = false

    async function loadCatalog() {
      try {
        const [media, subMedia, facets] = await Promise.all([
          supabase.from('media').select('id,name').order('name', { ascending: true }),
          supabase.from('sub_media').select('id,name,media_id').order('name', { ascending: true }),
          fetchAllPaged((from, to) => supabase
            .from('vendor_addresses')
            .select('state,city,country')
            .order('id', { ascending: true })
            .range(from, to)),
        ])
        if (cancelled) return
        setMediaOptions(media.data || [])
        setSubMediaOptions(subMedia.data || [])
        setAddressFacets(facets)
      } catch {
        if (!cancelled) setAddressFacets([])
      } finally {
        if (!cancelled) setCatalogReady(true)
      }
    }

    loadCatalog()
    return () => { cancelled = true }
  }, [refresh.key])

  useEffect(() => {
    let cancelled = false

    async function loadSelectedVendorAddress() {
      if (!selectedVendor?.id) {
        setSelectedVendorAddress(null)
        return
      }
      const { data, error: addressError } = await supabase
        .from('vendor_addresses')
        .select('*')
        .eq('vendor_id', selectedVendor.id)
        .order('is_default', { ascending: false })
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      setSelectedVendorAddress(addressError ? null : data)
    }

    loadSelectedVendorAddress()
    return () => { cancelled = true }
  }, [selectedVendor])

  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(searchInput)
      setPage(1)
    }, 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  /* ── Slash-command parsing ────────────────────────────────────────────── */

  const slashCatalog = useMemo(
    () => ({ facets: addressFacets, media: mediaOptions, subMedia: subMediaOptions }),
    [addressFacets, mediaOptions, subMediaOptions],
  )

  // Two resolutions of the same pure function: the live one keeps the chips and
  // suggestions in step with every keystroke, the applied one is debounced so
  // typing does not fire a request per character.
  const liveSlash = useMemo(() => resolveSlashSearch(searchInput, slashCatalog), [searchInput, slashCatalog])
  const appliedSlash = useMemo(() => resolveSlashSearch(appliedSearch, slashCatalog), [appliedSearch, slashCatalog])

  const slashActive = Boolean(liveSlash)
  const textQuery = appliedSlash ? '' : appliedSearch.trim()

  // A "/" chain owns the four dimensions it addresses plus city (which hangs off
  // state); status stays under manual control because nothing in the chain
  // touches it.
  const effectiveFilters = useMemo(() => (
    appliedSlash
      ? { ...EMPTY_VENDOR_FILTERS, ...appliedSlash.filters, status: filters.status }
      : filters
  ), [appliedSlash, filters])

  const activeToken = liveSlash?.tokens[liveSlash.activeIndex] || null

  const suggestions = useMemo(() => {
    if (!activeToken) return []
    const needle = normalizeToken(activeToken.raw)
    const pool = needle
      ? activeToken.options.filter((option) => normalizeToken(option.label).includes(needle))
      : activeToken.options
    return pool.slice(0, 8)
  }, [activeToken])

  const showSuggestions = slashActive && suggestOpen && catalogReady
  const boundedSuggestIndex = suggestions.length ? Math.min(suggestIndex, suggestions.length - 1) : 0

  useEffect(() => { setSuggestIndex(0) }, [searchInput])

  // Close the suggestion list on an outside click, like the other menus here.
  useEffect(() => {
    if (!showSuggestions) return
    function handlePointerDown(event) {
      if (searchShellRef.current && !searchShellRef.current.contains(event.target)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [showSuggestions])

  // "/" anywhere on the page jumps into the chained filter.
  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || showForm) return
      const target = event.target
      if (target?.isContentEditable) return
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return
      event.preventDefault()
      setSearchInput((current) => (isSlashSearch(current) ? current : '/'))
      setSuggestOpen(true)
      searchInputRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showForm])

  function applySuggestion(option) {
    if (!liveSlash) return
    const next = buildSlashInput(liveSlash, liveSlash.activeIndex, option.label)
    setSearchInput(next)
    setAppliedSearch(next)
    setPage(1)
    setSuggestIndex(0)
    searchInputRef.current?.focus()
  }

  // Clicking a chip truncates the chain back to that step so it can be retyped.
  function editSegment(index) {
    if (!liveSlash) return
    const parts = liveSlash.tokens.slice(0, index + 1).map((token) => token.match?.label || token.raw)
    setSearchInput(`/${parts.join('/')}`)
    setSuggestOpen(true)
    setSuggestIndex(0)
    searchInputRef.current?.focus()
  }

  function handleSearchKeyDown(event) {
    if (event.key === 'Escape') {
      setSuggestOpen(false)
      return
    }
    if (!showSuggestions || suggestions.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSuggestIndex((current) => (current + 1) % suggestions.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSuggestIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      applySuggestion(suggestions[boundedSuggestIndex])
    }
  }

  /* ── Vendor list ──────────────────────────────────────────────────────── */

  useEffect(() => {
    // A "/" chain cannot be resolved before the catalogs are in memory, and
    // fetching early would briefly apply an empty chain — i.e. show everything.
    if (appliedSlash && !catalogReady) return

    // A segment that matches nothing is a genuinely empty result, not a reason
    // to fall back to the broader query the rest of the chain would produce.
    if (appliedSlash?.unmatched) {
      setVendors([])
      setTotalCount(0)
      setError('')
      setLoading(false)
      setRefreshing(false)
      return
    }

    let cancelled = false
    const silent = refresh.silent

    async function loadVendors() {
      if (silent) setRefreshing(true)
      else setLoading(true)
      setError('')

      const from = (page - 1) * VENDORS_PAGE_SIZE
      let request = supabase
        .from('vendors')
        .select(vendorSelect('*', effectiveFilters), { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, from + VENDORS_PAGE_SIZE - 1)

      request = applyVendorFilters(request, textQuery, effectiveFilters)

      const { data, count, error: fetchError } = await request
      if (cancelled) return

      if (fetchError) {
        setVendors([])
        setTotalCount(0)
        setError(fetchError.message)
      } else {
        setVendors(data || [])
        setTotalCount(count || 0)
      }
      setLoading(false)
      setRefreshing(false)
    }

    loadVendors()
    return () => { cancelled = true }
  }, [page, textQuery, effectiveFilters, appliedSlash, catalogReady, refresh])

  const mediaMap = useMemo(() => Object.fromEntries(mediaOptions.map((item) => [item.id, item.name])), [mediaOptions])
  const subMediaMap = useMemo(() => Object.fromEntries(subMediaOptions.map((item) => [item.id, item.name])), [subMediaOptions])

  const totalPages = Math.max(1, Math.ceil(totalCount / VENDORS_PAGE_SIZE))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * VENDORS_PAGE_SIZE + 1
  const pageEnd = Math.min(page * VENDORS_PAGE_SIZE, totalCount)
  const pageNumbers = useMemo(() => {
    const current = Math.min(page, totalPages)
    return [current - 2, current - 1, current, current + 1, current + 2].filter((n) => n >= 1 && n <= totalPages)
  }, [page, totalPages])

  // Deleting or filtering can shrink the result set under the current page.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  /* ── Filter option lists ──────────────────────────────────────────────── */

  const mediaFilterOptions = useMemo(() => [
    { value: '', label: 'All media' },
    ...mediaOptions.map((item) => ({ value: String(item.id), label: item.name })),
  ], [mediaOptions])

  const subMediaFilterOptions = useMemo(() => [
    { value: '', label: 'All sub media' },
    ...subMediaOptions
      .filter((item) => !filters.media_id || String(item.media_id) === String(filters.media_id))
      .map((item) => ({ value: String(item.id), label: item.name })),
  ], [subMediaOptions, filters.media_id])

  const countryFilterOptions = useMemo(() => [
    { value: '', label: 'All countries' },
    ...uniqueOptions(addressFacets.map((item) => item.country)),
  ], [addressFacets])

  const stateFilterOptions = useMemo(() => [
    { value: '', label: 'All states' },
    ...uniqueOptions(addressFacets
      .filter((item) => !filters.country || item.country === filters.country)
      .map((item) => item.state)),
  ], [addressFacets, filters.country])

  const cityFilterOptions = useMemo(() => [
    { value: '', label: 'All cities' },
    ...uniqueOptions(addressFacets
      .filter((item) => (!filters.country || item.country === filters.country) && (!filters.state || item.state === filters.state))
      .map((item) => item.city)),
  ], [addressFacets, filters.country, filters.state])

  // Chain dimensions are only manually adjustable while no "/" search owns them.
  const activeFilterCount = Object.entries(filters)
    .filter(([field, value]) => value !== '' && (!slashActive || field === 'status'))
    .length
  const hasActiveCriteria = Boolean(searchInput) || activeFilterCount > 0

  const filterChips = useMemo(() => {
    const chips = []
    const push = (field, label, value) => { if (value) chips.push({ field, label, value }) }
    if (!slashActive) {
      push('media_id', 'Media', filters.media_id && (mediaMap[Number(filters.media_id)] || filters.media_id))
      push('sub_media_id', 'Sub media', filters.sub_media_id && (subMediaMap[Number(filters.sub_media_id)] || filters.sub_media_id))
      push('country', 'Country', filters.country)
      push('state', 'State', filters.state)
      push('city', 'City', filters.city)
    }
    push('status', 'Status', filters.status === '' ? '' : (filters.status === '1' ? 'Active' : 'Inactive'))
    return chips
  }, [filters, slashActive, mediaMap, subMediaMap])

  /* ── Actions ──────────────────────────────────────────────────────────── */

  function changePage(nextPage) { setPage(Math.max(1, Math.min(nextPage, totalPages))) }

  // Dependent filters reset so an impossible combination can never be selected.
  function setFilter(field, value) {
    setActionError('')
    setFilters((current) => {
      const next = { ...current, [field]: value }
      if (field === 'media_id') next.sub_media_id = ''
      if (field === 'country') { next.state = ''; next.city = '' }
      if (field === 'state') next.city = ''
      return next
    })
    setPage(1)
  }

  function clearSearch() {
    setSearchInput('')
    setAppliedSearch('')
    setSuggestOpen(false)
    setPage(1)
  }

  function clearAllCriteria() {
    setActionError('')
    setFilters(EMPTY_VENDOR_FILTERS)
    setSearchInput('')
    setAppliedSearch('')
    setSuggestOpen(false)
    setPage(1)
  }

  function afterSaved(created) {
    setShowForm(false)
    setError('')
    setActionError('')

    // The new vendor need not match whatever is currently filtered, so return
    // the view to the top of the unfiltered list where it is guaranteed to be.
    setSearchInput('')
    setAppliedSearch('')
    setSuggestOpen(false)
    setFilters(EMPTY_VENDOR_FILTERS)
    setPage(1)

    // Optimistic: the row is on screen before the reload lands. Rows are
    // ordered by descending id, so a new vendor belongs at the top of page 1.
    if (created?.id) {
      setVendors((current) => [created, ...current.filter((vendor) => vendor.id !== created.id)].slice(0, VENDORS_PAGE_SIZE))
      setTotalCount((current) => current + 1)
    }

    // …then reconcile against the server. `silent` keeps the optimistic row
    // visible instead of replacing it with loading skeletons.
    setRefresh((current) => ({ key: current.key + 1, silent: Boolean(created?.id) }))
  }

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const currentPageIds = vendors.map((vendor) => vendor.id)
  const allCurrentSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedSet.has(id))

  function toggleSelect(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  }

  function toggleSelectPage() {
    setSelectedIds((current) => {
      if (allCurrentSelected) return current.filter((id) => !currentPageIds.includes(id))
      return [...new Set([...current, ...currentPageIds])]
    })
  }

  // Selects every vendor matching the current criteria, not just this page.
  async function selectAllFiltered() {
    setSelectingAll(true)
    setActionError('')
    try {
      const rows = await fetchAllPaged((from, to) => {
        const columns = needsAddressJoin(effectiveFilters) ? 'id,vendor_addresses!inner(country,state,city)' : 'id'
        return applyVendorFilters(
          supabase.from('vendors').select(columns).order('id', { ascending: false }).range(from, to),
          textQuery,
          effectiveFilters,
        )
      })
      setSelectedIds(rows.map((row) => row.id))
    } catch (err) {
      console.error(err)
      setActionError(err?.message || 'Could not select all filtered vendors.')
    } finally {
      setSelectingAll(false)
    }
  }

  const busy = selectingAll

  const emptyCopy = appliedSlash?.unmatched
    ? `No ${appliedSlash.unmatched.dimension.toLowerCase()} matches “${appliedSlash.unmatched.raw}”. Pick a suggestion from the search bar to correct that step.`
    : hasActiveCriteria
      ? 'No vendors match the current search and filters. Try clearing one of them.'
      : 'Add your first vendor to see it listed here.'

  return (
    <div className={`vendors-page ${selectedVendor ? 'has-selection' : ''}`}>
      <div className="vendors-main-content">
        <div className="page-header">
          <div>
            <span className="page-kicker">MASTER DATA</span>
            <h1>Vendors</h1>
            <p>{totalCount.toLocaleString()} {totalCount === 1 ? 'vendor' : 'vendors'} in view · 15 per page</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
            {showSharePopover && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 300,
                background: 'var(--surface)', border: '1px solid var(--line)',
                borderRadius: 10, padding: '14px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                minWidth: 320,
              }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Vendor Registration Link
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--muted)', marginBottom: 10, lineHeight: 1.5 }}>
                  Share this link with anyone — no login required. Submissions will appear as <strong>Inactive</strong> pending your review.
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    readOnly
                    value={`${window.location.origin}/vendor/register`}
                    style={{
                      flex: 1, fontSize: '0.82rem', padding: '7px 10px',
                      border: '1px solid var(--line)', borderRadius: 6,
                      background: 'var(--page)', color: 'var(--text)',
                      fontFamily: 'monospace', outline: 'none',
                    }}
                    onFocus={e => e.target.select()}
                  />
                  <button
                    className="primary-button"
                    style={{ padding: '7px 14px', fontSize: '0.82rem', flexShrink: 0 }}
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/vendor/register`)
                        .then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000) })
                    }}
                  >
                    {shareCopied ? <><Icon name="check" size={14} /> Copied!</> : 'Copy'}
                  </button>
                </div>
              </div>
            )}
            <button
              className="secondary-button"
              onClick={() => { setShowSharePopover(v => !v); setShareCopied(false) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
              </svg>
              Share
            </button>
            <button className="primary-button add-button" onClick={() => setShowForm(true)}>
              <Icon name="plus" size={18} /> Add vendor
            </button>
          </div>
        </div>

        {/* ── Search + actions ─────────────────────────────────────────── */}
        <div className="vendors-toolbar">
          <div className={`vendor-search ${slashActive ? 'is-chained' : ''}`} ref={searchShellRef}>
            <span className="vendor-search-icon"><Icon name="search" size={17} /></span>
            <input
              ref={searchInputRef}
              className="vendor-search-input"
              value={searchInput}
              onChange={(event) => { setSearchInput(event.target.value); setSuggestOpen(true) }}
              onFocus={() => setSuggestOpen(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder={`Search company, email, GSTIN or PAN — or type ${SLASH_PATH_HINT}`}
              aria-label="Search vendors"
              role="combobox"
              aria-expanded={showSuggestions}
              aria-controls="vendor-slash-suggestions"
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck="false"
            />
            {slashActive
              ? <span className="vendor-search-mode">Chained filter</span>
              : <kbd className="vendor-search-kbd" title="Press / to filter by state, country, media and sub media">/</kbd>}
            {searchInput && (
              <button type="button" className="search-clear" onClick={clearSearch} aria-label="Clear search">
                <Icon name="close" size={15} />
              </button>
            )}

            {showSuggestions && activeToken && (
              <div className="slash-suggestions" id="vendor-slash-suggestions" role="listbox" aria-label={`${activeToken.dimension} suggestions`}>
                <div className="slash-suggestions-head">
                  <span className="slash-suggestions-step">Step {liveSlash.activeIndex + 1} of {SLASH_CHAIN.length} · {activeToken.dimension}</span>
                  <span className="slash-suggestions-path">{SLASH_PATH_HINT}</span>
                </div>
                {suggestions.length === 0 ? (
                  <div className="search-select-empty">
                    {activeToken.options.length === 0
                      ? `No ${activeToken.dimension.toLowerCase()} values available yet`
                      : `No ${activeToken.dimension.toLowerCase()} matches “${activeToken.raw}”`}
                  </div>
                ) : suggestions.map((option, index) => (
                  <button
                    type="button"
                    key={`${activeToken.key}-${option.value}`}
                    role="option"
                    aria-selected={index === boundedSuggestIndex}
                    className={`slash-suggestion ${index === boundedSuggestIndex ? 'is-active' : ''}`}
                    onMouseEnter={() => setSuggestIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applySuggestion(option)}
                  >
                    <span className="slash-suggestion-label">{option.label}</span>
                    <span className="slash-suggestion-hint">↵</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="toolbar-actions">
            <button
              type="button"
              className={`filter-toggle ${filtersOpen ? 'is-open' : ''}`}
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              aria-controls="vendor-filter-grid"
            >
              <Icon name="filter" size={16} />
              Filters
              {activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
              <span className="filter-toggle-caret"><Icon name="chevronDown" size={15} /></span>
            </button>
          </div>
        </div>

        {/* ── Active criteria ──────────────────────────────────────────── */}
        {(slashActive || filterChips.length > 0) && (
          <div className="criteria-row">
            {slashActive && liveSlash.tokens.map((token, index) => (
              <button
                type="button"
                key={token.key}
                className={`criteria-chip is-slash is-${token.status}`}
                onClick={() => editSegment(index)}
                title={`Edit the ${token.dimension.toLowerCase()} step`}
              >
                <span className="criteria-chip-key">{token.dimension}</span>
                <span className="criteria-chip-value">{token.match?.label || token.raw || 'any'}</span>
              </button>
            ))}
            {filterChips.map((chip) => (
              <span className="criteria-chip" key={chip.field}>
                <span className="criteria-chip-key">{chip.label}</span>
                <span className="criteria-chip-value">{chip.value}</span>
                <button type="button" className="criteria-chip-remove" onClick={() => setFilter(chip.field, '')} aria-label={`Remove ${chip.label} filter`}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
            {hasActiveCriteria && (
              <button type="button" className="criteria-reset" onClick={clearAllCriteria}>Reset all</button>
            )}
          </div>
        )}

        {/* ── Filters ──────────────────────────────────────────────────── */}
        {filtersOpen && (
          <section className="filter-panel" id="vendor-filter-grid">
            {slashActive && (
              <p className="filter-panel-note">
                State, country, media and sub media are coming from the <code>/</code> search. Clear it to set them here.
              </p>
            )}
            <div className="filter-grid">
              <SearchableSelect
                label="Media"
                value={filters.media_id}
                onChange={(value) => setFilter('media_id', value)}
                options={mediaFilterOptions}
                placeholder="All media"
                searchPlaceholder="Search media..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="Sub Media"
                value={filters.sub_media_id}
                onChange={(value) => setFilter('sub_media_id', value)}
                options={subMediaFilterOptions}
                placeholder="All sub media"
                searchPlaceholder="Search sub media..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="Country"
                value={filters.country}
                onChange={(value) => setFilter('country', value)}
                options={countryFilterOptions}
                placeholder="All countries"
                searchPlaceholder="Search countries..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="State"
                value={filters.state}
                onChange={(value) => setFilter('state', value)}
                options={stateFilterOptions}
                placeholder="All states"
                searchPlaceholder="Search states..."
                disabled={slashActive}
              />
              <SearchableSelect
                label="City"
                value={filters.city}
                onChange={(value) => setFilter('city', value)}
                options={cityFilterOptions}
                placeholder="All cities"
                searchPlaceholder="Search cities..."
                disabled={slashActive}
              />
              <div className="field">
                <label htmlFor="vendor-status-filter">Vendor Status</label>
                <select id="vendor-status-filter" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}>
                  <option value="">All statuses</option>
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="page-error" role="alert">
            <span className="page-error-icon"><Icon name="alert" size={18} /></span>
            <div><strong>Could not load vendors</strong><p>{error}</p></div>
          </div>
        )}

        {actionError && (
          <div className="page-error" role="alert">
            <span className="page-error-icon"><Icon name="alert" size={18} /></span>
            <div><strong>Action failed</strong><p>{actionError}</p></div>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────────────────── */}
        <section className="table-card">
          <div className="table-topline">
            <div>
              <strong>All Vendors</strong>
              <span className="result-count">{totalCount.toLocaleString()} records</span>
              {refreshing && <span className="result-count">Updating…</span>}
              {textQuery && <span className="search-state">Filtered by “{textQuery}”</span>}
            </div>
            <div className="topline-right">
              <span className="selection-count"><strong>{selectedIds.length.toLocaleString()}</strong> selected</span>
              <button type="button" className="selection-link" onClick={selectAllFiltered} disabled={busy || loading || totalCount === 0}>
                {selectingAll ? 'Selecting…' : 'Select all filtered'}
              </button>
              <button type="button" className="selection-link" onClick={() => setSelectedIds([])} disabled={selectedIds.length === 0}>
                Clear selection
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th className="check-column"><button type="button" className={`checkbox-button ${allCurrentSelected ? 'checked' : ''}`} onClick={toggleSelectPage} aria-label="Select all vendors on this page">{allCurrentSelected ? <Icon name="check" size={14} /> : null}</button></th>
                  <th>ID</th>
                  <th>Vendor</th>
                  <th>Media</th>
                  <th>Location</th>
                  <th>Contact</th>
                  <th>GSTIN</th>
                  <th>Status</th>
                  <th className="actions-column">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: VENDORS_PAGE_SIZE }).map((_, index) => (
                    <tr key={`vendor-skeleton-${index}`}>
                      {Array.from({ length: VENDOR_COLUMN_COUNT }).map((__, cell) => <td key={cell}><span className="skeleton skeleton-company" /></td>)}
                    </tr>
                  ))
                ) : vendors.length === 0 ? (
                  <tr>
                    <td colSpan={VENDOR_COLUMN_COUNT} className="empty-state">
                      <div className="empty-title">No vendors found</div>
                      <div className="empty-copy">{emptyCopy}</div>
                    </td>
                  </tr>
                ) : (
                  vendors.map((vendor) => {
                    const isActive = isActiveStatus(getValue(vendor, ['status']))
                    const address = primaryAddress(vendor)
                    const subtitle = getValue(vendor, ['alias', 'contact_person', 'vendor_type'])
                    const region = [address?.state, address?.country].filter(Boolean).join(' · ')
                    const phone = vendor.contact == null ? null : `${vendor.country_dialcode || ''} ${vendor.contact}`.trim()
                    return (
                      <tr
                        key={vendor.id}
                        className={selectedVendor?.id === vendor.id ? 'is-open' : ''}
                        onDoubleClick={() => setSelectedVendor(vendor)}
                      >
                        <td className="check-column"><button type="button" className={`checkbox-button ${selectedSet.has(vendor.id) ? 'checked' : ''}`} onClick={(event) => { event.stopPropagation(); toggleSelect(vendor.id) }} aria-label={`Select ${vendor.company_name}`}>{selectedSet.has(vendor.id) ? <Icon name="check" size={14} /> : null}</button></td>
                        <td className="id-cell">{formatValue(vendor.id)}</td>
                        <td>
                          <span className="cell-primary company-cell" title={vendor.company_name || ''}>{formatValue(vendor.company_name)}</span>
                          <span className="cell-secondary" title={subtitle || ''}>{formatValue(subtitle)}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(mediaMap[vendor.media_id])}</span>
                          <span className="cell-secondary">{formatValue(subMediaMap[vendor.sub_media_id])}</span>
                        </td>
                        <td>
                          <span className="cell-primary">{formatValue(address?.city)}</span>
                          <span className="cell-secondary" title={region}>{formatValue(region)}</span>
                        </td>
                        <td>
                          {phone ? <ContactHoverAction type="phone" value={phone} /> : <span className="cell-primary">-</span>}
                          {vendor.email ? <ContactHoverAction type="email" value={vendor.email} /> : <span className="cell-secondary">-</span>}
                        </td>
                        <td className="mono-cell">{formatValue(vendor.gstin)}</td>
                        <td>
                          <span className={`status-pill ${isActive ? 'active' : 'inactive'}`}>
                            <span className="status-dot" />
                            {isActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="actions-column"><button className="row-action" onClick={() => setSelectedVendor(vendor)} aria-label={`Open vendor ${vendor.company_name}`}><Icon name="chevron" size={17} /></button></td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="pagination-bar">
            <span className="pagination-summary">
              {totalCount === 0 ? 'No records' : <>Showing <strong>{pageStart}–{pageEnd}</strong> of {totalCount.toLocaleString()}</>}
            </span>
            <div className="pagination-meta">
              <span className="pagination-page-label">Page {Math.min(page, totalPages)} of {totalPages.toLocaleString()}</span>
              <div className="pagination-buttons">
                <button onClick={() => changePage(1)} disabled={page <= 1} aria-label="First page"><Icon name="first" size={16} /></button>
                <button onClick={() => changePage(page - 1)} disabled={page <= 1} aria-label="Previous page"><Icon name="chevron" size={16} /></button>
                {pageNumbers.map((number) => <button key={number} className={number === page ? 'current' : ''} onClick={() => changePage(number)} aria-current={number === page ? 'page' : undefined}>{number}</button>)}
                <button onClick={() => changePage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><Icon name="chevron" size={16} /></button>
                <button onClick={() => changePage(totalPages)} disabled={page >= totalPages} aria-label="Last page"><Icon name="last" size={16} /></button>
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedVendor && <aside className="vendors-side-panel"><VendorDetails vendor={selectedVendor} address={selectedVendorAddress} onClose={() => setSelectedVendor(null)} mediaMap={mediaMap} subMediaMap={subMediaMap} /></aside>}
      {showForm && <AddVendorModal onClose={() => setShowForm(false)} onSaved={afterSaved} />}
    </div>
  )
}
