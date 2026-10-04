const config = require('./config');
const { usageFromPayload, usageFromSseText, chargeApiKey } = require('./billing');
const { normalizeAstraReasoningBody } = require('./reasoning');

const STRAX_MODELS = [
  { id: 'claude-fable-5.1', object: 'model', owned_by: 'strax' },
  { id: 'claude-opus-5', object: 'model', owned_by: 'strax' },
  { id: 'gpt-6-astra', object: 'model', owned_by: 'strax' },
  { id: 'gpt-5.6-sol', object: 'model', owned_by: 'strax' }
];

const STRAX_MODEL_IDS = new Set(STRAX_MODELS.map(m => m.id));

function buildUpstreamUrl(baseUrl, path) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function isStraxModel(model) {
  return typeof model === 'string' && STRAX_MODEL_IDS.has(model);
}

function getUpstreamForRequest(req) {
  const model = req.body?.model;
  if (isStraxModel(model)) {
    if (!config.straxApiKey) {
      const err = new Error('STRAX_API is not configured.');
      err.code = 'STRAX_NOT_CONFIGURED';
      throw err;
    }
    return {
      provider: 'strax',
      baseUrl: config.straxBaseUrl,
      apiKey: config.straxApiKey
    };
  }

  return {
    provider: 'alibaba',
    baseUrl: config.upstreamBaseUrl,
    apiKey: config.upstreamApiKey
  };
}

async function fetchUpstreamJson(path) {
  const r = await fetch(buildUpstreamUrl(config.upstreamBaseUrl, path), {
    headers: {
      authorization: `Bearer ${config.upstreamApiKey}`,
      accept: 'application/json'
    }
  });
  if (!r.ok) throw new Error(`Upstream models request failed with ${r.status}`);
  return r.json();
}

async function fetchModels() {
  const payload = await fetchUpstreamJson('/models');
  const alibabaModels = Array.isArray(payload?.data) ? payload.data : [];
  return [...alibabaModels, ...STRAX_MODELS];
}

async function proxyJson(req, res) {
  const incomingPath = req.path;
  const upstreamPath = incomingPath.startsWith('/v1/')
    ? incomingPath.slice(3)
    : incomingPath;

  const upstreamConfig = getUpstreamForRequest(req);
  const url = buildUpstreamUrl(upstreamConfig.baseUrl, upstreamPath);
  console.log(`[Proxy] ${req.method} ${incomingPath} -> ${upstreamConfig.provider} ${url}`);

  const headers = {
    'content-type': 'application/json',
    'authorization': `Bearer ${upstreamConfig.apiKey}`
  };
  if (req.get('accept')) headers.accept = req.get('accept');
  if (req.get('user-agent')) headers['user-agent'] = req.get('user-agent');

  // DashScope only returns token usage for streaming requests when usage is enabled.
  // This keeps the existing request/response flow intact while making billing measurable.
  let outboundBody = req.body;

  if (upstreamConfig.provider === 'strax' && req.body?.model === 'gpt-6-astra') {
    try {
      outboundBody = normalizeAstraReasoningBody(req.body);
    } catch (err) {
      return res.status(400).json({
        error: {
          message: err.message,
          type: 'invalid_request_error',
          param: 'reasoning_effort',
          code: err.code || 'invalid_reasoning_effort'
        }
      });
    }
  }
  if (
    upstreamConfig.provider === 'alibaba' &&
    req.method === 'POST' &&
    incomingPath.endsWith('/chat/completions') &&
    req.body?.stream === true
  ) {
    outboundBody = {
      ...req.body,
      stream_options: {
        ...(req.body.stream_options || {}),
        include_usage: true
      }
    };
  }

  let upstream;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(outboundBody),
      redirect: 'manual'
    });
  } catch (err) {
    console.error('[Proxy] Upstream fetch failed:', err?.name, err?.message);
    console.error('[Proxy] Upstream fetch stack:', err?.stack);
    throw err;
  }

  console.log(`[Proxy] Upstream status: ${upstream.status} (${upstreamConfig.provider})`);
  console.log(`[Proxy] Upstream content-type: ${upstream.headers.get('content-type') || 'none'}`);

  if (!upstream.ok) {
    try {
      const errorPreview = await upstream.clone().text();
      console.error(`[Proxy] Upstream error body: ${errorPreview.slice(0, 4000)}`);
    } catch (err) {
      console.error('[Proxy] Failed to read upstream error body:', err?.message);
    }
  }
  res.status(upstream.status);
  for (const [key, value] of upstream.headers.entries()) {
    if (['connection', 'keep-alive', 'transfer-encoding'].includes(key)) continue;
    res.setHeader(key, value);
  }
  if (!upstream.body) return res.end();

  const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
  const shouldBill = upstream.ok && Boolean(req.proxyKey?.id);

  // Non-streaming chat completions return one JSON object with a usage block.
  if (contentType.includes('application/json')) {
    const bodyBuffer = Buffer.from(await upstream.arrayBuffer());

    if (shouldBill) {
      try {
        const payload = JSON.parse(bodyBuffer.toString('utf8'));
        const usageTokens = usageFromPayload(payload);
        await chargeApiKey(req.proxyKey.id, usageTokens, req.body?.model, req.proxyKey?.default_multiplier_enabled);
      } catch (err) {
        console.error('[Billing] Failed to parse non-streaming usage:', err?.message || err);
      }
    }

    res.end(bodyBuffer);
    return;
  }

  // Streaming responses are forwarded chunk-by-chunk. We inspect the SSE data
  // without changing what the client receives and charge after the final chunk.
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let usageTokens = 0;

  const inspectSse = (text) => {
    if (!shouldBill || !text) return;
    const current = usageFromSseText(text);
    if (current > 0) usageTokens = current;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (shouldBill) {
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || '';
        inspectSse(lines.join('\n'));
      }

      res.write(Buffer.from(value));
    }

    if (shouldBill) {
      pending += decoder.decode();
      inspectSse(pending);
      await chargeApiKey(req.proxyKey.id, usageTokens, req.body?.model, req.proxyKey?.default_multiplier_enabled);
    }
  } finally {
    reader.releaseLock();
  }
  res.end();
}

module.exports = { proxyJson, fetchModels, STRAX_MODELS, STRAX_MODEL_IDS };
