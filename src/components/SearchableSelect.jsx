import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export function SearchableSelect({ label, value, onChange, options, placeholder, disabled = false, required = false, searchPlaceholder = 'Search...', hasError = false, error = false }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef(null)

  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selected = options.find((item) => item.value === value)
  const filtered = options
    .filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 150)

  return (
    <div ref={containerRef} className={`search-select-wrap ${open ? 'is-open' : ''} ${hasError ? 'has-error' : ''}`}>
      <label>
        {label}
        {required && <span style={{ color: '#e53e3e' }}> *</span>}
      </label>
      <button
        type="button"
        name={label.toLowerCase().includes('state') ? 'state' : label.toLowerCase().includes('city') ? 'city' : label.toLowerCase().includes('country') ? 'country_code' : ''}
        className={`search-select-trigger ${open ? 'open' : ''}`}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
      >
        <span className={selected || value ? '' : 'search-select-placeholder'}>{selected ? selected.label : (value || placeholder)}</span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div className="search-select-menu">
          <div className="search-select-search">
            <Icon name="search" size={15} />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={searchPlaceholder} name="search-dropdown" autoComplete="new-password" />
          </div>
          <div className="search-select-options">
            {filtered.length === 0 ? (
              <div className="search-select-empty">No matches found</div>
            ) : (
              filtered.map((item) => (
                <div key={item.value} className={`search-select-option ${item.value === value ? 'selected' : ''}`} onClick={() => { onChange(item.value); setOpen(false); setQuery('') }}>
                  {item.label}
                  {item.value === value && <Icon name="check" size={14} className="check-icon" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
      {error && <div className="pvf-field-error">Please complete this required field.</div>}
    </div>
  )
}
