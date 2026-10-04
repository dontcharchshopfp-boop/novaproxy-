const { consumeTokens } = require('./db');

const DEFAULT_MODEL_MULTIPLIERS = Object.freeze({
  'claude-fable-5.1': 2,
  'claude-opus-5': 2,
  'gpt-6-astra': 4,
  'gpt-5.6-sol': 2
});

function getTokenMultiplier(model, enabled) {
  if (!enabled) return 1;
  const multiplier = DEFAULT_MODEL_MULTIPLIERS[model];
  return Number.isInteger(multiplier) && multiplier > 0 ? multiplier : 1;
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return 0;

  const total = Number(usage.total_tokens);
  if (Number.isFinite(total) && total > 0) return Math.floor(total);

  const prompt = Number(usage.prompt_tokens);
  const completion = Number(usage.completion_tokens);
  const sum = (Number.isFinite(prompt) ? prompt : 0) + (Number.isFinite(completion) ? completion : 0);
  return sum > 0 ? Math.floor(sum) : 0;
}

function usageFromPayload(payload) {
  return normalizeUsage(payload?.usage);
}

function usageFromSseText(text) {
  let usage = 0;
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') continue;

    try {
      const payload = JSON.parse(raw);
      const current = usageFromPayload(payload);
      if (current > 0) usage = current;
    } catch {
      // Ignore non-JSON SSE lines. The response itself is still forwarded unchanged.
    }
  }

  return usage;
}

async function chargeApiKey(keyId, usageTokens, model, defaultMultiplierEnabled = false) {
  const usage = Math.floor(Number(usageTokens));
  if (!Number.isFinite(usage) || usage <= 0) return null;

  const multiplier = getTokenMultiplier(model, defaultMultiplierEnabled);
  const chargedTokens = usage * multiplier;

  try {
    const balance = await consumeTokens(keyId, chargedTokens);
    console.log(`[Billing] API key ${keyId}: usage=${usage} tokens, model=${model || 'unknown'}, multiplier=x${multiplier}, charged=${chargedTokens} tokens, balance=${balance}`);
    return balance;
  } catch (err) {
    console.error(`[Billing] Failed to charge API key ${keyId}:`, err?.message || err);
    return null;
  }
}

module.exports = {
  DEFAULT_MODEL_MULTIPLIERS,
  getTokenMultiplier,
  usageFromPayload,
  usageFromSseText,
  chargeApiKey
};
