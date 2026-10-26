import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import StatusBadge from '../components/StatusBadge'
import ThemeToggle from '../components/ThemeToggle'
import { SCHEMES, MY_APPLICATIONS } from '../data/dashboardData'
import {
  makePeraSigner,
  optInToApp,
  registerStudent,
  getStudentState,
  isOptedIn,
  APP_ID,
} from '../lib/scholarship-contract'
import { loadAddress } from '../lib/perawallet'

const TABS = [
  { id:'overview',     icon:'📊', label:'My Overview' },
  { id:'browse',       icon:'🔍', label:'Browse Schemes' },
  { id:'applications', icon:'📝', label:'My Applications' },
  { id:'onchain',      icon:'⛓️', label:'On-Chain Status' },
  { id:'verify',       icon:'🤖', label:'AI Verify Me' },
]

const TIMELINE = [
  { icon:'✅', title:'Application Submitted', desc:'AICTE Pragati Scholarship — APP-2026-000478', time:'Feb 03, 2026', state:'done' },
  { icon:'✅', title:'AI Verification Passed', desc:'Score: 88/100 — Identity, documents, income all cleared', time:'Feb 03, 2026', state:'done' },
  { icon:'✅', title:'Gov Officer Approved', desc:'Approved by Sr. Officer Rajiv Sharma (OFF-001)', time:'Feb 06, 2026', state:'done' },
  { icon:'✅', title:'Token Minted On-Chain', desc:'Asset ID 78812341 · Block 31198432 · Algorand TestNet', time:'Feb 08, 2026', state:'done' },
  { icon:'⏳', title:'Token Distributed to Wallet', desc:'Awaiting final distribution batch — BATCH-2026-0021', time:'Pending', state:'pending' },
]

const AI_STEPS = [
  { icon:'📤', label:'Document Upload', desc:'Upload Aadhaar, Marksheet, Income Certificate, Bank Statement' },
  { icon:'🔍', label:'OCR Extraction', desc:'AI extracts and parses all text from uploaded documents' },
  { icon:'🪪', label:'Identity Cross-Reference', desc:'Aadhaar data cross-referenced with UIDAI database' },
  { icon:'🖼️', label:'Forgery Detection', desc:'ML model scans for pixel manipulation, metadata anomalies' },
  { icon:'📋', label:'Duplicate Check', desc:'Vector DB search for duplicate identities across all applications' },
  { icon:'💰', label:'Income Validation', desc:'Stated income verified against PAN/ITR records' },
  { icon:'⛓️', label:'On-Chain Anchoring', desc:'Verification hash anchored immutably to blockchain' },
]

function TrustGauge({ score = 87 }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d')
    c.width = 200; c.height = 120
    const cx=100, cy=108, r=80
    ctx.clearRect(0,0,200,120)
    ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,2*Math.PI); ctx.strokeStyle='rgba(255,255,255,.06)'; ctx.lineWidth=12; ctx.stroke()
    const end = Math.PI + (score/100)*Math.PI
    const g = ctx.createLinearGradient(0,0,200,0)
    g.addColorStop(0,'#EF4444'); g.addColorStop(.5,'#FBBF24'); g.addColorStop(1,'#818CF8')
    ctx.beginPath(); ctx.arc(cx,cy,r,Math.PI,end); ctx.strokeStyle=g; ctx.lineWidth=12; ctx.lineCap='round'; ctx.stroke()
  }, [score])
  return (
    <div className="trust-gauge">
      <div className="gauge-wrap">
        <canvas ref={canvasRef} style={{ display:'block' }} />
        <div className="gauge-val" style={{ bottom:'8px' }}>{score}<span>/100</span></div>
      </div>
    </div>
  )
}

