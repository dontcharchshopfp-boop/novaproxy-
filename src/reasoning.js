const ASTRA_REASONING_EFFORTS = new Set([
  'low',
  'medium',
  'high',
  'xhigh',
  'max'
]);

function normalizeAstraReasoningBody(body) {
  if (!body || body.model !== 'gpt-6-astra') return body;

  const next = { ...body };
  let effort = next.reasoning_effort;

  // Accept an OpenAI-style reasoning object from clients and normalize it to
  // Chat Completions' reasoning_effort field.
  if (effort == null && next.reasoning && typeof next.reasoning === 'object' && !Array.isArray(next.reasoning)) {
    effort = next.reasoning.effort;
  }

  // Optional boolean toggle for clients that expose a simple reasoning switch.
  // GPT-6 Astra has no true "none/off" effort, so disabled maps to its
  // minimum supported effort (low). Enabled defaults to medium unless the
  // client also supplied an explicit effort.
  const toggle = typeof next.reasoning_enabled === 'boolean'
    ? next.reasoning_enabled
    : (typeof next.reasoning === 'boolean' ? next.reasoning : null);

  if (toggle === false) {
    effort = 'low';
  } else if (toggle === true && effort == null) {
    effort = 'medium';
  }

  delete next.reasoning;
  delete next.reasoning_enabled;

  if (effort == null || effort === '') {
    delete next.reasoning_effort;
    return next;
  }

  if (typeof effort !== 'string' || !ASTRA_REASONING_EFFORTS.has(effort)) {
    const allowed = [...ASTRA_REASONING_EFFORTS].join(', ');
    const err = new Error(`Invalid GPT-6 Astra reasoning_effort. Use one of: ${allowed}.`);
    err.code = 'INVALID_ASTRA_REASONING_EFFORT';
    throw err;
  }

  next.reasoning_effort = effort;
  return next;
}

module.exports = {
  ASTRA_REASONING_EFFORTS,
  normalizeAstraReasoningBody
};
