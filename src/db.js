const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const config = require('./config');

const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

const publicFields = 'id,name,active,request_count,created_at,last_used_at,key_preview,balance,allowed_models,expires_at,default_multiplier_enabled';

async function findApiKey(rawKey) {
  const keyHash = hashKey(rawKey);
  const { data, error } = await supabase
    .from('api_keys')
    .select(publicFields + ',key_hash')
    .eq('key_hash', keyHash)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function normalizeModels(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(v => String(v).trim()).filter(Boolean))].slice(0, 100);
}

function normalizeBalance(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Invalid balance.');
  return Math.round(n * 1_000_000) / 1_000_000;
}

async function createApiKey(input = {}) {
  const raw = `px_live_${crypto.randomBytes(24).toString('base64url')}`;
  const keyHash = hashKey(raw);
  const keyPreview = `${raw.slice(0, 15)}...${raw.slice(-6)}`;
  const row = {
    name: String(input.name || 'Unnamed').trim().slice(0, 100) || 'Unnamed',
    key_hash: keyHash,
    key_preview: keyPreview,
    balance: normalizeBalance(input.balance ?? 0),
    allowed_models: normalizeModels(input.allowed_models),
    expires_at: input.expires_at || null,
    default_multiplier_enabled: Boolean(input.default_multiplier_enabled)
  };
  const { data, error } = await supabase.from('api_keys').insert(row).select(publicFields).single();
  if (error) throw error;
  return { ...data, key: raw };
}

async function listApiKeys() {
  const { data, error } = await supabase
    .from('api_keys')
    .select(publicFields)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function updateApiKey(id, input = {}) {
  const updates = {};
  if (typeof input.active === 'boolean') updates.active = input.active;
  if (input.name !== undefined) updates.name = String(input.name).trim().slice(0, 100) || 'Unnamed';
  if (input.balance !== undefined) updates.balance = normalizeBalance(input.balance);
  if (input.allowed_models !== undefined) updates.allowed_models = normalizeModels(input.allowed_models);
  if (input.expires_at !== undefined) updates.expires_at = input.expires_at || null;
  if (typeof input.default_multiplier_enabled === 'boolean') {
    updates.default_multiplier_enabled = input.default_multiplier_enabled;
  }

  const { data, error } = await supabase
    .from('api_keys')
    .update(updates)
    .eq('id', id)
    .select(publicFields)
    .single();
  if (error) throw error;
  return data;
}


async function consumeTokens(id, tokens) {
  const amount = Number(tokens);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
    throw new Error('Invalid token amount.');
  }

  const { data, error } = await supabase.rpc('consume_api_key_tokens', {
    p_key_id: id,
    p_tokens: amount
  });
  if (error) throw error;

  const rawBalance = Array.isArray(data) ? data[0] : data;
  return Number(rawBalance || 0);
}

async function deleteApiKey(id) {
  const { error } = await supabase.from('api_keys').delete().eq('id', id);
  if (error) throw error;
}

async function touchApiKey(id) {
  // Best-effort request statistics; the API request should not wait for this update.
  const { data, error } = await supabase.from('api_keys').select('request_count').eq('id', id).single();
  if (error) return;
  await supabase.from('api_keys').update({
    request_count: Number(data.request_count || 0) + 1,
    last_used_at: new Date().toISOString()
  }).eq('id', id);
}

module.exports = {
  supabase,
  findApiKey,
  createApiKey,
  listApiKeys,
  updateApiKey,
  deleteApiKey,
  consumeTokens,
  touchApiKey
};
