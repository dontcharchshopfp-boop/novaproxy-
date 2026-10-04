const required = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'UPSTREAM_BASE_URL',
  'UPSTREAM_API_KEY',
  'ADMIN_PASSWORD',
  'ADMIN_SESSION_SECRET'
];

for (const name of required) {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY,
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL.replace(/\/$/, ''),
  upstreamApiKey: process.env.UPSTREAM_API_KEY,
  // Secondary OpenAI-compatible provider used ONLY for the fixed GPT/Claude model allowlist.
  straxBaseUrl: (process.env.STRAX_BASE_URL || '').replace(/\/$/, ''),
  straxApiKey: process.env.STRAX_API || '',
  adminPassword: process.env.ADMIN_PASSWORD,
  adminSessionSecret: process.env.ADMIN_SESSION_SECRET,
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean),
  apiRateLimitPerMinute: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 120),
  adminRateLimitPerMinute: Number(process.env.ADMIN_RATE_LIMIT_PER_MINUTE || 30),
  maxBodyMb: Number(process.env.MAX_BODY_MB || 10)
};
