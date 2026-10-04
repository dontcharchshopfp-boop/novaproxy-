const crypto = require('crypto');
const config = require('./config');
const { findApiKey, touchApiKey } = require('./db');

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function extractBearer(req) {
  const header = req.get('authorization') || '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  return header.slice(7).trim();
}

async function requireApiKey(req, res, next) {
  try {
    const rawKey = extractBearer(req);
    if (!rawKey) return res.status(401).json({ error: { message: 'Missing Bearer API key.', type: 'authentication_error' } });

    const row = await findApiKey(rawKey);
    if (!row || !row.active) {
      return res.status(401).json({ error: { message: 'Invalid or disabled API key.', type: 'authentication_error' } });
    }

    req.proxyKey = row;
    // Do not block the actual upstream request on statistics.
    void touchApiKey(row.id);
    next();
  } catch (err) {
    next(err);
  }
}

function makeAdminToken() {
  const payload = Buffer.from(JSON.stringify({
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', config.adminSessionSecret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyAdminToken(token) {
  try {
    if (!token || !token.includes('.')) return false;
    const [payload, sig] = token.split('.', 2);
    const expected = crypto.createHmac('sha256', config.adminSessionSecret).update(payload).digest('base64url');
    if (!safeEqual(sig, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Date.now() < Number(data.exp);
  } catch {
    return false;
  }
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  const found = raw.split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : null;
}

function requireAdmin(req, res, next) {
  if (!verifyAdminToken(getCookie(req, 'admin_session'))) {
    return res.status(401).json({ error: 'Admin authentication required.' });
  }
  next();
}

module.exports = {
  safeEqual,
  extractBearer,
  requireApiKey,
  makeAdminToken,
  verifyAdminToken,
  getCookie,
  requireAdmin
};
