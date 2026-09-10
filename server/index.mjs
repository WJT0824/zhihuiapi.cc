import http from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'web');
const DATA_DIR = process.env.ZH_DATA_DIR ? path.resolve(process.env.ZH_DATA_DIR) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const ASSET_DIR = path.join(DATA_DIR, 'assets');
const REF_DIR = path.join(DATA_DIR, 'references');
const DOWNLOAD_DIR = path.join(DATA_DIR, 'downloads');
const PLUGIN_FILENAME = '郅绘CDR插件ai版-v1.4.0.exe';
const RECHARGE_CODE_PREFIX = 'ZHRC1';
const RECHARGE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAziIuFwOLkYPZE7YI2dL7fwlDzsRRFANWlvOosrPfCnY=
-----END PUBLIC KEY-----`;
const RECHARGE_AMOUNTS = new Set([10, 20, 30, 50, 100, 200]);
const RECHARGE_PERMANENT_EXPIRES = '9999-12-31T23:59:59.999Z';
const RECHARGE_KEY_FILE = path.join(DATA_DIR, 'recharge-private.pem');
const ADMIN_KEY = process.env.ZH_ADMIN_KEY || 'dev-admin-2026';
const PUBLIC_API_ORIGIN = (process.env.PUBLIC_API_ORIGIN || '').replace(/\/+$/, '');
const AI_BASE_URL = (process.env.AI_BASE_URL || '').replace(/\/+$/, '');
const AI_API_KEY = (process.env.AI_API_KEY || '').trim();
const AI_IMAGE_MODEL = (process.env.AI_IMAGE_MODEL || '').trim() || 'gpt-image-2';
if (process.env.NODE_ENV === 'production' && !process.env.ZH_ADMIN_KEY) {
  throw new Error('Production requires ZH_ADMIN_KEY.');
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const passwordHash = (value, salt) => crypto.scryptSync(value, salt, 64).toString('hex');
const defaultStore = () => ({ users: [], tasks: [], redemptionCodes: [], redemptions: [], rechargeNonces: [], ledger: [], sessions: {}, references: [], jobs: [], assets: [], workflows: [], aiConfig: { baseUrl: '', apiKey: '', model: '' } });
let store = defaultStore();
async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(ASSET_DIR, { recursive: true });
  await mkdir(REF_DIR, { recursive: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  if (existsSync(DATA_FILE)) { try { store = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { store = defaultStore(); } }
  store.tasks ||= []; store.redemptionCodes ||= []; store.redemptions ||= []; store.rechargeNonces ||= []; store.ledger ||= []; store.sessions ||= {}; store.references ||= []; store.jobs ||= []; store.assets ||= []; store.workflows ||= []; store.aiConfig ||= { baseUrl: '', apiKey: '', model: '' };
  if (!store.users.length) {
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    store.users.push({ id: uid(), nickname: 'admin', email: '', passwordSalt, passwordHash: passwordHash(ADMIN_KEY, passwordSalt), points: 1000, role: 'admin', createdAt: now() });
  }
  await persist();
}
const persist = () => writeFile(DATA_FILE, JSON.stringify(store, null, 2));
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); };
const sendRaw = (res, status, data, headers = {}) => { res.writeHead(status, headers); res.end(data); };
const parseBody = async (req) => { let data = ''; for await (const chunk of req) data += chunk; try { return data ? JSON.parse(data) : {}; } catch { return {}; } };
const tokenUser = (req, kind = 'access') => { const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); if (!token) return null; const session = store.sessions[hash(token)]; const id = session && typeof session === 'object' ? (session.kind === kind ? session.userId : null) : session; return store.users.find((u) => u.id === id); };
const safeUser = (u) => u && ({ id: u.id, nickname: u.nickname, username: u.nickname || u.username || '', displayName: u.displayName || u.nickname || '', email: u.email || '', role: u.role || 'user', isAdmin: u.role === 'admin', points: u.points, credits: u.points, profile: u.profile || {}, membershipType: u.membershipType || 'registered', membershipExpiresAt: u.membershipExpiresAt || '', isMembershipValid: true, beansBalance: u.beansBalance || 0, beansExpiresAt: u.beansExpiresAt || '', deviceId: u.deviceId || '', createdAt: u.createdAt });
const route = (req) => { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); return { path: url.pathname, query: url.searchParams }; };

const studioModels = () => {
  const common = [
    { id: 'gpt-image-2', name: 'GPT Image 2', provider: 'openai', capabilities: ['generate', 'edit'] },
    { id: 'T香蕉2', name: 'T香蕉2', provider: 'gemini', capabilities: ['generate', 'edit'] },
    { id: 'T香蕉pro', name: 'T香蕉pro', provider: 'gemini', capabilities: ['generate', 'edit'] },
    { id: 'grok-video-1.5', name: 'Grok Video 1.5', provider: 'grok', kind: 'video', capabilities: ['image-to-video'] },
    { id: 'sora-v3-fast', name: 'Sora V3 Fast', provider: 'sora', kind: 'video', capabilities: ['text-to-video', 'image-to-video', 'frames-to-video'] },
    { id: 'sora-v3-pro', name: 'Sora V3 Pro', provider: 'sora', kind: 'video', capabilities: ['text-to-video', 'image-to-video', 'frames-to-video'] },
    { id: 'veo3.1-fast图生视频1080p', name: 'Veo 3.1 Fast 1080p', provider: 'veo', kind: 'video', capabilities: ['image-to-video', 'frames-to-video'] },
  ];
  return common;
};

async function submitRemoteTask(task) {
  if (!AI_BASE_URL || !AI_API_KEY) return;
  const model = String(task.model || '');
  const prompt = String(task.prompt || '');
  const body = { ...(task.request || {}), model, prompt };
  let endpoint = '/v1/images/generations';
  if (model === 'gpt-image-2' && Array.isArray(body.images) && body.images.length) endpoint = '/v1/images/edits';
  if (model === 'T香蕉2' || model === 'T香蕉pro') endpoint = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  if (/grok-video|veo3/.test(model)) endpoint = '/v1/videos';
  if (/sora-v3/.test(model)) endpoint = '/v1/video/submit/generate';
  const res = await fetch(AI_BASE_URL + endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${AI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    task.status = 'failed';
    task.error = json.error?.message || json.message || `上游任务提交失败 ${res.status}`;
    return;
  }
  task.remoteTaskId = json.task_id || json.id || json.data?.task_id || null;
  task.progress = Number(json.progress ?? 0);
  if (!task.remoteTaskId) {
    const url = json.url || json.video_url || json.data?.[0]?.url || json.result?.data?.[0]?.url || json.result?.file_url;
    if (url) {
      task.status = 'completed';
      task.completedAt = now();
      task.result = { url, data: [{ url }] };
    }
  }
}

async function pollRemoteTask(task) {
  if (!task.remoteTaskId || !AI_BASE_URL || !AI_API_KEY) return;
  const model = String(task.model || '');
  let endpoint = `/v1/images/tasks/${encodeURIComponent(task.remoteTaskId)}`;
  if (/sora-v3/.test(model)) endpoint = `/v1/video/fetch/${encodeURIComponent(task.remoteTaskId)}`;
  if (/grok-video|veo3/.test(model)) endpoint = `/v1/videos/${encodeURIComponent(task.remoteTaskId)}`;
  const res = await fetch(AI_BASE_URL + endpoint, {
    headers: { authorization: `Bearer ${AI_API_KEY}` },
  });
  if (!res.ok) return;
  const json = await res.json().catch(() => ({}));
  task.progress = Number(json.progress ?? task.progress ?? 0);
  if (json.status === 'succeeded' || json.status === 'completed') {
    const url = json.url || json.video_url || json.data?.[0]?.url || json.metadata?.url || json.result?.data?.[0]?.url || json.result?.file_url;
    task.status = 'completed';
    task.completedAt = now();
    task.result = url ? { url, data: [{ url }] } : { message: '任务已完成。' };
    return;
  }
  if (json.status === 'failed') {
    task.status = 'failed';
    task.error = json.error?.message || json.message || '上游任务失败';
  }
}

const publicTask = (task) => ({
  id: task.id,
  prompt: task.prompt,
  model: task.model,
  status: task.status,
  progress: task.progress ?? (task.status === 'completed' ? 100 : 0),
  error: task.error || undefined,
  result: task.result || undefined,
  remoteTaskId: task.remoteTaskId || undefined,
  createdAt: task.createdAt,
  completedAt: task.completedAt || undefined,
});

const activeAiConfig = () => {
  const stored = store.aiConfig || {};
  return {
    baseUrl: normalizeUpstreamBase(stored.baseUrl || AI_BASE_URL || ''),
    apiKey: String(stored.apiKey || AI_API_KEY || '').trim(),
    model: String(stored.model || AI_IMAGE_MODEL || 'gpt-image-2').trim() || 'gpt-image-2',
  };
};
const normalizeUpstreamBase = (value) => String(value || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/(?:chat\/completions|images\/(?:generations|edits|models)|models)$/i, '')
  .replace(/\/v\d+(?:beta)?$/i, '')
  .replace(/\/v\d+$/i, '');
const publicPluginConfig = () => {
  const ai = activeAiConfig();
  return {
    serviceUrl: 'https://zhihuiapi.cc/',
    apiOrigin: PUBLIC_API_ORIGIN || 'https://zhihuiapicc-production.up.railway.app/',
    mode: 0,
    chatModel: 'gpt-4.1-mini',
    generationModel: ai.model || 'gpt-image-2',
    editModel: ai.model || 'gpt-image-2',
    pointsPerGeneration: 3,
    updatedAt: now(),
  };
};
const gatewayModels = () => {
  const config = activeAiConfig();
  const model = config.model || 'gpt-image-2';
  const displayName = model === 'gpt-image-2' ? 'GPT Image 2' : model === 'T香蕉2' ? 'T香蕉2' : model === 'T香蕉pro' ? 'T香蕉pro' : model;
  return [{ id: model, modelId: model, displayName, name: displayName, providerName: '郅绘 AI 网关', price: 3, recommended: true, tags: ['text-to-image', 'image-editing'], capabilities: { supportsEdit: true, maxReferences: 10, aspectRatios: ['1:1', '4:3', '3:4', '16:9', '9:16'], resolutions: ['1K', '2K', '4K'], qualities: ['auto', 'high', 'medium', 'low'] } }];
};
const normalizeLiveModelItem = (item, configModel = '') => {
  const id = String(item.id || item.modelId || item.name || '').trim();
  const rawName = String(item.name || item.displayName || id || '').trim();
  const lower = `${id} ${rawName}`.toLowerCase();
  const endpoints = Array.isArray(item.supported_endpoint_types) ? item.supported_endpoint_types.map((name) => String(name || '').toLowerCase()).filter(Boolean) : [];
  const hasImageEndpoint = endpoints.some((name) => name.includes('image') || name === 'images' || name.includes('img'));
  const hasReasoningEndpoint = endpoints.some((name) => name.includes('chat') || name.includes('reason') || name.includes('completion') || name.includes('text'));
  const looksLikeImage = /(^|[^a-z])(gpt-image|dall|flux|image|img)([^a-z]|$)/i.test(lower);
  const looksLikeReasoning = /(^|[^a-z])(gpt|o[0-9]|o1|claude|deepseek|codex|command|gemini|mini|compact|luna|sol|terra)([^a-z]|$)/i.test(lower) && !/video|image|img/i.test(lower);
  let tags = [];
  if (!/video|image|img/i.test(lower) && (hasReasoningEndpoint || looksLikeReasoning)) tags.push('reasoning');
  if (hasImageEndpoint || looksLikeImage) tags = ['text-to-image', 'image-editing'];
  if (!tags.length && !endpoints.length) tags.push('reasoning');
  if (!tags.length) tags = ['reasoning'];
  return {
    id,
    modelId: id,
    name: rawName || id,
    displayName: rawName || id,
    providerName: String(item.owned_by || item.provider || '郅绘 AI 网关'),
    price: 3,
    recommended: Boolean(configModel && id === configModel),
    tags,
  };
};
const modelsFromPayload = (payload, configModel = '') => {
  const source = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return source.map((item) => normalizeLiveModelItem(item, configModel)).filter((model) => model.id);
};
const readUpstreamModels = async (baseUrl, apiKey) => {
  const base = normalizeUpstreamBase(baseUrl);
  const candidates = [`${base}/v1/models`, `${base}/v1/images/models`, `${base}/models`];
  let lastError;
  for (const endpoint of candidates) {
    try {
      const response = await fetch(endpoint, { headers: { authorization: `Bearer ${apiKey}` } });
      if (!response.ok) {
        lastError = new Error(`模型接口返回 ${response.status}`);
        continue;
      }
      const models = modelsFromPayload(await response.json());
      if (models.length) return models;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return [];
};
const liveGatewayModels = async () => {
  const config = activeAiConfig();
  if (!config.baseUrl || !config.apiKey) return gatewayModels();
  try {
    const live = await readUpstreamModels(config.baseUrl, config.apiKey);
    const ordered = new Map();
    for (const fallback of gatewayModels()) {
      const key = fallback.modelId || fallback.id;
      if (key) ordered.set(key, fallback);
    }
    for (const model of live) {
      const key = model.modelId || model.id;
      if (key && !ordered.has(key)) ordered.set(key, model);
    }
    return [...ordered.values()];
  } catch {
    return gatewayModels();
  }
};
const imageGatewayModels = async () => {
  const live = await liveGatewayModels();
  const ordered = new Map();
  for (const fallback of gatewayModels()) {
    const key = fallback.modelId || fallback.id;
    if (key) ordered.set(key, fallback);
  }
  for (const model of live) {
    const key = model.modelId || model.id;
    if (key && !ordered.has(key)) ordered.set(key, model);
  }
  if (![...ordered.values()].some((model) => model.tags?.includes('text-to-image') || model.tags?.includes('image-editing'))) {
    for (const fallback of gatewayModels()) {
      const key = fallback.modelId || fallback.id;
      if (key) ordered.set(key, fallback);
    }
  }
  return [...ordered.values()];
};
const normalizeRechargeAccount = (value) => String(value || '').trim().replace(/\s+/g, '').toLowerCase();
const decodeBase64Url = (value) => {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64');
};
const encodeBase64Url = (buffer) => Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const getRechargePrivateKey = () => {
  const inline = String(process.env.ZH_RECHARGE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (inline) return inline;
  try {
    return existsSync(RECHARGE_KEY_FILE) ? readFileSync(RECHARGE_KEY_FILE, 'utf8') : '';
  } catch {
    return '';
  }
};
const verifyPluginRechargeCode = (code, user) => {
  const parts = String(code || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== RECHARGE_CODE_PREFIX) throw new Error('积分访问码格式不正确。');
  const payloadBuffer = decodeBase64Url(parts[1]);
  const signature = decodeBase64Url(parts[2]);
  if (!crypto.verify(null, payloadBuffer, RECHARGE_PUBLIC_KEY, signature)) throw new Error('积分访问码签名无效，请确认复制完整。');
  let payload;
  try {
    payload = JSON.parse(payloadBuffer.toString('utf8'));
  } catch {
    throw new Error('积分访问码内容无法解析。');
  }
  if (payload.v !== 1 || payload.app !== 'zhihui-ai-canvas') throw new Error('积分访问码版本不匹配。');
  if (!payload.nonce || String(payload.nonce).length < 8) throw new Error('积分访问码缺少唯一编号。');
  if (!RECHARGE_AMOUNTS.has(Number(payload.amountCny))) throw new Error('积分访问码金额不在允许档位内。');
  if (Number(payload.points) !== Number(payload.amountCny) * 10) throw new Error('积分访问码积分数量不正确。');
  const payloadUser = normalizeRechargeAccount(payload.user);
  const userKeys = new Set([normalizeRechargeAccount(user.nickname), normalizeRechargeAccount(user.id), normalizeRechargeAccount(user.email)]);
  if (payloadUser !== '*' && !userKeys.has(payloadUser)) throw new Error(`该积分访问码属于 ${payload.user}，不能兑换到当前账号 ${user.nickname || user.id}。`);
  if (Number.isNaN(Date.parse(payload.expiresAt)) || new Date(payload.expiresAt).getTime() < Date.now()) throw new Error('积分访问码已过期，请联系管理员重新发放。');
  return payload;
};
async function redeemRechargeCode(user, rawCode) {
  const code = String(rawCode || '').trim();
  if (!code) throw Object.assign(new Error('请输入积分访问码。'), { status: 400 });
  if (code.toUpperCase().startsWith(`${RECHARGE_CODE_PREFIX}.`)) {
    const payload = verifyPluginRechargeCode(code, user);
    if (store.rechargeNonces.some((item) => item.nonce === payload.nonce)) throw Object.assign(new Error('该积分访问码已使用。'), { status: 409 });
    const points = Number(payload.points);
    user.points += points;
    store.rechargeNonces.push({ nonce: payload.nonce, userId: user.id, points, amountCny: Number(payload.amountCny), redeemedAt: now() });
    store.redemptions.push({ id: uid(), code: 'ZHRC1', userId: user.id, points, createdAt: now() });
    store.ledger.push({ id: uid(), userId: user.id, type: 'redeem', points, createdAt: now() });
    await persist();
    return { points: user.points, credited: points, balance: user.points };
  }
  const available = store.redemptionCodes.find((item) => item.code === code.toUpperCase() && !item.usedAt);
  if (!available) throw Object.assign(new Error('兑换码无效或已使用'), { status: 400 });
  available.usedAt = now();
  available.userId = user.id;
  user.points += available.points;
  store.redemptions.push({ id: uid(), code: available.code, userId: user.id, points: available.points, createdAt: now() });
  store.ledger.push({ id: uid(), userId: user.id, type: 'redeem', points: available.points, createdAt: now() });
  await persist();
  return { points: user.points, credited: available.points, balance: user.points };
}
function createSignedRechargeCodes(points, count) {
  const privateKey = getRechargePrivateKey();
  const amountCny = Number(points) / 10;
  if (!privateKey || !RECHARGE_AMOUNTS.has(amountCny)) return null;
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    const payload = {
      v: 1,
      app: 'zhihui-ai-canvas',
      user: '*',
      amountCny,
      points: amountCny * 10,
      nonce: crypto.randomUUID(),
      issuedAt: now(),
      expiresAt: RECHARGE_PERMANENT_EXPIRES,
    };
    const payloadBuffer = Buffer.from(JSON.stringify(payload), 'utf8');
    const signature = crypto.sign(null, payloadBuffer, privateKey);
    codes.push(`${RECHARGE_CODE_PREFIX}.${encodeBase64Url(payloadBuffer)}.${encodeBase64Url(signature)}`);
  }
  return codes;
}
const gatewayJob = (job) => ({ success: job.status === 'succeeded', jobId: job.id, assetId: job.status === 'succeeded' ? job.id : null, status: job.status, error: job.error || undefined, prompt: job.prompt || '', modelId: job.model || AI_IMAGE_MODEL, createdAt: job.createdAt || '' });
const issueTokens = (user) => { const accessToken = uid(); const refreshToken = uid(); store.sessions[hash(accessToken)] = { userId: user.id, kind: 'access', createdAt: now() }; store.sessions[hash(refreshToken)] = { userId: user.id, kind: 'refresh', createdAt: now() }; return { access_token: accessToken, refresh_token: refreshToken }; };
const readRawBody = async (req) => { const chunks = []; let total = 0; for await (const chunk of req) { total += chunk.length; if (total > 60 * 1024 * 1024) throw Object.assign(new Error('请求体过大'), { status: 413 }); chunks.push(Buffer.from(chunk)); } return Buffer.concat(chunks); };
function parseMultipart(raw, contentType) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return [];
  const boundary = Buffer.from('--' + (match[1] || match[2] || '').trim());
  const parts = [];
  let cursor = raw.indexOf(boundary);
  while (cursor >= 0) {
    let pos = cursor + boundary.length;
    if (raw.subarray(pos, pos + 2).toString() === '--') break;
    if (raw.subarray(pos, pos + 2).toString() === '\r\n') pos += 2;
    const headEnd = raw.indexOf('\r\n\r\n', pos);
    if (headEnd < 0) break;
    const headers = raw.subarray(pos, headEnd).toString();
    const bodyStart = headEnd + 4;
    const next = raw.indexOf(boundary, bodyStart);
    if (next < 0) break;
    let data = raw.subarray(bodyStart, next);
    if (data.length > 1 && data.subarray(data.length - 2).toString() === '\r\n') data = data.subarray(0, data.length - 2);
    const nameMatch = headers.match(/name="([^"]*)"/i);
    const fileMatch = headers.match(/filename="([^"]*)"/i);
    const typeMatch = headers.match(/content-type:\s*([^\r\n]+)/i);
    if (nameMatch) parts.push({ name: nameMatch[1], filename: fileMatch ? fileMatch[1] : '', type: typeMatch ? typeMatch[1].trim() : 'application/octet-stream', data });
    cursor = next;
  }
  return parts;
}
function outputSize(ratio, resolution) {
  const base = ({ '1K': 1024, '2K': 2048, '4K': 4096 }[String(resolution || '1K').toUpperCase()] || 1024);
  const factors = { '4:3': 3 / 4, '3:4': 4 / 3, '16:9': 9 / 16, '9:16': 16 / 9, '2:3': 2 / 3, '3:2': 3 / 2 };
  const f = factors[String(ratio || '1:1')] || 1;
  return `${base}x${Math.round(base * f)}`;
}
async function runGatewayGeneration(job, user, referenceIds, aiOverride, maskId) {
  const ai = aiOverride || activeAiConfig();
  if (!ai.baseUrl || !ai.apiKey) throw new Error('服务器尚未配置上游图像服务，请在运营后台设置 AI 服务。');
  const refs = store.references.filter((r) => referenceIds.includes(r.id) && r.userId === user.id);
  const maskRef = maskId ? store.references.find((r) => r.id === maskId && r.userId === user.id) : undefined;
  const prompt = String(job.prompt || '');
  const size = outputSize(job.aspectRatio, job.resolution);
  const payload = { model: job.model || ai.model, prompt, size, quality: job.quality || 'auto', n: job.quantity || 1, response_format: 'b64_json' };
  const headers = { authorization: `Bearer ${ai.apiKey}` };
  const upstreamBase = normalizeUpstreamBase(ai.baseUrl);
  const attempt = async (model) => {
    const nextPayload = { ...payload, model };
    let response;
    if (refs.length) {
      const form = new FormData();
      form.append('model', model); form.append('prompt', prompt); form.append('size', size); form.append('quality', nextPayload.quality); form.append('n', String(nextPayload.n)); form.append('response_format', 'b64_json');
      for (let i = 0; i < refs.length; i += 1) {
        const ref = refs[i];
        const file = await readFile(ref.path);
        form.append('image', new Blob([file], { type: ref.mimeType || 'image/png' }), ref.fileName || `ref-${i}.png`);
      }
      if (maskRef) {
        const maskFile = await readFile(maskRef.path);
        form.append('mask', new Blob([maskFile], { type: maskRef.mimeType || 'image/png' }), maskRef.fileName || 'mask.png');
      }
      response = await fetch(`${upstreamBase}/v1/images/edits`, { method: 'POST', headers, body: form });
    } else {
      response = await fetch(`${upstreamBase}/v1/images/generations`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(nextPayload) });
    }
    return { response, json: await response.json().catch(() => ({})) };
  };
  const candidates = [payload.model];
  const first = await attempt(payload.model);
  let { response, json } = first;
  const primaryError = json?.error?.message || json?.message || '';
  if (!response.ok && /model_not_found|no available channel|not found|不存在|不支持/i.test(String(primaryError))) {
    try {
      const live = await readUpstreamModels(upstreamBase, ai.apiKey);
      for (const model of live) {
        if ((model.tags || []).some((tag) => tag === 'text-to-image' || tag === 'image-editing')) candidates.push(model.modelId || model.id);
      }
    } catch {}
    candidates.push('gpt-image-1.5', 'gpt-image-1', 'dall-e-3');
    for (const candidate of [...new Set(candidates.filter(Boolean))].slice(1)) {
      const next = await attempt(candidate);
      if (next.response.ok) {
        response = next.response; json = next.json; payload.model = candidate;
        break;
      }
    }
  }
  if (!response.ok) throw new Error(json.error?.message || json.message || `上游图像服务失败 ${response.status}`);
  let buffer;
  const item = (json.data || [])[0] || {};
  if (item.b64_json) buffer = Buffer.from(item.b64_json, 'base64');
  if (!buffer && item.url) {
    const imageResponse = await fetch(item.url);
    if (!imageResponse.ok) throw new Error('上游返回图片下载失败');
    buffer = Buffer.from(await imageResponse.arrayBuffer());
  }
  if (!buffer) throw new Error('上游没有返回可用的图片数据');
  const assetFile = path.join(ASSET_DIR, `${job.id}.png`);
  await writeFile(assetFile, buffer);
  job.assetFile = assetFile; job.mimeType = 'image/png'; job.status = 'succeeded'; job.completedAt = now();
}

async function processUpstreamText(body) {
  const platform = activeAiConfig();
  const baseUrl = normalizeUpstreamBase(body.baseUrl || platform.baseUrl || '');
  const apiKey = String(body.apiKey || platform.apiKey || '').trim();
  if (!baseUrl || !apiKey) throw new Error('尚未配置可用的上游文本服务，请先在设置或运营后台配置。');
  const tool = String(body.tool || 'chat');
  const prompt = String(body.prompt || '').trim();
  if (!prompt && tool !== 'reverse-prompt') throw new Error('请先输入需要处理的文本。');
  const systemPrompt = tool === 'chat'
    ? '你是郄绘 AI 画布里的智能对话助手。理解用户的广告、电商、视觉设计需求，给出清晰、可执行、适合继续生图的中文结果。只输出结果，不要解释接口。'
    : tool === 'polish-prompt'
      ? '你是顶级商业广告视觉提示词导演。把用户输入改写成高标准、高质量、可执行的中文图像生成提示词，补全主体、材质、光线、构图、镜头和排版要求。只输出提示词，不要解释。'
      : '你是专业视觉分析师。结合用户要求，反推出准确的中文图像编辑提示词，重点保留主体身份、构图、材质和画面关系。只输出提示词，不要解释。';
  const candidates = [];
  const explicit = String(body.model || '').trim();
  if (explicit) candidates.push(explicit);
  try {
    const live = await readUpstreamModels(baseUrl, apiKey);
    for (const model of live) {
      if ((model.tags || []).includes('reasoning')) candidates.push(model.modelId || model.id);
    }
  } catch {}
  candidates.push('gpt-5.5', 'gpt-5.4', 'gpt-5.3-codex-spark', 'gpt-4.1-mini');
  let lastError = '';
  for (const model of [...new Set(candidates.filter(Boolean))].slice(0, 8)) {
    try {
      const response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt || '请分析这张参考图并反推出可执行的图像提示词。' },
          ],
          temperature: tool === 'chat' ? 0.7 : 0.45,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        lastError = json.error?.message || json.message || `文本服务返回 ${response.status}`;
        continue;
      }
      const message = json.choices?.[0]?.message ?? {};
      const content = typeof message.content === 'string' ? message.content : typeof message.reasoning_content === 'string' ? message.reasoning_content : '';
      if (content.trim()) return { text: content.trim(), model };
      lastError = '模型没有返回文本内容';
    } catch (error) {
      lastError = error.message || String(error);
    }
  }
  throw new Error(lastError || '文本处理失败：当前上游没有可用的推理模型。');
}

async function gateway(req, res, pathName) {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  if (req.method === 'GET' && pathName === '/healthz') return send(res, 200, { ok: true, service: 'zhihui-web' });
  const contentType = String(req.headers['content-type'] || '');
  let body;
  let files = [];
  if (contentType.includes('multipart/form-data')) {
    const raw = await readRawBody(req).catch((e) => send(res, e.status || 400, { detail: e.message }));
    if (!raw) return;
    files = parseMultipart(raw, contentType);
    body = {};
    for (const part of files) if (part.name && !part.filename) body[part.name] = part.data.toString('utf8');
  } else {
    body = await parseBody(req);
  }
  const fail = (status, message) => send(res, status, { success: false, error: message, detail: message });
  if (req.method === 'POST' && pathName === '/v1/auth/login') {
    const identifier = String(body.email || body.nickname || body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = store.users.find((u) => (u.email || '').toLowerCase() === identifier || (u.nickname || '').toLowerCase() === identifier);
    if (!user || user.passwordHash !== passwordHash(password, user.passwordSalt)) return fail(401, '邮箱/昵称或密码错误');
    return send(res, 200, { success: true, ...issueTokens(user), user: safeUser(user) });
  }
  if (req.method === 'POST' && pathName === '/v1/auth/register') {
    const email = String(body.email || '').trim().toLowerCase();
    const nickname = String(body.nickname || body.username || '').trim();
    const password = String(body.password || '');
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, '请输入有效邮箱');
    if (nickname.length < 2 || password.length < 8) return fail(400, '昵称至少 2 个字符，密码至少 8 位');
    if (store.users.some((u) => (u.email || '').toLowerCase() === email || (u.nickname || '').toLowerCase() === nickname.toLowerCase())) return fail(409, '邮箱或昵称已存在');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id: uid(), email, nickname, username: nickname, passwordSalt: salt, passwordHash: passwordHash(password, salt), points: 100, role: 'user', createdAt: now() };
    store.users.push(user); await persist();
    return send(res, 201, { success: true, ...issueTokens(user), user: safeUser(user) });
  }
  if (req.method === 'POST' && pathName === '/v1/auth/refresh') {
    const user = tokenUser(req, 'refresh');
    if (!user) return fail(401, '刷新令牌无效');
    const accessToken = uid(); store.sessions[hash(accessToken)] = { userId: user.id, kind: 'access', createdAt: now() }; await persist();
    return send(res, 200, { success: true, access_token: accessToken });
  }
  if (req.method === 'POST' && pathName === '/v1/ai/test-connection') {
    const platform = activeAiConfig();
    const apiKey = String(body.apiKey || platform.apiKey || '').trim();
    const baseUrl = normalizeUpstreamBase(body.baseUrl || platform.baseUrl || '');
    const mode = String(body.mode || 'models');
    if (!apiKey || !baseUrl) return fail(400, body.apiKey || body.baseUrl ? '请输入 API Key 和服务地址' : '服务器尚未配置默认 AI 服务，请联系管理员在运营后台配置');
    try {
      if (mode === 'reasoning') {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, { headers: { authorization: `Bearer ${apiKey}` } });
        if (response.ok) return send(res, 200, { success: true, message: '推理模型连接成功', models: [] });
        const text = await response.text();
        return fail(400, `连接失败（${response.status}）：${text.slice(0, 180)}`);
      }
      const models = await readUpstreamModels(baseUrl, apiKey);
      if (models.length) return send(res, 200, { success: true, message: `API 连接成功，已读取 ${models.length} 个模型${body.apiKey || body.baseUrl ? '' : '（默认使用平台服务）'}`, models });
      return fail(400, '连接成功，但没有读取到模型列表，请检查中转地址的模型接口。');
    } catch (error) {
      return fail(400, `连接失败：${String(error.message || error).slice(0, 180)}`);
    }
  }
  const user = tokenUser(req);
  if (!user) return fail(401, '请先登录平台账号');
  if (req.method === 'POST' && pathName === '/v1/ai/text') {
    try {
      const result = await processUpstreamText(body);
      return send(res, 200, { success: true, text: result.text, model: result.model });
    } catch (error) {
      return fail(400, error.message || String(error));
    }
  }
  if (req.method === 'GET' && pathName === '/v1/account') return send(res, 200, { success: true, user: safeUser(user) });
  if ((req.method === 'PUT' || req.method === 'PATCH') && pathName === '/v1/account') {
    const nickname = String(body.nickname || body.displayName || '').trim();
    if (nickname) {
      if (nickname.length < 2) return fail(400, '昵称至少 2 个字符');
      if (store.users.some((u) => u.id !== user.id && (u.nickname || '').toLowerCase() === nickname.toLowerCase())) return fail(409, '该昵称已存在');
      user.nickname = nickname; user.displayName = nickname;
    }
    user.profile = Object.assign({}, user.profile || {}, body.profile && typeof body.profile === 'object' ? body.profile : {});
    if (body.settings && typeof body.settings === 'object') user.profile.settings = Object.assign({}, user.profile.settings || {}, body.settings);
    await persist();
    return send(res, 200, { success: true, user: safeUser(user) });
  }
  if (req.method === 'GET' && pathName === '/v1/models') return send(res, 200, { success: true, models: await liveGatewayModels() });
  if (req.method === 'GET' && pathName === '/v1/image/models') return send(res, 200, { success: true, models: await liveGatewayModels() });
  if (req.method === 'POST' && pathName === '/v1/image/references') {
    if (!files.length) return fail(400, '没有收到参考图');
    const result = [];
    for (const file of files) {
      if (!file.filename) continue;
      if (!file.type.startsWith('image/')) return fail(415, '只支持图片文件');
      const ref = { id: uid(), userId: user.id, path: path.join(REF_DIR, `${uid()}.bin`), mimeType: file.type, fileName: file.filename, createdAt: now() };
      await writeFile(ref.path, file.data); store.references.push(ref); result.push({ id: ref.id, fileName: file.filename });
    }
    await persist(); return send(res, 201, { success: true, references: result });
  }
  if (req.method === 'DELETE' && pathName === '/v1/image/references') {
    const id = route(req).query.get('id') || body.id;
    const ref = store.references.find((r) => r.id === id && r.userId === user.id);
    if (ref) { await unlink(ref.path).catch(() => {}); store.references = store.references.filter((r) => r.id !== id); await persist(); }
    return send(res, 200, { success: true });
  }
  if (req.method === 'POST' && pathName === '/v1/image/generations') {
    const requestId = String(body.request_id || body.requestId || '').trim();
    if (requestId.length < 8) return fail(400, 'request_id 至少 8 个字符');
    const existingJob = store.jobs.find((j) => j.requestId === requestId && j.userId === user.id);
    if (existingJob) return send(res, 200, gatewayJob(existingJob));
    const cost = 3 * Math.max(1, Math.min(4, Number(body.quantity) || 1));
    if (user.role !== 'admin' && user.points < cost) return fail(402, '积分不足');
    const job = { id: uid(), requestId, userId: user.id, prompt: String(body.prompt || ''), model: String(body.model || body.modelId || AI_IMAGE_MODEL), aspectRatio: String(body.aspect_ratio || '1:1'), resolution: String(body.resolution || '1K'), quality: String(body.quality || 'auto'), quantity: Math.max(1, Math.min(4, Number(body.quantity) || 1)), status: 'processing', cost, createdAt: now() };
    if (user.role !== 'admin') user.points -= cost;
    store.jobs.push(job); store.ledger.push({ id: uid(), userId: user.id, type: 'image', points: user.role === 'admin' ? 0 : -cost, requestId, createdAt: now() }); await persist();
    const overrideBaseUrl = String(body.baseUrl || body.ai_base_url || req.headers['x-ai-base-url'] || '').trim();
    const overrideApiKey = String(body.apiKey || body.ai_api_key || req.headers['x-ai-key'] || '').trim();
    const aiOverride = overrideBaseUrl && overrideApiKey ? { baseUrl: overrideBaseUrl, apiKey: overrideApiKey } : undefined;
    const maskId = String(body.mask_id || body.maskId || '').trim();
    try { await runGatewayGeneration(job, user, Array.isArray(body.reference_ids) ? body.reference_ids : [], aiOverride, maskId); await persist(); }
    catch (err) { if (user.role !== 'admin') user.points += cost; job.status = 'failed'; job.error = String(err.message || err).slice(0, 500); store.ledger.push({ id: uid(), userId: user.id, type: 'image-refund', points: user.role === 'admin' ? 0 : cost, requestId, createdAt: now() }); await persist(); }
    return send(res, job.status === 'succeeded' ? 201 : 200, gatewayJob(job));
  }
  const assetMatch = pathName.match(/^\/v1\/image\/assets\/([^/]+)$/);
  if (req.method === 'GET' && assetMatch) {
    const job = store.jobs.find((j) => j.id === assetMatch[1] && j.userId === user.id && j.status === 'succeeded');
    if (!job || !job.assetFile || !existsSync(job.assetFile)) return fail(404, '图片不存在或已过期');
    const data = await readFile(job.assetFile); return sendRaw(res, 200, data, { 'content-type': job.mimeType || 'image/png' });
  }
  const jobMatch = pathName.match(/^\/v1\/image\/jobs\/([^/]+)$/);
  if (req.method === 'GET' && jobMatch) { const job = store.jobs.find((j) => j.id === jobMatch[1] && j.userId === user.id); return job ? send(res, 200, gatewayJob(job)) : fail(404, '任务不存在'); }
  if (req.method === 'GET' && pathName === '/v1/image/history') {
    const limit = Math.max(1, Math.min(50, Number(route(req).query.get('limit')) || 24));
    return send(res, 200, { success: true, history: store.jobs.filter((j) => j.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(gatewayJob) });
  }
  if (req.method === 'DELETE' && pathName === '/v1/image/history') {
    const ids = new Set([
      ...(Array.isArray(body.job_ids) ? body.job_ids : []),
      ...(Array.isArray(body.jobIds) ? body.jobIds : []),
      body.job_id,
      body.jobId,
      body.id,
    ].filter(Boolean).map(String));
    if (!ids.size) return fail(400, '请选择要删除的任务');
    const targets = store.jobs.filter((job) => ids.has(job.id) && job.userId === user.id);
    for (const job of targets) {
      if (job.assetFile) await unlink(job.assetFile).catch(() => {});
    }
    store.jobs = store.jobs.filter((job) => !(ids.has(job.id) && job.userId === user.id));
    await persist();
    return send(res, 200, { success: true, deleted: targets.length });
  }
  if (req.method === 'POST' && pathName === '/v1/redeem') {
    try {
      const result = await redeemRechargeCode(user, body.code);
      return send(res, 200, { success: true, credited: result.credited, balance: result.balance, points: result.points });
    } catch (error) {
      return fail(error.status || 400, error.message || String(error));
    }
  }
  if (req.method === 'GET' && pathName === '/v1/studio/workflows') return send(res, 200, { success: true, workflows: store.workflows || [] });
  if (user.role !== 'admin') return fail(403, '需要管理员权限');
  if (req.method === 'GET' && pathName === '/v1/admin/ai-config') {
    const cfg = activeAiConfig();
    return send(res, 200, { success: true, config: { baseUrl: cfg.baseUrl, model: cfg.model, apiKeyConfigured: Boolean(cfg.apiKey), apiKeyPreview: cfg.apiKey ? `${String(cfg.apiKey).slice(0, 3)}…${String(cfg.apiKey).slice(-3)}` : '' } });
  }
  if ((req.method === 'POST' || req.method === 'PUT') && pathName === '/v1/admin/ai-config') {
    const current = activeAiConfig();
    const baseUrl = normalizeUpstreamBase(body.baseUrl !== undefined ? body.baseUrl : current.baseUrl);
    const apiKey = String(body.apiKey !== undefined ? body.apiKey : current.apiKey).trim();
    const model = String(body.model !== undefined ? body.model : current.model).trim() || 'gpt-image-2';
    if (baseUrl) { try { const u = new URL(baseUrl); if (!/^https?:$/.test(u.protocol)) throw new Error('协议'); } catch { return fail(400, 'AI_BASE_URL 必须是有效的 http/https 地址'); } }
    store.aiConfig = { baseUrl, apiKey, model }; await persist();
    return send(res, 200, { success: true, config: { baseUrl, model, apiKeyConfigured: Boolean(apiKey), apiKeyPreview: apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-3)}` : '' } });
  }
  if (req.method === 'POST' && pathName === '/v1/admin/redeem-codes') {
    const points = Math.max(1, Math.min(100000, Number(body.amount || body.points) || 10));
    const count = Math.max(1, Math.min(100, Number(body.count) || 1));
    const signed = createSignedRechargeCodes(points, count);
    if (signed) return send(res, 201, { success: true, codes: signed, amount: points, signed: true });
    const codes = [];
    for (let i = 0; i < count; i += 1) {
      const raw = `ZH-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
      codes.push(raw);
      store.redemptionCodes.push({ id: uid(), code: raw, points, createdAt: now() });
    }
    await persist();
    return send(res, 201, { success: true, codes, amount: points, signed: false });
  }
  if (req.method === 'GET' && pathName === '/v1/admin/recharge-key') {
    return send(res, 200, { success: true, configured: Boolean(getRechargePrivateKey()) });
  }
  if ((req.method === 'POST' || req.method === 'PUT') && pathName === '/v1/admin/recharge-key') {
    const privateKey = String(body.privateKey || '').replace(/\\n/g, '\n').trim();
    try {
      const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).trim();
      if (publicKey !== RECHARGE_PUBLIC_KEY.trim()) return fail(400, '私钥与插件内置公钥不匹配。');
      await writeFile(RECHARGE_KEY_FILE, `${privateKey}\n`);
      return send(res, 200, { success: true, configured: true });
    } catch {
      return fail(400, '私钥格式不正确，应为 Ed25519 PEM 私钥。');
    }
  }
  if (req.method === 'GET' && pathName === '/v1/admin/dashboard') {
    const users = store.users.slice(-200); const jobs = store.jobs.slice(-100).reverse(); const workflows = store.workflows || [];
    return send(res, 200, { success: true, stats: { users: users.length, jobs: jobs.length, credits: users.reduce((n, u) => n + u.points, 0), succeeded: jobs.filter((j) => j.status === 'succeeded').length, failed: jobs.filter((j) => j.status === 'failed').length }, users: users.map((u) => ({ ...safeUser(u), blocked: false })), jobs: jobs.map((j) => ({ id: j.id, requestId: j.requestId, userId: j.userId, status: j.status, model: j.model, cost: j.cost, error: j.error, createdAt: j.createdAt })), workflows });
  }
  if (req.method === 'POST' && pathName === '/v1/studio/workflows') { const workflow = typeof body.workflow === 'string' ? JSON.parse(body.workflow) : body.workflow; if (!workflow || !workflow.code) return fail(400, '工作流缺少 code'); const item = { id: uid(), code: String(workflow.code), name: String(workflow.name || workflow.code), description: String(workflow.description || ''), definition: workflow, version: Number(workflow.version) || 1, published: workflow.published !== false, createdAt: now(), updatedAt: now() }; store.workflows.push(item); await persist(); return send(res, 201, { success: true, workflow: item }); }
  return fail(404, '接口不存在');
}

async function api(req, res, pathName) {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  if (req.method === 'GET' && pathName === '/api/health') return send(res, 200, { ok: true, service: 'zhihui-web', time: now(), apiOrigin: PUBLIC_API_ORIGIN || '', aiEnabled: Boolean(activeAiConfig().apiKey) });
  const body = await parseBody(req);
  if (req.method === 'POST' && pathName === '/api/v1/auth/register') {
    const nickname = String(body.nickname || '').trim(); const password = String(body.password || '');
    if (nickname.length < 2 || password.length < 6) return send(res, 400, { error: '昵称至少 2 个字符，密码至少 6 位。' });
    const email = String(body.email || '').trim().toLowerCase();
    if (store.users.some((u) => u.nickname === nickname || (email && (u.email || '').toLowerCase() === email))) return send(res, 409, { error: '该账号已存在。' });
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const user = { id: uid(), nickname, email, passwordSalt, passwordHash: passwordHash(password, passwordSalt), points: 100, role: 'user', createdAt: now() }; store.users.push(user);
    const token = uid(); store.sessions[hash(token)] = user.id; await persist(); return send(res, 201, { token, user: safeUser(user) });
  }
  if (req.method === 'POST' && pathName === '/api/v1/auth/login') {
    const identifier = String(body.nickname || body.email || '').trim().toLowerCase();
    const user = store.users.find((u) => (u.nickname || '').toLowerCase() === identifier || (u.email || '').toLowerCase() === identifier);
    if (!user || user.passwordHash !== passwordHash(String(body.password || ''), user.passwordSalt)) return send(res, 401, { error: '账号或密码错误。' });
    const token = uid(); store.sessions[hash(token)] = user.id; await persist(); return send(res, 200, { token, user: safeUser(user) });
  }
  const user = tokenUser(req);
  if (pathName === '/api/v1/auth/me' && req.method === 'GET') return user ? send(res, 200, { user: safeUser(user) }) : send(res, 401, { error: '未登录。' });
  if (!user) return send(res, 401, { error: '请先登录。' });
  if (req.method === 'GET' && pathName === '/api/v1/tasks') return send(res, 200, { tasks: store.tasks.filter((t) => t.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(publicTask) });
  if (req.method === 'DELETE' && pathName === '/api/v1/tasks') {
    const ids = new Set([
      ...(Array.isArray(body.ids) ? body.ids : []),
      ...(Array.isArray(body.task_ids) ? body.task_ids : []),
      body.id,
      body.taskId,
    ].filter(Boolean).map(String));
    if (!ids.size) return send(res, 400, { error: '请选择要删除的任务。' });
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((task) => !(ids.has(task.id) && task.userId === user.id));
    await persist();
    return send(res, 200, { success: true, deleted: before - store.tasks.length });
  }
  if (req.method === 'POST' && (pathName === '/api/v1/tasks' || pathName === '/api/v1/studio/generate' || pathName === '/api/v1/studio/tasks')) {
    const cost = 10; const prompt = String(body.prompt || '').trim(); if (!prompt) return send(res,400,{error:'请输入创作描述。'}); if (user.points < cost) return send(res,402,{error:'积分不足。'});
    user.points -= cost; const task = { id: uid(), userId: user.id, prompt, model: body.model || 'gpt-image-2', mode: body.mode || (Array.isArray(body.images) && body.images.length ? 'edit' : 'generate'), status: 'queued', cost, progress: 0, request: body, createdAt: now() }; store.tasks.push(task); store.ledger.push({id:uid(),userId:user.id,type:'task',points:-cost,taskId:task.id,createdAt:now()});
    await submitRemoteTask(task);
    if (task.status === 'queued' && task.remoteTaskId) task.status = 'processing';
    if (!AI_BASE_URL || !AI_API_KEY) {
      task.status = 'completed';
      task.completedAt = now();
      task.progress = 100;
      task.result = { message: '任务已创建。配置 AI_BASE_URL 与 AI_API_KEY 后可启用真实模型生成。' };
    }
    await persist();
    if (task.status === 'processing') {
      const poll = setInterval(async () => {
        await pollRemoteTask(task);
        await persist();
        if (task.status === 'completed' || task.status === 'failed') clearInterval(poll);
      }, 5000);
      setTimeout(() => clearInterval(poll), 15 * 60 * 1000);
    }
    return send(res, 201, { task: publicTask(task), points: user.points });
  }
  if (req.method === 'GET' && pathName === '/api/v1/studio/tasks') return send(res, 200, { tasks: store.tasks.filter((t) => t.userId === user.id).map(publicTask) });
  if (req.method === 'DELETE' && pathName === '/api/v1/studio/tasks') {
    const ids = new Set([...(Array.isArray(body.ids) ? body.ids : []), ...(Array.isArray(body.task_ids) ? body.task_ids : []), body.id, body.taskId].filter(Boolean).map(String));
    if (!ids.size) return send(res, 400, { error: '请选择要删除的任务。' });
    const before = store.tasks.length;
    store.tasks = store.tasks.filter((task) => !(ids.has(task.id) && task.userId === user.id));
    await persist();
    return send(res, 200, { success: true, deleted: before - store.tasks.length });
  }
  if (req.method === 'GET' && pathName === '/api/v1/studio/models') return send(res, 200, { models: studioModels() });
  if (req.method === 'GET' && pathName === '/api/v1/studio/profile') return send(res, 200, { user: safeUser(user) });
  if (req.method === 'GET' && pathName === '/api/v1/studio/config') return send(res, 200, { apiOrigin: PUBLIC_API_ORIGIN || `http://${req.headers.host || 'localhost'}`, compatibility: 'zhihui-v1', models: studioModels(), aiEnabled: Boolean(AI_BASE_URL && AI_API_KEY) });
  const studioTask = pathName.match(/^\/api\/v1\/studio\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && studioTask) { const task = store.tasks.find((t)=>t.id===studioTask[1] && t.userId===user.id); return task ? send(res,200,{task: publicTask(task)}) : send(res,404,{error:'任务不存在。'}); }
  if (req.method === 'POST' && pathName === '/api/v1/points/redeem') {
    try {
      const result = await redeemRechargeCode(user, body.code);
      return send(res, 200, { points: result.points, credited: result.credited, message: `已兑换 ${result.credited} 积分。` });
    } catch (error) {
      return send(res, error.status || 400, { error: error.message || String(error) });
    }
  }
  const isAdmin = user.role === 'admin' || req.headers['x-admin-key'] === ADMIN_KEY;
  if (req.method === 'GET' && pathName === '/api/v1/admin/overview') { if (!isAdmin) return send(res,403,{error:'无权限。'}); return send(res,200,{users:store.users.map(safeUser), tasks:store.tasks, redemptions:store.redemptions, metrics:{users:store.users.length,tasks:store.tasks.length,points:store.users.reduce((n,u)=>n+u.points,0)}}); }
  if (req.method === 'POST' && pathName === '/api/v1/admin/redemption-codes') {
    if (!isAdmin) return send(res, 403, { error: '无权限。' });
    const points = Math.max(1, Math.min(100000, Number(body.points) || 100));
    const count = Math.max(1, Math.min(100, Number(body.count) || 1));
    const signed = createSignedRechargeCodes(points, count);
    if (signed) return send(res, 201, { codes: signed.map((code) => ({ id: uid(), code, points, createdAt: now() })), signed: true });
    const codes = Array.from({ length: count }, () => ({ id: uid(), code: `ZH-${crypto.randomBytes(5).toString('hex').toUpperCase()}`, points, createdAt: now() }));
    store.redemptionCodes.push(...codes);
    await persist();
    return send(res, 201, { codes, signed: false });
  }
  if (/^\/api\/v1\/studio\//.test(pathName)) return send(res, 404, { error:'不支持的插件接口。', compatibility:'zhihui-v1' });
  return send(res, 404, { error:'接口不存在。' });
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg' };
const server = http.createServer(async (req,res) => { res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN || '*'); res.setHeader('access-control-allow-headers','authorization, content-type, x-admin-key, x-ai-key, x-ai-base-url'); res.setHeader('access-control-allow-methods','GET, POST, PUT, PATCH, DELETE, OPTIONS'); res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); const { path: p } = route(req); if (p === '/plugin-config.json') return send(res, 200, publicPluginConfig()); if (p.startsWith('/api/')) return api(req,res,p); if (p === '/healthz' || p.startsWith('/v1/')) return gateway(req,res,p); let file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p); if (!file.startsWith(PUBLIC_DIR)) return send(res,403,{error:'forbidden'}); if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html'); if (!existsSync(file)) file = path.join(PUBLIC_DIR,'index.html'); try { res.writeHead(200, {'content-type': mime[path.extname(file)] || mime['.html']}); createReadStream(file).pipe(res); } catch { send(res,500,{error:'server error'}); } });
await load(); server.listen(PORT, HOST, () => console.log(`Zhihui web listening on http://${HOST}:${PORT}`));
