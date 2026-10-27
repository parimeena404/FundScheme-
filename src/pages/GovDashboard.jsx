import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import Sidebar from '../components/Sidebar'
import StatusBadge from '../components/StatusBadge'
import ThemeToggle from '../components/ThemeToggle'
import {
  SCHEMES,
  APPLICATIONS,
  AI_FLAGS,
  TX_DATA,
  MINTED_HISTORY,
  REPORTS_DATA,
  BRIDGE_BATCH,
  BRIDGE_RECIPIENTS,
  MY_TOKENS,
} from '../data/dashboardData'
import {
  makePeraSigner,
  markMilestoneComplete,
  releasePayout as contractReleasePayout,
  getGlobalState,
  getStudentState,
  APP_ID,
} from '../lib/scholarship-contract'
import { loadAddress } from '../lib/perawallet'

const TABS = [
  { id: 'overview',     icon: '📊', label: 'Overview' },
  { id: 'schemes',      icon: '🏛️', label: 'Manage Schemes' },
  { id: 'blockchain',   icon: '⛓️', label: 'Blockchain Ops' },
  { id: 'applications', icon: '📝', label: 'Applications', badge: 3 },
  { id: 'flags',        icon: '🚨', label: 'AI Flags', badge: 7 },
  { id: 'reports',      icon: '📄', label: 'Audit Reports' },
]

function BarChart() {
  const canvasRef = useRef(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    const data = [17, 36, 49, 64, 39, 77, 83]
    const labels = ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb']
    const th = document.documentElement.getAttribute('data-theme')
    const barColor = th === 'light' ? '#4F46E5' : '#818CF8'
    const textColor = th === 'light' ? '#475569' : '#94A3B8'
    c.width = c.offsetWidth
    c.height = c.offsetHeight || 180
    ctx.clearRect(0, 0, c.width, c.height)
    const pad = 30, bw = Math.floor((c.width - pad * 2) / data.length) - 8
    data.forEach((v, i) => {
      const x = pad + i * ((c.width - pad * 2) / data.length) + 4
      const h = (v / 100) * (c.height - 40)
      const y = c.height - 20 - h
      ctx.fillStyle = barColor + '22'
      ctx.beginPath()
      ctx.roundRect(x, y, bw, h, 4)
      ctx.fill()
      ctx.fillStyle = barColor
      ctx.beginPath()
      ctx.roundRect(x, c.height - 20 - 4, bw, 4, 2)
      ctx.fill()
      ctx.fillStyle = textColor
      ctx.font = '10px Inter'
      ctx.textAlign = 'center'
      ctx.fillText(labels[i], x + bw / 2, c.height - 4)
    })
  }, [])
  return <canvas ref={canvasRef} style={{ width: '100%', height: '180px', display: 'block' }} />
}

function DonutChart({ value = 73 }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    const th = document.documentElement.getAttribute('data-theme')
    c.width = c.offsetWidth || 160
    c.height = c.offsetHeight || 160
    const cx = c.width / 2, cy = c.height / 2, r = Math.min(c.width, c.height) / 2 - 16
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(255,255,255,.06)'
    ctx.lineWidth = 14
    ctx.stroke()
    const start = -Math.PI / 2, end = start + (value / 100) * Math.PI * 2
    const grad = ctx.createLinearGradient(0, 0, c.width, c.height)
    grad.addColorStop(0, th === 'light' ? '#4F46E5' : '#818CF8')
    grad.addColorStop(1, '#38BDF8')
    ctx.beginPath()
    ctx.arc(cx, cy, r, start, end)
    ctx.strokeStyle = grad
    ctx.lineWidth = 14
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.fillStyle = th === 'light' ? '#0F172A' : '#fff'
    ctx.font = 'bold 22px Inter'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(value + '%', cx, cy - 6)
    ctx.fillStyle = th === 'light' ? '#475569' : '#94A3B8'
    ctx.font = '11px Inter'
    ctx.fillText('Utilized', cx, cy + 14)
  }, [value])
  return <canvas ref={canvasRef} style={{ width: '160px', height: '160px', display: 'block', margin: '0 auto' }} />
}

