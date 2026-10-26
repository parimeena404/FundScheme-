import { useNavigate } from 'react-router-dom'

export default function Sidebar({ role, tabs, activeTab, onTabChange, open, onClose }) {
  const navigate = useNavigate()
  const isGov = role === 'gov'

  // Read actual logged-in user from session
  let userName = isGov ? 'Gov Officer' : 'Citizen'
  let userId = isGov ? 'OFF-001' : 'STU-001'
  let initials = 'GO'
  try {
    if (isGov) {
      const org = JSON.parse(sessionStorage.getItem('gov_org') || 'null')
      if (org) {
        userName = org.orgName || 'Gov Officer'
        userId = org.orgId || 'OFF-001'
        initials = userName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
      }
    } else {
      const citizen = JSON.parse(sessionStorage.getItem('citizen_user') || 'null')
      if (citizen) {
        userName = citizen.name || 'Citizen'
        userId = citizen.phone ? '+91 ' + citizen.phone : 'STU-001'
        initials = userName.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()
      }
    }
  } catch {}

  const handleLogout = () => {
    if (isGov) sessionStorage.removeItem('gov_org')
    else sessionStorage.removeItem('citizen_user')
    navigate('/')
  }

  return (
    <>
      {/* Backdrop overlay — tap to close on mobile */}
      <div
        className={`sidebar-overlay${open ? ' visible' : ''}`}
        onClick={onClose}
      />
      <aside className={`sidebar${open ? ' open' : ' hidden'}`}>
      <div className="sidebar-brand">
        <span style={{ color:'var(--accent)' }}>⚡</span>
        <span>ExpressScheme</span>
      </div>
      <div className="sidebar-role-badge">
        <span className={`role-dot ${isGov ? 'gov-dot' : 'user-dot'}`}></span>
        {isGov ? 'Gov Officer' : 'Citizen Portal'}
      </div>

      <nav className="sidebar-nav">
        {tabs.map(t => (
          <div
            key={t.id}
            className={`snav-item${activeTab === t.id ? ' active' : ''}`}
            onClick={() => onTabChange(t.id)}
          >
            <span className="snav-icon">{t.icon}</span>
            <span>{t.label}</span>
            {t.badge ? <span className="nav-badge">{t.badge}</span> : null}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className={`su-avatar ${isGov ? 'gov-avatar' : 'user-avatar'}`}>
            {initials}
          </div>
          <div className="su-info">
            <span className="su-name">{userName.length > 22 ? userName.slice(0,22) + '…' : userName}</span>
            <span className="su-id">{userId}</span>
          </div>
        </div>
        <span className="logout-btn" onClick={handleLogout} style={{ cursor:'pointer' }}>
          Logout
        </span>
      </div>
    </aside>
    </>
  )
}
