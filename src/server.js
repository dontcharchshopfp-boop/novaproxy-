const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config');
const {
  createApiKey,
  listApiKeys,
  updateApiKey,
  deleteApiKey,
  findApiKey
} = require('./db');
const {
  safeEqual,
  requireApiKey,
  makeAdminToken,
  getCookie,
  verifyAdminToken,
  requireAdmin
} = require('./auth');
const { proxyJson, fetchModels, STRAX_MODEL_IDS } = require('./proxy');
require('./keepalive');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false, contentSecurityPolicy: false }));
app.use((req, res, next) => {
  const allowed = config.allowedOrigins;
  const origin = req.get('origin');
  if (allowed.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && allowed.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: `${config.maxBodyMb}mb` }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.static('public'));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.apiRateLimitPerMinute,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: { message: 'Rate limit exceeded.', type: 'rate_limit_error' } }
});
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: config.adminRateLimitPerMinute,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many admin requests.' }
});
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many balance checks. Try again shortly.' }
});

function isExpired(row) {
  return row?.expires_at && new Date(row.expires_at).getTime() <= Date.now();
}

function sanitizeKeyInfo(row) {
  return {
    name: row.name,
    active: Boolean(row.active) && !isExpired(row),
    expired: Boolean(isExpired(row)),
    balance: Number(row.balance || 0),
    currency: 'token',
    request_count: Number(row.request_count || 0),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
    allowed_models: Array.isArray(row.allowed_models) ? row.allowed_models : []
  };
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'novaproxy', time: new Date().toISOString() }));

app.post('/api/key-info', publicLimiter, async (req, res, next) => {
  try {
    const rawKey = String(req.body?.api_key || '').trim();
    if (!rawKey) return res.status(400).json({ error: 'Введите API ключ.' });
    const row = await findApiKey(rawKey);
    if (!row) return res.status(404).json({ error: 'Такого API ключа нет в базе NovaProxy.' });
    const info = sanitizeKeyInfo(row);
    if (!row.active || info.expired) {
      return res.status(403).json({ ...info, error: info.expired ? 'Срок действия API ключа истёк.' : 'API ключ отключён администратором.' });
    }
    let models = info.allowed_models;
    if (!models.length) {
      try { models = (await fetchModels()).map(m => m.id); } catch { models = []; }
    }
    res.json({ ...info, allowed_models: models });
  } catch (err) { next(err); }
});

app.get('/v1/models', apiLimiter, requireApiKey, async (req, res, next) => {
  try {
    const data = await fetchModels();
    const allowed = req.proxyKey.allowed_models || [];
    const filtered = allowed.length ? data.filter(m => allowed.includes(m.id)) : data;
    res.json({ object: 'list', data: filtered });
  } catch (err) { next(err); }
});

async function handleChatCompletions(req, res, next) {
  console.log(`[API] POST ${req.originalUrl} -> chat/completions`);
  try {
    const allowed = req.proxyKey.allowed_models || [];
    const model = req.body?.model;
    if (allowed.length && model && !allowed.includes(model)) {
      console.log(`[API] Model blocked: ${model}`);
      return res.status(403).json({ error: { message: `Model \"${model}\" is not available for this API key.`, type: 'model_not_allowed' } });
    }

    // STRAX is a strict secondary route: only the four explicitly allowlisted
    // GPT/Claude models can ever be sent there. Every other model stays on Alibaba.
    if (STRAX_MODEL_IDS.has(model) && !process.env.STRAX_API) {
      return res.status(503).json({
        error: {
          message: 'STRAX provider is not configured on this server.',
          type: 'provider_not_configured',
          param: 'STRAX_API'
        }
      });
    }

    await proxyJson(req, res);
  } catch (err) {
    console.error('[API] chat/completions error:', err);
    next(err);
  }
}

// Explicit chat completions route. Express 5 works best with a literal path here.
app.use('/v1/chat/completions', (req, res, next) => {
  console.log(`[TRACE] chat route reached: ${req.method} ${req.originalUrl}`);
  next();
});

app.post('/v1/chat/completions', apiLimiter, requireApiKey, handleChatCompletions);

app.all('/v1/*splat', apiLimiter, requireApiKey, async (req, res, next) => {
  try { await proxyJson(req, res); } catch (err) { next(err); }
});

app.get('/admin/status', adminLimiter, (req, res) => res.json({ authenticated: verifyAdminToken(getCookie(req, 'admin_session')) }));
app.post('/admin/login', adminLimiter, (req, res) => {
  const password = String(req.body?.password || '');
  if (!safeEqual(password, config.adminPassword)) return res.status(401).json({ error: 'Invalid password.' });
  const token = makeAdminToken();
  res.setHeader('Set-Cookie', `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/admin/logout', adminLimiter, requireAdmin, (req, res) => {
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
  res.json({ ok: true });
});
app.get('/admin/api/keys', adminLimiter, requireAdmin, async (req, res, next) => {
  try { res.json({ keys: await listApiKeys() }); } catch (err) { next(err); }
});
app.post('/admin/api/keys', adminLimiter, requireAdmin, async (req, res, next) => {
  try { res.status(201).json({ key: await createApiKey(req.body || {}) }); } catch (err) { next(err); }
});
app.patch('/admin/api/keys/:id', adminLimiter, requireAdmin, async (req, res, next) => {
  try { res.json({ key: await updateApiKey(req.params.id, req.body || {}) }); } catch (err) { next(err); }
});
app.delete('/admin/api/keys/:id', adminLimiter, requireAdmin, async (req, res, next) => {
  try { await deleteApiKey(req.params.id); res.json({ ok: true }); } catch (err) { next(err); }
});
app.get('/admin', (req, res) => res.sendFile(path.join(process.cwd(), 'public', 'admin.html')));
app.use((req, res) => {
  if (req.path.startsWith('/v1/')) return res.status(404).json({ error: { message: 'Endpoint not found.', type: 'invalid_request_error' } });
  res.status(404).json({ error: 'Not found.' });
});
app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled request error');
  console.error('[ERROR] Method:', req.method, 'URL:', req.originalUrl);
  console.error('[ERROR] Name:', err?.name);
  console.error('[ERROR] Message:', err?.message);
  console.error('[ERROR] Stack:', err?.stack);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: { message: 'Internal server error.', type: 'server_error' } });
});

app.listen(config.port, () => console.log(`NovaProxy listening on port ${config.port}`));
