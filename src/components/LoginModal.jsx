import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/* ─── localStorage helpers ───────────────────────────────────────────── */
const CITIZEN_KEY = 'es_citizen_users'
const GOV_KEY     = 'es_gov_orgs'
const OTP_KEY     = 'es_pending_otp'

const readDB  = k => { try { return JSON.parse(localStorage.getItem(k) || '[]') } catch { return [] } }
const writeDB = (k, v) => localStorage.setItem(k, JSON.stringify(v))

const findCitizenByPhone = ph => readDB(CITIZEN_KEY).find(u => u.phone === ph) || null
const findGovByOrgId     = id => readDB(GOV_KEY).find(o => o.orgId === id)     || null
const findGovByEmail     = em => readDB(GOV_KEY).find(o => o.email === em.toLowerCase()) || null

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

const genOtp = () => String(Math.floor(100000 + Math.random() * 900000))

function storeOtp(key, otp) {
  sessionStorage.setItem(OTP_KEY, JSON.stringify({ key, otp, expiry: Date.now() + 5 * 60 * 1000 }))
}
function checkOtp(key, entered) {
  try {
    const s = JSON.parse(sessionStorage.getItem(OTP_KEY) || 'null')
    if (!s || s.key !== key)         return 'No OTP found. Request a new one.'
    if (Date.now() > s.expiry)       return 'OTP expired. Please request a new one.'
    if (s.otp !== entered.trim())    return 'Incorrect OTP. Please try again.'
    sessionStorage.removeItem(OTP_KEY)
    return null
  } catch { return 'OTP validation error.' }
}

/* ─── Employment options ─────────────────────────────────────────────── */
const EMP_OPTS = [
  'Student', 'Employed – Government', 'Employed – Private Sector',
  'Self-employed / Business Owner', 'Farmer / Agricultural Worker',
  'Unemployed / Job-seeker', 'Homemaker', 'Retired', 'Daily Wage Worker', 'Other',
]

/* ─── Schemes list ───────────────────────────────────────────────────── */
const SCHEME_OPTS = [
  'PM Scholarship Scheme', 'PM Fasal Bima Yojana', 'NMMSS',
  'Mukhyamantri Medhavi Vidyarthi Yojana', 'Central Sector Scholarship',
  'Post-Matric Scholarship – SC/ST/OBC', 'Minority Scholarship',
  'Pragati / Saksham (AICTE)', 'Ishan Uday (NER)', 'Other Government Scheme',
]

/* ─── Aadhaar live mask ──────────────────────────────────────────────── */
function maskAadhaar(d) {
  if (!d) return ''
  const p = d.padEnd(12, '·')
  return [p.slice(0,4), p.slice(4,8), p.slice(8,12)]
    .map((s, i) => i < 2 ? s.replace(/\d/g,'X') : s).join('  ')
}

