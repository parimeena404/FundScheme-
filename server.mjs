/**
 * ExpressScheme — MongoDB API Server
 * Runs on port 3001. Vite proxies /api → this server.
 * Keeps MongoDB credentials server-side (never exposed to browser).
 */

import express        from 'express'
import cors           from 'cors'
import { MongoClient, ObjectId } from 'mongodb'
import crypto         from 'crypto'

// ── Connection config ─────────────────────────────────────────────────
const MONGO_URI = 'mongodb+srv://mytholover85_db_user:DsJP1dAddduUiCx8@cluster0.eqmtdhi.mongodb.net/?appName=Cluster0'
const DB_NAME   = 'excessscheme'
const PORT      = 3001

// ── MongoDB singleton client ──────────────────────────────────────────
let client
let db

async function getDb() {
  if (db) return db
  client = new MongoClient(MONGO_URI, {
    serverSelectionTimeoutMS: 8000,
    tls: true,
    tlsAllowInvalidCertificates: true,
  })
  await client.connect()
  db = client.db(DB_NAME)
  console.log(`  ✓ MongoDB connected — database: ${DB_NAME}`)
  return db
}

// ── Express setup ─────────────────────────────────────────────────────
const app = express()
app.use(cors({ origin: 'http://localhost:3000' }))
app.use(express.json({ limit: '2mb' }))

// ── Helper: normalise _id in results ─────────────────────────────────
function normalize(doc) {
  if (!doc) return doc
  if (Array.isArray(doc)) return doc.map(normalize)
  const { _id, ...rest } = doc
  return { _id: _id?.toString(), ...rest }
}

// ── Health check ─────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  try {
    await getDb()
    res.json({ ok: true, db: DB_NAME })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

// ──────────────────────────────────────────────────────────────────────
// Generic CRUD routes  (all POST for simplicity — no complex URL parsing)
// ──────────────────────────────────────────────────────────────────────

