import http from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream, statSync } from 'node:fs';
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
const defaultStore = () => ({ users: [], tasks: [], redemptionCodes: [], redemptions: [], ledger: [], sessions: {}, references: [], jobs: [], assets: [], workflows: [], aiConfig: { baseUrl: '', apiKey: '', model: '' } });
let store = defaultStore();
async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(ASSET_DIR, { recursive: true });
  await mkdir(REF_DIR, { recursive: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  if (existsSync(DATA_FILE)) { try { store = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { store = defaultStore(); } }
  store.tasks ||= []; store.redemptionCodes ||= []; store.redemptions ||= []; store.ledger ||= []; store.sessions ||= {}; store.references ||= []; store.jobs ||= []; store.assets ||= []; store.workflows ||= []; store.aiConfig ||= { baseUrl: '', apiKey: '', model: '' };
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

const activeAiConfig = () => ({ baseUrl: AI_BASE_URL || store.aiConfig?.baseUrl || '', apiKey: AI_API_KEY || store.aiConfig?.apiKey || '', model: AI_IMAGE_MODEL || store.aiConfig?.model || 'gpt-image-2' });
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
  const endpoint = `${String(baseUrl || '').replace(/\/+$/, '')}/v1/models`;
  const response = await fetch(endpoint, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!response.ok) throw new Error(`模型接口返回 ${response.status}`);
  return modelsFromPayload(await response.json());
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
async function runGatewayGeneration(job, user, referenceIds) {
  const ai = activeAiConfig();
  if (!ai.baseUrl || !ai.apiKey) throw new Error('服务器尚未配置上游图像服务，请在运营后台设置 AI 服务。');
  const refs = store.references.filter((r) => referenceIds.includes(r.id) && r.userId === user.id);
  const prompt = String(job.prompt || '');
  const size = outputSize(job.aspectRatio, job.resolution);
  const payload = { model: job.model || ai.model, prompt, size, quality: job.quality || 'auto', n: job.quantity || 1, response_format: 'b64_json' };
  const headers = { authorization: `Bearer ${ai.apiKey}` };
  let response;
  if (refs.length) {
    const form = new FormData();
    form.append('model', payload.model); form.append('prompt', prompt); form.append('size', size); form.append('quality', payload.quality); form.append('n', String(payload.n)); form.append('response_format', 'b64_json');
    for (let i = 0; i < refs.length; i += 1) {
      const ref = refs[i];
      const file = await readFile(ref.path);
      form.append('image', new Blob([file], { type: ref.mimeType || 'image/png' }), ref.fileName || `ref-${i}.png`);
    }
    response = await fetch(`${ai.baseUrl.replace(/\/+$/, '')}/v1/images/edits`, { method: 'POST', headers, body: form });
  } else {
    response = await fetch(`${ai.baseUrl.replace(/\/+$/, '')}/v1/images/generations`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(payload) });
  }
  const json = await response.json().catch(() => ({}));
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
    let baseUrl = String(body.baseUrl || platform.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/v\d+$/i, '');
    const mode = String(body.mode || 'models');
    if (!apiKey || !baseUrl) return fail(400, body.apiKey || body.baseUrl ? '请输入 API Key 和服务地址' : '服务器尚未配置默认 AI 服务，请联系管理员在运营后台配置');
    try {
      const endpoint = mode === 'reasoning' ? '/v1/chat/completions' : '/v1/models';
      const response = await fetch(baseUrl + endpoint, { headers: { authorization: `Bearer ${apiKey}` } });
      if (response.ok) {
        let models = [];
        if (mode !== 'reasoning') models = modelsFromPayload(await response.json().catch(() => ({})), String(body.model || ''));
        return send(res, 200, { success: true, message: mode === 'reasoning' ? '推理模型连接成功（平台默认服务）' : `API 连接成功，已读取 ${models.length || ''} 个模型${body.apiKey || body.baseUrl ? '' : '（默认使用平台服务）'}`, models });
      }
      const text = await response.text();
      return fail(400, `连接失败（${response.status}）：${text.slice(0, 180)}`);
    } catch (error) {
      return fail(400, `连接失败：${String(error.message || error).slice(0, 180)}`);
    }
  }
  const user = tokenUser(req);
  if (!user) return fail(401, '请先登录平台账号');
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
  if (req.method === 'GET' && pathName === '/v1/image/models') return send(res, 200, { success: true, models: await imageGatewayModels() });
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
    try { await runGatewayGeneration(job, user, Array.isArray(body.reference_ids) ? body.reference_ids : []); await persist(); }
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
  if (req.method === 'GET' && pathName === '/v1/image/history') return send(res, 200, { success: true, history: store.jobs.filter((j) => j.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100).map(gatewayJob) });
  if (req.method === 'DELETE' && pathName === '/v1/image/history') { const id = String(body.job_id || body.jobId || ''); const job = store.jobs.find((j) => j.id === id && j.userId === user.id); if (job) { if (job.assetFile) await unlink(job.assetFile).catch(() => {}); store.jobs = store.jobs.filter((j) => j.id !== id); await persist(); } return send(res, 200, { success: true }); }
  if (req.method === 'POST' && pathName === '/v1/redeem') {
    const code = String(body.code || '').trim().toUpperCase();
    const available = store.redemptionCodes.find((r) => r.code === code && !r.usedAt);
    if (!available) return fail(400, '兑换码无效或已使用');
    available.usedAt = now(); available.userId = user.id; user.points += available.points;
    store.redemptions.push({ id: uid(), code, userId: user.id, points: available.points, createdAt: now() });
    store.ledger.push({ id: uid(), userId: user.id, type: 'redeem', points: available.points, createdAt: now() }); await persist();
    return send(res, 200, { success: true, credited: available.points, balance: user.points });
  }
  if (req.method === 'GET' && pathName === '/v1/studio/workflows') return send(res, 200, { success: true, workflows: store.workflows || [] });
  if (user.role !== 'admin') return fail(403, '需要管理员权限');
  if (req.method === 'GET' && pathName === '/v1/admin/ai-config') {
    const cfg = activeAiConfig();
    return send(res, 200, { success: true, config: { baseUrl: cfg.baseUrl, model: cfg.model, apiKeyConfigured: Boolean(cfg.apiKey), apiKeyPreview: cfg.apiKey ? `${String(cfg.apiKey).slice(0, 3)}…${String(cfg.apiKey).slice(-3)}` : '' } });
  }
  if ((req.method === 'POST' || req.method === 'PUT') && pathName === '/v1/admin/ai-config') {
    const current = activeAiConfig();
    const baseUrl = String(body.baseUrl !== undefined ? body.baseUrl : current.baseUrl).trim();
    const apiKey = String(body.apiKey !== undefined ? body.apiKey : current.apiKey).trim();
    const model = String(body.model !== undefined ? body.model : current.model).trim() || 'gpt-image-2';
    if (baseUrl) { try { const u = new URL(baseUrl); if (!/^https?:$/.test(u.protocol)) throw new Error('协议'); } catch { return fail(400, 'AI_BASE_URL 必须是有效的 http/https 地址'); } }
    store.aiConfig = { baseUrl, apiKey, model }; await persist();
    return send(res, 200, { success: true, config: { baseUrl, model, apiKeyConfigured: Boolean(apiKey), apiKeyPreview: apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-3)}` : '' } });
  }
  if (req.method === 'POST' && pathName === '/v1/admin/redeem-codes') { const points = Math.max(1, Math.min(100000, Number(body.amount || body.points) || 10)); const count = Math.max(1, Math.min(100, Number(body.count) || 1)); const codes = []; for (let i = 0; i < count; i += 1) { const raw = `ZH-${crypto.randomBytes(5).toString('hex').toUpperCase()}`; codes.push(raw); store.redemptionCodes.push({ id: uid(), code: raw, points, createdAt: now() }); } await persist(); return send(res, 201, { success: true, codes, amount: points }); }
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
  if (req.method === 'GET' && pathName === '/api/v1/studio/models') return send(res, 200, { models: studioModels() });
  if (req.method === 'GET' && pathName === '/api/v1/studio/profile') return send(res, 200, { user: safeUser(user) });
  if (req.method === 'GET' && pathName === '/api/v1/studio/config') return send(res, 200, { apiOrigin: PUBLIC_API_ORIGIN || `http://${req.headers.host || 'localhost'}`, compatibility: 'zhihui-v1', models: studioModels(), aiEnabled: Boolean(AI_BASE_URL && AI_API_KEY) });
  const studioTask = pathName.match(/^\/api\/v1\/studio\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && studioTask) { const task = store.tasks.find((t)=>t.id===studioTask[1] && t.userId===user.id); return task ? send(res,200,{task: publicTask(task)}) : send(res,404,{error:'任务不存在。'}); }
  if (req.method === 'POST' && pathName === '/api/v1/points/redeem') { const code = String(body.code || '').trim().toUpperCase(); const available = store.redemptionCodes.find((r)=>r.code===code && !r.usedAt); if (!available) return send(res,400,{error:'兑换码无效或已使用。'}); available.usedAt=now(); available.userId=user.id; store.redemptions.push({ id:uid(), code, userId:user.id, points:available.points, createdAt:now() }); store.ledger.push({id:uid(),userId:user.id,type:'redeem',points:available.points,createdAt:now()}); user.points += available.points; await persist(); return send(res,200,{points:user.points, message:`已兑换 ${available.points} 积分。`}); }
  const isAdmin = user.role === 'admin' || req.headers['x-admin-key'] === ADMIN_KEY;
  if (req.method === 'GET' && pathName === '/api/v1/admin/overview') { if (!isAdmin) return send(res,403,{error:'无权限。'}); return send(res,200,{users:store.users.map(safeUser), tasks:store.tasks, redemptions:store.redemptions, metrics:{users:store.users.length,tasks:store.tasks.length,points:store.users.reduce((n,u)=>n+u.points,0)}}); }
  if (req.method === 'POST' && pathName === '/api/v1/admin/redemption-codes') { if (!isAdmin) return send(res,403,{error:'无权限。'}); const points=Math.max(1,Math.min(100000,Number(body.points)||100)); const count=Math.max(1,Math.min(100,Number(body.count)||1)); const codes=Array.from({length:count},()=>({id:uid(),code:`ZH-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,points,createdAt:now()})); store.redemptionCodes.push(...codes); await persist(); return send(res,201,{codes}); }
  if (/^\/api\/v1\/studio\//.test(pathName)) return send(res, 404, { error:'不支持的插件接口。', compatibility:'zhihui-v1' });
  return send(res, 404, { error:'接口不存在。' });
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg' };
const server = http.createServer(async (req,res) => { res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN || '*'); res.setHeader('access-control-allow-headers','authorization, content-type, x-admin-key, x-ai-key, x-ai-base-url'); res.setHeader('access-control-allow-methods','GET, POST, PUT, PATCH, DELETE, OPTIONS'); res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); const { path: p } = route(req); if (p.startsWith('/api/')) return api(req,res,p); if (p === '/healthz' || p.startsWith('/v1/')) return gateway(req,res,p); let file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p); if (!file.startsWith(PUBLIC_DIR)) return send(res,403,{error:'forbidden'}); if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html'); if (!existsSync(file)) file = path.join(PUBLIC_DIR,'index.html'); try { res.writeHead(200, {'content-type': mime[path.extname(file)] || mime['.html']}); createReadStream(file).pipe(res); } catch { send(res,500,{error:'server error'}); } });
await load(); server.listen(PORT, HOST, () => console.log(`Zhihui web listening on http://${HOST}:${PORT}`));