/* ─── 6-box OTP input (hooks-compliant) ─────────────────────────────── */
function OtpBoxes({ value, onChange }) {
  const boxRefs = useRef([])
  const digits  = value.split('')

  const focusBox = i => boxRefs.current[i]?.focus()

  const handleChange = (i, e) => {
    const ch = e.target.value.replace(/\D/g,'').slice(-1)
    if (!ch) return
    const next = [...digits]; next[i] = ch; onChange(next.join(''))
    if (i < 5) focusBox(i + 1)
  }
  const handleKey = (i, e) => {
    if (e.key === 'Backspace') {
      if (digits[i]) { const next=[...digits]; next[i]=''; onChange(next.join('')) }
      else if (i > 0) { focusBox(i-1); const next=[...digits]; next[i-1]=''; onChange(next.join('')) }
    }
  }
  const handlePaste = e => {
    const text = e.clipboardData.getData('text').replace(/\D/g,'').slice(0,6)
    onChange(text)
    focusBox(Math.min(text.length, 5))
    e.preventDefault()
  }

  return (
    <div className="otp-boxes">
      {[0,1,2,3,4,5].map(i => (
        <input key={i}
          ref={el => boxRefs.current[i] = el}
          type="text" inputMode="numeric" maxLength={1}
          value={digits[i] || ''}
          onChange={e => handleChange(i, e)}
          onKeyDown={e => handleKey(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          className={`otp-box${digits[i] ? ' filled' : ''}`}
          autoFocus={i === 0}
        />
      ))}
    </div>
  )
}

/* ─── Countdown hook ─────────────────────────────────────────────────── */
function useCountdown() {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const start = (n = 30) => {
    clearInterval(ref.current)
    setCount(n)
    ref.current = setInterval(() =>
      setCount(c => { if (c <= 1) { clearInterval(ref.current); return 0 } return c - 1 }), 1000)
  }
  useEffect(() => () => clearInterval(ref.current), [])
  return [count, start]
}

/* ─── Reusable components ────────────────────────────────────────────── */
function MsgBox({ msg, type }) {
  if (!msg) return null
  return <div className={`auth-msg ${type}`}>{msg}</div>
}

function ModalBrand({ icon, name, sub }) {
  return (
    <div className="modal-brand">
      <span className="modal-brand-icon">{icon}</span>
      <div>
        <div className="modal-brand-name">{name}</div>
        <div className="modal-brand-sub">{sub}</div>
      </div>
    </div>
  )
}

function BackBtn({ onClick }) {
  return <button type="button" className="modal-back" onClick={onClick}>← Back</button>
}

function OtpScreen({ title, sub, maskedDest, pendOtp, otp, setOtp, countdown, onResend, onSubmit, busy, altAction, altLabel, err }) {
  useEffect(() => {
    if (otp.length === 6) onSubmit()
  }, [otp])

  return (
    <form className="modal-form" onSubmit={e => { e.preventDefault(); onSubmit() }}>
      {altAction && <BackBtn onClick={altAction} />}
      <div className="modal-step-title">{title}</div>
      <p className="modal-step-sub">OTP sent to <strong>{maskedDest}</strong></p>
      <div className="otp-sent-badge">📱 OTP sent — check your phone / email</div>
      <MsgBox msg={err} type="error" />
      <OtpBoxes value={otp} onChange={setOtp} />
      {pendOtp && <p className="modal-note" style={{textAlign:'left'}}>Demo OTP: <strong style={{color:'var(--accent)'}}>{pendOtp}</strong></p>}
      <div className="otp-resend-row">
        {countdown > 0
          ? <span>Resend in <strong>{countdown}s</strong></span>
          : <button type="button" className="link-btn" onClick={onResend}>Resend OTP</button>
        }
        {altLabel && altAction &&
          <button type="button" className="link-btn" onClick={altAction}>{altLabel}</button>
        }
      </div>
      <button type="submit" className="btn-primary w-full mt-1" disabled={otp.length < 6 || busy}>
        {busy ? 'Verifying…' : `${sub} →`}
      </button>
    </form>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   GOV PORTAL — Login + Register
═══════════════════════════════════════════════════════════════════════ */
function GovAuth({ onDone }) {
  // screen: 'login' | 'register' | 'success'
  const [screen, setScreen] = useState('login')

  // Login state
  const [loginOrgId, setLoginOrgId]   = useState('')
  const [loginPass,  setLoginPass]    = useState('')

  // Register state
  const [orgName,  setOrgName]   = useState('')
  const [website,  setWebsite]   = useState('')
  const [scheme,   setScheme]    = useState('')
  const [email,    setEmail]     = useState('')
  const [contact,  setContact]   = useState('')
  const [regPass,  setRegPass]   = useState('')
  const [regPass2, setRegPass2]  = useState('')
  const [orgId,    setOrgId]     = useState('')   // auto-generated, shown to user

  const [busy, setBusy] = useState(false)
  const [err,  setErr]  = useState('')
  const [successData, setSuccessData] = useState(null)

  const clr = () => setErr('')

  /* Login */
  const handleLogin = async e => {
    e.preventDefault(); clr()
    if (!loginOrgId.trim() || !loginPass) { setErr('Please enter your Organisation ID and password.'); return }
    setBusy(true)
    const hash = await sha256(loginPass)
    setBusy(false)
    const org = findGovByOrgId(loginOrgId.trim().toUpperCase())
    if (!org)             { setErr('Organisation ID not found.'); return }
    if (org.passwordHash !== hash) { setErr('Incorrect password.'); return }
    onDone(org)
  }

  /* Register */
  const handleRegister = async e => {
    e.preventDefault(); clr()
    if (!orgName.trim())  { setErr('Organisation name is required.'); return }
    if (!scheme)          { setErr('Please select a scheme.'); return }
    if (!email.trim())    { setErr('Contact email is required.'); return }
    if (!contact.trim())  { setErr('Contact person / phone is required.'); return }
    if (regPass.length < 8) { setErr('Password must be at least 8 characters.'); return }
    if (regPass !== regPass2) { setErr('Passwords do not match.'); return }
    if (findGovByEmail(email)) { setErr('This email is already registered.'); return }

    setBusy(true)
    const passwordHash = await sha256(regPass)
    // Auto-generate org ID: ES + 3 letters from org name + 4 digits
    const prefix = orgName.trim().replace(/[^a-zA-Z]/g,'').slice(0,3).toUpperCase().padEnd(3,'X')
    const newOrgId = `ES-${prefix}-${String(Date.now()).slice(-4)}`
    const org = {
      id: Date.now().toString(),
      orgName: orgName.trim(),
      website: website.trim(),
      scheme,
      email: email.trim().toLowerCase(),
      contact: contact.trim(),
      passwordHash,
      orgId: newOrgId,
      status: 'pending_review',
      createdAt: new Date().toISOString(),
    }
    const orgs = readDB(GOV_KEY)
    orgs.push(org)
    writeDB(GOV_KEY, orgs)
    setBusy(false)
    setOrgId(newOrgId)
    setSuccessData(org)
    setScreen('success')
  }

  if (screen === 'success') {
    return (
      <>
        <ModalBrand icon="🏛️" name="ExpressScheme" sub="Government Portal" />
        <div className="auth-success-screen">
          <div className="auth-success-icon">🏛️</div>
          <div className="auth-success-title">Organisation Registered!</div>
          <p className="auth-success-sub" style={{marginBottom:'.5rem'}}>
            Your Organisation ID is:
          </p>
          <div className="org-id-badge">{orgId}</div>
          <p className="auth-success-sub" style={{marginTop:'.7rem', fontSize:'.82rem'}}>
            Save this ID. You'll use it to log in.<br/>Account is under review — you'll be notified at <strong>{email}</strong>.
          </p>
          <button className="btn-primary w-full mt-1" onClick={() => setScreen('login')}>
            Go to Login →
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <ModalBrand icon="🏛️" name="ExpressScheme" sub="Government Officer Portal" />

      {/* Tab switcher */}
      <div className="modal-auth-tabs">
        <button className={screen === 'login'    ? 'active' : ''} onClick={() => { setScreen('login');    clr() }}>Sign In</button>
        <button className={screen === 'register' ? 'active' : ''} onClick={() => { setScreen('register'); clr() }}>Register Organisation</button>
      </div>

      {/* ── LOGIN ── */}
      {screen === 'login' && (
        <form className="modal-form" onSubmit={handleLogin}>
          <div className="modal-step-title">Officer Sign In</div>
          <p className="modal-step-sub">Enter your credentials to access the control panel</p>
          <MsgBox msg={err} type="error" />
          <div className="form-group">
            <label>Organisation ID</label>
            <input type="text" placeholder="ES-XXX-0000" value={loginOrgId}
              onChange={e => { setLoginOrgId(e.target.value.toUpperCase()); clr() }}
              style={{fontFamily:'monospace', letterSpacing:'.08em'}}
              autoFocus required />
            <span className="field-hint">Issued during organisation registration</span>
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Your secure password" value={loginPass}
              onChange={e => { setLoginPass(e.target.value); clr() }} required />
          </div>
          <button type="submit" className="btn-primary w-full mt-1" disabled={busy}>
            {busy ? 'Signing in…' : 'Enter Government Portal →'}
          </button>
          <p className="modal-note mt-1">
            Don't have an account? Switch to <button type="button" className="link-btn" onClick={() => { setScreen('register'); clr() }}>Register Organisation</button>
          </p>
        </form>
      )}

      {/* ── REGISTER ── */}
      {screen === 'register' && (
        <form className="modal-form" onSubmit={handleRegister}>
          <div className="modal-step-title">Register Your Organisation</div>
          <p className="modal-step-sub">Fill all details to get your Organisation ID</p>
          <MsgBox msg={err} type="error" />

          <div className="form-group">
            <label>Organisation Name *</label>
            <input type="text" placeholder="e.g. Madhya Pradesh Education Department"
              value={orgName} onChange={e => { setOrgName(e.target.value); clr() }} required autoFocus />
          </div>

          <div className="form-group">
            <label>Official Website <span className="optional-tag">optional</span></label>
            <input type="url" placeholder="https://education.mp.gov.in"
              value={website} onChange={e => { setWebsite(e.target.value); clr() }} />
          </div>

          <div className="form-group">
            <label>Scheme / Programme *</label>
            <select value={scheme} onChange={e => { setScheme(e.target.value); clr() }}
              className="form-select" required>
              <option value="">— Select the scheme you administer —</option>
              {SCHEME_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Official Contact Email *</label>
            <input type="email" placeholder="nodalofficer@dept.gov.in"
              value={email} onChange={e => { setEmail(e.target.value); clr() }} required />
          </div>

          <div className="form-group">
            <label>Contact Person / Phone *</label>
            <input type="text" placeholder="Name or phone number of nodal officer"
              value={contact} onChange={e => { setContact(e.target.value); clr() }} required />
          </div>

          <div className="form-row2">
            <div className="form-group">
              <label>Password *</label>
              <input type="password" placeholder="Min 8 characters" value={regPass}
                onChange={e => { setRegPass(e.target.value); clr() }} required minLength={8} />
            </div>
            <div className="form-group">
              <label>Confirm Password *</label>
              <input type="password" placeholder="Repeat password" value={regPass2}
                onChange={e => { setRegPass2(e.target.value); clr() }} required />
            </div>
          </div>

          <div className="gov-register-note">
            🔒 Your Organisation ID will be auto-generated and shown after registration.
          </div>

          <button type="submit" className="btn-primary w-full mt-1" disabled={busy}>
            {busy ? 'Registering…' : 'Register & Get Organisation ID →'}
          </button>
        </form>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   CITIZEN PORTAL — step-by-step flow
═══════════════════════════════════════════════════════════════════════ */
function CitizenAuth({ onDone }) {
  // screen: 'phone' | 'otp' | 'pwd' | 'register' | 'verify' | 'success'
  const [screen, setScreen] = useState('phone')

  const [phone,   setPhone]   = useState('')
  const [name,    setName]    = useState('')
  const [pass,    setPass]    = useState('')
  const [pass2,   setPass2]   = useState('')
  const [aadhaar, setAadhaar] = useState('')
  const [emp,     setEmp]     = useState('')
  const [otp,     setOtp]     = useState('')

  const [busy,    setBusy]   = useState(false)
  const [err,     setErr]    = useState('')
  const [pendOtp, setPendOtp] = useState('')

  const [countdown, startCountdown] = useCountdown()

  const clr  = () => setErr('')
  const dig  = s => s.replace(/\D/g,'')
  const ph   = dig(phone)
  const masked = `+91 XXXXXX${ph.slice(-4)}`

  const sendOtp = (phoneNum) => {
    const code = genOtp()
    storeOtp(phoneNum, code)
    setPendOtp(code)
    startCountdown(30)
    setOtp('')
  }

  /* Step 1 */
  const handlePhoneContinue = e => {
    e.preventDefault(); clr()
    if (ph.length !== 10) { setErr('Please enter a valid 10-digit mobile number.'); return }
    if (findCitizenByPhone(ph)) {
      sendOtp(ph)
      setScreen('otp')
    } else {
      setScreen('register')
    }
  }

  /* Login via OTP */
  const handleVerifyOtp = () => {
    clr()
    if (otp.length < 6) { setErr('Please enter the complete 6-digit OTP.'); return }
    const e = checkOtp(ph, otp)
    if (e) { setErr(e); return }
    const user = findCitizenByPhone(ph)
    if (!user) { setErr('Account not found.'); return }
    onDone(user)
  }

  /* Login via password */
  const handlePwdLogin = async e => {
    e.preventDefault(); clr()
    setBusy(true)
    const hash = await sha256(pass)
    setBusy(false)
    const user = findCitizenByPhone(ph)
    if (!user)                   { setErr('Mobile number not registered.'); return }
    if (user.passwordHash !== hash) { setErr('Incorrect password. Please try again.'); return }
    onDone(user)
  }

  /* Register — validate then send OTP */
  const handleRegisterSubmit = e => {
    e.preventDefault(); clr()
    if (!name.trim())               { setErr('Full name is required.'); return }
    if (ph.length !== 10)           { setErr('Valid 10-digit mobile number required.'); return }
    if (pass.length < 8)            { setErr('Password must be at least 8 characters.'); return }
    if (pass !== pass2)             { setErr('Passwords do not match.'); return }
    if (aadhaar && dig(aadhaar).length !== 12) { setErr('Aadhaar must be exactly 12 digits.'); return }
    if (!emp)                       { setErr('Please select your employment status.'); return }
    if (findCitizenByPhone(ph))     { setErr('Mobile number is already registered. Please sign in.'); return }
    sendOtp(ph)
    setScreen('verify')
  }

  /* Create account after OTP */
  const handleCreateAccount = async () => {
    clr()
    if (otp.length < 6) { setErr('Please enter the complete 6-digit OTP.'); return }
    const e = checkOtp(ph, otp)
    if (e) { setErr(e); return }
    setBusy(true)
    const [passwordHash, aadhaarHash] = await Promise.all([
      sha256(pass),
      aadhaar ? sha256(dig(aadhaar)) : Promise.resolve(null),
    ])
    const user = {
      id: Date.now().toString(),
      name: name.trim(), phone: ph,
      passwordHash, aadhaarHash,
      aadhaarLast4: aadhaar ? dig(aadhaar).slice(-4) : null,
      employment: emp,
      createdAt: new Date().toISOString(),
    }
    const users = readDB(CITIZEN_KEY)
    users.push(user)
    writeDB(CITIZEN_KEY, users)
    setBusy(false)
    setScreen('success')
    setTimeout(() => onDone(user), 2200)
  }

  return (
    <>
      <ModalBrand icon="⚡" name="ExpressScheme" sub="Citizen Services Portal" />

      {/* ─── PHONE ─── */}
      {screen === 'phone' && (
        <form className="modal-form" onSubmit={handlePhoneContinue}>
          <div className="modal-step-title">Sign In / Register</div>
          <p className="modal-step-sub">Enter your mobile number to continue</p>
          <MsgBox msg={err} type="error" />
          <div className="form-group">
            <label>Mobile Number</label>
            <div className="phone-input-wrap">
              <span className="phone-prefix">🇮🇳 +91</span>
              <input type="tel" placeholder="98XXXXXXXX" value={phone} autoFocus
                onChange={e => { setPhone(dig(e.target.value).slice(0,10)); clr() }}
                inputMode="numeric" maxLength={10} required />
            </div>
          </div>
          <button type="submit" className="btn-primary w-full mt-1" disabled={ph.length < 10}>
            Continue →
          </button>
          <p className="modal-note mt-1">New user? Just enter your number — we'll guide you through sign-up.</p>
        </form>
      )}

      {/* ─── OTP LOGIN ─── */}
      {screen === 'otp' && (
        <OtpScreen
          title="Verify Your Number"
          sub="Sign In"
          maskedDest={masked}
          pendOtp={pendOtp}
          otp={otp} setOtp={setOtp}
          countdown={countdown}
          onResend={() => { sendOtp(ph); clr() }}
          onSubmit={handleVerifyOtp}
          busy={busy}
          err={err}
          altAction={() => { setScreen('pwd'); clr() }}
          altLabel="Use password instead"
        />
      )}

      {/* ─── PASSWORD LOGIN ─── */}
      {screen === 'pwd' && (
        <form className="modal-form" onSubmit={handlePwdLogin}>
          <BackBtn onClick={() => { setScreen('otp'); clr() }} />
          <div className="modal-step-title">Enter Password</div>
          <p className="modal-step-sub">Mobile: <strong>+91 {ph}</strong></p>
          <MsgBox msg={err} type="error" />
          <div className="form-group">
            <label>Password</label>
            <input type="password" placeholder="Your account password" value={pass}
              onChange={e => { setPass(e.target.value); clr() }} autoFocus required />
          </div>
          <button type="submit" className="btn-primary w-full mt-1" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign In →'}
          </button>
          <div className="otp-resend-row" style={{justifyContent:'center', marginTop:'.5rem'}}>
            <button type="button" className="link-btn" onClick={() => { sendOtp(ph); setScreen('otp'); clr() }}>
              Login with OTP instead
            </button>
          </div>
        </form>
      )}

      {/* ─── REGISTER FORM ─── */}
      {screen === 'register' && (
        <form className="modal-form" onSubmit={handleRegisterSubmit}>
          <BackBtn onClick={() => { setScreen('phone'); clr() }} />
          <div className="modal-step-title">Create Your Account</div>
          <p className="modal-step-sub">New to ExpressScheme — let's set you up</p>
          <MsgBox msg={err} type="error" />

          <div className="form-group">
            <label>Full Name *</label>
            <input type="text" placeholder="As per Aadhaar / official ID" value={name}
              onChange={e => { setName(e.target.value); clr() }} required autoFocus />
          </div>

          <div className="form-group">
            <label>Mobile Number *</label>
            <div className="phone-input-wrap disabled">
              <span className="phone-prefix">🇮🇳 +91</span>
              <input type="tel" value={ph} readOnly style={{opacity:.7}} />
            </div>
            <span className="field-hint">Pre-filled — will be verified via OTP</span>
          </div>

          <div className="form-row2">
            <div className="form-group">
              <label>Password *</label>
              <input type="password" placeholder="Min 8 characters" value={pass}
                onChange={e => { setPass(e.target.value); clr() }} required minLength={8} />
            </div>
            <div className="form-group">
              <label>Confirm Password *</label>
              <input type="password" placeholder="Repeat password" value={pass2}
                onChange={e => { setPass2(e.target.value); clr() }} required />
            </div>
          </div>

          <div className="form-group">
            <label>Aadhaar Number <span className="optional-tag">optional</span></label>
            <input type="text" placeholder="12-digit Aadhaar" value={aadhaar}
              onChange={e => { setAadhaar(dig(e.target.value).slice(0,12)); clr() }}
              inputMode="numeric" maxLength={12} />
            {aadhaar.length > 0 && (
              <div className="aadhaar-preview">
                <span className="aadh-label">Stored as:</span>
                <span className="aadh-mask">{maskAadhaar(aadhaar)}</span>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Employment / Professional Status *</label>
            <select value={emp} onChange={e => { setEmp(e.target.value); clr() }}
              className="form-select" required>
              <option value="">— Select your current status —</option>
              {EMP_OPTS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          <button type="submit" className="btn-primary w-full mt-1" disabled={busy}>
            {busy ? 'Please wait…' : 'Verify Mobile & Create Account →'}
          </button>
        </form>
      )}

      {/* ─── OTP VERIFY (register) ─── */}
      {screen === 'verify' && (
        <OtpScreen
          title="Verify Mobile Number"
          sub="Create Account"
          maskedDest={masked}
          pendOtp={pendOtp}
          otp={otp} setOtp={setOtp}
          countdown={countdown}
          onResend={() => { sendOtp(ph); clr() }}
          onSubmit={handleCreateAccount}
          busy={busy}
          err={err}
          altAction={() => { setScreen('register'); clr() }}
          altLabel={null}
        />
      )}

      {/* ─── SUCCESS ─── */}
      {screen === 'success' && (
        <div className="auth-success-screen">
          <div className="auth-success-icon">✅</div>
          <div className="auth-success-title">Account Created!</div>
          <p className="auth-success-sub">Welcome, <strong>{name}</strong>. Redirecting to your dashboard…</p>
          <div className="auth-success-bar"><div className="auth-success-fill" /></div>
        </div>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   MODAL WRAPPER
═══════════════════════════════════════════════════════════════════════ */
export default function LoginModal({ role, onClose }) {
  const navigate = useNavigate()
  if (!role) return null
  const isGov = role === 'gov'

  const handleDone = (user) => {
    onClose()
    if (isGov) {
      if (user) sessionStorage.setItem('gov_org', JSON.stringify(user))
      navigate('/gov-dashboard')
    } else {
      if (user) sessionStorage.setItem('citizen_user', JSON.stringify(user))
      navigate('/user-dashboard')
    }
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal-box${isGov ? ' modal-box--gov' : ' modal-box--citizen'}`}>
        <button className="modal-close" onClick={onClose}>✕</button>
        {isGov
          ? <GovAuth     onDone={handleDone} />
          : <CitizenAuth onDone={handleDone} />
        }
      </div>
    </div>
  )
}
