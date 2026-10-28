/**
 * perawallet.js — Pera Wallet Connect & Algorand TestNet Provider
 *
 * Handles:
 *   • Official Pera Wallet Mobile (QR) & Pera Web Connect
 *   • Auto-reconnect on refresh
 *   • High-availability TestNet demo & simulation accounts (instant connection)
 *   • Custom TestNet address connection
 *   • Event dispatches for real-time dashboard updates across components
 *
 * Security:
 *   • We ONLY store the wallet address and connection mode (public metadata).
 *   • Private keys / mnemonics never touch this application.
 */

import { PeraWalletConnect } from '@perawallet/connect'

// Singleton — one instance per page session
let _pera = null

/** Return (or create) the shared PeraWalletConnect instance. */
export function getPeraWallet() {
  if (!_pera) {
    try {
      _pera = new PeraWalletConnect({
        chainId: 416002,          // Algorand TestNet chain ID
        shouldShowSignTxnToast: true,
      })
    } catch (e) {
      console.warn('PeraWalletConnect init warning:', e)
    }
  }
  return _pera
}

// ─── Storage keys ─────────────────────────────────────────────────────────────
const ADDR_KEY = 'pera_connected_address'
const MODE_KEY = 'pera_wallet_mode'      // 'pera' | 'demo_student' | 'demo_authority' | 'custom'
const LABEL_KEY = 'pera_wallet_label'

// Role-specific storage keys
const STUDENT_ADDR_KEY = 'pera_student_address'
const STUDENT_MODE_KEY = 'pera_student_mode'
const STUDENT_LABEL_KEY = 'pera_student_label'

const GOV_ADDR_KEY = 'pera_gov_address'
const GOV_MODE_KEY = 'pera_gov_mode'
const GOV_LABEL_KEY = 'pera_gov_label'

export function saveAddress(addr, mode = 'pera', label = '', role = null) {
  if (!addr) return
  // Determine role if not specified
  const targetRole = role || (mode?.includes('authority') || mode?.includes('gov') ? 'gov' : 'student')

  if (targetRole === 'gov') {
    localStorage.setItem(GOV_ADDR_KEY, addr)
    localStorage.setItem(GOV_MODE_KEY, mode)
    if (label) localStorage.setItem(GOV_LABEL_KEY, label)
  } else {
    localStorage.setItem(STUDENT_ADDR_KEY, addr)
    localStorage.setItem(STUDENT_MODE_KEY, mode)
    if (label) localStorage.setItem(STUDENT_LABEL_KEY, label)
  }

  // Also maintain global active address
  localStorage.setItem(ADDR_KEY, addr)
  localStorage.setItem(MODE_KEY, mode)
  if (label) localStorage.setItem(LABEL_KEY, label)
  else localStorage.removeItem(LABEL_KEY)

  // Dispatch custom window events
  try {
    window.dispatchEvent(new CustomEvent('pera_wallet_updated', {
      detail: { address: addr, mode, label, role: targetRole }
    }))
  } catch {}
}

export function loadAddress(role = null) {
  // If specific role requested:
  if (role === 'gov' || role === 'authority') {
    return localStorage.getItem(GOV_ADDR_KEY) || DEMO_WALLETS.authority.address
  }
  if (role === 'student' || role === 'user') {
    return localStorage.getItem(STUDENT_ADDR_KEY) || DEMO_WALLETS.student.address
  }

  // Auto-detect from active session if in gov dashboard or user dashboard
  try {
    if (typeof window !== 'undefined') {
      const path = window.location.pathname
      if (path.includes('gov')) {
        return localStorage.getItem(GOV_ADDR_KEY) || DEMO_WALLETS.authority.address
      }
      if (path.includes('user')) {
        return localStorage.getItem(STUDENT_ADDR_KEY) || DEMO_WALLETS.student.address
      }
      // Check session
      if (sessionStorage.getItem('gov_org')) {
        return localStorage.getItem(GOV_ADDR_KEY) || DEMO_WALLETS.authority.address
      }
      if (sessionStorage.getItem('citizen_user')) {
        return localStorage.getItem(STUDENT_ADDR_KEY) || DEMO_WALLETS.student.address
      }
    }
  } catch {}

  return localStorage.getItem(ADDR_KEY) || DEMO_WALLETS.student.address
}

export function getWalletMode(role = null) {
  if (role === 'gov' || role === 'authority') {
    return localStorage.getItem(GOV_MODE_KEY) || 'demo_authority'
  }
  if (role === 'student' || role === 'user') {
    return localStorage.getItem(STUDENT_MODE_KEY) || 'demo_student'
  }
  return localStorage.getItem(MODE_KEY) || 'demo_student'
}

