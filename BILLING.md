# NovaProxy token billing

This version keeps the existing proxy flow and additionally deducts the actual `usage.total_tokens` returned by DashScope from the API key balance.

For streaming chat completions, the proxy automatically enables `stream_options.include_usage` so DashScope includes usage in the final SSE chunk. The response sent to the client is still forwarded unchanged.

Before deploying this version, run the updated `schema.sql` in the Supabase SQL Editor. The SQL creates the atomic `consume_api_key_tokens` RPC used by the proxy and normalizes all existing currencies to `token`.

The admin panel now exposes token balance only; there is no currency selector.

## Default model multiplier

Each API key has a `default_multiplier_enabled` toggle in the admin panel. It is off by default, so existing keys continue to behave exactly as before.

When enabled, only these four STRAX models use the default multiplier:

- `claude-fable-5.1` ×2
- `claude-opus-5` ×2
- `gpt-6-astra` ×4
- `gpt-5.6-sol` ×2

The provider-reported usage remains unchanged in the response. The multiplier is applied only to the amount deducted from the NovaProxy API key balance. For example, 100 reported tokens on `gpt-6-astra` deducts 400 tokens from the key balance.
