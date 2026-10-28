import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import StatusBadge from '../components/StatusBadge'
import ThemeToggle from '../components/ThemeToggle'
import { SCHEMES, MY_APPLICATIONS, MY_TOKENS } from '../data/dashboardData'
import {
  makePeraSigner,
  optInToApp,
  registerStudent,
  getStudentState,
  isOptedIn,
  resetOnChainDemo,
  APP_ID,
} from '../lib/scholarship-contract'
import {
  loadAddress,
  connectWallet,
  connectDemoWallet,
  disconnectWallet,
  getWalletLabel,
  getWalletMode,
} from '../lib/perawallet'
import {
  getStudentApplications,
  submitStudentApplication,
  getStudentTokens,
  redeemStudentToken,
  subscribeAppSync,
} from '../lib/appSync'

const TABS = [
  { id: 'overview',     icon: '📊', label: 'My Overview' },
  { id: 'browse',       icon: '🔍', label: 'Browse Schemes' },
  { id: 'applications', icon: '📝', label: 'My Applications' },
  { id: 'onchain',      icon: '⛓️', label: 'On-Chain & Tokens' },
  { id: 'verify',       icon: '🤖', label: 'AI Verify Me' },
]

const AI_STEPS = [
  { icon: '📤', label: 'Document Upload', desc: 'Upload Aadhaar, Marksheet, Income Certificate, Bank Statement' },
  { icon: '🔍', label: 'OCR Extraction', desc: 'AI extracts and parses all text from uploaded documents' },
  { icon: '🪪', label: 'Identity Cross-Reference', desc: 'Aadhaar data cross-referenced with UIDAI database' },
  { icon: '🖼️', label: 'Forgery Detection', desc: 'ML model scans for pixel manipulation, metadata anomalies' },
  { icon: '📋', label: 'Duplicate Check', desc: 'Vector DB search for duplicate identities across all applications' },
  { icon: '💰', label: 'Income Validation', desc: 'Stated income verified against PAN/ITR records' },
  { icon: '⛓️', label: 'On-Chain Anchoring', desc: 'Verification hash anchored immutably to blockchain' },
]

