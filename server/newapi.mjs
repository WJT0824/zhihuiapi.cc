// Bridge to a self-hosted new-api instance (https://github.com/QuantumNous/new-api).
// new-api owns the relay, channel routing, per-user quota and usage logs; this
// module mirrors accounts, moves quota and proxies reads for the portal.

// 1 point = 0.1 CNY, and the relay is configured with QuotaPerUnit=700000 plus a
// 7 CNY/USD rate, which makes one point exactly 10,000 quota units.
export const QUOTA_PER_POINT = 10000;
export const POINTS_PER_YUAN = 10;

export const pointsToQuota = (points) => Math.round((Number(points) || 0) * QUOTA_PER_POINT);
export const quotaToPoints = (quota) => Math.round((Number(quota) || 0) / QUOTA_PER_POINT);

export function normalizeNewapiBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('请输入完整的中转站地址，例如 https://api.zhihuiapi.cc');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('中转站地址必须使用 http/https。');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '').replace(/\/(?:api|v1|console)$/i, '');
  return url.toString().replace(/\/+$/, '');
}

const bearer = (token) => {
  const value = String(token || '').trim().replace(/^Bearer\s+/i, '');
  return value ? { authorization: `Bearer ${value}` } : {};
};

/** Raw call against new-api. Returns `{ ok, status, data, message }`. */
export async function newapiFetch(baseUrl, pathname, options = {}) {
  const base = normalizeNewapiBaseUrl(baseUrl);
  if (!base) throw new Error('尚未配置中转站地址。');
  const { method = 'GET', token, body, timeoutMs = 30000, headers = {} } = options;
  const requestHeaders = { ...bearer(token), ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  const response = await fetch(`${base}${pathname.startsWith('/') ? pathname : `/${pathname}`}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text().catch(() => '');
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  const payload = data && typeof data === 'object' && 'data' in data ? data.data : data;
  return {
    ok: response.ok,
    status: response.status,
    data: payload,
    raw: data,
    message: data?.message || '',
    success: data?.success !== false,
  };
}

async function call(baseUrl, pathname, options) {
  const result = await newapiFetch(baseUrl, pathname, options);
  if (!result.ok || result.success === false) {
    const detail = typeof result.message === 'string' && result.message ? result.message : `HTTP ${result.status}`;
    throw Object.assign(new Error(`中转站接口失败：${detail}`), { status: result.status, payload: result.data });
  }
  return result.data;
}

export async function newapiStatus(baseUrl) {
  const result = await newapiFetch(baseUrl, '/api/status', { timeoutMs: 15000 });
  return { ok: result.ok && result.success !== false, data: result.data, message: result.message };
}

export async function newapiLogin(baseUrl, username, password) {
  const data = await call(baseUrl, '/api/user/login', { method: 'POST', body: { username, password } });
  return { accessToken: data?.access_token || '', user: data?.user || data?.data || null };
}

/** Issues a long-lived access token for the given (already authenticated) user. */
export async function newapiAccessToken(baseUrl, userToken) {
  const data = await call(baseUrl, '/api/user/token', { method: 'POST', token: userToken });
  return String(data?.token || data?.access_token || '').trim();
}

export async function newapiCreateUser(baseUrl, adminToken, input) {
  const data = await call(baseUrl, '/api/user/', {
    method: 'POST',
    token: adminToken,
    body: {
      username: input.username,
      password: input.password,
      display_name: input.displayName || input.username,
      role: 1,
      quota: pointsToQuota(input.points ?? 0),
    },
  });
  return data;
}

export async function newapiGetUser(baseUrl, adminToken, userId) {
  return call(baseUrl, `/api/user/${userId}`, { token: adminToken });
}

export async function newapiAdjustQuota(baseUrl, adminToken, userId, mode, value) {
  await call(baseUrl, '/api/user/manage', {
    method: 'POST',
    token: adminToken,
    body: { id: Number(userId), action: 'add_quota', mode, value: Math.max(0, Math.round(Number(value) || 0)) },
  });
  return true;
}

export async function newapiSetPoints(baseUrl, adminToken, userId, points) {
  return newapiAdjustQuota(baseUrl, adminToken, userId, 'override', pointsToQuota(points));
}

export async function newapiAddPoints(baseUrl, adminToken, userId, points) {
  return newapiAdjustQuota(baseUrl, adminToken, userId, 'add', pointsToQuota(points));
}

export async function newapiSubtractPoints(baseUrl, adminToken, userId, points) {
  const value = pointsToQuota(points);
  if (value <= 0) return true;
  return newapiAdjustQuota(baseUrl, adminToken, userId, 'subtract', value);
}

export async function newapiPricing(baseUrl) {
  const result = await newapiFetch(baseUrl, '/api/pricing');
  if (!result.ok || result.success === false) {
    throw Object.assign(new Error(`中转站接口失败：${result.message || `HTTP ${result.status}`}`), { status: result.status });
  }
  const payload = result.data;
  const models = Array.isArray(payload) ? payload : payload?.models || [];
  return {
    models,
    groups: result.raw?.groups || (Array.isArray(payload) ? [] : payload?.groups) || [],
    usableGroup: result.raw?.usable_group || {},
  };
}

export async function newapiRatioConfig(baseUrl) {
  return call(baseUrl, '/api/ratio_config');
}

export async function newapiModels(baseUrl, adminToken) {
  return call(baseUrl, '/api/models/?page_size=1000', { token: adminToken });
}

export async function newapiListTokens(baseUrl, userToken) {
  return call(baseUrl, '/api/token/?p=1&size=100', { token: userToken });
}

export async function newapiCreateToken(baseUrl, userToken, input = {}) {
  await call(baseUrl, '/api/token/', {
    method: 'POST',
    token: userToken,
    body: {
      name: input.name || '郅绘默认密钥',
      remain_quota: 0,
      expired_time: -1,
      unlimited_quota: true,
      model_limits_enabled: false,
      model_limits: '',
      allow_ips: '',
      group: input.group || '',
    },
  });
  const list = await newapiListTokens(baseUrl, userToken);
  const items = Array.isArray(list) ? list : list?.items || list?.data || [];
  const created = items.find((item) => item?.name === (input.name || '郅绘默认密钥')) || items[items.length - 1];
  if (!created?.id) throw new Error('中转站未返回新建的密钥。');
  const keyData = await call(baseUrl, `/api/token/${created.id}/key`, { method: 'POST', token: userToken });
  return { id: created.id, name: created.name, key: String(keyData?.key || '').trim() };
}

export async function newapiTokenKey(baseUrl, userToken, tokenId) {
  const data = await call(baseUrl, `/api/token/${tokenId}/key`, { method: 'POST', token: userToken });
  return String(data?.key || '').trim();
}

export async function newapiUserLogs(baseUrl, userToken, options = {}) {
  const page = Math.max(1, Number(options.page) || 1);
  const size = Math.min(100, Math.max(1, Number(options.size) || 20));
  return call(baseUrl, `/api/log/self?p=${page}&page_size=${size}`, { token: userToken });
}

export async function newapiUserQuotaDates(baseUrl, userToken) {
  return call(baseUrl, '/api/data/self', { token: userToken });
}

export async function newapiRedeem(baseUrl, userToken, code) {
  return call(baseUrl, '/api/user/topup', { method: 'POST', token: userToken, body: { key: String(code || '').trim() } });
}

/** Creates redemption codes through the admin token; used by the ops backend. */
export async function newapiCreateRedemptions(baseUrl, adminToken, input = {}) {
  const name = String(input.name || `郅绘 ${input.points} 积分`);
  const count = Math.max(1, Math.min(200, Number(input.count) || 1));
  const created = [];
  for (let i = 0; i < count; i += 1) {
    await call(baseUrl, '/api/redemption/', {
      method: 'POST',
      token: adminToken,
      body: { name, quota: pointsToQuota(input.points), count: 1, expired_time: -1 },
    });
  }
  const list = await call(baseUrl, '/api/redemption/?p=0&page_size=200', { token: adminToken });
  const items = Array.isArray(list) ? list : list?.items || [];
  for (const item of items.slice(0, count)) {
    if (item?.key) created.push(String(item.key));
  }
  return created;
}
