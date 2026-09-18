import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import './CorporateGiftingCatalogue.css'

export default function CorporateGiftingCatalogue() {
  const [hasAccess, setHasAccess] = useState(false)
  const [files, setFiles] = useState([])
  const [catalogueId, setCatalogueId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [formLoading, setFormLoading] = useState(false)
  const [error, setError] = useState(null)

  const [form, setForm] = useState({
    name: '',
    company_name: '',
    email: '',
    mobile: '',
    city: ''
  })

  const [expandedNodes, setExpandedNodes] = useState({ 
    '1.Premium Executive & Welcome Kits': true, // Expand first one by default 
  })

  const toggleNode = (node) => {
    setExpandedNodes(prev => ({ ...prev, [node]: !prev[node] }))
  }

  useEffect(() => {
    if (localStorage.getItem('dikho_cg_access')) {
      setHasAccess(true)
    }
    fetchCatalogue()
  }, [])

  async function fetchCatalogue() {
    setLoading(true)
    const { data: catData, error: catError } = await supabase
      .from('catalogues')
      .select('id')
      .eq('slug', 'corporategifting')
      .eq('active', true)
      .single()
      
    if (catError || !catData) {
      console.error(catError)
      setError('Catalogue not found or currently inactive.')
      setLoading(false)
      return
    }
    
    setCatalogueId(catData.id)

    const { data: fileData, error: fileError } = await supabase
      .from('catalogue_files')
      .select('*')
      .eq('catalogue_id', catData.id)
      .eq('active', true)
      .order('sort_order', { ascending: true })
      
    if (!fileError && fileData) {
      setFiles(fileData)
    }
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.email || !form.mobile) return
    setFormLoading(true)
    
    try {
      const res = await fetch('/api/catalogue/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, catalogue_id: catalogueId })
      })
      
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to submit lead')
      
      localStorage.setItem('dikho_cg_access', 'true')
      setHasAccess(true)
    } catch (err) {
      alert(err.message)
    } finally {
      setFormLoading(false)
    }
  }

  const [selectedPdfUrl, setSelectedPdfUrl] = useState(null)
  const [selectedFileId, setSelectedFileId] = useState(null)
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768)

  const handleSelectFile = async (file) => {
    setSelectedFileId(file.id)
    setLoadingPdf(true)
    try {
      const res = await fetch(`/api/catalogue/files/${file.id}/view?t=${Date.now()}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load PDF URL')
      setSelectedPdfUrl(data.url)
    } catch (err) {
      alert(err.message)
    } finally {
      setLoadingPdf(false)
    }
  }

  if (loading) return <div className="cgc-loading">Loading catalogue...</div>
  if (error) return <div className="cgc-error">{error}</div>

  if (!hasAccess) {
    return (
      <div className="cgc-container">
        <div className="cgc-hero">
          <h1>Dikho Corporate Gifting</h1>
          <p>Discover our premium selection of corporate gifts. Fill the form below to access the complete catalogue.</p>
        </div>
        <div className="cgc-form-wrapper">
          <form onSubmit={handleSubmit} className="cgc-form">
            <h2>Access Catalogue</h2>
            <div className="cgc-form-group">
              <label>Full Name *</label>
              <input type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="cgc-form-group">
              <label>Company Name</label>
              <input type="text" value={form.company_name} onChange={e => setForm({ ...form, company_name: e.target.value })} />
            </div>
            <div className="cgc-form-group">
              <label>Email *</label>
              <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="cgc-form-group">
              <label>Mobile Number *</label>
              <input type="tel" pattern="[0-9]{10}" placeholder="10 digit number" required value={form.mobile} onChange={e => setForm({ ...form, mobile: e.target.value })} />
            </div>
            <div className="cgc-form-group">
              <label>City</label>
              <input type="text" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
            </div>
            <button type="submit" disabled={formLoading} className="cgc-submit-btn">
              {formLoading ? 'Submitting...' : 'View Catalogue'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Hardcode all expected categories so even empty ones show up
  const allCategories = [
    '1.Premium Executive & Welcome Kits',
    '2. Apparel & Lifestyle Wearables',
    '3. Luggage, Bags & Travel Accessories',
    '4. Tech Gadgets, Audio & Smart Electronics',
    '5. Gourmet Food, Sweets & Festive Hampers',
    '6. Home, Kitchen, Drinkware & Lifestyle',
    '7. Rewards, Recognition & Trophies',
    '8. Premium Brand Catalogs'
  ];

  const categories = {}
  allCategories.forEach(cat => categories[cat] = [])
  
  files.forEach(f => {
    if (f.type === 'complete') return
    if (categories[f.category]) {
      categories[f.category].push(f)
    } else if (f.category) {
      categories[f.category] = [f]
    }
  })


  const isMobile = window.innerWidth <= 768
  const collapsed = !sidebarOpen

  return (
    <div className={`app-shell${collapsed ? ' sidebar-is-collapsed' : ''}`}>
      {!collapsed && isMobile && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <aside className={`sidebar${collapsed ? ' sidebar-is-collapsed' : ''}`} aria-label="Main navigation">
        <div className="sidebar-logo-area">
          <div className="sidebar-logo-full">
            <img src="/dikho-logo.png" alt="Dikho" className="sidebar-logo-img" style={{ height: '32px' }} />
          </div>
        </div>

        <nav className="sidebar-nav" style={{ padding: '20px 12px', overflowY: 'auto' }}>
          <div style={{ padding: '0 8px 20px 8px', fontWeight: '700', color: '#101828', fontSize: '16px', letterSpacing: '-0.3px' }}>
            Dikho - CG
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.keys(categories).map(cat => {
              const isExpanded = expandedNodes[cat];
              const empty = categories[cat].length === 0;
              
              return (
                <div key={cat} className="tree-category">
                  {/* Folder Header */}
                  <div 
                    onClick={() => toggleNode(cat)}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      padding: '10px 8px', 
                      cursor: empty ? 'default' : 'pointer',
                      borderRadius: '8px',
                      color: isExpanded ? '#101828' : '#475467',
                      background: isExpanded && !empty ? 'rgba(24, 84, 148, 0.03)' : 'transparent',
                      transition: 'all 0.2s ease',
                    }}
                    onMouseEnter={e => !empty && (e.currentTarget.style.background = 'rgba(24, 84, 148, 0.06)')}
                    onMouseLeave={e => !empty && (e.currentTarget.style.background = isExpanded ? 'rgba(24, 84, 148, 0.03)' : 'transparent')}
                  >
                    {/* Expand/Collapse Arrow Container (Keeps alignment even if empty) */}
                    <div style={{ width: '20px', display: 'flex', justifyContent: 'center', marginRight: '6px', flexShrink: 0 }}>
                      {!empty && (
                        <svg 
                          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" 
                          style={{ 
                            transform: isExpanded ? 'rotate(90deg)' : 'none', 
                            transition: 'transform 0.2s',
                            color: '#98A2B3'
                          }}
                        >
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      )}
                    </div>
                    
                    {/* Folder Icon */}
                    <svg width="18" height="18" viewBox="0 0 24 24" fill={isExpanded && !empty ? "rgba(24, 84, 148, 0.15)" : "none"} stroke={isExpanded && !empty ? "#185494" : "#667085"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '10px', flexShrink: 0, transition: 'all 0.2s' }}>
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    
                    {/* Folder Name */}
                    <span style={{ fontSize: '13.5px', fontWeight: isExpanded && !empty ? '600' : '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', letterSpacing: '-0.1px' }}>
                      {cat.replace(/^[0-9]\.\s*/, '')}
                    </span>
                  </div>

                  {/* Folder Contents */}
                  {isExpanded && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', paddingLeft: '34px', marginTop: '4px', marginBottom: '8px' }}>
                      {empty ? (
                        <div style={{ padding: '6px 8px', fontSize: '12.5px', color: '#98a2b3', fontStyle: 'italic' }}>
                          No files yet.
                        </div>
                      ) : (
                        categories[cat].map(file => {
                          const isActive = selectedFileId === file.id;
                          return (
                            <button 
                              key={file.id} 
                              onClick={() => handleSelectFile(file)}
                              style={{ 
                                minHeight: '36px', 
                                padding: '0 10px', 
                                border: 'none', 
                                background: isActive ? '#E6F0F9' : 'transparent', 
                                width: '100%', 
                                textAlign: 'left', 
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                transition: 'background 0.15s'
                              }}
                              onMouseEnter={e => !isActive && (e.currentTarget.style.background = '#F2F4F7')}
                              onMouseLeave={e => !isActive && (e.currentTarget.style.background = 'transparent')}
                              title={file.name}
                            >
                              {/* PDF Icon */}
                              <div style={{ width: '16px', display: 'flex', justifyContent: 'center', marginRight: '8px', flexShrink: 0 }}>
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={isActive ? "#185494" : "#98A2B3"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                  <polyline points="14 2 14 8 20 8"></polyline>
                                  <line x1="16" y1="13" x2="8" y2="13"></line>
                                  <line x1="16" y1="17" x2="8" y2="17"></line>
                                  <polyline points="10 9 9 9 8 9"></polyline>
                                </svg>
                              </div>
                              
                              {/* File Name */}
                              <span style={{ fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: isActive ? '#185494' : '#475467', fontWeight: isActive ? '600' : '500' }}>
                                {file.name}
                              </span>
                            </button>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-header">
          {isMobile && (
            <button className="header-menu" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle sidebar" style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
          )}
          <div style={{ marginLeft: isMobile ? 16 : 0, fontWeight: 600, color: '#101828', fontSize: '16px' }}>
            Catalogue Viewer
          </div>
          <div style={{ flex: 1 }} />
        </header>

        <div className="workspace" style={{ padding: 0, display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', background: '#f5f7f9', borderRadius: '16px', margin: '16px 16px 16px 0', border: '1px solid rgba(24,84,148,0.1)' }}>
          {loadingPdf ? (
            <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', color: '#666' }}>
              Loading PDF securely...
            </div>
          ) : selectedPdfUrl ? (
            <iframe 
              src={`${selectedPdfUrl}#view=FitH`} 
              style={{ width: '100%', height: '100%', border: 'none' }} 
              title="PDF Viewer"
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', color: '#889' }}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 16, opacity: 0.5 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
              <p>Select a PDF from the sidebar folder tree to view it here.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
