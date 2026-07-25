const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const TOKEN_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 7);
const databaseUrl = process.env.DATABASE_URL;
let pool;
let localSessions = new Map();
let storeFile;

const hashToken = token => crypto.createHash('sha256').update(token).digest('hex');
const isHash = value => /^\$2[aby]\$\d{2}\$/.test(value || '');

async function protectPasswords(data) {
  for (const user of data.users || []) {
    if (!user.passwordHash) user.passwordHash = await bcrypt.hash(user.password || crypto.randomBytes(24).toString('hex'), 12);
    delete user.password;
  }
  return data;
}

async function initStorage(root, initialData) {
  const data = await protectPasswords(structuredClone(initialData));
  if (!databaseUrl) {
    storeFile = path.join(root, 'data', 'store.json');
    try {
      const disk = await protectPasswords(JSON.parse(fs.readFileSync(storeFile, 'utf8')));
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
      fs.writeFileSync(storeFile, JSON.stringify(disk, null, 2));
      return { data: disk, mode: 'json' };
    } catch {
      fs.mkdirSync(path.dirname(storeFile), { recursive: true });
      fs.writeFileSync(storeFile, JSON.stringify(data, null, 2));
      return { data, mode: 'json' };
    }
  }

  pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    max: Number(process.env.PG_POOL_MAX || 10)
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions(expires_at);
  `);
  const existing = await pool.query('SELECT data FROM app_state WHERE id = 1');
  if (!existing.rowCount) {
    await pool.query('INSERT INTO app_state(id, data) VALUES(1, $1::jsonb)', [JSON.stringify(data)]);
    return { data, mode: 'postgres' };
  }
  const loaded = await protectPasswords(existing.rows[0].data);
  await saveData(loaded);
  await pool.query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
  return { data: loaded, mode: 'postgres' };
}

async function saveData(data) {
  if (!pool) {
    fs.writeFileSync(storeFile, JSON.stringify(data, null, 2));
    return;
  }
  await pool.query('UPDATE app_state SET data = $1::jsonb, updated_at = NOW() WHERE id = 1', [JSON.stringify(data)]);
}

async function verifyPassword(user, password) {
  if (!user?.passwordHash || !isHash(user.passwordHash)) return false;
  return bcrypt.compare(String(password || ''), user.passwordHash);
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000);
  if (pool) await pool.query('INSERT INTO user_sessions(token_hash, user_id, expires_at) VALUES($1,$2,$3)', [hashToken(token), userId, expiresAt]);
  else localSessions.set(hashToken(token), { userId, expiresAt });
  return token;
}

async function findSession(token) {
  if (!token) return null;
  const key = hashToken(token);
  if (pool) {
    const result = await pool.query('SELECT user_id FROM user_sessions WHERE token_hash=$1 AND expires_at > NOW()', [key]);
    return result.rows[0]?.user_id || null;
  }
  const session = localSessions.get(key);
  if (!session || session.expiresAt <= new Date()) { localSessions.delete(key); return null; }
  return session.userId;
}

async function deleteSession(token) {
  if (!token) return;
  const key = hashToken(token);
  if (pool) await pool.query('DELETE FROM user_sessions WHERE token_hash=$1', [key]);
  else localSessions.delete(key);
}

async function health() {
  if (!pool) return { storage: 'json' };
  await pool.query('SELECT 1');
  return { storage: 'postgres' };
}

module.exports = { initStorage, saveData, verifyPassword, createSession, findSession, deleteSession, health };