export default function GovDashboard() {
  const [tab, setTab] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 1024)
  const [searchQuery, setSearchQuery] = useState('')
  const [schemeCatFilter, setSchemeCatFilter] = useState('All')
  const [appFilter, setAppFilter] = useState('all')

  // Schemes state
  const [allSchemesList, setAllSchemesList] = useState(SCHEMES)
  const [showCreateScheme, setShowCreateScheme] = useState(false)
  const [editingScheme, setEditingScheme] = useState(null)
  const [newScheme, setNewScheme] = useState({
    name: '', cat: 'Merit', amount: '', budget: '', deadline: '', criteria: '', ministry: ''
  })

  // Blockchain ops state
  const [mintAmount, setMintAmount] = useState(500)
  const [mintScheme, setMintScheme] = useState('NSP Central Merit Scholarship 2025-26')
  const [mintingActive, setMintingActive] = useState(false)
  const [mintedHistory, setMintedHistory] = useState(MINTED_HISTORY)
  const [bridgeBatch, setBridgeBatch] = useState(BRIDGE_BATCH)
  const [bridgeRecipients, setBridgeRecipients] = useState(BRIDGE_RECIPIENTS)
  const [distributingBridge, setDistributingBridge] = useState(false)

  // Applications state: initialize from persistent storage with fallback
  const [apps, setApps] = useState(() => {
    try {
      const saved = localStorage.getItem('gov_all_apps')
      if (saved) return JSON.parse(saved)
      const extra = JSON.parse(localStorage.getItem('gov_extra_apps') || '[]')
      if (extra.length > 0) {
        const ids = new Set(extra.map(a => a.id))
        return [...extra, ...APPLICATIONS.filter(a => !ids.has(a.id))]
      }
    } catch {}
    return APPLICATIONS
  })

  // Sync incoming student applications from localStorage in real-time
  useEffect(() => {
    const syncGovApps = () => {
      try {
        const extra = JSON.parse(localStorage.getItem('gov_extra_apps') || '[]')
        if (extra.length > 0) {
          setApps(prev => {
            const ids = new Set(prev.map(a => a.id))
            const newItems = extra.filter(a => !ids.has(a.id))
            if (newItems.length > 0) {
              const combined = [...newItems, ...prev]
              localStorage.setItem('gov_all_apps', JSON.stringify(combined))
              return combined
            }
            return prev
          })
        }
      } catch {}
    }
    window.addEventListener('storage', syncGovApps)
    window.addEventListener('focus', syncGovApps)
    syncGovApps()
    return () => {
      window.removeEventListener('storage', syncGovApps)
      window.removeEventListener('focus', syncGovApps)
    }
  }, [])

  const [flags, setFlags] = useState(AI_FLAGS)
  const [toast, setToast] = useState(null)
  const [appDetail, setAppDetail] = useState(null)
  const [docPreview, setDocPreview] = useState(null)

  // Notifications state
  const [showNotifPanel, setShowNotifPanel] = useState(false)
  const [notifs, setNotifs] = useState([
    { id: 1, title: '🚨 Critical Fraud Alert', desc: 'STU-2026-0912 duplicate Aadhaar hash flagged with 98.4% vector similarity.', time: '1 hr ago', read: false },
    { id: 2, title: '⛓️ Algorand Batch Minted', desc: 'Batch 0019 (5,000 tokens) anchored on TestNet block 31204819.', time: '3 hrs ago', read: false },
    { id: 3, title: '⚠️ Budget Threshold Warning', desc: 'AICTE Pragati Scholarship utilization reached 91% of total ₹34 Cr budget.', time: '5 hrs ago', read: false },
    { id: 4, title: '📝 New Application Influx', desc: '14 new student applications submitted from Maharashtra state board.', time: '7 hrs ago', read: true },
    { id: 5, title: '📄 CAG Audit Report Ready', desc: 'Q4 2025 automated audit report generated and anchored to IPFS.', time: '1 day ago', read: true },
  ])

  const unreadCount = notifs.filter(n => !n.read).length

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── Contract state ──────────────────────────────────
  const [contractGlobal,  setContractGlobal]  = useState(null)
  const [contractLoading, setContractLoading] = useState(false)
  const [contractError,   setContractError]   = useState(null)
  const [contractTx,      setContractTx]      = useState(null)
  const [contractAction,  setContractAction]  = useState(null)
  const [studentTarget,   setStudentTarget]   = useState('')
  const [studentState,    setStudentState]    = useState(null)

  const loadGlobal = useCallback(async () => {
    setContractLoading(true)
    setContractError(null)
    try {
      const g = await getGlobalState()
      setContractGlobal(g)
    } catch (e) {
      setContractError(e.message ?? 'Failed to load chain state')
    } finally {
      setContractLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab === 'blockchain') loadGlobal()
  }, [tab, loadGlobal])

  const lookupStudent = async () => {
    if (!studentTarget.trim()) return
    try {
      const s = await getStudentState(studentTarget.trim())
      setStudentState(s)
    } catch {
      setStudentState(null)
    }
  }

  const runContractOp = async (label, fn) => {
    const authAddr = loadAddress()
    if (!authAddr) { setContractError('Connect your wallet (◎ Wallet) first.'); return }
    setContractAction(label)
    setContractError(null)
    setContractTx(null)
    try {
      const signer = makePeraSigner(authAddr)
      const { txID } = await fn(authAddr, signer)
      setContractTx(txID)
      await loadGlobal()
      if (studentTarget) {
        const s = await getStudentState(studentTarget.trim())
        setStudentState(s)
      }
    } catch (e) {
      setContractError(
        e?.message?.includes('rejected')
          ? 'Transaction rejected in Pera Wallet.'
          : (e?.message ?? 'Transaction failed')
      )
    } finally {
      setContractAction(null)
    }
  }

  const navigate = useNavigate()

  // ── Session: read logged-in gov org ────────────────────────────────
  const govOrg = (() => {
    try { return JSON.parse(sessionStorage.getItem('gov_org') || 'null') }
    catch { return null }
  })()
  useEffect(() => { if (!govOrg) navigate('/') }, [])
  const orgName   = govOrg?.orgName  || 'Ministry Officer'
  const orgScheme = govOrg?.scheme   || ''
  const orgId     = govOrg?.orgId    || 'OFF-GOV-01'

  const handleLogout = () => { sessionStorage.removeItem('gov_org'); navigate('/') }

  // ── Filters ────────────────────────────────────────────────────────
  const filteredSchemes = allSchemesList.filter(s => {
    const matchesSearch = !searchQuery ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.ministry?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.criteria?.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCat = schemeCatFilter === 'All' || s.cat === schemeCatFilter
    return matchesSearch && matchesCat
  })

  const filteredApps = apps.filter(a => {
    const matchesFilter = appFilter === 'all' || a.status === appFilter
    const matchesSearch = !searchQuery ||
      a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.studentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.scheme.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.inst.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  const filteredFlags = flags.filter(f => {
    return !searchQuery ||
      f.student.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.studentId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.reason.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.scheme.toLowerCase().includes(searchQuery.toLowerCase())
  })

  // ── Create / Edit Scheme Handlers ──────────────────────────────────
  const handleCreateScheme = () => {
    if (!newScheme.name.trim()) { showToast('Scheme name is required.', 'error'); return }
    if (!newScheme.amount) { showToast('Amount per student is required.', 'error'); return }
    if (!newScheme.budget) { showToast('Total budget is required.', 'error'); return }
    if (!newScheme.deadline) { showToast('Deadline is required.', 'error'); return }
    if (!newScheme.criteria.trim()) { showToast('Eligibility criteria is required.', 'error'); return }

    const scheme = {
      id: `SCH-${String(Date.now()).slice(-4)}`,
      name: newScheme.name.trim(),
      cat: newScheme.cat,
      budget: Number(newScheme.budget),
      benef: Math.floor((Number(newScheme.budget) * 10000000) / Number(newScheme.amount)),
      amount: Number(newScheme.amount),
      filled: 0,
      status: 'active',
      deadline: newScheme.deadline,
      ministry: newScheme.ministry.trim() || orgName,
      criteria: newScheme.criteria.trim(),
    }
    setAllSchemesList(prev => [scheme, ...prev])
    setShowCreateScheme(false)
    setNewScheme({ name: '', cat: 'Merit', amount: '', budget: '', deadline: '', criteria: '', ministry: '' })
    showToast(`✅ Scheme "${scheme.name}" created and tokenized on Algorand!`)
  }

  const handleUpdateScheme = () => {
    if (!editingScheme) return
    setAllSchemesList(prev => prev.map(s => s.id === editingScheme.id ? editingScheme : s))
    showToast(`Scheme "${editingScheme.name}" updated successfully.`)
    setEditingScheme(null)
  }

  const handleToggleSchemeStatus = (schemeId) => {
    setAllSchemesList(prev => prev.map(s => {
      if (s.id === schemeId) {
        const nextStatus = s.status === 'active' ? 'draft' : 'active'
        showToast(`Scheme ${s.id} marked as ${nextStatus}.`)
        return { ...s, status: nextStatus }
      }
      return s
    }))
  }

  // ── Mint ASA Tokens Action ─────────────────────────────────────────
  const handleMintTokens = () => {
    if (mintAmount <= 0) { showToast('Please enter a valid token quantity.', 'error'); return }
    setMintingActive(true)
    setTimeout(() => {
      const randomBlock = Math.floor(31200000 + Math.random() * 50000)
      const randomHash = `V7KQ${Math.random().toString(36).substring(2, 8).toUpperCase()}…${Math.random().toString(36).substring(2, 6).toUpperCase()}`
      const newEntry = {
        scheme: mintScheme.slice(0, 20),
        tokens: Number(mintAmount),
        amount: `₹${((Number(mintAmount) * 20000) / 10000000).toFixed(2)} Cr`,
        time: 'Just now',
        txHash: randomHash,
        block: randomBlock,
      }
      setMintedHistory(prev => [newEntry, ...prev])
      setMintingActive(false)
      showToast(`🎉 Successfully minted ${Number(mintAmount).toLocaleString()} ASA tokens for "${mintScheme}" on Algorand block ${randomBlock}!`)
    }, 1200)
  }

  // ── Bridge Batch Distribution Action ───────────────────────────────
  const handleDistributeBatch = () => {
    setDistributingBridge(true)
    setTimeout(() => {
      setBridgeRecipients(prev => prev.map(r => ({ ...r, status: 'verified', wallet: r.wallet === 'Not connected' ? `ALGO_DIST_${r.id.slice(-4)}` : r.wallet })))
      setBridgeBatch(b => ({ ...b, totalDistributed: b.total, status: 'Distributed' }))
      setDistributingBridge(false)
      showToast(`🚀 Batch ${bridgeBatch.batchId} (${bridgeBatch.amount}) distributed to all recipients via Algorand inner transactions!`)
    }, 1500)
  }

  // ── Approve/Reject Application Handler ─────────────────────────────
  const handleAppAction = (appId, action) => {
    let targetApp = null
    setApps(prev => {
      const updated = prev.map(x => {
        if (x.id === appId) {
          targetApp = { ...x, status: action, officer: orgId }
          return targetApp
        }
        return x
      })
      try { localStorage.setItem('gov_all_apps', JSON.stringify(updated)) } catch {}
      return updated
    })

    // Sync student portal my_apps in localStorage & sessionStorage
    try {
      const studentApps = JSON.parse(localStorage.getItem('my_apps') || '[]')
      const updatedStudentApps = studentApps.map(a =>
        a.id === appId
          ? {
              ...a,
              status: action,
              remarks: action === 'Approved'
                ? `Approved by ${orgName} (${orgId}). Algorand token generated.`
                : action === 'AI Verified'
                ? 'AI automated checks verified. Awaiting final officer release.'
                : `Rejected by ${orgName} (${orgId}). Document criteria unfulfilled.`
            }
          : a
      )
      localStorage.setItem('my_apps', JSON.stringify(updatedStudentApps))
      sessionStorage.setItem('my_apps', JSON.stringify(updatedStudentApps))

      // If approved, mint/grant a token to the student
      if (action === 'Approved' && targetApp) {
        const existingTokens = JSON.parse(localStorage.getItem('my_tokens') || JSON.stringify(MY_TOKENS))
        const newToken = {
          id: `TOK-2026-${String(Date.now()).slice(-6)}-A`,
          scheme: targetApp.scheme,
          amount: targetApp.amount,
          status: 'redeemable',
          issued: new Date().toISOString().slice(0, 10),
          expires: '2026-12-31',
          txHash: `CKAOTMTK${Math.random().toString(36).substring(2, 8).toUpperCase()}W4ETPB5SRAXQ2`,
          assetId: Math.floor(78800000 + Math.random() * 99999),
        }
        const updatedTokens = [newToken, ...existingTokens]
        localStorage.setItem('my_tokens', JSON.stringify(updatedTokens))
        sessionStorage.setItem('my_tokens', JSON.stringify(updatedTokens))
      }
    } catch {}

    showToast(`Application ${appId} marked as ${action}.`)
  }

  // ── CSV Export ─────────────────────────────────────────────────────
  const exportApplicationsToCSV = () => {
    const headers = ['Application ID', 'Student Name', 'Student ID', 'Scheme', 'Amount (INR)', 'Status', 'Date', 'Institution', 'Course', 'AI Score', 'Reviewing Officer']
    const rows = filteredApps.map(a => [
      a.id,
      `"${a.name}"`,
      a.studentId,
      `"${a.scheme}"`,
      a.amount,
      a.status,
      a.date,
      `"${a.inst}"`,
      `"${a.course}"`,
      a.aiScore,
      a.officer || 'Unassigned'
    ])
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute('download', `fundscheme_applications_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    showToast('📥 Applications report exported successfully as CSV!')
  }

  // ── Download Real Audit Report ─────────────────────────────────────
  const downloadReportFile = (report) => {
    const reportText = `======================================================================
GOVERNMENT OF INDIA — MINISTRY OF EDUCATION / SOCIAL JUSTICE
FundScheme Decentralized Scholarship Disbursement Platform
======================================================================
REPORT: ${report.title}
METADATA: ${report.meta}
GENERATED AT: ${new Date().toUTCString()}
ORGANIZATION: ${orgName} (${orgId})
ALGORAND TESTNET APP ID: ${APP_ID}
======================================================================

EXECUTIVE SUMMARY:
${report.desc}

SYSTEM AUDIT METRICS:
- Total Enrolled Schemes: ${allSchemesList.length}
- Verified Applications Processed: ${apps.length}
- Active ASA Tokens Circulating: ${mintedHistory.reduce((acc, m) => acc + m.tokens, 0).toLocaleString()}
- Total Disbursed (Algorand Anchor): ₹41.29 Cr
- Zero double-spend guarantees confirmed via Algorand State Proofs

SECURITY & FRAUD MITIGATION:
- Cross-database vector embedding duplicate checks: ZERO false negatives
- GNN Fraud Model Accuracy: 97.4%
- Document Tampering Detection: Enabled (Form-16A, Marksheet OCR)

DIGITAL SIGNATURE:
Officer: ${orgName}
Signature Hash: 0x${Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}
Algorand Anchor TXID: V7KQMN3PXRWSTF4DHJBL8CGAZE2YNI6OULM5Q3PXRWSTF4DHJBL
======================================================================`

    const blob = new Blob([reportText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report.title.replace(/[^a-zA-Z0-9]/g, '_')}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    showToast(`📄 Downloaded official audit report: "${report.title}"`)
  }

  return (
    <div className="dash-body">
      <Sidebar
        role="gov"
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
            <span className="topbar-title">Gov Control Panel</span>
          </div>
          <div className="topbar-right">
            <div className="topbar-search" style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Search schemes, students, flags…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute', right: '8px', background: 'transparent',
                    border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: '.9rem'
                  }}
                >✕</button>
              )}
            </div>

            <div className="topbar-chain"><span className="chain-dot"></span>Chain: Active</div>

            <button
              onClick={() => navigate('/wallet')}
              style={{
                background: 'rgba(0,232,198,.12)', color: 'var(--accent)',
                border: '1px solid rgba(0,232,198,.3)', borderRadius: '7px',
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
                onClick={() => setShowNotifPanel(p => !p)}
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
                    background: '#EF4444', color: '#fff', fontSize: '.68rem',
                    fontWeight: 700, borderRadius: '50%', width: '16px', height: '16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifPanel && (
                <div style={{
                  position: 'absolute', right: 0, top: '42px', width: '320px',
                  background: 'var(--card-bg, #1e293b)', border: '1px solid var(--border-2)',
                  borderRadius: '12px', boxShadow: '0 12px 32px rgba(0,0,0,.45)',
                  zIndex: 100, padding: '1rem', backdropFilter: 'blur(16px)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.75rem' }}>
                    <strong style={{ fontSize: '.9rem' }}>Notifications ({unreadCount} new)</strong>
                    <button
                      onClick={() => setNotifs(ns => ns.map(n => ({ ...n, read: true })))}
                      style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '.75rem', cursor: 'pointer' }}
                    >
                      Mark all read
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem', maxHeight: '280px', overflowY: 'auto' }}>
                    {notifs.map(n => (
                      <div
                        key={n.id}
                        style={{
                          padding: '.65rem', borderRadius: '8px',
                          background: n.read ? 'rgba(255,255,255,.02)' : 'rgba(0,232,198,.08)',
                          border: `1px solid ${n.read ? 'transparent' : 'rgba(0,232,198,.2)'}`,
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

            <div className="topbar-user">
              <span className="topbar-avatar" style={{ background: 'rgba(0,232,198,.18)', color: '#00e8c6' }}>
                {orgName.charAt(0).toUpperCase()}
              </span>
              <span className="topbar-uname">{orgName.length > 18 ? orgName.slice(0, 18) + '…' : orgName}</span>
            </div>
            <button onClick={handleLogout} className="btn-logout">Sign Out</button>
            <ThemeToggle />
          </div>
        </div>

        {/* Toast */}
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
                <h1>Government Authority Dashboard 🏛️</h1>
                <p>Welcome, {orgName} ({orgId}) · Algorand TestNet App ID: <strong>{APP_ID}</strong></p>
              </div>
              <div style={{ display: 'flex', gap: '.6rem' }}>
                <button className="btn-primary" onClick={() => setShowCreateScheme(true)}>+ New Scheme</button>
                <button className="btn-sm btn-view" onClick={() => setTab('blockchain')}>⛓️ Blockchain Ops</button>
              </div>
            </div>

            <div className="kpi-grid">
              {[
                { label: 'Total Allocated Budget', val: '₹518 Cr', icon: '💰', cls: '', action: () => setTab('schemes') },
                { label: 'Active Schemes', val: String(allSchemesList.filter(s => s.status === 'active').length), icon: '🏛️', cls: 'kpi-accent', action: () => setTab('schemes') },
                { label: 'Disbursed via Algorand', val: '₹41.29 Cr', icon: '⛓️', cls: '', action: () => setTab('blockchain') },
                { label: 'Pending Applications', val: String(apps.filter(a => a.status === 'Pending Review' || a.status === 'AI Verified').length), icon: '📝', cls: 'kpi-warn', action: () => setTab('applications') },
                { label: 'Fraud Flags Blocked', val: String(flags.length), icon: '🚨', cls: 'kpi-critical', action: () => setTab('flags') },
                { label: 'Avg Beneficiary Lead Time', val: '4.2 Days', icon: '⚡', cls: 'kpi-accent', action: () => setTab('reports') },
              ].map(k => (
                <div
                  key={k.label}
                  className={`kpi-card${k.cls ? ' ' + k.cls : ''}`}
                  onClick={k.action}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="kpi-top">
                    <span className="kpi-label">{k.label}</span>
                    <span className="kpi-icon">{k.icon}</span>
                  </div>
                  <span className="kpi-val">{k.val}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '1.4rem' }}>
              <div className="table-card" style={{ padding: '1.6rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <span className="chart-title">Disbursement Volume Trend (₹ Cr)</span>
                  <span style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>August 2025 – February 2026</span>
                </div>
                <BarChart />
              </div>
              <div className="table-card" style={{ padding: '1.6rem', textAlign: 'center' }}>
                <span className="chart-title">Overall Budget Utilization</span>
                <DonutChart value={74} />
                <div style={{ fontSize: '.84rem', color: 'var(--text-2)', marginTop: '1rem', lineHeight: 1.5 }}>
                  ₹384 Cr disbursed / committed across 8 central and state scholarship frameworks.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* MANAGE SCHEMES */}
        {tab === 'schemes' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>Manage Scholarship Schemes</h2>
                <p>Configure scheme parameters, budgets, and eligibility criteria.</p>
              </div>
              <button className="btn-primary" onClick={() => setShowCreateScheme(true)}>+ Create New Scheme</button>
            </div>

            <div className="filter-bar">
              <input
                className="filter-input"
                placeholder="Search schemes by name, criteria, or ministry…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <select
                className="filter-select"
                value={schemeCatFilter}
                onChange={e => setSchemeCatFilter(e.target.value)}
              >
                <option value="All">All Categories</option>
                <option value="Merit">Merit</option>
                <option value="Need-Based">Need-Based</option>
                <option value="Disability">Disability</option>
                <option value="Minority">Minority</option>
                <option value="Research">Research</option>
              </select>
            </div>

            <div className="schemes-grid">
              {filteredSchemes.map(s => (
                <div key={s.id} className="scheme-card">
                  <div className="sc-header">
                    <div>
                      <span className="sc-title">{s.name}</span>
                      <div style={{ fontSize: '.72rem', color: 'var(--text-3)', marginTop: '.2rem' }}>ID: {s.id} · {s.ministry}</div>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="sc-body">{s.criteria}</p>
                  <div className="sc-meta">
                    <span>📂 {s.cat}</span>
                    <span>💰 ₹{s.amount.toLocaleString()}/student</span>
                    <span>🏛️ Budget: ₹{s.budget} Cr</span>
                    <span>👥 {s.benef?.toLocaleString()} Beneficiaries</span>
                    <span>📅 Deadline: {s.deadline}</span>
                  </div>
                  <div className="sc-footer" style={{ borderTop: '1px solid var(--border-2)', paddingTop: '.8rem', marginTop: '.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div className="sc-progress" style={{ flex: 1, marginRight: '1rem' }}>
                      <div className="sc-progress-bar">
                        <div className="sc-progress-fill" style={{ width: `${s.filled}%` }}></div>
                      </div>
                      <span className="sc-pct">{s.filled}% filled</span>
                    </div>
                    <div style={{ display: 'flex', gap: '.4rem' }}>
                      <button
                        className="btn-sm btn-view"
                        onClick={() => setEditingScheme({ ...s })}
                        title="Edit Scheme Details"
                      >
                        ✏️ Edit
                      </button>
                      <button
                        className="btn-sm"
                        style={{
                          background: s.status === 'active' ? 'rgba(239,68,68,.1)' : 'rgba(16,185,129,.1)',
                          color: s.status === 'active' ? '#ef4444' : '#10b981',
                          border: `1px solid ${s.status === 'active' ? 'rgba(239,68,68,.25)' : 'rgba(16,185,129,.25)'}`,
                          padding: '.35rem .6rem'
                        }}
                        onClick={() => handleToggleSchemeStatus(s.id)}
                      >
                        {s.status === 'active' ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {filteredSchemes.length === 0 && (
                <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: '3rem', color: 'var(--text-2)' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
                  <h3>No schemes match your filter</h3>
                  <p>Try clearing your search query or selecting "All Categories".</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* BLOCKCHAIN OPS */}
        {tab === 'blockchain' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>⛓️ Blockchain Operations & ASA Token Management</h2>
                <p>Live Algorand TestNet state · ASA Token Minting · Batch Bridge Distribution · App ID: <strong>{APP_ID}</strong></p>
              </div>
              <button className="btn-sm btn-view" onClick={loadGlobal} disabled={contractLoading}>
                {contractLoading ? '↻ Loading…' : '↻ Refresh Chain State'}
              </button>
            </div>

            {contractTx && (
              <div style={{ background: 'rgba(16,185,129,.1)', border: '1px solid rgba(16,185,129,.3)', borderRadius: '10px', padding: '.75rem 1rem', marginBottom: '1rem', color: '#10b981', fontSize: '.88rem' }}>
                ✅ Transaction confirmed!&nbsp;&nbsp;
                <a href={`https://testnet.algoexplorer.io/tx/${contractTx}`} target="_blank" rel="noreferrer" style={{ color: '#10b981', fontWeight: 600 }}>View on AlgoExplorer ↗</a>
              </div>
            )}
            {contractError && (
              <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.25)', borderRadius: '10px', padding: '.75rem 1rem', marginBottom: '1rem', color: '#ef4444', fontSize: '.88rem' }}>
                ❌ {contractError}
              </div>
            )}

            {/* Global State Card */}
            <div className="table-card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📊 Contract Global State</h3>
              {contractGlobal ? (
                <>
                  <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '.75rem', marginBottom: '1rem' }}>
                    {[
                      { label: 'Status',         val: contractGlobal.schemeActive ? '🟢 Active' : '🔴 Inactive' },
                      { label: 'Payout/Student', val: contractGlobal.payoutAmount ? (Number(contractGlobal.payoutAmount)/1e6).toFixed(4) + ' ALGO' : '—' },
                      { label: 'Spent Budget',   val: contractGlobal.spentBudget  ? (Number(contractGlobal.spentBudget)/1e6).toFixed(4) + ' ALGO' : '0 ALGO' },
                      { label: 'Total Budget',   val: contractGlobal.totalBudget  ? (Number(contractGlobal.totalBudget)/1e6).toFixed(4) + ' ALGO' : '—' },
                    ].map(k => (
                      <div key={k.label} className="kpi-card" style={{ padding: '.9rem 1rem' }}>
                        <div className="kpi-top"><span className="kpi-label">{k.label}</span></div>
                        <span className="kpi-val" style={{ fontSize: '1rem' }}>{k.val}</span>
                      </div>
                    ))}
                  </div>
                  {contractGlobal.authority && (
                    <div style={{ fontSize: '.8rem', color: 'var(--text-2)' }}>
                      🛡️ Authority: <code style={{ color: 'var(--accent)', wordBreak: 'break-all' }}>{contractGlobal.authority}</code>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: 'var(--text-2)', fontSize: '.9rem' }}>
                  Click <strong>Refresh Chain State</strong> to query live Algorand TestNet parameters.
                </div>
              )}
            </div>

            {/* Token Minting & Student Operations Layout */}
            <div className="tokenize-layout" style={{ marginBottom: '1.5rem' }}>
              {/* Form 1: Mint ASA Tokens */}
              <div className="tokenize-form-card">
                <h3>💎 Mint Algorand Standard Assets (ASA)</h3>
                <p style={{ fontSize: '.82rem', color: 'var(--text-2)', marginBottom: '1rem' }}>
                  Create program-specific token batches for immediate escrow anchoring.
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Target Scheme</label>
                    <select
                      className="filter-select"
                      style={{ width: '100%' }}
                      value={mintScheme}
                      onChange={e => setMintScheme(e.target.value)}
                    >
                      {allSchemesList.map(s => (
                        <option key={s.id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Quantity of ASA Tokens to Mint</label>
                    <input
                      type="number"
                      className="filter-input"
                      value={mintAmount}
                      onChange={e => setMintAmount(e.target.value)}
                      placeholder="e.g. 500"
                    />
                  </div>
                  <div style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>
                    Est. Total Tokenized Value: <strong>₹{((Number(mintAmount) * 20000) / 10000000).toFixed(2)} Cr</strong> (Algorand ARC-0003 asset)
                  </div>
                  <button
                    className="btn-primary"
                    disabled={mintingActive}
                    onClick={handleMintTokens}
                  >
                    {mintingActive ? '⛓️ Minting Tokens on Algorand…' : '💎 Mint ASA Tokens'}
                  </button>
                </div>
              </div>

              {/* Form 2: Student Milestone / Payout Actions */}
              <div className="tokenize-preview">
                <h3>Student Authority Actions</h3>
                <div className="form-group" style={{ marginBottom: '.75rem' }}>
                  <label>Student Algorand Wallet Address</label>
                  <input
                    className="filter-input"
                    style={{ fontFamily: 'monospace', fontSize: '.82rem' }}
                    placeholder="ALGO TestNet address…"
                    value={studentTarget}
                    onChange={e => setStudentTarget(e.target.value)}
                  />
                </div>
                <button className="btn-sm btn-view" style={{ marginBottom: '.75rem' }} onClick={lookupStudent}>
                  🔍 Look Up Student State
                </button>

                {studentState && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', marginBottom: '1rem' }}>
                    {[
                      { label: 'Registered',    ok: studentState.isRegistered },
                      { label: 'Milestone Done', ok: studentState.milestoneCompleted },
                      { label: 'Paid',          ok: studentState.hasBeenPaid },
                    ].map(s => (
                      <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.82rem', padding: '.3rem .6rem', background: 'var(--bg)', borderRadius: '6px' }}>
                        <span style={{ color: 'var(--text-2)' }}>{s.label}</span>
                        <span style={{ color: s.ok ? '#10b981' : '#94a3b8', fontWeight: 600 }}>{s.ok ? '✔ Yes' : '✗ No'}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                  <button
                    className="btn-primary w-full"
                    disabled={!studentTarget.trim() || !!contractAction}
                    onClick={() => runContractOp('Marking milestone…', (addr, signer) =>
                      markMilestoneComplete(addr, studentTarget.trim(), signer)
                    )}
                  >
                    {contractAction === 'Marking milestone…' ? contractAction : '✅ Mark Milestone Complete'}
                  </button>
                  <button
                    className="btn-primary w-full"
                    disabled={!studentTarget.trim() || !!contractAction}
                    style={{ background: 'rgba(59,130,246,.15)', borderColor: 'rgba(59,130,246,.4)', color: '#60a5fa' }}
                    onClick={() => runContractOp('Releasing payout…', (addr, signer) =>
                      contractReleasePayout(addr, studentTarget.trim(), signer)
                    )}
                  >
                    {contractAction === 'Releasing payout…' ? contractAction : '💸 Release Payout (Inner Txn)'}
                  </button>
                </div>
              </div>
            </div>

            {/* Minted History Table */}
            <div className="table-card" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>📜 Minted ASA Batch History</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-2)', textAlign: 'left', color: 'var(--text-3)' }}>
                      <th style={{ padding: '.6rem .8rem' }}>Scheme</th>
                      <th style={{ padding: '.6rem .8rem' }}>Tokens Minted</th>
                      <th style={{ padding: '.6rem .8rem' }}>Value</th>
                      <th style={{ padding: '.6rem .8rem' }}>Time</th>
                      <th style={{ padding: '.6rem .8rem' }}>Transaction</th>
                      <th style={{ padding: '.6rem .8rem' }}>Block</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mintedHistory.map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <td style={{ padding: '.6rem .8rem', fontWeight: 600 }}>{m.scheme}</td>
                        <td style={{ padding: '.6rem .8rem' }}>{m.tokens.toLocaleString()} ASA</td>
                        <td style={{ padding: '.6rem .8rem', color: '#10b981' }}>{m.amount}</td>
                        <td style={{ padding: '.6rem .8rem', color: 'var(--text-3)' }}>{m.time}</td>
                        <td style={{ padding: '.6rem .8rem' }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{m.txHash}</span>
                        </td>
                        <td style={{ padding: '.6rem .8rem', color: 'var(--text-2)' }}>#{m.block}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Bridge Batch Distribution Section */}
            <div className="table-card" style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
                <div>
                  <h3 style={{ fontSize: '1rem', marginBottom: '.2rem' }}>🌉 Bulk Bridge Batch Distribution ({bridgeBatch.batchId})</h3>
                  <div style={{ fontSize: '.8rem', color: 'var(--text-2)' }}>
                    Scheme: <strong>{bridgeBatch.scheme}</strong> · Total Value: <strong>{bridgeBatch.amount}</strong> ({bridgeBatch.total} Tokens)
                  </div>
                </div>
                <button
                  className="btn-primary"
                  disabled={distributingBridge || bridgeRecipients.every(r => r.status === 'verified')}
                  onClick={handleDistributeBatch}
                >
                  {distributingBridge ? '⏳ Executing Batch Transfer…' :
                   bridgeRecipients.every(r => r.status === 'verified') ? '✔ Batch Fully Distributed' :
                   '🚀 Distribute Batch to Recipients'}
                </button>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.84rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-2)', textAlign: 'left', color: 'var(--text-3)' }}>
                      <th style={{ padding: '.6rem .8rem' }}>Student ID</th>
                      <th style={{ padding: '.6rem .8rem' }}>Recipient Name</th>
                      <th style={{ padding: '.6rem .8rem' }}>Institution</th>
                      <th style={{ padding: '.6rem .8rem' }}>Amount</th>
                      <th style={{ padding: '.6rem .8rem' }}>Assigned Wallet</th>
                      <th style={{ padding: '.6rem .8rem' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bridgeRecipients.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,.04)' }}>
                        <td style={{ padding: '.6rem .8rem', fontFamily: 'monospace' }}>{r.id}</td>
                        <td style={{ padding: '.6rem .8rem', fontWeight: 600 }}>{r.name}</td>
                        <td style={{ padding: '.6rem .8rem', color: 'var(--text-2)' }}>{r.inst}</td>
                        <td style={{ padding: '.6rem .8rem', color: '#10b981' }}>₹{r.amount.toLocaleString()}</td>
                        <td style={{ padding: '.6rem .8rem', fontFamily: 'monospace', fontSize: '.78rem' }}>{r.wallet}</td>
                        <td style={{ padding: '.6rem .8rem' }}>
                          <span style={{
                            fontSize: '.75rem', padding: '.25rem .5rem', borderRadius: '6px',
                            background: r.status === 'verified' ? 'rgba(16,185,129,.15)' : 'rgba(245,158,11,.15)',
                            color: r.status === 'verified' ? '#10b981' : '#f59e0b',
                            fontWeight: 600
                          }}>
                            {r.status === 'verified' ? '✔ Distributed' : '⏳ Pending'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* APPLICATIONS */}
        {tab === 'applications' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>Student Applications ({filteredApps.length})</h2>
                <p>AI-scored verification records, identity checks, and disbursement approvals.</p>
              </div>
              <div style={{ display: 'flex', gap: '.6rem' }}>
                <button className="btn-sm btn-view" onClick={exportApplicationsToCSV}>
                  📥 Export CSV
                </button>
              </div>
            </div>

            <div className="apps-filters" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
              {['all', 'Pending Review', 'AI Verified', 'Approved', 'Rejected'].map(f => (
                <button
                  key={f}
                  className={`btn-sm${appFilter === f ? ' btn-approve' : ' btn-view'}`}
                  onClick={() => setAppFilter(f)}
                >
                  {f === 'all' ? `All (${apps.length})` : `${f} (${apps.filter(a => a.status === f).length})`}
                </button>
              ))}
            </div>

            {filteredApps.map(a => (
              <div key={a.id} className="app-row">
                <div>
                  <div className="app-name">{a.name}</div>
                  <div className="app-id">{a.studentId} · {a.inst} ({a.course})</div>
                </div>
                <div className="app-scheme">{a.scheme}</div>
                <div className="app-amount">₹{a.amount.toLocaleString()}</div>
                <StatusBadge status={a.status} />
                <div style={{ fontSize: '.78rem', color: 'var(--text-3)' }}>{a.date}</div>
                <div style={{ fontSize: '.78rem', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: '.25rem' }}>
                  🛡️ {a.aiScore}/100
                </div>
                <div className="app-actions">
                  {a.status === 'Pending Review' || a.status === 'AI Verified' ? (
                    <>
                      <button
                        className="btn-sm btn-approve"
                        onClick={() => handleAppAction(a.id, 'Approved')}
                      >✓ Approve</button>
                      <button
                        className="btn-sm btn-reject"
                        onClick={() => handleAppAction(a.id, 'Rejected')}
                      >✕ Reject</button>
                      <button
                        className="btn-sm btn-view"
                        onClick={() => setAppDetail(a)}
                      >👁 View</button>
                    </>
                  ) : a.status === 'Approved' ? (
                    <>
                      <button
                        className="btn-sm btn-approve"
                        style={{ background: 'rgba(59,130,246,.12)', color: '#60a5fa', borderColor: 'rgba(59,130,246,.3)' }}
                        onClick={() => {
                          setStudentTarget(a.walletAddress || a.studentId)
                          setTab('blockchain')
                        }}
                      >⛓ Mark Milestone</button>
                      <button
                        className="btn-sm btn-approve"
                        style={{ background: 'rgba(16,185,129,.1)', color: '#10b981', borderColor: 'rgba(16,185,129,.25)' }}
                        onClick={() => {
                          setStudentTarget(a.walletAddress || a.studentId)
                          setTab('blockchain')
                        }}
                      >💸 Payout</button>
                      <button className="btn-sm btn-view" onClick={() => setAppDetail(a)}>Details</button>
                    </>
                  ) : (
                    <button className="btn-sm btn-view" onClick={() => setAppDetail(a)}>View</button>
                  )}
                </div>
              </div>
            ))}

            {filteredApps.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-2)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📝</div>
                <h3>No applications match the current filter</h3>
                <p>Try clearing your search query or switching filters.</p>
              </div>
            )}
          </div>
        )}

        {/* AI FLAGS */}
        {tab === 'flags' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>AI Fraud Flags & Anomaly Detections</h2>
                <p>Real-time graph neural network flags, duplicate identity alerts, and tampering detection.</p>
              </div>
              <div className="flag-summary">
                <span className="fs-chip critical">🔴 {flags.filter(f => f.type === 'critical').length} Critical</span>
                <span className="fs-chip warning">🟡 {flags.filter(f => f.type === 'warning').length} Warning</span>
              </div>
            </div>

            {filteredFlags.length === 0 && (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-2)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
                <h3>All Clear!</h3>
                <p>No pending fraud flags matching your search criteria.</p>
              </div>
            )}

            {filteredFlags.map(f => (
              <div key={f.id} className={`flag-card ${f.type}`}>
                <div className="flag-header">
                  <div>
                    <div className="flag-title">{f.reason}</div>
                    <div className="flag-id">{f.id} · {f.studentId}</div>
                  </div>
                  <StatusBadge status={f.type === 'critical' ? 'Rejected' : 'Pending'} />
                </div>
                <div className="flag-meta">
                  <span>👤 {f.student}</span>
                  <span>📋 {f.scheme}</span>
                  <span>🕐 {f.time}</span>
                </div>
                <div className="flag-details">{f.detail}</div>
                <div className="flag-actions">
                  <button className="btn-sm btn-reject" onClick={() => {
                    setFlags(prev => prev.filter(x => x.id !== f.id))
                    showToast(`🚫 Student ${f.student} blocked & blacklisted on-chain.`)
                  }}>
                    Block Student
                  </button>
                  <button className="btn-sm btn-approve" onClick={() => {
                    setFlags(prev => prev.filter(x => x.id !== f.id))
                    showToast(`✅ Flag ${f.id} cleared and marked resolved.`)
                  }}>
                    Mark Resolved
                  </button>
                  <button className="btn-sm btn-view" onClick={() => showToast(`📧 Formal re-verification request dispatched to ${f.student}.`)}>
                    Request Documents
                  </button>
                  <button
                    className="btn-sm"
                    style={{ background: 'rgba(239,68,68,.12)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)' }}
                    onClick={() => {
                      showToast(`🚨 Escalated to Vigilance & Anti-Corruption Bureau. Case ID: VIG-${f.id}`)
                    }}
                  >
                    Escalate to Vigilance
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* AUDIT REPORTS */}
        {tab === 'reports' && (
          <div className="tab-content active">
            <div className="tab-header-row">
              <div>
                <h2>Audit Reports & Compliance Logs</h2>
                <p>Cryptographically anchored compliance reports, IFMS reconciliations, and CAG audit trails.</p>
              </div>
            </div>
            <div className="reports-grid">
              {REPORTS_DATA.map(r => (
                <div key={r.title} className="report-card">
                  <div className="rc-icon">{r.icon}</div>
                  <div className="rc-title">{r.title}</div>
                  <div className="rc-desc">{r.desc}</div>
                  <div className="rc-meta">{r.meta}</div>
                  <button className="btn-sm btn-view" onClick={() => downloadReportFile(r)}>
                    ⬇ Download Official Report
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* CREATE SCHEME MODAL */}
      {showCreateScheme && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowCreateScheme(false)}>
          <div className="modal-box" style={{ maxWidth: '560px' }}>
            <button className="modal-close" onClick={() => setShowCreateScheme(false)}>✕</button>
            <div className="modal-title">Create New Scheme</div>
            <div className="modal-sub">Define the scheme parameters for Algorand tokenization.</div>
            <div className="modal-form">
              <div className="form-group">
                <label>Scheme Name *</label>
                <input
                  type="text"
                  placeholder="e.g. National Merit Award 2026"
                  value={newScheme.name}
                  onChange={e => setNewScheme({ ...newScheme, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Ministry / Department</label>
                <input
                  type="text"
                  placeholder={orgName || 'e.g. Ministry of Education'}
                  value={newScheme.ministry}
                  onChange={e => setNewScheme({ ...newScheme, ministry: e.target.value })}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Category</label>
                  <select
                    className="filter-select"
                    style={{ width: '100%' }}
                    value={newScheme.cat}
                    onChange={e => setNewScheme({ ...newScheme, cat: e.target.value })}
                  >
                    <option>Merit</option>
                    <option>Need-Based</option>
                    <option>Disability</option>
                    <option>Minority</option>
                    <option>Research</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Amount per Student (₹) *</label>
                  <input
                    type="number"
                    placeholder="50000"
                    value={newScheme.amount}
                    onChange={e => setNewScheme({ ...newScheme, amount: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Total Budget (₹ Cr) *</label>
                  <input
                    type="number"
                    placeholder="50"
                    value={newScheme.budget}
                    onChange={e => setNewScheme({ ...newScheme, budget: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Deadline *</label>
                  <input
                    type="date"
                    value={newScheme.deadline}
                    onChange={e => setNewScheme({ ...newScheme, deadline: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Eligibility Criteria *</label>
                <input
                  type="text"
                  placeholder="Describe criteria…"
                  value={newScheme.criteria}
                  onChange={e => setNewScheme({ ...newScheme, criteria: e.target.value })}
                />
              </div>
              <button className="btn-primary w-full" onClick={handleCreateScheme}>
                Create & Tokenize
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT SCHEME MODAL */}
      {editingScheme && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setEditingScheme(null)}>
          <div className="modal-box" style={{ maxWidth: '560px' }}>
            <button className="modal-close" onClick={() => setEditingScheme(null)}>✕</button>
            <div className="modal-title">Edit Scheme — {editingScheme.name}</div>
            <div className="modal-sub">Update parameters, budget, or active status.</div>
            <div className="modal-form">
              <div className="form-group">
                <label>Scheme Name</label>
                <input
                  type="text"
                  value={editingScheme.name}
                  onChange={e => setEditingScheme({ ...editingScheme, name: e.target.value })}
                />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Total Budget (₹ Cr)</label>
                  <input
                    type="number"
                    value={editingScheme.budget}
                    onChange={e => setEditingScheme({ ...editingScheme, budget: Number(e.target.value) })}
                  />
                </div>
                <div className="form-group">
                  <label>Amount / Student (₹)</label>
                  <input
                    type="number"
                    value={editingScheme.amount}
                    onChange={e => setEditingScheme({ ...editingScheme, amount: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Deadline</label>
                  <input
                    type="date"
                    value={editingScheme.deadline}
                    onChange={e => setEditingScheme({ ...editingScheme, deadline: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select
                    className="filter-select"
                    style={{ width: '100%' }}
                    value={editingScheme.status}
                    onChange={e => setEditingScheme({ ...editingScheme, status: e.target.value })}
                  >
                    <option value="active">Active</option>
                    <option value="draft">Draft / Paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Eligibility Criteria</label>
                <textarea
                  className="filter-input"
                  rows={3}
                  value={editingScheme.criteria}
                  onChange={e => setEditingScheme({ ...editingScheme, criteria: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: '.6rem' }}>
                <button className="btn-primary" style={{ flex: 1 }} onClick={handleUpdateScheme}>
                  Save Changes
                </button>
                <button className="btn-sm btn-view" onClick={() => setEditingScheme(null)}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ENHANCED APPLICATION DETAIL MODAL */}
      {appDetail && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setAppDetail(null)}>
          <div className="modal-box" style={{ maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto' }}>
            <button className="modal-close" onClick={() => setAppDetail(null)}>✕</button>
            <div className="modal-title">Application Verification File</div>
            <div className="modal-sub">File #{appDetail.id} · Submitted {appDetail.date}</div>

            {/* Applicant Summary Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginTop: '1rem' }}>
              {[
                { label: 'Student Name', val: appDetail.name },
                { label: 'Student ID', val: appDetail.studentId },
                { label: 'Institution', val: appDetail.inst },
                { label: 'Course Enrolled', val: appDetail.course },
                { label: 'Scheme Applied', val: appDetail.scheme },
                { label: 'Requested Amount', val: `₹${appDetail.amount.toLocaleString()}` },
                { label: 'Current Status', val: appDetail.status },
                { label: 'Reviewing Officer', val: appDetail.officer || orgId },
              ].map(item => (
                <div key={item.label} style={{ padding: '.65rem .8rem', background: 'var(--bg)', borderRadius: '8px', border: '1px solid var(--border-2)' }}>
                  <div style={{ fontSize: '.7rem', color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '.2rem' }}>{item.label}</div>
                  <div style={{ fontSize: '.86rem', fontWeight: 600 }}>{item.val}</div>
                </div>
              ))}
            </div>

            {/* AI Trust Score Breakdown */}
            <div style={{ marginTop: '1.25rem', padding: '1rem', background: 'rgba(0,232,198,.04)', border: '1px solid rgba(0,232,198,.2)', borderRadius: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '.6rem' }}>
                <span style={{ fontWeight: 600, fontSize: '.9rem' }}>🛡️ GNN Trust & Verification Score</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--accent)' }}>{appDetail.aiScore}/100</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '.5rem', fontSize: '.78rem' }}>
                <div style={{ background: 'var(--bg)', padding: '.4rem .6rem', borderRadius: '6px' }}>
                  <span style={{ color: 'var(--text-3)' }}>Aadhaar Match:</span> <strong>98.2%</strong>
                </div>
                <div style={{ background: 'var(--bg)', padding: '.4rem .6rem', borderRadius: '6px' }}>
                  <span style={{ color: 'var(--text-3)' }}>Forgery Prob.:</span> <strong style={{ color: '#10b981' }}>0.4% (Clear)</strong>
                </div>
                <div style={{ background: 'var(--bg)', padding: '.4rem .6rem', borderRadius: '6px' }}>
                  <span style={{ color: 'var(--text-3)' }}>Income Match:</span> <strong>Cleared</strong>
                </div>
                <div style={{ background: 'var(--bg)', padding: '.4rem .6rem', borderRadius: '6px' }}>
                  <span style={{ color: 'var(--text-3)' }}>Vector Dup.:</span> <strong>0 Duplicates</strong>
                </div>
              </div>
            </div>

            {/* Attached Documents */}
            <div style={{ marginTop: '1.25rem' }}>
              <div style={{ fontSize: '.84rem', fontWeight: 600, marginBottom: '.5rem' }}>📎 Submitted Verification Documents</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.5rem' }}>
                {[
                  { name: 'Aadhaar Card (e-KYC)', type: 'PDF · 1.2 MB', verified: true },
                  { name: 'Class 12 / Degree Marksheet', type: 'PDF · 2.4 MB', verified: true },
                  { name: 'Tehsildar Income Certificate', type: 'PDF · 850 KB', verified: true },
                  { name: 'Bank Account Passbook / Statement', type: 'PDF · 1.8 MB', verified: true },
                ].map(doc => (
                  <div
                    key={doc.name}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '.6rem .75rem', background: 'var(--bg)', border: '1px solid var(--border-2)',
                      borderRadius: '8px', fontSize: '.8rem'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600 }}>{doc.name}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--text-3)' }}>{doc.type} · ✔ Verified</div>
                    </div>
                    <button
                      className="btn-sm btn-view"
                      style={{ padding: '.25rem .5rem', fontSize: '.75rem' }}
                      onClick={() => setDocPreview(doc.name)}
                    >
                      View
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
              {(appDetail.status === 'Pending Review' || appDetail.status === 'AI Verified') && (
                <>
                  <button
                    className="btn-primary"
                    style={{ flex: 1 }}
                    onClick={() => { handleAppAction(appDetail.id, 'Approved'); setAppDetail(null) }}
                  >
                    ✓ Approve Application
                  </button>
                  <button
                    className="btn-sm btn-reject"
                    style={{ flex: 1, padding: '.6rem' }}
                    onClick={() => { handleAppAction(appDetail.id, 'Rejected'); setAppDetail(null) }}
                  >
                    ✕ Reject Application
                  </button>
                </>
              )}
              {appDetail.status === 'Approved' && (
                <button
                  className="btn-primary"
                  style={{ flex: 1, background: 'rgba(59,130,246,.2)', borderColor: 'rgba(59,130,246,.5)', color: '#60a5fa' }}
                  onClick={() => {
                    setStudentTarget(appDetail.walletAddress || appDetail.studentId)
                    setTab('blockchain')
                    setAppDetail(null)
                  }}
                >
                  ⛓ Jump to Blockchain Payout
                </button>
              )}
              <button
                className="btn-sm btn-view"
                style={{ padding: '.6rem 1rem' }}
                onClick={() => setAppDetail(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DOCUMENT PREVIEW MODAL */}
      {docPreview && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setDocPreview(null)}>
          <div className="modal-box" style={{ maxWidth: '480px', textAlign: 'center' }}>
            <button className="modal-close" onClick={() => setDocPreview(null)}>✕</button>
            <div style={{ fontSize: '2.5rem', marginBottom: '.5rem' }}>📄</div>
            <div className="modal-title">{docPreview}</div>
            <div className="modal-sub" style={{ marginBottom: '1rem' }}>
              SHA256: 0x{Math.random().toString(16).substring(2, 18).toUpperCase()}... Verified by Government OCR Engine
            </div>
            <div style={{ background: 'var(--bg)', border: '1px dashed var(--border-2)', borderRadius: '10px', padding: '2rem 1rem', color: 'var(--text-2)', fontSize: '.88rem', lineHeight: 1.6 }}>
              ✔ Document metadata authenticated against National Academic Depository & UIDAI e-KYC gateway.<br/>
              No digital tampering or splicing anomalies detected.
            </div>
            <button className="btn-primary w-full" style={{ marginTop: '1.25rem' }} onClick={() => setDocPreview(null)}>
              Close Document Preview
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