export function getWalletLabel(role = null) {
  if (role === 'gov' || role === 'authority') {
    return localStorage.getItem(GOV_LABEL_KEY) || DEMO_WALLETS.authority.label
  }
  if (role === 'student' || role === 'user') {
    return localStorage.getItem(STUDENT_LABEL_KEY) || DEMO_WALLETS.student.label
  }
  return localStorage.getItem(LABEL_KEY) || ''
}

export function clearAddress(role = null) {
  if (role === 'gov') {
    localStorage.removeItem(GOV_ADDR_KEY)
    localStorage.removeItem(GOV_MODE_KEY)
    localStorage.removeItem(GOV_LABEL_KEY)
  } else if (role === 'student') {
    localStorage.removeItem(STUDENT_ADDR_KEY)
    localStorage.removeItem(STUDENT_MODE_KEY)
    localStorage.removeItem(STUDENT_LABEL_KEY)
  } else {
    localStorage.removeItem(ADDR_KEY)
    localStorage.removeItem(MODE_KEY)
    localStorage.removeItem(LABEL_KEY)
  }
  try {
    window.dispatchEvent(new CustomEvent('pera_wallet_updated', { detail: { address: null, mode: null, label: '', role } }))
  } catch {}
}

// ─── Standard Demo Accounts for Zero-Friction Testing ─────────────────────────
export const DEMO_WALLETS = {
  student: {
    address: 'EW6GDRDYKFDMOW625MABOUBOPVBEDIFMTGZWOT3DUCQQUMVJZNXD27Q3Y4',
    label: 'Student Beneficiary (Divya / TestNet)',
    balance: '14.50 ALGO',
    role: 'Student Beneficiary',
  },
  authority: {
    address: 'CKNSI7KYTGPFIVHBJHTIV3HQWCE46I5BWJAUOIQ5VW47O4RI4ODTAZXEDU',
    label: 'Ministry Treasury Officer (Creator / TestNet)',
    balance: '890.25 ALGO',
    role: 'Government Authority (App Creator)',
  },
}

// ─── Connect via Pera Wallet (Official QR / Web) ──────────────────────────────
export async function connectWallet(role = null) {
  const pera = getPeraWallet()
  if (!pera) throw new Error('Pera Wallet SDK is not available.')

  try {
    const accounts = await pera.connect()
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned from Pera Wallet.')
    }
    const address = accounts[0]
    saveAddress(address, 'pera', 'Pera Wallet Connected', role)
    return address
  } catch (err) {
    if (err?.message?.includes('Modal closed') || err?.message?.includes('cancelled')) {
      throw new Error('Pera connection cancelled.')
    }
    throw err
  }
}

// ─── Connect via Demo TestNet Account (Instant) ───────────────────────────────
export function connectDemoWallet(type = 'student') {
  const wallet = DEMO_WALLETS[type] || DEMO_WALLETS.student
  const role = type === 'authority' ? 'gov' : 'student'
  saveAddress(wallet.address, `demo_${type}`, wallet.label, role)
  return wallet.address
}

// ─── Connect via Custom Algorand Address ──────────────────────────────────────
export function connectCustomAddress(address, role = null) {
  const clean = String(address || '').trim()
  if (clean.length !== 58 && !clean.startsWith('ALGO_')) {
    throw new Error('Please enter a valid 58-character Algorand TestNet address.')
  }
  saveAddress(clean, 'custom', 'Custom TestNet Account', role)
  return clean
}

// ─── Reconnect (on page refresh) ─────────────────────────────────────────────
export async function reconnectWallet() {
  const existing = loadAddress()
  const mode = getWalletMode()

  // If connected via demo or custom, restore immediately
  if (existing && mode && mode !== 'pera') {
    return existing
  }

  // If connected via Pera, restore Pera session
  const pera = getPeraWallet()
  if (pera) {
    try {
      const accounts = await pera.reconnectSession()
      if (accounts && accounts.length > 0) {
        const address = accounts[0]
        saveAddress(address, 'pera', 'Pera Wallet Reconnected')
        return address
      }
    } catch {
      // Session expired or missing
    }
  }

  // Return existing address if stored in local storage
  return existing || null
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
export async function disconnectWallet() {
  const pera = getPeraWallet()
  if (pera) {
    try {
      await pera.disconnect()
    } catch {}
  }
  clearAddress()
}

// ─── Sign Transactions Helper ────────────────────────────────────────────────
export async function signTransactions(txGroups) {
  const pera = getPeraWallet()
  const mode = getWalletMode()

  if (mode === 'pera' && pera?.isConnected) {
    return pera.signTransaction([txGroups])
  }

  // For Demo/Simulated mode, return simulated signed bytes
  return txGroups.map(() => new Uint8Array(64).fill(1))
}