/** find / findOne */
app.post('/api/mongo/find', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, filter = {}, options = {}, one = false } = req.body
    const col = database.collection(collection)
    if (one) {
      const doc = await col.findOne(filter, options)
      return res.json({ data: normalize(doc), error: null })
    }
    const docs = await col.find(filter, options).toArray()
    return res.json({ data: normalize(docs), error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

/** insertOne */
app.post('/api/mongo/insertOne', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, document } = req.body
    const doc = { ...document, createdAt: new Date(), updatedAt: new Date() }
    const result = await database.collection(collection).insertOne(doc)
    return res.json({ data: { _id: result.insertedId.toString(), ...doc }, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

/** insertMany */
app.post('/api/mongo/insertMany', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, documents } = req.body
    const now = new Date()
    const docs = documents.map(d => ({ ...d, createdAt: now, updatedAt: now }))
    const result = await database.collection(collection).insertMany(docs)
    return res.json({ data: { insertedCount: result.insertedCount }, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

/** updateOne */
app.post('/api/mongo/updateOne', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, filter, update, upsert = false } = req.body
    const updateDoc = { ...update, $set: { ...(update.$set || {}), updatedAt: new Date() } }
    const result = await database.collection(collection).findOneAndUpdate(
      filter, updateDoc, { returnDocument: 'after', upsert }
    )
    return res.json({ data: normalize(result), error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

/** deleteOne */
app.post('/api/mongo/deleteOne', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, filter } = req.body
    const result = await database.collection(collection).deleteOne(filter)
    return res.json({ data: { deletedCount: result.deletedCount }, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

/** aggregate */
app.post('/api/mongo/aggregate', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, pipeline } = req.body
    const docs = await database.collection(collection).aggregate(pipeline).toArray()
    return res.json({ data: normalize(docs), error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

/** countDocuments */
app.post('/api/mongo/count', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, filter = {} } = req.body
    const count = await database.collection(collection).countDocuments(filter)
    return res.json({ data: count, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

/** upsertOne */
app.post('/api/mongo/upsertOne', async (req, res) => {
  try {
    const database = await getDb()
    const { collection, filter, document } = req.body
    const doc = { ...document, updatedAt: new Date() }
    const result = await database.collection(collection).findOneAndUpdate(
      filter,
      { $set: doc, $setOnInsert: { createdAt: new Date() } },
      { returnDocument: 'after', upsert: true }
    )
    return res.json({ data: normalize(result), error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

// ── Start ─────────────────────────────────────────────────────────────
// ── Auth helpers ─────────────────────────────────────────────────────
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

// In-memory OTP store  { phone → { otp, expiresAt } }
const otpStore = new Map()

// ── POST /api/auth/register ──────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const database = await getDb()
    const { name, phone, password, aadhaar, employment } = req.body
    if (!name || !phone || !password) return res.status(400).json({ error: 'name, phone and password are required' })

    const existing = await database.collection('citizen_users').findOne({ phone })
    if (existing) return res.status(409).json({ error: 'Phone number already registered' })

    const doc = {
      name,
      phone,
      passwordHash: sha256(password),
      aadhaarHash:  aadhaar ? sha256(aadhaar) : null,
      aadhaarLast4: aadhaar ? aadhaar.replace(/\D/g,'').slice(-4) : null,
      employment:   employment || 'not_specified',
      createdAt:    new Date(),
      updatedAt:    new Date(),
    }
    const result = await database.collection('citizen_users').insertOne(doc)
    const user = { _id: result.insertedId.toString(), name: doc.name, phone: doc.phone, employment: doc.employment, aadhaarLast4: doc.aadhaarLast4 }
    return res.json({ data: user, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

// ── POST /api/auth/login ─────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const database = await getDb()
    const { phone, password } = req.body
    if (!phone || !password) return res.status(400).json({ error: 'phone and password are required' })

    const doc = await database.collection('citizen_users').findOne({ phone })
    if (!doc) return res.status(401).json({ error: 'Phone number not found' })
    if (doc.passwordHash !== sha256(password)) return res.status(401).json({ error: 'Incorrect password' })

    const user = { _id: doc._id.toString(), name: doc.name, phone: doc.phone, employment: doc.employment, aadhaarLast4: doc.aadhaarLast4 }
    return res.json({ data: user, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

// ── POST /api/auth/send-otp ──────────────────────────────────────────
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const database = await getDb()
    const { phone } = req.body
    if (!phone) return res.status(400).json({ error: 'phone is required' })

    const doc = await database.collection('citizen_users').findOne({ phone })
    if (!doc) return res.status(404).json({ error: 'Phone number not registered' })

    const otp = String(Math.floor(100000 + Math.random() * 900000))
    otpStore.set(phone, { otp, expiresAt: Date.now() + 5 * 60 * 1000 })
    console.log(`  📱 OTP for ${phone}: ${otp}`)   // In production → send via SMS
    return res.json({ data: { sent: true, demo_otp: otp }, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

// ── POST /api/auth/verify-otp ────────────────────────────────────────
app.post('/api/auth/verify-otp', async (req, res) => {
  try {
    const database = await getDb()
    const { phone, otp } = req.body
    if (!phone || !otp) return res.status(400).json({ error: 'phone and otp are required' })

    const entry = otpStore.get(phone)
    if (!entry) return res.status(400).json({ error: 'No OTP requested for this number' })
    if (Date.now() > entry.expiresAt) { otpStore.delete(phone); return res.status(400).json({ error: 'OTP expired' }) }
    if (entry.otp !== otp) return res.status(401).json({ error: 'Incorrect OTP' })

    otpStore.delete(phone)
    const doc = await database.collection('citizen_users').findOne({ phone })
    const user = { _id: doc._id.toString(), name: doc.name, phone: doc.phone, employment: doc.employment, aadhaarLast4: doc.aadhaarLast4 }
    return res.json({ data: user, error: null })
  } catch (e) {
    res.status(500).json({ data: null, error: e.message })
  }
})

app.listen(PORT, () => {
  console.log('')
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║   ExpressScheme — MongoDB API Server                 ║')
  console.log(`║   http://localhost:${PORT}/api                           ║`)
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log('')
  // Eagerly connect
  getDb().catch(err => console.error('  ✗ MongoDB connect error:', err.message))
})

// ── Graceful shutdown ─────────────────────────────────────────────────
process.on('SIGINT',  () => { client?.close(); process.exit(0) })
process.on('SIGTERM', () => { client?.close(); process.exit(0) })
