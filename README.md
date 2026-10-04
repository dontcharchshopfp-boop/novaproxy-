# API Proxy

Small OpenAI-compatible proxy for routing multiple private proxy keys through one upstream API key.

## Routes

- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /admin`
- `GET /health`

The proxy only connects to the configured `UPSTREAM_BASE_URL`; client-supplied upstream authorization is never forwarded.

## 1. Supabase

Run `schema.sql` in Supabase SQL Editor.

For server access use your Supabase project URL and Secret/service_role key.

## 2. Render

Connect the GitHub repository to Render as a Node web service.

Set these environment variables:

```text
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_KEY=YOUR_SECRET_KEY
UPSTREAM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
UPSTREAM_API_KEY=YOUR_ALIBABA_UPSTREAM_KEY
STRAX_API=YOUR_STRAX_KEY
STRAX_BASE_URL=YOUR_STRAX_BASE_URL
ADMIN_PASSWORD=YOUR_ADMIN_PASSWORD
ADMIN_SESSION_SECRET=LONG_RANDOM_SECRET
```

Optional:

```text
PORT=3000
ALLOWED_ORIGINS=*
API_RATE_LIMIT_PER_MINUTE=120
ADMIN_RATE_LIMIT_PER_MINUTE=30
MAX_BODY_MB=10
```

## 3. Using a generated proxy key

Create one in `/admin`. The key is shown once when created.

Use it like:

```bash
curl https://YOUR-RENDER-DOMAIN.onrender.com/v1/chat/completions \
  -H 'Authorization: Bearer px_live_...' \
  -H 'Content-Type: application/json' \
  -d '{"model":"kimi-k3","messages":[{"role":"user","content":"Hello"}]}'
```

Models are passed through to the upstream OpenAI-compatible API.

## Security notes

- Never commit `.env`.
- Never put `UPSTREAM_API_KEY` or `SUPABASE_SERVICE_KEY` in frontend code.
- `STRAX_API` is server-side only and is used exclusively for `claude-fable-5.1`, `claude-opus-5`, `gpt-6-astra`, and `gpt-5.6-sol`; all other models remain on the Alibaba upstream.
- Store only SHA-256 hashes of generated proxy keys.
- The raw proxy key is only displayed once at creation time.
