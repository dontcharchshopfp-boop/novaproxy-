# NovaProxy deployment

1. Push this repository to GitHub.
2. In Render, create a Web Service from the repo. If you use `render.yaml`, the service name defaults to `novaproxy`; Render may append/change the public hostname if that name is unavailable.
3. Add these Render environment variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `UPSTREAM_BASE_URL` — your OpenAI-compatible upstream, for example `https://dashscope.aliyuncs.com/compatible-mode/v1`
- `UPSTREAM_API_KEY` — the Alibaba/DashScope upstream secret, server-side only
- `STRAX_API` — the secondary STRAX secret, server-side only; ONLY four fixed GPT/Claude models use it
- `STRAX_BASE_URL` — the STRAX OpenAI-compatible base URL, provided via environment variable
- `ADMIN_PASSWORD`
- `ADMIN_SESSION_SECRET`

4. Run `schema.sql` in Supabase SQL Editor.
5. Open `/admin`, log in, create a proxy key.
6. Client configuration should point only at your Render URL, e.g. `https://novaproxy.onrender.com/v1`.

The upstream hostname and upstream API key are never returned to the API client.
