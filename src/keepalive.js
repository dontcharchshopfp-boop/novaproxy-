const cron = require('node-cron');
const config = require('./config');

function getPingUrl() {
  const baseUrl = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${config.port}`;
  return new URL('/health', baseUrl).toString();
}

async function pingRender() {
  const url = getPingUrl();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'NovaProxy-KeepAlive/1.0' },
      signal: AbortSignal.timeout(10000)
    });

    console.log(`[KeepAlive] GET ${url} -> ${response.status}`);
  } catch (error) {
    console.error(`[KeepAlive] Ping failed: ${error?.message || error}`);
  }
}

cron.schedule('*/13 * * * *', pingRender, {
  noOverlap: true
});

console.log(`[KeepAlive] Scheduled every 13 minutes -> ${getPingUrl()}`);

module.exports = { pingRender, getPingUrl };
