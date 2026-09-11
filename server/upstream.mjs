// OpenAI-compatible gateways may mount the API at /v1, /v2, /api/v1,
// an arbitrary prefix, or directly at the origin.
export function normalizeUpstreamBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try { url = new URL(raw); } catch { throw new Error('请输入完整的 http/https 中转地址。'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('中转地址必须使用 http/https，密钥请填写在 API Key 栏。');
  url.search = ''; url.hash = '';
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '')
    .replace(/\/(?:chat\/completions|images\/(?:generations|edits|models)|responses|models)$/i, '') || '/';
  return url.toString().replace(/\/+$/, '');
}

export const normalizeApiKey = (key) => String(key || '').trim().replace(/^Bearer\s+/i, '').trim();
export const upstreamAuthHeaders = (key, headers = {}) => ({ authorization: `Bearer ${normalizeApiKey(key)}`, ...headers });

export function upstreamUrls(baseUrl, endpoint) {
  const base = normalizeUpstreamBase(baseUrl);
  const resource = String(endpoint || '').replace(/^\/+/, '').replace(/^v1\//, '');
  if (!base || !resource) throw new Error('请先配置上游中转地址。');
  if (/^v\d+beta\//i.test(resource)) return [`${base.replace(/\/v\d+(?:beta)?$/i, '')}/${resource}`];
  if (/\/v\d+(?:beta)?$/i.test(base)) return [base + '/' + resource];
  return [`${base}/v1/${resource}`, `${base}/${resource}`];
}

export async function fetchUpstream(baseUrl, endpoint, options = {}) {
  const urls = upstreamUrls(baseUrl, endpoint);
  let response;
  for (let i = 0; i < urls.length; i += 1) {
    response = await fetch(urls[i], { redirect: 'error', signal: AbortSignal.timeout(180000), ...options });
    // Only a definite routing rejection is safe to retry. Do not resubmit on
    // timeouts, authentication errors, rate limits or an ambiguous 5xx.
    if (![404, 405].includes(response.status) || i === urls.length - 1) return response;
    await response.body?.cancel();
  }
  return response;
}