function TrustGauge({ score = 88 }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    c.width = 200
    c.height = 120
    const cx = 100, cy = 108, r = 80
    ctx.clearRect(0, 0, 200, 120)
    ctx.beginPath()
    ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI)
    ctx.strokeStyle = 'rgba(255,255,255,.06)'
    ctx.lineWidth = 12
    ctx.stroke()
    const end = Math.PI + (score / 100) * Math.PI
    const g = ctx.createLinearGradient(0, 0, 200, 0)
    g.addColorStop(0, '#EF4444')
    g.addColorStop(0.5, '#FBBF24')
    g.addColorStop(1, '#818CF8')
    ctx.beginPath()
    ctx.arc(cx, cy, r, Math.PI, end)
    ctx.strokeStyle = g
    ctx.lineWidth = 12
    ctx.lineCap = 'round'
    ctx.stroke()
  }, [score])
  return (
    <div className="trust-gauge">
      <div className="gauge-wrap">
        <canvas ref={canvasRef} style={{ display: 'block' }} />
        <div className="gauge-val" style={{ bottom: '8px' }}>
          {score}<span>/100</span>
        </div>
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
  const [myApps, setMyApps] = useState(() => getStudentApplications())
  const [tokens, setTokens] = useState(() => getStudentTokens())
  const [toast, setToast] = useState(null)
  const [appDetail, setAppDetail] = useState(null)
  const [redeemModal, setRedeemModal] = useState(null)
  const [redeemMethod, setRedeemMethod] = useState('bank')
  const [redeeming, setRedeeming] = useState(false)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [trustScore, setTrustScore] = useState(88)

  // Real-time synchronization with Gov Dashboard and storage events
  useEffect(() => {
    const unsub = subscribeAppSync((detail) => {
      setMyApps(getStudentApplications())
      setTokens(getStudentTokens())
      if (detail?.type === 'application_updated' && detail?.app) {
        const isApproved = detail.action === 'Approved'
        setUserNotifs(prev => [{
          id: Date.now(),
          title: isApproved ? '🎉 Application Approved by Ministry!' : `⚠️ Status: ${detail.action}`,
          desc: `${detail.app.scheme} (${detail.app.id}) was updated to "${detail.action}". ${isApproved ? 'Scholarship token minted on Algorand!' : ''}`,
          time: 'Just now',
          read: false,
        }, ...prev])
        showToast(isApproved ? `🎉 "${detail.app.scheme}" was APPROVED! New ASA token received.` : `Status updated: ${detail.app.scheme} (${detail.action})`)
      }
    })
    return unsub
  }, [])

  // Topbar Notifications
  const [showNotifDropdown, setShowNotifDropdown] = useState(false)
  const [userNotifs, setUserNotifs] = useState([
    { id: 1, title: '🎉 Application Approved!', desc: 'AICTE Pragati Scholarship approved by Sr. Officer. Token generated on Algorand.', time: '2 hrs ago', read: false },
    { id: 2, title: '💎 Token Ready to Redeem', desc: 'Asset #78812341 (₹50,000) is ready for bank credit or tuition transfer.', time: '1 day ago', read: false },
    { id: 3, title: '🤖 AI Verification Passed', desc: 'Trust Score 88/100 recorded. UIDAI & academic verification cleared.', time: '2 days ago', read: true },
    { id: 4, title: '📅 Renewal Reminder', desc: 'Submit semester marksheets before March 31 for next milestone disbursement.', time: '3 days ago', read: true },
  ])

  const unreadCount = userNotifs.filter(n => !n.read).length

  // Upload states for verify
  const [verifyUploads, setVerifyUploads] = useState({
    aadhaar: true, marksheet: true, income: true, bank: false
  })

  // Apply form state
  const [applyForm, setApplyForm] = useState({
    name: '', studentId: '', institution: '', income: '', course: '', bankIfsc: '', bankAcc: ''
  })

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Contract state ──────────────────────────────────────
  const [walletAddr,    setWalletAddr]    = useState(() => loadAddress())
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
    const handleWalletChange = (e) => {
      const a = e.detail?.address || loadAddress()
      setWalletAddr(a)
      if (a) refreshChainStatus(a)
      else {
        setChainStatus(null)
        setChainOptedIn(false)
      }
    }
    window.addEventListener('pera_wallet_updated', handleWalletChange)
    return () => window.removeEventListener('pera_wallet_updated', handleWalletChange)
  }, [refreshChainStatus])

  useEffect(() => {
    if (tab === 'onchain') {
      const addr = walletAddr || loadAddress()
      if (addr) refreshChainStatus(addr)
      else setChainError(null)
    }
  }, [tab, walletAddr, refreshChainStatus])

  const runChainAction = async (label, fn) => {
    let addr = walletAddr || loadAddress()
    if (!addr) {
      addr = connectDemoWallet('student')
      setWalletAddr(addr)
      showToast('⚡ Auto-connected TestNet Student Wallet for signing.')
    }
    setChainAction(label)
    setChainError(null)
    setChainTx(null)
    try {
      const signer = makePeraSigner(addr)
      const { txID } = await fn(addr, signer)
      setChainTx(txID)
      showToast(`✅ ${label} completed on Algorand TestNet!`)
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

  // ── Session: read logged-in citizen with default fallback ─────────
  const citizen = (() => {
    try {
      const stored = sessionStorage.getItem('citizen_user')
      if (stored) return JSON.parse(stored)
    } catch {}
    return { name: 'Divya S. Krishnamurthy', phone: '9876543210', employment: 'Student · B.E. ECE', aadhaarLast4: '4821' }
  })()

  const [profile, setProfile] = useState({
    name: citizen?.name || 'Divya S. Krishnamurthy',
    studentId: 'STU-2026-0478',
    phone: citizen?.phone || '9876543210',
    employment: citizen?.employment || 'Student · B.E. ECE',
    institution: 'BITS Pilani',
    course: 'B.E. Electronics & Communication',
    cgpa: '8.92',
    income: '₹4,20,000 / year',
    aadhaarLast4: citizen?.aadhaarLast4 || '4821',
    bankAcc: 'HDFC Bank · A/C XXXX-4821',
    ifsc: 'HDFC0001244',
  })

  const citizenName = profile.name
  const aadhaarLinked = !!profile.aadhaarLast4

  const handleLogout = () => { sessionStorage.removeItem('citizen_user'); navigate('/') }

  const handleSaveProfile = () => {
    sessionStorage.setItem('citizen_user', JSON.stringify({ ...citizen, name: profile.name, phone: profile.phone, employment: profile.employment }))
    setShowProfileModal(false)
    showToast('Profile information saved successfully!')
  }

  const filteredSchemes = SCHEMES.filter(s =>
    s.status === 'active' &&
    (!browseFilter || s.name.toLowerCase().includes(browseFilter.toLowerCase())) &&
    (browseCategory === 'All Categories' || s.cat === browseCategory)
  )

  const runVerify = () => {
    setVerifyRunning(true)
    setVerifyDone(false)
    setVerifyStep(0)
    let i = 0
    const iv = setInterval(() => {
      i++
      setVerifyStep(i)
      if (i >= AI_STEPS.length) {
        clearInterval(iv)
        setVerifyDone(true)
        setVerifyRunning(false)
        setTrustScore(94)
        showToast('🎉 AI Verification completed! Trust score elevated to 94/100.')
      }
    }, 850)
  }

  // ── Submit application handler ──────────────────────────────────
  const handleSubmitApplication = () => {
    if (!applyForm.name.trim()) { showToast('Please enter your full name.', 'error'); return }
    if (!applyForm.institution.trim()) { showToast('Please enter your institution.', 'error'); return }

    const newApp = submitStudentApplication({
      scheme: applyModal.name,
      amount: applyModal.amount,
      name: applyForm.name.trim(),
      studentId: applyForm.studentId || profile.studentId || `STU-2026-${String(Date.now()).slice(-4)}`,
      inst: applyForm.institution.trim(),
      course: applyForm.course || profile.course || 'B.Tech / Degree',
      income: applyForm.income ? `₹${Number(applyForm.income).toLocaleString()}` : profile.income,
      bankAcc: applyForm.bankAcc || profile.bankAcc,
      ifsc: applyForm.bankIfsc || profile.ifsc,
    })

    setMyApps(getStudentApplications())

    // Add notification for the submitted application
    setUserNotifs(prev => [{
      id: Date.now(),
      title: '📝 Application Submitted!',
      desc: `Your application for "${applyModal.name}" (${newApp.id}) submitted at ${newApp.time}. Live in Gov Portal review queue.`,
      time: 'Just now',
      read: false,
    }, ...prev])

    setApplyModal(null)
    setApplyForm({ name: '', studentId: '', institution: '', income: '', course: '', bankIfsc: '', bankAcc: '' })
    showToast(`✅ Application submitted for "${applyModal.name}" at ${newApp.time}! Sent to Gov Portal.`)

    // Auto-switch to My Applications tab after a brief delay
    setTimeout(() => setTab('applications'), 500)
  }

  // ── Withdraw application handler ────────────────────────────────
  const handleWithdrawApp = (appId) => {
    setMyApps(prev => {
      const updated = prev.filter(a => a.id !== appId)
      try {
        localStorage.setItem('fundscheme_applications', JSON.stringify(updated))
        localStorage.setItem('my_apps', JSON.stringify(updated))
        sessionStorage.setItem('my_apps', JSON.stringify(updated))
        localStorage.setItem('gov_all_apps', JSON.stringify(updated))
        const govExtra = JSON.parse(localStorage.getItem('gov_extra_apps') || '[]')
        localStorage.setItem('gov_extra_apps', JSON.stringify(govExtra.filter(a => a.id !== appId)))
      } catch {}
      return updated
    })
    if (appDetail?.id === appId) setAppDetail(null)
    showToast(`Application ${appId} has been withdrawn.`)
  }

  // ── Redeem Token Action ──────────────────────────────────────────
  const handleConfirmRedeem = () => {
    if (!redeemModal) return
    setRedeeming(true)
    setTimeout(() => {
      redeemStudentToken(redeemModal.id, redeemMethod)
      setTokens(getStudentTokens())
      setRedeeming(false)
      const tokenName = redeemModal.scheme
      setRedeemModal(null)
      showToast(`🎉 ₹${redeemModal.amount.toLocaleString()} successfully redeemed via ${redeemMethod === 'bank' ? 'Direct Bank Transfer (DBT)' : 'College Tuition Escrow'}!`)
    }, 1200)
  }

  // ── Download Acknowledgement Slip ───────────────────────────────
  const downloadAcknowledgementSlip = (app) => {
    const text = `======================================================================
GOVERNMENT OF INDIA — NATIONAL SCHOLARSHIP PORTAL
FundScheme Tokenized Scheme Disbursement System
======================================================================
APPLICATION ACKNOWLEDGEMENT SLIP
======================================================================
Application Number : ${app.id}
Date of Submission : ${app.date}
Applicant Name     : ${citizenName}
Student ID         : ${profile.studentId}
Institution        : ${profile.institution}
Course & Branch    : ${profile.course}
Scheme Name        : ${app.scheme}
Sanctioned Amount  : ₹${app.amount.toLocaleString()}
Current Status     : ${app.status}
AI Trust Score     : ${app.aiScore}/100
UIDAI e-KYC Status : VERIFIED (Aadhaar XXXX-${profile.aadhaarLast4})
Bank Account       : ${profile.bankAcc} (IFSC: ${profile.ifsc})
Algorand App ID    : ${APP_ID}
======================================================================
DIGITAL VERIFICATION SEAL:
Verification Hash  : SHA256-${Math.random().toString(36).substring(2, 10).toUpperCase()}
Anchor Block       : 31204819 (Algorand TestNet)
======================================================================
Please quote your Application Number for any future communications.
Save or print this acknowledgement for your records.`

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `acknowledgement_${app.id}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`📄 Downloaded acknowledgement slip for ${app.id}`)
  }

  // ── Download Redemption Receipt ──────────────────────────────────
  const downloadRedemptionReceipt = (token) => {
    const text = `======================================================================
FUNDSCHEME ALGORAND TOKEN REDEMPTION CERTIFICATE
======================================================================
Token ID           : ${token.id}
ASA Asset ID       : ${token.assetId || 78812341}
Beneficiary Name   : ${citizenName}
Scheme             : ${token.scheme}
Redeemed Value     : ₹${token.amount.toLocaleString()}
Redemption Date    : ${new Date().toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' })}
Disbursement Mode  : PFMS / Direct Benefit Transfer (DBT)
Beneficiary A/C    : ${profile.bankAcc}
Algorand TestNet TX: ${token.txHash || 'CKAOTMTKZL47GJTHVKW4CJNPKX5IN4BQKQMF3QFP6W4ETPB5SRAXQ2'}
Status             : CONFIRMED ON-CHAIN
======================================================================`

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `redemption_receipt_${token.id}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`📄 Downloaded redemption certificate for ${token.id}`)
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
            <button className="sidebar-toggle" onClick={() => setSidebarOpen(o => !o)}>☰</button>
            <span className="topbar-title">Citizen & Student Portal</span>
          </div>
          <div className="topbar-right">
            <div className="verify-status"><span className="chain-dot"></span>AI Verified ({trustScore}%)</div>

            <button
              onClick={() => navigate('/wallet')}
              style={{
                background: 'rgba(129,140,248,.12)', color: 'var(--accent)',
                border: '1px solid rgba(129,140,248,.3)', borderRadius: '7px',
                padding: '.38rem .85rem', fontSize: '.82rem', fontWeight: 600,
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '.35rem',
                whiteSpace: 'nowrap'
              }}
            >
              ◎ Wallet
            </button>

            {/* Notification Bell */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowNotifDropdown(p => !p)}
                style={{
                  background: 'var(--card-bg, rgba(255,255,255,.05))',
                  border: '1px solid var(--border-2)',
                  borderRadius: '7px',
                  padding: '.38rem .65rem',
                  cursor: 'pointer',
                  position: 'relative',
                  fontSize: '.95rem'
                }}
                title="Notifications"
              >
                🔔
                {unreadCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '-4px', right: '-4px',
                    background: '#818CF8', color: '#fff', fontSize: '.68rem',
                    fontWeight: 700, borderRadius: '50%', width: '16px', height: '16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifDropdown && (
                <div style={{
                  position: 'absolute', right: 0, top: '42px', width: '300px',
                  background: 'var(--card-bg, #1e293b)', border: '1px solid var(--border-2)',
                  borderRadius: '12px', boxShadow: '0 12px 32px rgba(0,0,0,.45)',
                  zIndex: 100, padding: '1rem', backdropFilter: 'blur(16px)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
                    <strong style={{ fontSize: '.88rem' }}>Notifications ({unreadCount} new)</strong>
                    <button
                      onClick={() => setUserNotifs(ns => ns.map(n => ({ ...n, read: true })))}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '.75rem', cursor: 'pointer' }}
                    >
                      Mark read
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', maxHeight: '260px', overflowY: 'auto' }}>
                    {userNotifs.map(n => (
                      <div
                        key={n.id}
                        style={{
                          padding: '.6rem', borderRadius: '8px',
                          background: n.read ? 'rgba(255,255,255,.02)' : 'rgba(129,140,248,.1)',
                          border: `1px solid ${n.read ? 'transparent' : 'rgba(129,140,248,.25)'}`,
                          fontSize: '.8rem'
                        }}
                      >
                        <div style={{ fontWeight: 600, color: n.read ? 'var(--text)' : 'var(--accent)', marginBottom: '.2rem' }}>{n.title}</div>
                        <div style={{ color: 'var(--text-2)', lineHeight: 1.4 }}>{n.desc}</div>
                        <div style={{ fontSize: '.7rem', color: 'var(--text-3)', marginTop: '.3rem' }}>{n.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Profile Avatar Trigger */}
            <div
              className="topbar-user"
              onClick={() => setShowProfileModal(true)}
              style={{ cursor: 'pointer' }}
              title="View & Edit Student Profile"
            >
              <span className="topbar-avatar">{citizenName.charAt(0).toUpperCase()}</span>
              <span className="topbar-uname">{citizenName.split(' ')[0]}</span>
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
                <p>{profile.institution} · {profile.course} · Algorand TestNet App ID: <strong>{APP_ID}</strong></p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '.3rem' }}>
                <span className="welcome-date">{profile.studentId}</span>
                {aadhaarLinked && <span className="topbar-badge">🔒 Aadhaar XXXX-{profile.aadhaarLast4}</span>}
              </div>
            </div>

            <div className="kpi-grid">
              {[
                { label: 'Active Applications', val: String(myApps.filter(a => a.status !== 'Rejected').length), icon: '📝', cls: 'kpi-accent', action: () => setTab('applications') },
                { label: 'Tokens Available', val: String(tokens.filter(t => t.status === 'redeemable').length), icon: '💎', cls: '', action: () => setTab('onchain') },
                { label: 'Total Sanctioned', val: '₹' + myApps.filter(a => a.status === 'Approved').reduce((s, a) => s + a.amount, 0).toLocaleString(), icon: '💰', cls: '', action: null },
                { label: 'AI Trust Score', val: `${trustScore}/100`, icon: '🛡️', cls: 'kpi-accent', action: () => setTab('verify') },
                { label: 'Pending Review', val: String(myApps.filter(a => a.status === 'Pending Review').length) + ' apps', icon: '⏳', cls: 'kpi-warn', action: () => setTab('applications') },
                { label: 'Browse Eligible Schemes', val: String(SCHEMES.filter(s => s.status === 'active').length) + ' active', icon: '🔍', cls: '', action: () => setTab('browse') },
              ].map(k => (
                <div
                  key={k.label}
                  className={`kpi-card${k.cls ? ' ' + k.cls : ''}`}
                  onClick={k.action}
                  style={{ cursor: k.action ? 'pointer' : 'default' }}
                >
                  <div className="kpi-top">
                    <span className="kpi-label">{k.label}</span>
                    <span className="kpi-icon">{k.icon}</span>
                  </div>
                  <span className="kpi-val">{k.val}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1.4rem' }}>
              <div className="table-card" style={{ padding: '1.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span className="chart-title">Disbursement & Verification Timeline</span>
                  <button className="btn-sm btn-view" onClick={() => setTab('applications')}>View All Apps →</button>
                </div>
                <div className="timeline">
                  {[
                    { icon: '✅', title: 'Application Submitted', desc: `${myApps[0]?.scheme || 'Scholarship Scheme'} — ${myApps[0]?.id || 'APP-2026-000478'}`, time: 'Feb 03, 2026', state: 'done' },
                    { icon: '✅', title: 'AI Verification Passed', desc: `Trust Score: ${trustScore}/100 — UIDAI e-KYC, Marksheets & Income cleared`, time: 'Feb 03, 2026', state: 'done' },
                    { icon: '✅', title: 'Gov Officer Approved', desc: 'Approved by Sr. Officer Rajiv Sharma (OFF-001) under Central Guidelines', time: 'Feb 06, 2026', state: 'done' },
                    { icon: '✅', title: 'ASA Token Minted On-Chain', desc: 'Asset ID 78812341 · Algorand TestNet Block 31198432', time: 'Feb 08, 2026', state: 'done' },
                    { icon: tokens.some(t => t.status === 'redeemed') ? '✅' : '⏳', title: 'Token Distribution & Redemption', desc: tokens.some(t => t.status === 'redeemed') ? 'Successfully transferred to bank account' : 'Ready to redeem via On-Chain tab', time: tokens.some(t => t.status === 'redeemed') ? 'Completed' : 'Action Required', state: tokens.some(t => t.status === 'redeemed') ? 'done' : 'pending' },
                  ].map(t => (
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

              <div className="table-card" style={{ padding: '1.6rem', textAlign: 'center' }}>
                <span className="chart-title">Verified Identity Trust Score</span>
                <TrustGauge score={trustScore} />
                <div className="gauge-checks" style={{ marginTop: '1rem' }}>
                  {[
                    { label: 'Identity',    val: `Aadhaar XXXX-${profile.aadhaarLast4}`, ok: true },
                    { label: 'Documents',  val: 'Authentic (OCR 96%)', ok: true },
                    { label: 'Income',     val: `${profile.income} — Verified`, ok: true },
                    { label: 'Duplicates', val: 'Zero Matches Found', ok: true },
                    { label: 'Bank Account', val: profile.bankAcc.split('·')[0].trim(), ok: true },
                    { label: 'Institution', val: `${profile.institution} (Accredited)`, ok: true },
                  ].map(g => (
                    <div key={g.label} className="gc-item">
                      <span className="gc-label">{g.label}</span>
                      <span className={`gc-val ${g.ok ? 'ok' : 'warn'}`}>{g.val}</span>
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
              <div>
                <h2>Browse Scholarship Schemes</h2>
                <p>Discover government grants matching your academic credentials and financial background.</p>
              </div>
            </div>
            <div className="filter-bar">
              <input
                className="filter-input"
                placeholder="Search schemes by name, keyword, or criteria…"
                value={browseFilter}
                onChange={e => setBrowseFilter(e.target.value)}
              />
              <select
                className="filter-select"
                value={browseCategory}
                onChange={e => setBrowseCategory(e.target.value)}
              >
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
                    <span>📅 Deadline: {s.deadline}</span>
                  </div>
                  <div className="sc-footer">
                    <div className="sc-progress">
                      <div className="sc-progress-bar">
                        <div className="sc-progress-fill" style={{ width: `${s.filled}%` }}></div>
                      </div>
                      <span className="sc-pct">{s.filled}% filled</span>
                    </div>
                    <button
                      className="btn-sm btn-approve"
                      onClick={() => {
                        setApplyForm({
                          name: citizenName,
                          studentId: profile.studentId,
                          institution: profile.institution,
                          income: profile.income.replace(/[^0-9]/g, ''),
                          course: profile.course,
                          bankIfsc: profile.ifsc,
                          bankAcc: profile.bankAcc,
                        })
                        setApplyModal(s)
                      }}
                    >
                      Apply Now →
                    </button>
                  </div>
                </div>
              ))}
              {filteredSchemes.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '3rem', color: 'var(--text-2)' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                  <h3>No schemes found</h3>
                  <p>Try adjusting your search query or selecting a different category filter.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MY APPLICATIONS */}
        {tab === 'applications' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>My Applications ({myApps.length})</h2>
                <p>Track real-time approval status, AI verification flags, and disbursement stages.</p>
              </div>
              <button className="btn-primary" onClick={() => setTab('browse')}>+ Apply for New Scheme</button>
            </div>
            {myApps.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-2)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📝</div>
                <h3>No Applications Found</h3>
                <p>Browse eligible schemes and submit your first application.</p>
                <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={() => setTab('browse')}>Browse Schemes →</button>
              </div>
            ) : (
              <div className="apps-list">
                {myApps.map(a => (
                  <div key={a.id} className="my-app-card" style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr auto', alignItems: 'center', gap: '1rem' }}>
                    <div>
                      <div className="mac-scheme" style={{ fontWeight: 600 }}>{a.scheme}</div>
                      <div className="mac-date" style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
                        Application ID: {a.id} · Applied: {a.submittedAt || `${a.date}${a.time ? ` · ${a.time}` : ''}`}
                      </div>
                    </div>
                    <div>
                      <StatusBadge status={a.status} />
                    </div>
                    <div className="mac-amount" style={{ fontWeight: 700, color: '#10b981' }}>₹{a.amount.toLocaleString()}</div>
                    <div style={{ fontSize: '.8rem', color: 'var(--text-2)' }}>
                      🛡️ Score: <strong>{a.aiScore}/100</strong>
                    </div>
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      <button className="btn-sm btn-view" onClick={() => setAppDetail(a)}>View File</button>
                      <button className="btn-sm btn-view" onClick={() => downloadAcknowledgementSlip(a)} title="Download Slip">📄 Slip</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ON-CHAIN STATUS & MY TOKENS */}
        {tab === 'onchain' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>⛓️ On-Chain Status & Scholarship Tokens (ASA)</h2>
                <p>Algorand TestNet Smart Contract State · Redeem Disbursed Scholarship Tokens · App ID: <strong>{APP_ID}</strong></p>
              </div>
              <button
                className="btn-sm btn-view"
                onClick={() => { const a = walletAddr || loadAddress(); if (a) refreshChainStatus(a) }}
                disabled={chainLoading}
              >
                {chainLoading ? '↻ Loading…' : '↻ Refresh Chain'}
              </button>
            </div>

            {/* Wallet Connection Bar */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(79,70,229,.12), rgba(6,182,212,.08))',
              border: '1px solid rgba(129,140,248,.3)',
              borderRadius: '14px',
              padding: '1.2rem 1.4rem',
              marginBottom: '1.5rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '1rem',
            }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <span>◎</span> {walletAddr ? `Connected: ${walletAddr.slice(0, 8)}…${walletAddr.slice(-6)}` : 'Algorand TestNet Wallet'}
                  {walletAddr && (
                    <span style={{ fontSize: '.72rem', background: 'rgba(16,185,129,.15)', color: '#10b981', padding: '.2rem .55rem', borderRadius: '6px', fontWeight: 700 }}>
                      ✔ Connected ({getWalletLabel() || 'TestNet'})
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '.8rem', color: 'var(--text-2)', marginTop: '.25rem' }}>
                  {walletAddr
                    ? `Ready to execute smart contract operations on App ID ${APP_ID}`
                    : 'Connect via Pera Wallet (QR / Web) or select 1-click TestNet Student Wallet to opt-in and receive disbursements.'}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap' }}>
                {!walletAddr ? (
                  <>
                    <button
                      className="btn-primary"
                      style={{ fontSize: '.84rem', padding: '.55rem 1rem' }}
                      onClick={async () => {
                        try {
                          const a = await connectWallet()
                          setWalletAddr(a)
                          refreshChainStatus(a)
                          showToast('🔗 Connected via Pera Wallet!')
                        } catch (e) {
                          showToast(e.message, 'error')
                        }
                      }}
                    >
                      🔗 Connect Pera Wallet
                    </button>
                    <button
                      className="btn-sm btn-view"
                      style={{ fontSize: '.84rem', padding: '.55rem .9rem', background: 'rgba(79,70,229,.15)', color: 'var(--accent)', border: '1px solid rgba(129,140,248,.3)' }}
                      onClick={() => {
                        const a = connectDemoWallet('student')
                        setWalletAddr(a)
                        refreshChainStatus(a)
                        showToast('⚡ Connected with TestNet Student Wallet!')
                      }}
                    >
                      ⚡ 1-Click TestNet Wallet
                    </button>
                    <button
                      className="btn-sm btn-view"
                      style={{ fontSize: '.84rem', padding: '.55rem .8rem' }}
                      onClick={() => navigate('/wallet')}
                    >
                      Full Wallet Hub →
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="btn-sm btn-view"
                      style={{ fontSize: '.84rem' }}
                      onClick={() => navigate('/wallet')}
                    >
                      Open Wallet Hub ↗
                    </button>
                    <button
                      className="btn-sm btn-reject"
                      style={{ fontSize: '.84rem' }}
                      onClick={() => {
                        disconnectWallet()
                        setWalletAddr(null)
                        setChainStatus(null)
                        setChainOptedIn(false)
                        showToast('Wallet disconnected.')
                      }}
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            </div>

            {chainTx && (
              <div style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: '10px', padding: '.75rem 1rem', marginBottom: '1rem', color: '#10b981', fontSize: '.88rem' }}>
                ✅ Transaction confirmed!&nbsp;&nbsp;
                <a href={`https://testnet.algoexplorer.io/tx/${chainTx}`} target="_blank" rel="noreferrer" style={{ color: '#10b981', fontWeight: 600 }}>View on AlgoExplorer ↗</a>
              </div>
            )}
            {chainError && (
              <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: '10px', padding: '.75rem 1rem', marginBottom: '1rem', color: '#ef4444', fontSize: '.88rem' }}>
                ❌ {chainError}
              </div>
            )}

            {/* MY SCHOLARSHIP TOKENS (ASA) SECTION */}
            <div className="table-card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.05rem', marginBottom: '.2rem' }}>💎 My Sanctioned Scholarship Tokens (ASA)</h3>
                  <p style={{ fontSize: '.82rem', color: 'var(--text-2)' }}>
                    Each token represents a legally binding treasury commitment minted on Algorand.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
                {tokens.map(t => (
                  <div
                    key={t.id}
                    style={{
                      display: 'grid', gridTemplateColumns: '2fr 1.2fr 1fr 1fr auto', alignItems: 'center', gap: '1rem',
                      padding: '1rem', background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: '10px'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '.92rem' }}>{t.scheme}</div>
                      <div style={{ fontSize: '.76rem', color: 'var(--text-3)', marginTop: '.2rem' }}>
                        Token ID: <code>{t.id}</code> {t.assetId ? `· ASA #${t.assetId}` : ''}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>GRANT AMOUNT</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#10b981' }}>₹{t.amount.toLocaleString()}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>STATUS</div>
                      <span style={{
                        display: 'inline-block', fontSize: '.75rem', fontWeight: 700, padding: '.25rem .6rem', borderRadius: '6px',
                        background: t.status === 'redeemable' ? 'rgba(16,185,129,.15)' : t.status === 'redeemed' ? 'rgba(59,130,246,.15)' : 'rgba(245,158,11,.15)',
                        color: t.status === 'redeemable' ? '#10b981' : t.status === 'redeemed' ? '#60a5fa' : '#f59e0b'
                      }}>
                        {t.status === 'redeemable' ? '🟢 Redeemable' : t.status === 'redeemed' ? '✔ Redeemed' : '⏳ Pending Approval'}
                      </span>
                    </div>
                    <div style={{ fontSize: '.78rem', color: 'var(--text-2)' }}>
                      {t.txHash ? (
                        <a
                          href={`https://testnet.algoexplorer.io/tx/${t.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: 'var(--accent)', textDecoration: 'none' }}
                        >
                          Txn Proof ↗
                        </a>
                      ) : (
                        <span style={{ color: 'var(--text-3)' }}>Awaiting Mint</span>
                      )}
                    </div>
                    <div>
                      {t.status === 'redeemable' ? (
                        <button
                          className="btn-primary"
                          style={{ padding: '.45rem .9rem', fontSize: '.82rem' }}
                          onClick={() => setRedeemModal(t)}
                        >
                          Redeem Token →
                        </button>
                      ) : t.status === 'redeemed' ? (
                        <button
                          className="btn-sm btn-view"
                          onClick={() => downloadRedemptionReceipt(t)}
                        >
                          📄 Receipt
                        </button>
                      ) : (
                        <button className="btn-sm btn-view" disabled style={{ opacity: 0.6 }}>
                          Pending
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Smart Contract Interaction Panels */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
              {/* Status panel */}
              <div className="table-card" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1.2rem', fontSize: '1rem' }}>Your Contract Status</h3>
                {!chainOptedIn ? (
                  <div style={{ color: 'var(--text-2)', fontSize: '.9rem', marginBottom: '1rem' }}>
                    You have not opted in to this app yet.<br />Follow Step 1 on the right to participate.
                  </div>
                ) : chainStatus ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', marginBottom: '1.2rem' }}>
                    {[
                      { label: 'Opted In to Contract', ok: true },
                      { label: 'Student Registered', ok: chainStatus.isRegistered },
                      { label: 'Milestone Completed', ok: chainStatus.milestoneCompleted },
                      { label: 'Payout Inner Txn Sent', ok: chainStatus.hasBeenPaid },
                    ].map(s => (
                      <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '.5rem .85rem', background: 'var(--bg)', borderRadius: '9px', border: '1px solid var(--border-2)' }}>
                        <span style={{ color: 'var(--text-2)', fontSize: '.88rem' }}>{s.label}</span>
                        <span style={{ color: s.ok ? '#10b981' : '#94a3b8', fontWeight: 700, fontSize: '.88rem' }}>{s.ok ? '✔ Yes' : '✗ No'}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {chainStatus?.hasBeenPaid && (
                  <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)', borderRadius: '10px', padding: '1rem', textAlign: 'center', color: '#10b981', fontWeight: 700, fontSize: '.9rem' }}>
                    🎉 Scholarship payout has been confirmed on the Algorand blockchain!
                  </div>
                )}
              </div>

              {/* Action panel */}
              <div className="table-card" style={{ padding: '1.5rem' }}>
                <h3 style={{ marginBottom: '1.2rem', fontSize: '1rem' }}>On-Chain Lifecycle Actions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
                  {/* Step 1: Opt in */}
                  <div>
                    <div style={{ fontSize: '.78rem', color: 'var(--text-2)', marginBottom: '.4rem', letterSpacing: '.04em', textTransform: 'uppercase' }}>Step 1 — Opt In to App</div>
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
                    <div style={{ fontSize: '.78rem', color: 'var(--text-2)', marginBottom: '.4rem', letterSpacing: '.04em', textTransform: 'uppercase' }}>Step 2 — Register as Student</div>
                    <button
                      className="btn-primary w-full"
                      disabled={!!chainAction || !chainOptedIn || chainStatus?.isRegistered}
                      onClick={() => runChainAction('Registering…', (addr, signer) => registerStudent(addr, signer))}
                    >
                      {chainAction === 'Registering…' ? chainAction : chainStatus?.isRegistered ? '✔ Already Registered' : '📝 Register Student'}
                    </button>
                  </div>

                  {/* Reset demo onchain state */}
                  <div style={{ borderTop: '1px solid var(--border-2)', paddingTop: '.85rem', marginTop: '.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '.75rem', color: 'var(--text-3)' }}>Testing lifecycle again?</span>
                    <button
                      type="button"
                      className="btn-sm"
                      style={{ fontSize: '.75rem', padding: '.3rem .65rem', background: 'rgba(239,68,68,.12)', color: '#f87171', border: '1px solid rgba(239,68,68,.25)' }}
                      onClick={() => {
                        const addr = walletAddr || loadAddress()
                        if (addr) {
                          resetOnChainDemo(addr)
                          setChainOptedIn(false)
                          setChainStatus(null)
                          setChainTx(null)
                          setChainError(null)
                          showToast('🔄 Demo on-chain state reset to Step 1.')
                        }
                      }}
                    >
                      🔄 Reset Demo Lifecycle
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AI VERIFY */}
        {tab === 'verify' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>AI Verify Me</h2>
                <p>Run your identity and credentials through the 7-step automated verification pipeline.</p>
              </div>
              <button className="btn-sm btn-view" onClick={() => navigate('/ai-verify')}>
                Open Full AI Engine →
              </button>
            </div>

            {/* ─── Demo Student Details Card ───────────────────────── */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem', marginBottom: '1.5rem'
            }}>
              <div className="table-card" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.85rem', marginBottom: '1.2rem' }}>
                  <div style={{
                    width: '52px', height: '52px', borderRadius: '50%',
                    background: 'linear-gradient(135deg, #818CF8, #6366F1)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1.4rem', color: '#fff', fontWeight: 800, flexShrink: 0
                  }}>
                    {profile.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{profile.name}</div>
                    <div style={{ fontSize: '.82rem', color: 'var(--text-2)' }}>{profile.studentId} · {profile.institution}</div>
                  </div>
                  <div style={{
                    marginLeft: 'auto', background: aadhaarLinked ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
                    color: aadhaarLinked ? '#10b981' : '#ef4444',
                    padding: '.3rem .75rem', borderRadius: '8px', fontSize: '.76rem', fontWeight: 700
                  }}>
                    {aadhaarLinked ? '✔ e-KYC Linked' : '✗ Not Verified'}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
                  {[
                    { label: 'Course & Branch', value: profile.course },
                    { label: 'CGPA / Marks', value: profile.cgpa },
                    { label: 'Annual Family Income', value: profile.income },
                    { label: 'Bank Account', value: profile.bankAcc },
                    { label: 'Aadhaar (Last 4)', value: `XXXX-XXXX-${profile.aadhaarLast4}` },
                    { label: 'IFSC Code', value: profile.ifsc },
                  ].map(row => (
                    <div key={row.label} style={{
                      padding: '.6rem .85rem', background: 'var(--bg)',
                      border: '1px solid var(--border-2)', borderRadius: '9px'
                    }}>
                      <div style={{ fontSize: '.7rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.2rem' }}>{row.label}</div>
                      <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{row.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Uploaded Documents Summary */}
              <div className="table-card" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontSize: '1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}>
                  📂 Uploaded Documents
                  <span style={{
                    marginLeft: 'auto', fontSize: '.75rem', fontWeight: 700,
                    background: Object.values(verifyUploads).every(v => v) ? 'rgba(16,185,129,.12)' : 'rgba(245,158,11,.12)',
                    color: Object.values(verifyUploads).every(v => v) ? '#10b981' : '#f59e0b',
                    padding: '.25rem .65rem', borderRadius: '7px'
                  }}>
                    {Object.values(verifyUploads).filter(v => v).length}/4 Ready
                  </span>
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.65rem' }}>
                  {[
                    { key: 'aadhaar', label: 'Aadhaar Card (e-KYC)', icon: '🪪', demoFile: 'aadhaar_ekyc_XXXX4821.pdf', demoSize: '248 KB' },
                    { key: 'marksheet', label: 'Academic Marksheet', icon: '📋', demoFile: 'BITS_Pilani_sem6_marksheet.pdf', demoSize: '1.2 MB' },
                    { key: 'income', label: 'Income Certificate', icon: '💰', demoFile: 'income_cert_FY2025-26.pdf', demoSize: '186 KB' },
                    { key: 'bank', label: 'Bank Statement / Passbook', icon: '🏦', demoFile: 'HDFC_statement_Q4.pdf', demoSize: '420 KB' },
                  ].map(doc => (
                    <div key={doc.key} style={{
                      display: 'flex', alignItems: 'center', gap: '.75rem',
                      padding: '.7rem .85rem', background: 'var(--bg)',
                      border: `1px solid ${verifyUploads[doc.key] ? 'rgba(16,185,129,.3)' : 'var(--border-2)'}`,
                      borderRadius: '10px', transition: 'all .2s'
                    }}>
                      <span style={{ fontSize: '1.2rem' }}>{verifyUploads[doc.key] ? '✅' : doc.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '.85rem', fontWeight: 600 }}>{doc.label}</div>
                        {verifyUploads[doc.key] ? (
                          <div style={{ fontSize: '.74rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '.4rem', marginTop: '.15rem' }}>
                            📄 {doc.demoFile} <span style={{ color: 'var(--text-3)' }}>({doc.demoSize})</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: '.74rem', color: 'var(--text-3)', marginTop: '.15rem' }}>Not uploaded yet</div>
                        )}
                      </div>
                      <label style={{
                        background: verifyUploads[doc.key] ? 'rgba(239,68,68,.1)' : 'rgba(129,140,248,.1)',
                        color: verifyUploads[doc.key] ? '#ef4444' : 'var(--accent)',
                        padding: '.35rem .7rem', borderRadius: '7px',
                        fontSize: '.78rem', fontWeight: 600, cursor: 'pointer',
                        border: `1px solid ${verifyUploads[doc.key] ? 'rgba(239,68,68,.2)' : 'rgba(129,140,248,.25)'}`,
                        transition: 'all .2s'
                      }}>
                        {verifyUploads[doc.key] ? '✕ Remove' : '📤 Upload'}
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          style={{ display: 'none' }}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) {
                              setVerifyUploads(u => ({ ...u, [doc.key]: true }))
                              showToast(`✅ Uploaded: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`)
                            }
                            e.target.value = ''
                          }}
                          onClick={(e) => {
                            if (verifyUploads[doc.key]) {
                              e.preventDefault()
                              setVerifyUploads(u => ({ ...u, [doc.key]: false }))
                              showToast(`Removed ${doc.label}`)
                            }
                          }}
                        />
                      </label>
                    </div>
                  ))}
                </div>
                {!Object.values(verifyUploads).every(v => v) && (
                  <div style={{
                    marginTop: '.85rem', padding: '.65rem .85rem', borderRadius: '9px',
                    background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.18)',
                    fontSize: '.8rem', color: '#f59e0b', lineHeight: 1.5
                  }}>
                    ⚠️ Upload all 4 documents before running the AI verification pipeline for full trust score.
                  </div>
                )}
              </div>
            </div>

            {/* ─── Verification Pipeline + Trust Score ─────────────── */}
            <div className="ai-verify-layout">
              <div className="verify-steps-card">
                <h3>Verification Pipeline</h3>

                {/* Drag & Drop Upload Zone */}
                <div
                  style={{
                    marginBottom: '1.5rem', padding: '1.2rem',
                    border: '2px dashed var(--border-2)', borderRadius: '12px',
                    textAlign: 'center', cursor: 'pointer',
                    background: 'var(--bg)', transition: 'all .2s'
                  }}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = '#818CF8'; e.currentTarget.style.background = 'rgba(129,140,248,.05)' }}
                  onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-2)'; e.currentTarget.style.background = 'var(--bg)' }}
                  onDrop={(e) => {
                    e.preventDefault()
                    e.currentTarget.style.borderColor = 'var(--border-2)'
                    e.currentTarget.style.background = 'var(--bg)'
                    const files = Array.from(e.dataTransfer.files)
                    if (files.length > 0) {
                      const keys = ['aadhaar', 'marksheet', 'income', 'bank']
                      const emptyKeys = keys.filter(k => !verifyUploads[k])
                      files.forEach((f, idx) => {
                        if (idx < emptyKeys.length) {
                          setVerifyUploads(u => ({ ...u, [emptyKeys[idx]]: true }))
                        }
                      })
                      showToast(`📤 ${files.length} file(s) attached for verification`)
                    }
                  }}
                  onClick={() => {
                    const fileInput = document.createElement('input')
                    fileInput.type = 'file'
                    fileInput.accept = '.pdf,.jpg,.jpeg,.png'
                    fileInput.multiple = true
                    fileInput.onchange = (evt) => {
                      const files = Array.from(evt.target.files)
                      if (files.length > 0) {
                        const keys = ['aadhaar', 'marksheet', 'income', 'bank']
                        const emptyKeys = keys.filter(k => !verifyUploads[k])
                        files.forEach((f, idx) => {
                          if (idx < emptyKeys.length) {
                            setVerifyUploads(u => ({ ...u, [emptyKeys[idx]]: true }))
                          }
                        })
                        showToast(`📤 ${files.length} file(s) attached for verification`)
                      }
                    }
                    fileInput.click()
                  }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '.4rem', opacity: .7 }}>📁</div>
                  <div style={{ fontSize: '.88rem', fontWeight: 600, color: 'var(--text-1)' }}>
                    Drag & Drop documents here
                  </div>
                  <div style={{ fontSize: '.78rem', color: 'var(--text-3)', marginTop: '.25rem' }}>
                    or click to browse — accepts PDF, JPG, PNG
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
                {!verifyRunning && (
                  <button className="btn-primary w-full" style={{ marginTop: '1.2rem' }} onClick={runVerify}>
                    🤖 {verifyDone ? 'Re-run AI Verification Pipeline' : 'Start AI Verification'}
                  </button>
                )}
                {verifyRunning && (
                  <div style={{ textAlign: 'center', marginTop: '1rem', color: 'var(--accent)', fontWeight: 600 }}>
                    ⚡ Analyzing credentials: step {verifyStep + 1} of {AI_STEPS.length}…
                  </div>
                )}
              </div>

              <div className="verify-progress-card">
                <h3>Verification Score & Proof</h3>
                <TrustGauge score={trustScore} />
                {verifyDone ? (
                  <>
                    <div className="verify-result success" style={{ marginTop: '1rem' }}>
                      ✅ Verification Passed — Trust Score: {trustScore}/100
                    </div>
                    <div style={{ fontSize: '.78rem', color: 'var(--text-2)', marginTop: '.8rem', lineHeight: 1.6 }}>
                      Identity cryptographically authenticated against UIDAI and National Academic Depository.<br />
                      <span style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>
                        TXID: V7KQMN3PXRWSTF4DHJBL8CGAZE2YNI6OULM5Q3P
                      </span>
                    </div>

                    {/* Verification Breakdown */}
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.45rem' }}>
                      {[
                        { label: 'UIDAI e-KYC Match', score: '98%', color: '#10b981' },
                        { label: 'Academic Record Validity', score: '96%', color: '#10b981' },
                        { label: 'Forgery Detection', score: 'CLEAR', color: '#10b981' },
                        { label: 'Duplicate Identity Check', score: 'UNIQUE', color: '#10b981' },
                        { label: 'Income Cross-Reference', score: '91%', color: '#f59e0b' },
                      ].map(item => (
                        <div key={item.label} style={{
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          padding: '.45rem .7rem', background: 'var(--bg)',
                          border: '1px solid var(--border-2)', borderRadius: '7px', fontSize: '.8rem'
                        }}>
                          <span style={{ color: 'var(--text-2)' }}>{item.label}</span>
                          <span style={{ fontWeight: 700, color: item.color, fontFamily: 'monospace' }}>{item.score}</span>
                        </div>
                      ))}
                    </div>

                    <button
                      className="btn-primary w-full"
                      style={{ marginTop: '1rem' }}
                      onClick={() => navigate('/ai-verify')}
                    >
                      View Detailed Model Diagnostics →
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ color: 'var(--text-2)', fontSize: '.88rem', paddingTop: '1rem', lineHeight: 1.6 }}>
                      All 4 credentials are required for autonomous on-chain pre-approval. Click <strong>"Start AI Verification"</strong> to initiate real-time optical character recognition, forgery analysis, and vector duplicate screening.
                    </div>
                    {/* Pre-verification Checklist */}
                    <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
                      {[
                        { label: 'Aadhaar e-KYC', done: verifyUploads.aadhaar },
                        { label: 'Academic Marksheet', done: verifyUploads.marksheet },
                        { label: 'Income Certificate', done: verifyUploads.income },
                        { label: 'Bank Statement', done: verifyUploads.bank },
                      ].map(c => (
                        <div key={c.label} style={{
                          display: 'flex', alignItems: 'center', gap: '.5rem',
                          padding: '.4rem .65rem', borderRadius: '7px',
                          background: c.done ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.04)',
                          border: `1px solid ${c.done ? 'rgba(16,185,129,.18)' : 'rgba(239,68,68,.12)'}`,
                          fontSize: '.82rem'
                        }}>
                          <span>{c.done ? '✅' : '⬜'}</span>
                          <span style={{ color: c.done ? '#10b981' : 'var(--text-3)' }}>{c.label}</span>
                          <span style={{ marginLeft: 'auto', fontSize: '.72rem', fontWeight: 600, color: c.done ? '#10b981' : '#ef4444' }}>
                            {c.done ? 'UPLOADED' : 'PENDING'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* APPLY MODAL */}
      {applyModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setApplyModal(null)}>
          <div className="modal-box" style={{ maxWidth: '600px', padding: '2.4rem 2rem', borderRadius: '20px' }}>
            <button className="modal-close" onClick={() => setApplyModal(null)}>✕</button>
            <div className="modal-title">Apply — {applyModal.name}</div>
            <div className="modal-sub">Amount: ₹{applyModal.amount?.toLocaleString()} · Deadline: {applyModal.deadline}</div>
            <div className="modal-form">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Full Legal Name *</label>
                  <input
                    type="text"
                    value={applyForm.name}
                    onChange={e => setApplyForm({ ...applyForm, name: e.target.value })}
                    placeholder="Your legal name"
                  />
                </div>
                <div className="form-group">
                  <label>Student ID</label>
                  <input
                    type="text"
                    value={applyForm.studentId}
                    readOnly
                    style={{ opacity: 0.7, fontFamily: 'monospace' }}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Enrolled Institution / College *</label>
                <input
                  type="text"
                  value={applyForm.institution}
                  onChange={e => setApplyForm({ ...applyForm, institution: e.target.value })}
                  placeholder="Full college/university name"
                />
              </div>

              <div className="form-group">
                <label>Course / Program Specialization</label>
                <input
                  type="text"
                  value={applyForm.course}
                  onChange={e => setApplyForm({ ...applyForm, course: e.target.value })}
                  placeholder="e.g. B.E. Electronics & Communication Engineering"
                />
              </div>

              <div className="form-group">
                <label>Family Annual Income (₹) *</label>
                <input
                  type="number"
                  value={applyForm.income}
                  onChange={e => setApplyForm({ ...applyForm, income: e.target.value })}
                  placeholder="e.g. 420000"
                />
              </div>

              <div style={{ background: 'var(--bg)', border: '1px solid var(--border-2)', borderRadius: '10px', padding: '.85rem 1rem', fontSize: '.84rem', color: 'var(--text-2)', lineHeight: 1.5 }}>
                <strong>Eligibility Criteria:</strong> {applyModal.criteria}
              </div>

              <div style={{ display: 'flex', gap: '.85rem', marginTop: '.5rem' }}>
                <button
                  type="button"
                  style={{
                    flex: 2,
                    background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '.8rem 1.4rem',
                    fontWeight: 700,
                    fontSize: '.92rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(79,70,229,.35)'
                  }}
                  onClick={handleSubmitApplication}
                >
                  Submit Application →
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    background: 'var(--card-bg, rgba(255,255,255,.05))',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border-2)',
                    borderRadius: '10px',
                    padding: '.8rem 1.2rem',
                    fontWeight: 600,
                    fontSize: '.92rem',
                    cursor: 'pointer'
                  }}
                  onClick={() => setApplyModal(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* APPLICATION DETAIL MODAL */}
      {appDetail && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAppDetail(null)}>
          <div className="modal-box" style={{ maxWidth: '600px', padding: '2.4rem 2rem', borderRadius: '20px' }}>
            <button className="modal-close" onClick={() => setAppDetail(null)}>✕</button>
            <div className="modal-title">Application Dossier</div>
            <div className="modal-sub">ID: {appDetail.id} · Applied: {appDetail.date}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginTop: '1.2rem' }}>
              {[
                { label: 'Scheme', val: appDetail.scheme },
                { label: 'Sanctioned Amount', val: `₹${appDetail.amount.toLocaleString()}` },
                { label: 'Current Status', val: appDetail.status },
                { label: 'AI Score', val: `${appDetail.aiScore}/100` },
                { label: 'Institution', val: profile.institution },
                { label: 'Remarks', val: appDetail.remarks || 'None' },
              ].map(item => (
                <div key={item.label} style={{ padding: '.75rem', background: 'var(--bg)', borderRadius: '10px', border: '1px solid var(--border-2)' }}>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.25rem' }}>{item.label}</div>
                  <div style={{ fontSize: '.88rem', fontWeight: 600 }}>{item.val}</div>
                </div>
              ))}
            </div>

            {appDetail.status === 'Approved' && (
              <div style={{ background: 'rgba(16,185,129,.08)', border: '1px solid rgba(16,185,129,.25)', borderRadius: '10px', padding: '.85rem 1rem', marginTop: '1rem', color: '#10b981', fontSize: '.85rem', textAlign: 'center', fontWeight: 600 }}>
                🎉 Application approved! Token minted on Algorand. Check "On-Chain & Tokens" tab to redeem.
              </div>
            )}
            {appDetail.status === 'Rejected' && (
              <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', borderRadius: '10px', padding: '.85rem 1rem', marginTop: '1rem', color: '#ef4444', fontSize: '.85rem' }}>
                ❌ <strong>Reason:</strong> {appDetail.remarks}
              </div>
            )}

            <div style={{ display: 'flex', gap: '.85rem', marginTop: '1.25rem' }}>
              <button
                type="button"
                style={{
                  flex: 2,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '.8rem 1.4rem',
                  fontWeight: 700,
                  fontSize: '.92rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(79,70,229,.35)'
                }}
                onClick={() => downloadAcknowledgementSlip(appDetail)}
              >
                📄 Download Slip
              </button>
              {appDetail.status === 'Pending Review' && (
                <button
                  type="button"
                  style={{
                    flex: 1,
                    background: 'rgba(239,68,68,.1)',
                    color: '#ef4444',
                    border: '1px solid rgba(239,68,68,.25)',
                    borderRadius: '10px',
                    padding: '.8rem 1rem',
                    fontWeight: 600,
                    fontSize: '.92rem',
                    cursor: 'pointer'
                  }}
                  onClick={() => handleWithdrawApp(appDetail.id)}
                >
                  Withdraw App
                </button>
              )}
              <button
                type="button"
                style={{
                  flex: 1,
                  background: 'var(--card-bg, rgba(255,255,255,.05))',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border-2)',
                  borderRadius: '10px',
                  padding: '.8rem 1.2rem',
                  fontWeight: 600,
                  fontSize: '.92rem',
                  cursor: 'pointer'
                }}
                onClick={() => setAppDetail(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TOKEN REDEEM MODAL */}
      {redeemModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setRedeemModal(null)}>
          <div className="modal-box" style={{ maxWidth: '540px', padding: '2.4rem 2rem', borderRadius: '20px' }}>
            <button className="modal-close" onClick={() => setRedeemModal(null)}>✕</button>
            <div className="modal-title">Redeem Scholarship Token</div>
            <div className="modal-sub">Token: {redeemModal.id} · Amount: ₹{redeemModal.amount.toLocaleString()}</div>

            <div style={{ margin: '1.25rem 0' }}>
              <label style={{ fontSize: '.84rem', fontWeight: 600, color: 'var(--text-2)', display: 'block', marginBottom: '.6rem' }}>
                Choose Redemption Channel
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                <label
                  style={{
                    display: 'flex', alignItems: 'center', gap: '.85rem', padding: '.9rem',
                    background: redeemMethod === 'bank' ? 'rgba(0,232,198,.08)' : 'var(--bg)',
                    border: `1px solid ${redeemMethod === 'bank' ? 'var(--accent)' : 'var(--border-2)'}`,
                    borderRadius: '10px', cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="redeemMethod"
                    checked={redeemMethod === 'bank'}
                    onChange={() => setRedeemMethod('bank')}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.9rem' }}>🏦 Direct Bank Deposit (PFMS / DBT)</div>
                    <div style={{ fontSize: '.78rem', color: 'var(--text-3)', marginTop: '.15rem' }}>
                      Credits to {profile.bankAcc} (IFSC: {profile.ifsc})
                    </div>
                  </div>
                </label>

                <label
                  style={{
                    display: 'flex', alignItems: 'center', gap: '.85rem', padding: '.9rem',
                    background: redeemMethod === 'escrow' ? 'rgba(0,232,198,.08)' : 'var(--bg)',
                    border: `1px solid ${redeemMethod === 'escrow' ? 'var(--accent)' : 'var(--border-2)'}`,
                    borderRadius: '10px', cursor: 'pointer'
                  }}
                >
                  <input
                    type="radio"
                    name="redeemMethod"
                    checked={redeemMethod === 'escrow'}
                    onChange={() => setRedeemMethod('escrow')}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '.9rem' }}>🎓 College Tuition Escrow Account</div>
                    <div style={{ fontSize: '.78rem', color: 'var(--text-3)', marginTop: '.15rem' }}>
                      Directly offsets semester fees at {profile.institution}
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,.03)', padding: '.75rem 1rem', borderRadius: '10px', fontSize: '.78rem', color: 'var(--text-3)', marginBottom: '1.2rem', lineHeight: 1.5 }}>
              🔒 Cryptographically anchored via Algorand TestNet inner transaction. Zero intermediary deductions.
            </div>

            <div style={{ display: 'flex', gap: '.85rem' }}>
              <button
                type="button"
                style={{
                  flex: 2,
                  background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '10px',
                  padding: '.8rem 1.4rem',
                  fontWeight: 700,
                  fontSize: '.92rem',
                  cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(79,70,229,.35)'
                }}
                disabled={redeeming}
                onClick={handleConfirmRedeem}
              >
                {redeeming ? '⏳ Processing On-Chain Redemption…' : `Confirm Redemption (₹${redeemModal.amount.toLocaleString()})`}
              </button>
              <button
                type="button"
                style={{
                  flex: 1,
                  background: 'var(--card-bg, rgba(255,255,255,.05))',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border-2)',
                  borderRadius: '10px',
                  padding: '.8rem 1.2rem',
                  fontWeight: 600,
                  fontSize: '.92rem',
                  cursor: 'pointer'
                }}
                onClick={() => setRedeemModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STUDENT PROFILE & CREDENTIALS MODAL */}
      {showProfileModal && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowProfileModal(false)}>
          <div className="modal-box" style={{ maxWidth: '640px', padding: '2.4rem 2.2rem', borderRadius: '22px' }}>
            <button className="modal-close" onClick={() => setShowProfileModal(false)}>✕</button>

            {/* Profile Hero Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.6rem', paddingBottom: '1.4rem', borderBottom: '1px solid var(--border-2)' }}>
              <div style={{
                width: '68px', height: '68px', borderRadius: '50%',
                background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                color: '#fff', fontSize: '1.9rem', fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(79,70,229,.3)', flexShrink: 0
              }}>
                {profile.name.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)', margin: 0 }}>{profile.name}</h3>
                  <span style={{ fontSize: '.75rem', fontWeight: 700, padding: '.22rem .65rem', borderRadius: '20px', background: 'rgba(16,185,129,.12)', color: '#10b981', border: '1px solid rgba(16,185,129,.25)' }}>
                    ✔ Verified Student
                  </span>
                </div>
                <div style={{ fontSize: '.84rem', color: 'var(--text-3)', marginTop: '.35rem', display: 'flex', gap: '.8rem', flexWrap: 'wrap' }}>
                  <span>Roll: <strong style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>{profile.studentId}</strong></span>
                  <span>•</span>
                  <span>CGPA: <strong style={{ color: 'var(--text)' }}>{profile.cgpa}</strong></span>
                  <span>•</span>
                  <span>Status: <strong style={{ color: '#10b981' }}>Active Beneficiary</strong></span>
                </div>
              </div>
            </div>

            <div className="modal-form">
              {/* Personal & Academic Details */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text-2)' }}>
                      👤 Full Legal Name
                    </label>
                    <input
                      type="text"
                      value={profile.name}
                      onChange={e => setProfile({ ...profile, name: e.target.value })}
                      placeholder="Enter legal name"
                    />
                  </div>
                  <div className="form-group">
                    <label style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text-2)' }}>
                      📱 Contact Number
                    </label>
                    <input
                      type="text"
                      value={profile.phone}
                      onChange={e => setProfile({ ...profile, phone: e.target.value })}
                      placeholder="+91 Mobile number"
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text-2)' }}>
                    🏛️ Enrolled Institution / University
                  </label>
                  <input
                    type="text"
                    value={profile.institution}
                    onChange={e => setProfile({ ...profile, institution: e.target.value })}
                    placeholder="Full institution name"
                  />
                </div>

                <div className="form-group">
                  <label style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text-2)' }}>
                    🎓 Degree Program & Specialization
                  </label>
                  <input
                    type="text"
                    value={profile.course}
                    onChange={e => setProfile({ ...profile, course: e.target.value })}
                    placeholder="e.g. B.E. Electronics & Communication Engineering"
                  />
                </div>
              </div>

              {/* Verified & Locked Blockchain Credentials Card */}
              <div style={{
                marginTop: '1.2rem',
                background: 'rgba(0, 232, 198, 0.04)',
                border: '1px solid rgba(0, 232, 198, 0.18)',
                borderRadius: '14px',
                padding: '1.1rem 1.25rem'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.85rem' }}>
                  <div style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '.4rem', textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    🔒 Verified Blockchain & Banking Credentials
                  </div>
                  <span style={{ fontSize: '.72rem', color: '#10b981', fontWeight: 600, background: 'rgba(16,185,129,.1)', padding: '.2rem .5rem', borderRadius: '6px' }}>
                    Immutable
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', fontSize: '.84rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.65rem .85rem', background: 'var(--bg)', borderRadius: '9px', border: '1px solid var(--border-2)' }}>
                    <div>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>AADHAAR e-KYC NUMBER</div>
                      <div style={{ fontWeight: 600, fontFamily: 'monospace', letterSpacing: '.05em' }}>XXXX-XXXX-{profile.aadhaarLast4}</div>
                    </div>
                    <span style={{ fontSize: '.75rem', color: '#10b981', fontWeight: 700 }}>✔ UIDAI Authenticated</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.65rem .85rem', background: 'var(--bg)', borderRadius: '9px', border: '1px solid var(--border-2)' }}>
                    <div>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>DISBURSEMENT BANK ACCOUNT (DBT / PFMS)</div>
                      <div style={{ fontWeight: 600 }}>{profile.bankAcc} <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>· IFSC: {profile.ifsc}</span></div>
                    </div>
                    <span style={{ fontSize: '.75rem', color: '#10b981', fontWeight: 700 }}>✔ Direct Benefit Transfer Active</span>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '.65rem .85rem', background: 'var(--bg)', borderRadius: '9px', border: '1px solid var(--border-2)' }}>
                    <div>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)' }}>ANNUAL FAMILY INCOME</div>
                      <div style={{ fontWeight: 600 }}>{profile.income}</div>
                    </div>
                    <span style={{ fontSize: '.75rem', color: '#10b981', fontWeight: 700 }}>✔ Income Certificate Cleared</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '.85rem', marginTop: '1.4rem' }}>
                <button
                  type="button"
                  onClick={handleSaveProfile}
                  style={{
                    flex: 2,
                    background: 'linear-gradient(135deg, #4f46e5 0%, #06b6d4 100%)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '.8rem 1.4rem',
                    fontWeight: 700,
                    fontSize: '.92rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 16px rgba(79,70,229,.35)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '.4rem'
                  }}
                >
                  💾 Save Profile Changes
                </button>
                <button
                  type="button"
                  onClick={() => setShowProfileModal(false)}
                  style={{
                    flex: 1,
                    background: 'var(--card-bg, rgba(255,255,255,.05))',
                    color: 'var(--text-2)',
                    border: '1px solid var(--border-2)',
                    borderRadius: '10px',
                    padding: '.8rem 1.2rem',
                    fontWeight: 600,
                    fontSize: '.92rem',
                    cursor: 'pointer'
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE APP BOTTOM NAVIGATION DOCK */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            className={`mb-item${tab === t.id ? ' active' : ''}`}
            onClick={() => {
              setTab(t.id)
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
          >
            <span className="mb-icon">
              {t.icon}
              {t.id === 'applications' && myApps.length > 0 && (
                <span className="mb-badge">{myApps.length}</span>
              )}
            </span>
            <span className="mb-label">{t.label.replace('My ', '')}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