export default function UserDashboard() {
  const [tab, setTab] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 1024)
  const [browseFilter, setBrowseFilter] = useState('')
  const [browseCategory, setBrowseCategory] = useState('All Categories')
  const [applyModal, setApplyModal] = useState(null)
  const [verifyRunning, setVerifyRunning] = useState(false)
  const [verifyStep, setVerifyStep] = useState(-1)
  const [verifyDone, setVerifyDone] = useState(false)
  const [myApps, setMyApps] = useState(MY_APPLICATIONS)
  const [toast, setToast] = useState(null)
  const [appDetail, setAppDetail] = useState(null)

  // Upload states for verify
  const [verifyUploads, setVerifyUploads] = useState({
    aadhaar: false, marksheet: false, income: false, bank: false
  })

  // Apply form state
  const [applyForm, setApplyForm] = useState({
    name: '', studentId: '', institution: '', income: ''
  })

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Contract state ──────────────────────────────────────
  const [chainStatus,   setChainStatus]   = useState(null)
  const [chainOptedIn,  setChainOptedIn]  = useState(false)
  const [chainLoading,  setChainLoading]  = useState(false)
  const [chainError,    setChainError]    = useState(null)
  const [chainTx,       setChainTx]       = useState(null)
  const [chainAction,   setChainAction]   = useState(null)

  const refreshChainStatus = useCallback(async (addr) => {
    setChainLoading(true)
    setChainError(null)
    try {
      const opted = await isOptedIn(addr)
      setChainOptedIn(opted)
      if (opted) {
        const s = await getStudentState(addr)
        setChainStatus(s)
      } else {
        setChainStatus(null)
      }
    } catch (e) {
      setChainError(e.message ?? 'Failed to load on-chain status')
    } finally {
      setChainLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'onchain') {
      const addr = loadAddress()
      if (addr) refreshChainStatus(addr)
      else setChainError('Connect your wallet (◎ Wallet) first.')
    }
  }, [tab, refreshChainStatus])

  const runChainAction = async (label, fn) => {
    const addr = loadAddress()
    if (!addr) { setChainError('Connect your wallet (◎ Wallet) first.'); return }
    setChainAction(label)
    setChainError(null)
    setChainTx(null)
    try {
      const signer = makePeraSigner(addr)
      const { txID } = await fn(addr, signer)
      setChainTx(txID)
      await refreshChainStatus(addr)
    } catch (e) {
      setChainError(
        e?.message?.includes('rejected') ? 'Transaction rejected in Pera Wallet.'
        : e?.message?.includes('Already opted in') ? 'Already opted in to this app.'
        : (e?.message ?? 'Transaction failed')
      )
    } finally {
      setChainAction(null)
    }
  }
  const navigate = useNavigate()

  // ── Session: read logged-in citizen ───────────────────────────────
  const citizen = (() => { try { return JSON.parse(sessionStorage.getItem('citizen_user') || 'null') } catch { return null } })()
  useEffect(() => { if (!citizen) navigate('/') }, [])
  const citizenName  = citizen?.name  || 'Citizen'
  const citizenEmp   = citizen?.employment || ''
  const citizenPhone = citizen?.phone || ''
  const aadhaarLinked = !!citizen?.aadhaarLast4

  const handleLogout = () => { sessionStorage.removeItem('citizen_user'); navigate('/') }

  const filteredSchemes = SCHEMES.filter(s =>
    s.status === 'active' &&
    (!browseFilter || s.name.toLowerCase().includes(browseFilter.toLowerCase())) &&
    (browseCategory === 'All Categories' || s.cat === browseCategory)
  )

  const runVerify = () => {
    setVerifyRunning(true); setVerifyDone(false); setVerifyStep(0)
    let i = 0
    const iv = setInterval(() => {
      i++
      setVerifyStep(i)
      if (i >= AI_STEPS.length) { clearInterval(iv); setVerifyDone(true); setVerifyRunning(false) }
    }, 900)
  }

  // ── Submit application handler ──────────────────────────────────
  const handleSubmitApplication = () => {
    if (!applyForm.name.trim()) { showToast('Please enter your name.', 'error'); return }
    if (!applyForm.institution.trim()) { showToast('Please enter your institution.', 'error'); return }

    const newApp = {
      id: `APP-2026-${String(Date.now()).slice(-6)}`,
      scheme: applyModal.name,
      date: new Date().toLocaleDateString('en-IN', {year:'numeric', month:'2-digit', day:'2-digit'}).split('/').reverse().join('-'),
      amount: applyModal.amount,
      status: 'Pending Review',
      aiScore: Math.floor(70 + Math.random() * 25),
      remarks: 'Submitted — in queue for AI verification',
    }
    setMyApps(prev => [newApp, ...prev])
    setApplyModal(null)
    setApplyForm({ name: '', studentId: '', institution: '', income: '' })
    showToast(`✅ Application submitted for "${applyModal.name}"! AI verification will begin automatically.`)
  }

  return (
    <div className="dash-body">
      <Sidebar
        role="user"
        tabs={TABS}
        activeTab={tab}
        onTabChange={id => { setTab(id); if (window.innerWidth <= 1024) setSidebarOpen(false) }}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="dash-main">
        {/* TOPBAR */}
        <div className="dash-topbar">
          <div className="topbar-left">
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(o=>!o)}>☰</button>
            <span className="topbar-title">Citizen Portal</span>
          </div>
          <div className="topbar-right">
            <div className="verify-status"><span className="chain-dot"></span>AI Verified</div>
            <button onClick={() => navigate('/wallet')} style={{ background:'rgba(129,140,248,.12)', color:'var(--accent)', border:'1px solid rgba(129,140,248,.3)', borderRadius:'7px', padding:'.38rem .85rem', fontSize:'.82rem', fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:'.35rem', whiteSpace:'nowrap' }}>◎ Wallet</button>
            <div className="topbar-user">
              <span className="topbar-avatar">{citizenName.charAt(0).toUpperCase()}</span>
              <span className="topbar-uname">{citizenName}</span>
            </div>
            <button onClick={handleLogout} className="btn-logout">Sign Out</button>
            <ThemeToggle />
          </div>
        </div>

        {/* Toast Notification */}
        {toast && (
          <div className={`dash-toast ${toast.type}`} onClick={() => setToast(null)}>
            {toast.msg}
          </div>
        )}

        {/* OVERVIEW */}
        {tab === 'overview' && (
          <div className="tab-content active">
            <div className="dash-welcome">
              <div>
                <h1>Welcome back, {citizenName} 👋</h1>
                <p>{citizenEmp ? citizenEmp + ' · ' : ''}Scholarship portal active — track applications & on-chain status below.</p>
              </div>
              <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:'.3rem'}}>
                <span className="welcome-date">{citizenPhone ? '+91 ' + citizenPhone : 'Citizen'}</span>
                {aadhaarLinked && <span className="topbar-badge">🔒 Aadhaar Linked</span>}
              </div>
            </div>
            <div className="kpi-grid">
              {[
                { label:'Active Applications', val: String(myApps.filter(a => a.status !== 'Rejected').length), icon:'📝', cls:'kpi-accent', action: 'applications' },
                { label:'Tokens Received',     val: String(myApps.filter(a => a.status === 'Approved').length), icon:'💎', cls:'', action: 'onchain' },
                { label:'Total Scholarship',   val:'₹' + myApps.filter(a=>a.status==='Approved').reduce((s,a)=>s+a.amount,0).toLocaleString(), icon:'💰', cls:'', action: null },
                { label:'AI Trust Score',      val:'88/100',    icon:'🛡️', cls:'kpi-accent', action: 'verify' },
                { label:'Pending Review',      val: String(myApps.filter(a=>a.status==='Pending Review').length) + ' apps', icon:'⏳', cls:'kpi-warn', action: 'applications' },
                { label:'Browse Schemes',      val: String(SCHEMES.filter(s=>s.status==='active').length) + ' active', icon:'🔍', cls:'', action: 'browse' },
              ].map(k => (
                <div key={k.label} className={`kpi-card${k.cls?' '+k.cls:''}`}
                  onClick={() => k.action && setTab(k.action)}
                  style={{ cursor: k.action ? 'pointer' : 'default' }}>
                  <div className="kpi-top">
                    <span className="kpi-label">{k.label}</span>
                    <span className="kpi-icon">{k.icon}</span>
                  </div>
                  <span className="kpi-val">{k.val}</span>
                </div>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:'1.4rem' }}>
              <div className="table-card" style={{ padding:'1.6rem' }}>
                <span className="chart-title">Application Timeline</span>
                <div className="timeline">
                  {TIMELINE.map(t => (
                    <div key={t.title} className="tl-item">
                      <div className={`tl-dot ${t.state}`}>{t.icon}</div>
                      <div>
                        <div className="tl-title">{t.title}</div>
                        <div className="tl-desc">{t.desc}</div>
                        <div className="tl-time">{t.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="table-card" style={{ padding:'1.6rem', textAlign:'center' }}>
                <span className="chart-title">Trust Score</span>
                <TrustGauge score={88} />
                <div className="gauge-checks" style={{ marginTop:'1rem' }}>
                  {[
                    { label:'Identity',    val:'Aadhaar Verified', ok:true },
                    { label:'Documents',  val:'Authentic (OCR 96%)', ok:true },
                    { label:'Income',     val:'₹4.2L — Confirmed', ok:true },
                    { label:'Duplicates', val:'None Found', ok:true },
                    { label:'Bank A/C',   val:'HDFC XXXX-4821', ok:true },
                    { label:'Eligibility',val:'AICTE Accredited ✓', ok:true },
                  ].map(g => (
                    <div key={g.label} className="gc-item">
                      <span className="gc-label">{g.label}</span>
                      <span className={`gc-val ${g.ok?'ok':'warn'}`}>{g.val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* BROWSE */}
        {tab === 'browse' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div><h2>Browse Schemes</h2><p>Find and apply for government scholarships.</p></div>
            </div>
            <div className="filter-bar">
              <input
                className="filter-input"
                placeholder="Search schemes…"
                value={browseFilter}
                onChange={e => setBrowseFilter(e.target.value)}
              />
              <select className="filter-select" value={browseCategory} onChange={e => setBrowseCategory(e.target.value)}>
                <option>All Categories</option>
                <option>Merit</option>
                <option>Need-Based</option>
                <option>Minority</option>
                <option>Research</option>
              </select>
            </div>
            <div className="schemes-grid">
              {filteredSchemes.map(s => (
                <div key={s.id} className="scheme-card">
                  <div className="sc-header">
                    <span className="sc-title">{s.name}</span>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="sc-body">{s.criteria}</p>
                  <div className="sc-meta">
                    <span>🏛️ {s.ministry || s.cat}</span>
                    <span>💰 ₹{s.amount.toLocaleString()}/student</span>
                    <span>👥 {s.benef.toLocaleString()} beneficiaries</span>
                    <span>📅 {s.deadline}</span>
                  </div>
                  <div className="sc-footer">
                    <div className="sc-progress">
                      <div className="sc-progress-bar">
                        <div className="sc-progress-fill" style={{ width:`${s.filled}%` }}></div>
                      </div>
                      <span className="sc-pct">{s.filled}% filled</span>
                    </div>
                    <button className="btn-sm btn-approve" onClick={() => {
                      setApplyForm({ name: citizenName, studentId: `STU-2026-${String(Date.now()).slice(-4)}`, institution: '', income: '' })
                      setApplyModal(s)
                    }}>
                      Apply →
                    </button>
                  </div>
                </div>
              ))}
              {filteredSchemes.length === 0 && (
                <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'3rem', color:'var(--text-2)' }}>
                  <div style={{ fontSize:'3rem', marginBottom:'1rem' }}>🔍</div>
                  <h3>No schemes found</h3>
                  <p>Try adjusting your search or filter criteria.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MY APPLICATIONS */}
        {tab === 'applications' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div><h2>My Applications</h2><p>Track your scholarship applications.</p></div>
              <button className="btn-primary" onClick={() => setTab('browse')}>+ Apply for More</button>
            </div>
            {myApps.length === 0 ? (
              <div style={{ textAlign:'center', padding:'3rem', color:'var(--text-2)' }}>
                <div style={{ fontSize:'3rem', marginBottom:'1rem' }}>📝</div>
                <h3>No Applications Yet</h3>
                <p>Browse schemes and submit your first application.</p>
                <button className="btn-primary" style={{ marginTop:'1rem' }} onClick={() => setTab('browse')}>Browse Schemes →</button>
              </div>
            ) : (
              <div className="apps-list">
                {myApps.map(a => (
                  <div key={a.id} className="my-app-card">
                    <div>
                      <div className="mac-scheme">{a.scheme}</div>
                      <div className="mac-date">{a.date}</div>
                    </div>
                    <StatusBadge status={a.status} />
                    <div className="mac-amount">₹{a.amount.toLocaleString()}</div>
                    <button className="btn-sm btn-view" onClick={() => setAppDetail(a)}>View Details</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* MY TOKENS */}
        {tab === 'onchain' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>⛓️ On-Chain Status</h2>
                <p>Your status on the ScholarshipTreasury smart contract · App ID: <strong>{APP_ID}</strong></p>
              </div>
              <button
                className="btn-sm btn-view"
                onClick={() => { const a = loadAddress(); if (a) refreshChainStatus(a) }}
                disabled={chainLoading}
              >
                {chainLoading ? '↻ Loading…' : '↻ Refresh'}
              </button>
            </div>

            {chainTx && (
              <div style={{ background:'rgba(16,185,129,.1)', border:'1px solid rgba(16,185,129,.3)', borderRadius:'10px', padding:'.75rem 1rem', marginBottom:'1rem', color:'#10b981', fontSize:'.88rem' }}>
                ✅ Transaction confirmed!&nbsp;&nbsp;
                <a href={`https://testnet.algoexplorer.io/tx/${chainTx}`} target="_blank" rel="noreferrer" style={{color:'#10b981',fontWeight:600}}>View on AlgoExplorer ↗</a>
              </div>
            )}
            {chainError && (
              <div style={{ background:'rgba(239,68,68,.1)', border:'1px solid rgba(239,68,68,.25)', borderRadius:'10px', padding:'.75rem 1rem', marginBottom:'1rem', color:'#ef4444', fontSize:'.88rem' }}>
                ❌ {chainError}
              </div>
            )}

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1.25rem' }}>
              {/* Status panel */}
              <div className="table-card" style={{ padding:'1.5rem' }}>
                <h3 style={{ marginBottom:'1.2rem', fontSize:'1rem' }}>Your Contract Status</h3>
                {!chainOptedIn ? (
                  <div style={{ color:'var(--text-2)', fontSize:'.9rem', marginBottom:'1rem' }}>
                    You have not opted in to this app yet.<br/>Step 1 below to get started.
                  </div>
                ) : chainStatus ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:'.6rem', marginBottom:'1.2rem' }}>
                    {[
                      { label:'Opted In',        ok: true },
                      { label:'Registered',       ok: chainStatus.isRegistered },
                      { label:'Milestone Done',   ok: chainStatus.milestoneCompleted },
                      { label:'Payout Released',  ok: chainStatus.hasBeenPaid },
                    ].map(s => (
                      <div key={s.label} style={{ display:'flex', justifyContent:'space-between', padding:'.5rem .85rem', background:'var(--bg)', borderRadius:'9px', border:'1px solid var(--border-2)' }}>
                        <span style={{ color:'var(--text-2)', fontSize:'.88rem' }}>{s.label}</span>
                        <span style={{ color: s.ok ? '#10b981' : '#94a3b8', fontWeight:700, fontSize:'.88rem' }}>{s.ok ? '✔ Yes' : '✗ No'}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {chainStatus?.hasBeenPaid && (
                  <div style={{ background:'rgba(16,185,129,.08)', border:'1px solid rgba(16,185,129,.25)', borderRadius:'10px', padding:'1rem', textAlign:'center', color:'#10b981', fontWeight:700, fontSize:'.9rem' }}>
                    🎉 Scholarship payout has been sent to your wallet!
                  </div>
                )}
              </div>

              {/* Action panel */}
              <div className="table-card" style={{ padding:'1.5rem' }}>
                <h3 style={{ marginBottom:'1.2rem', fontSize:'1rem' }}>Student Actions</h3>
                <div style={{ display:'flex', flexDirection:'column', gap:'.85rem' }}>

                  {/* Step 1: Opt in */}
                  <div>
                    <div style={{ fontSize:'.78rem', color:'var(--text-2)', marginBottom:'.4rem', letterSpacing:'.04em', textTransform:'uppercase' }}>Step 1 — Opt In to App</div>
                    <button
                      className="btn-primary w-full"
                      disabled={!!chainAction || chainOptedIn}
                      onClick={() => runChainAction('Opting in…', (addr, signer) => optInToApp(addr, signer))}
                    >
                      {chainAction === 'Opting in…' ? chainAction : chainOptedIn ? '✔ Already Opted In' : '🔐 Opt In to ScholarshipTreasury'}
                    </button>
                  </div>

                  {/* Step 2: Register */}
                  <div>
                    <div style={{ fontSize:'.78rem', color:'var(--text-2)', marginBottom:'.4rem', letterSpacing:'.04em', textTransform:'uppercase' }}>Step 2 — Register as Student</div>
                    <button
                      className="btn-primary w-full"
                      disabled={!!chainAction || !chainOptedIn || chainStatus?.isRegistered}
                      onClick={() => runChainAction('Registering…', (addr, signer) => registerStudent(addr, signer))}
                    >
                      {chainAction === 'Registering…' ? chainAction : chainStatus?.isRegistered ? '✔ Already Registered' : '📝 Register Student'}
                    </button>
                  </div>

                  {/* Step 3+: waiting for authority */}
                  {chainOptedIn && chainStatus?.isRegistered && !chainStatus?.milestoneCompleted && (
                    <div style={{ background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.25)', borderRadius:'10px', padding:'.85rem 1rem', color:'#f59e0b', fontSize:'.85rem', lineHeight:1.6 }}>
                      ⏳ <strong>Awaiting milestone validation</strong><br/>
                      The authority wallet must call <code>mark_milestone_complete</code> for your address before payout can be released.
                    </div>
                  )}
                  {chainStatus?.milestoneCompleted && !chainStatus?.hasBeenPaid && (
                    <div style={{ background:'rgba(59,130,246,.08)', border:'1px solid rgba(59,130,246,.25)', borderRadius:'10px', padding:'.85rem 1rem', color:'#60a5fa', fontSize:'.85rem', lineHeight:1.6 }}>
                      ✅ Milestone verified! <strong>Awaiting officer payout call</strong> — <code>release_payout</code> will send ALGO to your wallet via inner transaction.
                    </div>
                  )}

                  <p style={{ fontSize:'.78rem', color:'var(--text-3)', lineHeight:1.6, margin:0 }}>
                    Connect your Algorand wallet via <strong>◎ Wallet</strong> before performing any on-chain action.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI VERIFY */}
        {tab === 'verify' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div><h2>AI Verify Me</h2><p>Run your identity through the 7-step AI pipeline.</p></div>
              <button className="btn-sm btn-view" onClick={() => navigate('/ai-verify')}>
                Open Full AI Engine →
              </button>
            </div>
            <div className="ai-verify-layout">
              <div className="verify-steps-card">
                <h3>Verification Pipeline</h3>

                {/* Upload section */}
                <div style={{ marginBottom:'1.5rem' }}>
                  <div style={{ fontSize:'.82rem', color:'var(--text-2)', marginBottom:'.75rem', fontWeight:600 }}>📎 Upload Documents</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'.5rem' }}>
                    {[
                      { key:'aadhaar', label:'Aadhaar Card', icon:'🪪' },
                      { key:'marksheet', label:'Marksheet', icon:'📋' },
                      { key:'income', label:'Income Certificate', icon:'💰' },
                      { key:'bank', label:'Bank Statement', icon:'🏦' },
                    ].map(doc => (
                      <div
                        key={doc.key}
                        className={`mini-upload-zone${verifyUploads[doc.key] ? ' uploaded' : ''}`}
                        onClick={() => setVerifyUploads(u => ({ ...u, [doc.key]: true }))}
                        style={{ cursor:'pointer' }}
                      >
                        <span>{verifyUploads[doc.key] ? '✅' : doc.icon}</span>
                        <span style={{ fontSize:'.78rem' }}>{doc.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="vsteps">
                  {AI_STEPS.map((s, i) => (
                    <div
                      key={s.label}
                      className={`vstep${verifyStep > i ? ' done' : verifyStep === i ? ' active' : ''}`}
                    >
                      <span className="vstep-icon">{verifyStep > i ? '✅' : s.icon}</span>
                      <div>
                        <div className="vstep-title">{s.label}</div>
                        <div className="vstep-desc">{s.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {!verifyRunning && !verifyDone && (
                  <button className="btn-primary w-full" style={{ marginTop:'1.2rem' }} onClick={runVerify}>
                    🤖 Start AI Verification
                  </button>
                )}
                {verifyRunning && (
                  <div style={{ textAlign:'center', marginTop:'1rem', color:'var(--accent)' }}>
                    Processing step {verifyStep + 1} of {AI_STEPS.length}…
                  </div>
                )}
              </div>
              <div className="verify-progress-card">
                <h3>Verification Status</h3>
                {verifyDone ? (
                  <>
                    <TrustGauge score={87} />
                    <div className="verify-result success" style={{ marginTop:'1rem' }}>
                      ✅ Verification Passed — Score: 87/100
                    </div>
                    <div style={{ fontSize:'.78rem', color:'var(--text-2)', marginTop:'.8rem', lineHeight:1.6 }}>
                      Your identity has been verified on-chain.<br/>
                      <span style={{ color:'var(--accent)', fontFamily:'monospace' }}>
                        TX: 0x{Math.random().toString(16).slice(2,18).toUpperCase()}
                      </span>
                    </div>
                    <button
                      className="btn-primary w-full"
                      style={{ marginTop:'1rem' }}
                      onClick={() => navigate('/ai-verify')}
                    >
                      View Full AI Report →
                    </button>
                  </>
                ) : (
                  <div style={{ color:'var(--text-2)', fontSize:'.9rem', paddingTop:'1rem' }}>
                    {Object.values(verifyUploads).every(Boolean) ? (
                      <>
                        ✅ All documents uploaded!<br/><br/>
                        Click "Start AI Verification" to run the full pipeline.
                      </>
                    ) : (
                      <>
                        Upload all 4 documents first, then click "Start AI Verification" to run the pipeline.
                        <br/><br/>
                        <strong>Required:</strong> Aadhaar, Marksheet, Income Certificate, Bank Statement.
                        <br/><br/>
                        <span style={{ fontSize:'.82rem', color:'var(--text-3)' }}>
                          {Object.values(verifyUploads).filter(Boolean).length}/4 documents uploaded
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      {/* APPLY MODAL */}
      {applyModal && (
        <div className="modal-overlay open" onClick={e=>e.target===e.currentTarget&&setApplyModal(null)}>
          <div className="modal-box" style={{ maxWidth:'500px' }}>
            <button className="modal-close" onClick={() => setApplyModal(null)}>✕</button>
            <div className="modal-title">Apply — {applyModal.name}</div>
            <div className="modal-sub">Amount: ₹{applyModal.amount?.toLocaleString()} · Deadline: {applyModal.deadline}</div>
            <div className="modal-form">
              <div className="form-group">
                <label>Full Name *</label>
                <input type="text" value={applyForm.name}
                  onChange={e => setApplyForm({...applyForm, name: e.target.value})}
                  placeholder="Your full name" />
              </div>
              <div className="form-group">
                <label>Student ID</label>
                <input type="text" value={applyForm.studentId}
                  onChange={e => setApplyForm({...applyForm, studentId: e.target.value})}
                  placeholder="Auto-generated" readOnly style={{ opacity: .7 }} />
              </div>
              <div className="form-group">
                <label>Institution *</label>
                <input type="text" value={applyForm.institution}
                  onChange={e => setApplyForm({...applyForm, institution: e.target.value})}
                  placeholder="Your college/school" />
              </div>
              <div className="form-group">
                <label>Family Annual Income (₹)</label>
                <input type="number" value={applyForm.income}
                  onChange={e => setApplyForm({...applyForm, income: e.target.value})}
                  placeholder="Enter income" />
              </div>
              <div style={{ background:'var(--bg)', border:'1px solid var(--border-2)', borderRadius:'8px', padding:'.75rem', marginBottom:'.75rem', fontSize:'.82rem', color:'var(--text-2)' }}>
                <strong>Eligibility:</strong> {applyModal.criteria}
              </div>
              <button
                type="button"
                className="btn-primary w-full"
                onClick={handleSubmitApplication}
              >
                Submit Application →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* APPLICATION DETAIL MODAL */}
      {appDetail && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAppDetail(null)}>
          <div className="modal-box" style={{ maxWidth:'520px' }}>
            <button className="modal-close" onClick={() => setAppDetail(null)}>✕</button>
            <div className="modal-title">Application Details</div>
            <div className="modal-sub">{appDetail.id}</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'.75rem', marginTop:'1.2rem' }}>
              {[
                { label:'Scheme', val: appDetail.scheme },
                { label:'Amount', val: `₹${appDetail.amount.toLocaleString()}` },
                { label:'Status', val: appDetail.status },
                { label:'AI Score', val: `${appDetail.aiScore}/100` },
                { label:'Applied On', val: appDetail.date },
                { label:'Remarks', val: appDetail.remarks || 'None' },
              ].map(item => (
                <div key={item.label} style={{ padding:'.7rem', background:'var(--bg)', borderRadius:'8px', border:'1px solid var(--border-2)' }}>
                  <div style={{ fontSize:'.72rem', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:'.25rem' }}>{item.label}</div>
                  <div style={{ fontSize:'.85rem', fontWeight:600 }}>{item.val}</div>
                </div>
              ))}
            </div>
            {appDetail.status === 'Approved' && (
              <div style={{ background:'rgba(16,185,129,.08)', border:'1px solid rgba(16,185,129,.25)', borderRadius:'10px', padding:'.85rem 1rem', marginTop:'1rem', color:'#10b981', fontSize:'.85rem', textAlign:'center', fontWeight:600 }}>
                🎉 Application approved! Token will be minted on-chain.
              </div>
            )}
            {appDetail.status === 'Rejected' && (
              <div style={{ background:'rgba(239,68,68,.08)', border:'1px solid rgba(239,68,68,.25)', borderRadius:'10px', padding:'.85rem 1rem', marginTop:'1rem', color:'#ef4444', fontSize:'.85rem' }}>
                ❌ <strong>Reason:</strong> {appDetail.remarks}
              </div>
            )}
            <button className="btn-sm btn-view" style={{ width:'100%', marginTop:'1rem', padding:'.6rem' }} onClick={() => setAppDetail(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
