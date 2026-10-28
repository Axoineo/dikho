import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatPhone } from '../../lib/format'
import { isActiveStatus } from '../../lib/status'
import { Icon } from '../../components/Icon'
import { SearchableSelect } from '../../components/SearchableSelect'
import {
  PageHeader, ResultCount, Pagination, StatusPill, Cell, RowTitle, RowChevron, ContactCell,
  SkeletonRows, EmptyState, ShareLink, Toast,
} from '../../components/crm/CrmUi'
import VendorDetails from './VendorDetails'
import VendorForm from './VendorForm'
import { useAccess } from '../../lib/access'
import { preferredPageSize } from '../../lib/settings'
import {
  EMPTY_VENDOR_FILTERS, VENDOR_COLUMN_COUNT, VENDOR_PAGE_SIZES,
  vendorSelect, applyVendorFilters, primaryAddress,
  isSlashSearch, resolveSlashSearch, buildSlashInput,
  uniqueOptions, fetchAllPaged, SLASH_PATH_HINT,
  SLASH_CHAIN, normalizeToken
} from './vendorFilters'

const STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: '1', label: 'Active' },
  { value: '0', label: 'Inactive' },
]

export default function VendorsPage() {
  const { can } = useAccess()
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
  const [pageSize, setPageSize] = useState(() => preferredPageSize(VENDOR_PAGE_SIZES))
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

  // `editing` is null when the form is closed, {} for a new vendor, or the
  // vendor being edited.
  const [editing, setEditing] = useState(null)
  const showForm = Boolean(editing)
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [selectedVendorAddress, setSelectedVendorAddress] = useState(null)
  const [notice, setNotice] = useState('')

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

      const from = (page - 1) * pageSize
      let request = supabase
        .from('vendors')
        .select(vendorSelect('*', effectiveFilters), { count: 'exact' })
        .order('id', { ascending: false })
        .range(from, from + pageSize - 1)

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
  }, [page, pageSize, textQuery, effectiveFilters, appliedSlash, catalogReady, refresh])

  const mediaMap = useMemo(() => Object.fromEntries(mediaOptions.map((item) => [item.id, item.name])), [mediaOptions])
  const subMediaMap = useMemo(() => Object.fromEntries(subMediaOptions.map((item) => [item.id, item.name])), [subMediaOptions])

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize))
  const pageStart = totalCount === 0 ? 0 : (page - 1) * pageSize + 1
  const pageEnd = Math.min(page * pageSize, totalCount)
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

  function afterSaved(saved, savedAddress) {
    const wasEdit = Boolean(editing?.id)
    setEditing(null)
    setError('')
    setActionError('')

    if (wasEdit) {
      // The edited row keeps its place; the panel shows what was saved.
      setVendors((current) => current.map((vendor) => (vendor.id === saved.id ? { ...vendor, ...saved } : vendor)))
      setSelectedVendor((current) => (current?.id === saved.id ? { ...current, ...saved } : current))
      if (savedAddress) setSelectedVendorAddress(savedAddress)
      setNotice('Vendor saved')
      // A changed city or media can add a new option to the filters.
      setRefresh((current) => ({ key: current.key + 1, silent: true }))
      return
    }

    // The new vendor need not match whatever is currently filtered, so return
    // the view to the top of the unfiltered list where it is guaranteed to be.
    setSearchInput('')
    setAppliedSearch('')
    setSuggestOpen(false)
    setFilters(EMPTY_VENDOR_FILTERS)
    setPage(1)

    // Optimistic: the row is on screen before the reload lands. Rows are
    // ordered by descending id, so a new vendor belongs at the top of page 1.
    if (saved?.id) {
      setVendors((current) => [saved, ...current.filter((vendor) => vendor.id !== saved.id)].slice(0, pageSize))
      setTotalCount((current) => current + 1)
      setSelectedVendor(saved)
    }
    setNotice('Vendor added')

    // …then reconcile against the server. `silent` keeps the optimistic row
    // visible instead of replacing it with loading skeletons.
    setRefresh((current) => ({ key: current.key + 1, silent: Boolean(saved?.id) }))
  }

  const emptyCopy = appliedSlash?.unmatched
    ? `No ${appliedSlash.unmatched.dimension.toLowerCase()} matches “${appliedSlash.unmatched.raw}”. Pick a suggestion from the search bar to correct that step.`
    : hasActiveCriteria
      ? 'No vendors match the current search and filters. Try clearing one of them.'
      : 'Add your first vendor to see it listed here.'

  const canCreate = can('vendors.create')
  const canEdit = can('vendors.edit')
  const searching = Boolean(textQuery) || activeFilterCount > 0 || slashActive

  return (
    <div className="crm-page">
      <PageHeader title="Vendors" subtitle="Media owners and suppliers you buy from.">
        <ShareLink
          title="Vendor registration link"
          description="Anyone with this link can register as a vendor without signing in. New registrations arrive as Inactive for your review."
          path="/vendor/register"
        />
        {canCreate && (
          <button type="button" className="crm-btn crm-btn--primary" onClick={() => setEditing({})}>
            <Icon name="plus" size={17} /> New vendor
          </button>
        )}
      </PageHeader>

      {/* ── Search + filters ─────────────────────────────────────────── */}
      <div className="crm-toolbar">
        <div className="crm-search" ref={searchShellRef}>
          <Icon name="search" size={17} />
          <input
            ref={searchInputRef}
            value={searchInput}
            onChange={(event) => { setSearchInput(event.target.value); setSuggestOpen(true) }}
            onFocus={() => setSuggestOpen(true)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search vendors, or type / to filter by place and media"
            aria-label="Search vendors"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="vendor-slash-suggestions"
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck="false"
          />
          {slashActive
            ? <span className="crm-search-mode">Filtering</span>
            : !searchInput && <kbd className="crm-kbd" title={`Type / to filter by ${SLASH_PATH_HINT}`}>/</kbd>}
          {searchInput && (
            <button type="button" className="crm-icon-btn" onClick={clearSearch} aria-label="Clear search">
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
                    ? `No ${activeToken.dimension.toLowerCase()} values yet`
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

        <button
          type="button"
          className={`crm-btn crm-btn--secondary${filtersOpen ? ' is-open' : ''}`}
          onClick={() => setFiltersOpen((value) => !value)}
          aria-expanded={filtersOpen}
          aria-controls="vendor-filter-grid"
        >
          <Icon name="filter" size={16} /> Filters
          {activeFilterCount > 0 && <span className="crm-badge">{activeFilterCount}</span>}
        </button>

        {!loading && <ResultCount shown={totalCount} total={totalCount} noun="vendor" filtered={searching} />}
        {refreshing && <span className="crm-count" style={{ marginLeft: 0 }}>Updating…</span>}
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
            <button type="button" className="criteria-reset" onClick={clearAllCriteria}>Clear all</button>
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
            <SearchableSelect label="Media" value={filters.media_id} onChange={(value) => setFilter('media_id', value)} options={mediaFilterOptions} placeholder="All media" searchPlaceholder="Search media…" disabled={slashActive} />
            <SearchableSelect label="Sub media" value={filters.sub_media_id} onChange={(value) => setFilter('sub_media_id', value)} options={subMediaFilterOptions} placeholder="All sub media" searchPlaceholder="Search sub media…" disabled={slashActive} />
            <SearchableSelect label="Country" value={filters.country} onChange={(value) => setFilter('country', value)} options={countryFilterOptions} placeholder="All countries" searchPlaceholder="Search countries…" disabled={slashActive} />
            <SearchableSelect label="State" value={filters.state} onChange={(value) => setFilter('state', value)} options={stateFilterOptions} placeholder="All states" searchPlaceholder="Search states…" disabled={slashActive} />
            <SearchableSelect label="City" value={filters.city} onChange={(value) => setFilter('city', value)} options={cityFilterOptions} placeholder="All cities" searchPlaceholder="Search cities…" disabled={slashActive} />
            <SearchableSelect label="Status" value={filters.status} onChange={(value) => setFilter('status', value)} options={STATUS_FILTER_OPTIONS} placeholder="Any status" searchPlaceholder="Search…" />
          </div>
        </section>
      )}

      {(error || actionError) && (
        <div className="crm-note crm-note--danger" role="alert">
          <Icon name="alert" size={17} />
          <div><strong>{error ? 'Could not load vendors.' : 'That did not work.'}</strong> {error || actionError}</div>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────── */}
      <section className="crm-card">
        <div className="crm-table-scroll">
          <table className="crm-table">
            <thead>
              <tr>
                <th style={{ width: '26%' }}>Vendor</th>
                <th className="crm-hide-sm" style={{ width: '12%' }}>Media</th>
                <th className="crm-hide-sm" style={{ width: '15%' }}>Location</th>
                <th className="crm-hide-sm" style={{ width: '20%' }}>Contact</th>
                <th className="crm-hide-sm crm-hide-lg" style={{ width: '14%' }}>GSTIN</th>
                <th style={{ width: '110px' }}>Status</th>
                <th className="crm-col-tight" style={{ width: '36px' }} aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows rows={8} columns={VENDOR_COLUMN_COUNT} />
              ) : vendors.length === 0 ? (
                <tr>
                  <td colSpan={VENDOR_COLUMN_COUNT} className="crm-empty-cell">
                    <EmptyState
                      icon={hasActiveCriteria ? 'search' : 'vendors'}
                      title={hasActiveCriteria ? 'No vendors match' : 'No vendors yet'}
                      action={!hasActiveCriteria && canCreate && <button type="button" className="crm-btn crm-btn--primary" onClick={() => setEditing({})}><Icon name="plus" size={16} /> New vendor</button>}
                    >
                      {emptyCopy}
                    </EmptyState>
                  </td>
                </tr>
              ) : (
                vendors.map((vendor) => {
                  const active = isActiveStatus(vendor.status)
                  const address = primaryAddress(vendor)
                  const region = [address?.state, address?.country].filter(Boolean).join(', ')
                  return (
                    <tr
                      key={vendor.id}
                      className={`crm-row${selectedVendor?.id === vendor.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedVendor(vendor)}
                    >
                      <td>
                        <RowTitle name={vendor.company_name} sub={vendor.alias || vendor.contact_person} onOpen={() => setSelectedVendor(vendor)} />
                      </td>
                      <td className="crm-hide-sm"><Cell main={mediaMap[vendor.media_id]} sub={subMediaMap[vendor.sub_media_id]} /></td>
                      <td className="crm-hide-sm"><Cell main={address?.city} sub={region} title={region} /></td>
                      <td className="crm-hide-sm"><ContactCell phone={formatPhone(vendor.country_dialcode, vendor.contact)} email={vendor.email} /></td>
                      <td className="crm-hide-sm crm-hide-lg"><Cell main={vendor.gstin} sub={vendor.pan_number} mono /></td>
                      <td><StatusPill tone={active ? 'active' : 'inactive'}>{active ? 'Active' : 'Inactive'}</StatusPill></td>
                      <td className="crm-col-tight"><RowChevron /></td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          start={pageStart}
          end={pageEnd}
          total={totalCount}
          pageSize={pageSize}
          pageSizes={VENDOR_PAGE_SIZES}
          onPage={changePage}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
        />
      </section>

      {selectedVendor && (
        <VendorDetails
          vendor={selectedVendor}
          address={selectedVendorAddress}
          onClose={() => setSelectedVendor(null)}
          onEdit={canEdit ? () => setEditing(selectedVendor) : null}
          mediaMap={mediaMap}
          subMediaMap={subMediaMap}
        />
      )}
      {editing && (
        <VendorForm
          vendor={editing.id ? editing : null}
          address={editing.id ? selectedVendorAddress : null}
          onClose={() => setEditing(null)}
          onSaved={afterSaved}
        />
      )}
      <Toast message={notice} onDone={() => setNotice('')} />
    </div>
  )
}
