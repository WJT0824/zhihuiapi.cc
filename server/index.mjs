import http from 'node:http';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { existsSync, createReadStream, createWriteStream, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { normalizeUpstreamBase, normalizeApiKey, upstreamUrls, upstreamAuthHeaders, fetchUpstream } from './upstream.mjs';
import {
  normalizeComfyBaseUrl, comfySystemStats, comfyObjectInfo, uploadComfyImage, queueComfyPrompt,
  fetchComfyHistory, collectComfyOutputs, downloadComfyOutput, readImageSize, parseComfyWorkflow,
  applyComfyBindings, targetDimensions, BUILT_IN_PRESETS, pickUpscaleModel, buildVectorWorkflow,
  summarizeParsed, detectPresetKind, builtInPreset, findVectorNodeClass,
} from './comfy.mjs';

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
const defaultStore = () => ({ users: [], tasks: [], redemptionCodes: [], redemptions: [], rechargeNonces: [], ledger: [], sessions: {}, references: [], jobs: [], assets: [], workflows: [], comfyPresets: [], modelCache: [], aiConfig: { baseUrl: '', apiKey: '', model: '' }, comfy: { baseUrl: '', apiKey: '', enabled: true } });
let store = defaultStore();
async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(ASSET_DIR, { recursive: true });
  await mkdir(REF_DIR, { recursive: true });
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  if (existsSync(DATA_FILE)) { try { store = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { store = defaultStore(); } }
  store.tasks ||= []; store.redemptionCodes ||= []; store.redemptions ||= []; store.rechargeNonces ||= []; store.ledger ||= []; store.sessions ||= {}; store.references ||= []; store.jobs ||= []; store.assets ||= []; store.workflows ||= []; store.comfyPresets ||= []; store.modelCache ||= []; store.aiConfig ||= { baseUrl: '', apiKey: '', model: '' }; store.comfy ||= { baseUrl: '', apiKey: '', enabled: true };
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
const publicProfile = (profile = {}) => {
  const settings = { ...(profile.settings || {}) };
  if (settings.tokenFluxApiKey || settings.apiKey || settings.upstreamApiKey) {
    settings.tokenFluxApiKeyConfigured = true;
    delete settings.tokenFluxApiKey; delete settings.apiKey; delete settings.upstreamApiKey;
  }
  return { ...profile, settings };
};
const safeUser = (u) => u && ({ id: u.id, nickname: u.nickname, username: u.nickname || u.username || '', displayName: u.displayName || u.nickname || '', email: u.email || '', role: u.role || 'user', isAdmin: u.role === 'admin', points: u.points, credits: u.points, profile: publicProfile(u.profile), membershipType: u.membershipType || 'registered', membershipExpiresAt: u.membershipExpiresAt || '', isMembershipValid: true, beansBalance: u.beansBalance || 0, beansExpiresAt: u.beansExpiresAt || '', deviceId: u.deviceId || '', createdAt: u.createdAt });
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

async function submitRemoteTask(task, override) {
  const ai = override || activeAiConfig();
  if (!ai.baseUrl || !ai.apiKey) return;
  const model = String(task.model || '');
  const prompt = String(task.prompt || '');
  const body = { ...(task.request || {}), model, prompt };
  let endpoint = '/v1/images/generations';
  if (model === 'gpt-image-2' && Array.isArray(body.images) && body.images.length) endpoint = '/v1/images/edits';
  if (model === 'T香蕉2' || model === 'T香蕉pro') endpoint = `/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  if (/grok-video|veo3/.test(model)) endpoint = '/v1/videos';
  if (/sora-v3/.test(model)) endpoint = '/v1/video/submit/generate';
  const res = await fetchUpstream(ai.baseUrl, endpoint.replace(/^\//, ''), {
    method: 'POST',
    headers: upstreamAuthHeaders(ai.apiKey, { 'content-type': 'application/json' }),
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

async function pollRemoteTask(task, override) {
  const ai = override || activeAiConfig();
  if (!task.remoteTaskId || !ai.baseUrl || !ai.apiKey) return;
  const model = String(task.model || '');
  let endpoint = `/v1/images/tasks/${encodeURIComponent(task.remoteTaskId)}`;
  if (/sora-v3/.test(model)) endpoint = `/v1/video/fetch/${encodeURIComponent(task.remoteTaskId)}`;
  if (/grok-video|veo3/.test(model)) endpoint = `/v1/videos/${encodeURIComponent(task.remoteTaskId)}`;
  const res = await fetchUpstream(ai.baseUrl, endpoint.replace(/^\//, ''), {
    headers: upstreamAuthHeaders(ai.apiKey),
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
    apiKey: normalizeApiKey(stored.apiKey || AI_API_KEY),
    model: String(stored.model || AI_IMAGE_MODEL || 'gpt-image-2').trim() || 'gpt-image-2',
  };
};
const readConfiguredUpstream = (value = {}) => ({
  baseUrl: String(value.baseUrl || value.aiBaseUrl || value.upstreamBaseUrl || value.apiBaseUrl || value.tokenFluxBaseUrl || '').trim(),
  apiKey: String(value.apiKey || value.aiApiKey || value.upstreamApiKey || value.tokenFluxApiKey || value.key || '').trim(),
});
const accountAiOverride = (user) => {
  const settings = user?.profile?.settings || {};
  if (settings.upstreamMode === 'platform') return undefined;
  const config = readConfiguredUpstream(settings);
  return config.baseUrl && config.apiKey ? { ...config, baseUrl: normalizeUpstreamBase(config.baseUrl), apiKey: normalizeApiKey(config.apiKey), model: settings.defaultModel || activeAiConfig().model } : undefined;
};
const resolveAiConfig = (user, body = {}) => {
  if (body.upstreamMode === 'platform') return activeAiConfig();
  const supplied = readConfiguredUpstream(body);
  if (supplied.baseUrl || supplied.apiKey) {
    if (!supplied.baseUrl || !supplied.apiKey) throw new Error('切换中转站时请同时填写地址和对应的 API Key。');
    return { baseUrl: normalizeUpstreamBase(supplied.baseUrl), apiKey: normalizeApiKey(supplied.apiKey), model: body.model || body.defaultModel || activeAiConfig().model };
  }
  return accountAiOverride(user) || activeAiConfig();
};
const activeComfyConfig = () => {
  const stored = store.comfy || {};
  const raw = String(stored.baseUrl || process.env.COMFY_BASE_URL || '').trim();
  let baseUrl = '';
  if (raw) { try { baseUrl = normalizeComfyBaseUrl(raw); } catch { baseUrl = ''; } }
  return {
    baseUrl,
    apiKey: String(stored.apiKey || process.env.COMFY_API_KEY || '').trim(),
    enabled: stored.enabled !== false,
  };
};

const listWorkflowPresets = () => {
  const merged = new Map(BUILT_IN_PRESETS.map((preset) => [preset.code, { ...preset, source: 'builtin' }]));
  for (const preset of store.comfyPresets || []) merged.set(preset.code, { ...preset, source: 'uploaded' });
  return [...merged.values()];
};

const findWorkflowPreset = (code) => listWorkflowPresets().find((preset) => preset.code === String(code || ''));

const publicWorkflowPreset = (preset) => ({
  code: preset.code,
  name: preset.name,
  kind: preset.kind,
  description: preset.description || '',
  points: Number(preset.points ?? 3),
  source: preset.source || (preset.builtIn ? 'builtin' : 'uploaded'),
  builtIn: Boolean(preset.builtIn),
  requiresCustomWorkflow: Boolean(preset.requiresCustomWorkflow),
  targetLongEdge: Number(preset.targetLongEdge || 0),
  scale: Number(preset.scale || 0),
  params: preset.params || {},
  summary: preset.summary || null,
  createdAt: preset.createdAt,
  updatedAt: preset.updatedAt,
});

const comfyJobError = (status) => {
  const messages = Array.isArray(status?.messages) ? status.messages : [];
  const executionError = messages.find((item) => Array.isArray(item) && item[0] === 'execution_error');
  if (executionError) {
    const detail = executionError[1] || {};
    const node = detail.node_type || detail.node_id || '节点';
    return `${node} 执行失败：${String(detail.exception_message || detail.exception_type || '未知错误').slice(0, 300)}`;
  }
  return 'ComfyUI 任务执行失败。';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function registerWorkflowPreset(body = {}) {
  const raw = body.workflow ?? body.graph ?? body.json ?? body.definition;
  if (!raw) throw new Error('请上传或粘贴 ComfyUI 工作流 JSON。');
  const parsed = parseComfyWorkflow(raw);
  const requested = String(body.code || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  const code = requested || `wf-${crypto.randomBytes(4).toString('hex')}`;
  const kind = detectPresetKind(parsed, body.kind);
  const builtIn = builtInPreset(code);
  const preset = {
    id: uid(),
    code,
    name: String(body.name || '').trim() || builtIn?.name || code,
    description: String(body.description || '').trim() || builtIn?.description || '',
    kind,
    points: Math.max(0, Math.min(1000, Number(body.points ?? builtIn?.points ?? 3) || 0)),
    targetLongEdge: Math.max(0, Number(body.targetLongEdge ?? builtIn?.targetLongEdge ?? (kind === 'upscale' ? 4096 : 0)) || 0),
    scale: Math.max(0, Number(body.scale ?? builtIn?.scale ?? (kind === 'upscale' ? 2 : 0)) || 0),
    workflow: parsed.workflow,
    bindings: parsed.bindings,
    summary: summarizeParsed(parsed),
    params: body.params && typeof body.params === 'object' ? body.params : {},
    builtIn: false,
    createdAt: now(),
    updatedAt: now(),
  };
  const index = (store.comfyPresets || []).findIndex((item) => item.code === code);
  if (index >= 0) {
    preset.id = store.comfyPresets[index].id;
    preset.createdAt = store.comfyPresets[index].createdAt || preset.createdAt;
    store.comfyPresets[index] = preset;
  } else {
    store.comfyPresets.push(preset);
  }
  await persist();
  return preset;
}

async function executeComfyWorkflow(job, preset, user, referenceIds, options = {}) {
  const comfy = activeComfyConfig();
  if (!comfy.enabled || !comfy.baseUrl) throw new Error('尚未配置 ComfyUI 服务地址，请在运营后台填写并测试连接。');
  const ref = store.references.find((item) => referenceIds.includes(item.id) && item.userId === user.id);
  if (!ref) throw new Error('请先把图片节点连接到该工作流节点。');

  job.progress = 8;
  const buffer = await readFile(ref.path);
  const source = readImageSize(buffer) || { width: 1024, height: 1024 };
  const uploaded = await uploadComfyImage(comfy.baseUrl, buffer, ref.fileName || `${job.id}.png`, comfy.apiKey);
  job.progress = 18;
  await persist();

  let graph = preset.workflow || null;
  let bindings = preset.bindings || null;
  if (!graph) {
    if (preset.kind !== 'vectorize') throw new Error('该预设还没有配置 ComfyUI 工作流，请在运营后台上传。');
    const objectInfo = await comfyObjectInfo(comfy.baseUrl, comfy.apiKey);
    const built = buildVectorWorkflow(objectInfo, uploaded.name);
    graph = built.graph;
    bindings = { image: { nodeId: '1', input: 'image' }, prompt: null, scale: null, size: null, seed: null, upscaleModel: null, output: null };
    job.autoConfigured = built.classType;
  }
  if (!bindings) bindings = parseComfyWorkflow(graph).bindings;

  let upscaleModel = '';
  if (bindings.upscaleModel) {
    const objectInfo = await comfyObjectInfo(comfy.baseUrl, comfy.apiKey);
    upscaleModel = pickUpscaleModel(objectInfo, options.upscaleModel);
    if (!upscaleModel) throw new Error('ComfyUI 没有可用的放大模型，请把放大模型放进 models/upscale_models，或上传自定义工作流。');
  }

  const dims = preset.targetLongEdge ? targetDimensions(source, preset.targetLongEdge) : { width: source.width, height: source.height };
  const patched = applyComfyBindings(graph, bindings, {
    imageName: uploaded.name,
    imageSubfolder: uploaded.subfolder,
    prompt: String(options.prompt || ''),
    scale: Number(options.scale || preset.scale || 1) || 1,
    width: Number(options.width || dims.width),
    height: Number(options.height || dims.height),
    seed: options.seed === undefined ? Math.floor(Math.random() * 1e14) : options.seed,
    upscaleModel,
  });

  const { promptId } = await queueComfyPrompt(comfy.baseUrl, patched, comfy.apiKey);
  job.remoteTaskId = promptId;
  job.progress = 30;
  await persist();

  const startedAt = Date.now();
  const timeoutMs = Math.max(60000, Number(process.env.COMFY_TIMEOUT_MS) || 900000);
  let outputs = [];
  for (;;) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('ComfyUI 任务超时，请检查队列和显存占用。');
    await sleep(2500);
    const history = await fetchComfyHistory(comfy.baseUrl, promptId, comfy.apiKey);
    const entry = history[promptId];
    if (!entry) {
      job.progress = Math.min(85, 30 + Math.floor((Date.now() - startedAt) / 15000) * 5);
      continue;
    }
    const status = entry.status || {};
    if (status.status_str === 'error') throw new Error(comfyJobError(status));
    outputs = collectComfyOutputs(entry);
    if (outputs.length) break;
    if (status.completed === true || status.status_str === 'success') throw new Error('ComfyUI 任务完成但没有返回可用输出，请确认工作流包含保存图片或导出矢量节点。');
    job.progress = Math.min(88, 30 + Math.floor((Date.now() - startedAt) / 15000) * 5);
  }

  const preferred = preset.kind === 'vectorize'
    ? outputs.find((item) => item.kind === 'svg') || outputs[0]
    : outputs.find((item) => item.kind === 'image') || outputs[0];
  const file = await downloadComfyOutput(comfy.baseUrl, preferred, comfy.apiKey);
  const assetFile = path.join(ASSET_DIR, `${job.id}${file.ext}`);
  await writeFile(assetFile, file.buffer);
  job.assetFile = assetFile;
  job.mimeType = file.mime;
  job.outputKind = preferred.kind === 'svg' ? 'svg' : 'image';
  job.status = 'succeeded';
  job.progress = 100;
  job.completedAt = now();
}

const publicPluginConfig = () => {
  const ai = activeAiConfig();
  const comfy = activeComfyConfig();
  return {
    serviceUrl: 'https://zhihuiapi.cc/',
    apiOrigin: PUBLIC_API_ORIGIN || 'https://zhihuiapicc-production.up.railway.app/',
    mode: 0,
    chatModel: 'gpt-4.1-mini',
    generationModel: ai.model || 'gpt-image-2',
    editModel: ai.model || 'gpt-image-2',
    pointsPerGeneration: 3,
    workflowsUrl: `${(PUBLIC_API_ORIGIN || 'https://zhihuiapicc-production.up.railway.app').replace(/\/+$/, '')}/v1/studio/workflows/public`,
    comfyEnabled: Boolean(comfy.enabled && comfy.baseUrl),
    workflows: listWorkflowPresets().map(publicWorkflowPreset),
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
  if (typeof item === 'string') item = { id: item };
  const id = String(item.id || item.modelId || item.name || '').trim();
  const rawName = String(item.name || item.displayName || id || '').trim();
  const lower = `${id} ${rawName}`.toLowerCase();
  const endpoints = Array.isArray(item.supported_endpoint_types) ? item.supported_endpoint_types.map((name) => String(name || '').toLowerCase()).filter(Boolean) : [];
  const hasImageEndpoint = endpoints.some((name) => name.includes('image') || name === 'images' || name.includes('img'));
  const hasReasoningEndpoint = endpoints.some((name) => name.includes('chat') || name.includes('reason') || name.includes('completion') || name.includes('text'));
  const looksLikeImage = /(^|[^a-z])(gpt-image|dall|flux|image|img)([^a-z]|$)/i.test(lower);
  const looksLikeReasoning = /(^|[^a-z])(gpt|o[0-9]|o1|claude|deepseek|codex|command|gemini|mini|compact|luna|sol|terra)([^a-z]|$)/i.test(lower) && !/video|image|img/i.test(lower);
  let tags = Array.isArray(item.tags) ? item.tags.map(String) : [];
  if (!/video|image|img/i.test(lower) && (hasReasoningEndpoint || looksLikeReasoning)) tags.push('reasoning');
  if (hasImageEndpoint || looksLikeImage || tags.includes('text-to-image') || tags.includes('image-editing')) tags = ['text-to-image', 'image-editing'];
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
  const source = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return source.map((item) => normalizeLiveModelItem(item, configModel)).filter((model) => model.id);
};
const modelCaches = new Map();
const modelSourceKey = (config) => hash(JSON.stringify([normalizeUpstreamBase(config.baseUrl), normalizeApiKey(config.apiKey)]));
const readUpstreamModels = async (baseUrl, apiKey) => {
  const results = await Promise.allSettled(['models', 'images/models'].map(async (resource) => {
    const response = await fetchUpstream(baseUrl, resource, { headers: upstreamAuthHeaders(apiKey), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`模型接口返回 HTTP ${response.status}`);
    const payload = await response.json();
    return modelsFromPayload(payload).map((model) => resource === 'images/models'
      ? { ...model, tags: ['text-to-image', 'image-editing'] } : model);
  }));
  const models = mergeGatewayModelLists(...results.filter((r) => r.status === 'fulfilled').map((r) => r.value));
  if (models.length) return models;
  const failed = results.find((r) => r.status === 'rejected');
  throw failed?.reason || new Error('连接成功，但上游没有返回模型列表。');
};
const liveGatewayModels = async (override, force = false) => {
  const config = override || activeAiConfig();
  if (!config.baseUrl || !config.apiKey) return gatewayModels();
  const key = modelSourceKey(config);
  const cached = modelCaches.get(key);
  if (!force && cached && Date.now() - cached.at < 30000) return cached.models;
  const models = await readUpstreamModels(config.baseUrl, config.apiKey);
  modelCaches.set(key, { at: Date.now(), models });
  if (modelCaches.size > 100) modelCaches.delete(modelCaches.keys().next().value);
  return models;
};
const mergeGatewayModelLists = (...lists) => {
  const merged = new Map();
  for (const list of lists) {
    for (const model of list || []) {
      const key = String(model.modelId || model.id || '');
      if (!key) continue;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, model);
        continue;
      }
      let tags = [...new Set([...(existing.tags || []), ...(model.tags || [])])];
      if (tags.includes('text-to-image') || tags.includes('image-editing')) tags = tags.filter((tag) => tag !== 'reasoning');
      merged.set(key, { ...existing, name: existing.name || model.name, displayName: existing.displayName || model.displayName, tags });
    }
  }
  return [...merged.values()];
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
const gatewayJob = (job) => ({ success: job.status === 'succeeded', jobId: job.id, assetId: job.status === 'succeeded' ? job.id : null, status: job.status, error: job.error || undefined, prompt: job.prompt || '', modelId: job.model || AI_IMAGE_MODEL, progress: Number(job.progress || (job.status === 'succeeded' ? 100 : 0)), workflowCode: job.workflowCode || undefined, outputKind: job.outputKind || undefined, mimeType: job.mimeType || undefined, createdAt: job.createdAt || '' });
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
      response = await fetchUpstream(upstreamBase, 'images/edits', { method: 'POST', headers, body: form });
    } else {
      response = await fetchUpstream(upstreamBase, 'images/generations', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(nextPayload) });
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
      const response = await fetchUpstream(baseUrl, 'chat/completions', {
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
    const testUser = tokenUser(req);
    if (!testUser) return fail(401, '请先登录平台账号');
    try {
      if (body.scope === 'platform' && testUser.role !== 'admin') return fail(403, '需要管理员权限');
      const saved = body.scope === 'platform' ? activeAiConfig() : resolveAiConfig(testUser);
      const supplied = readConfiguredUpstream(body);
      // Blank key may reuse a saved key only for exactly the same API base.
      let config = saved;
      if (supplied.baseUrl || supplied.apiKey) {
        const baseUrl = normalizeUpstreamBase(supplied.baseUrl || saved.baseUrl);
        const apiKey = normalizeApiKey(supplied.apiKey || (baseUrl === normalizeUpstreamBase(saved.baseUrl) ? saved.apiKey : ''));
        if (!apiKey) throw new Error('更换中转地址时，请填写新站对应的 API Key。');
        config = { ...saved, baseUrl, apiKey };
      }
      if (body.upstreamMode === 'platform') config = activeAiConfig();
      if (!config.apiKey || !config.baseUrl) throw new Error('尚未配置 AI 服务，请填写中转地址和 API Key。');
      const allModels = await readUpstreamModels(config.baseUrl, config.apiKey);
      const mode = String(body.mode || 'models');
      const matching = mode === 'image' ? allModels.filter((m) => m.tags.includes('text-to-image') || m.tags.includes('image-editing'))
        : mode === 'reasoning' ? allModels.filter((m) => m.tags.includes('reasoning')) : allModels;
      if (!matching.length) throw new Error(`已读取 ${allModels.length} 个模型，但未识别到${mode === 'image' ? '图像' : '推理'}模型；请核对上游模型列表和标签。`);
      return send(res, 200, { success: true, baseUrl: config.baseUrl, endpoints: { models: upstreamUrls(config.baseUrl, 'models')[0], images: upstreamUrls(config.baseUrl, 'images/generations')[0], text: upstreamUrls(config.baseUrl, 'chat/completions')[0] }, models: allModels, matchedModels: matching, message: `连接成功：共 ${allModels.length} 个模型${mode === 'models' ? '' : '，其中' + (mode === 'image' ? '图像' : '推理') + '模型 ' + matching.length + ' 个'}。已验证模型列表，实际生成以运行结果为准。` });
    } catch (error) {
      return fail(400, `连接失败：${String(error.message || error).slice(0, 180)}`);
    }
  }
  if (req.method === 'GET' && pathName === '/v1/studio/workflows/public') {
    const comfy = activeComfyConfig();
    return send(res, 200, {
      success: true,
      comfy: { configured: Boolean(comfy.baseUrl), enabled: comfy.enabled },
      workflows: listWorkflowPresets().map(publicWorkflowPreset),
      updatedAt: now(),
    });
  }
  const user = tokenUser(req);
  if (!user) return fail(401, '请先登录平台账号');
  if (req.method === 'POST' && pathName === '/v1/ai/text') {
    try {
      const ai = resolveAiConfig(user, body);
      const result = await processUpstreamText({ ...body, apiKey: ai.apiKey, baseUrl: ai.baseUrl });
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
    const incoming = { ...(body.profile?.settings || {}), ...(body.settings || {}) };
    if (incoming.tokenFluxBaseUrl !== undefined) {
      try { incoming.tokenFluxBaseUrl = normalizeUpstreamBase(incoming.tokenFluxBaseUrl); }
      catch (error) { return fail(400, error.message); }
    }
    if (incoming.tokenFluxApiKey !== undefined) incoming.tokenFluxApiKey = normalizeApiKey(incoming.tokenFluxApiKey);
    const previousSettings = user.profile?.settings || {};
    const nextSettings = { ...previousSettings, ...incoming };
    if (nextSettings.tokenFluxApiKey && !nextSettings.tokenFluxBaseUrl) return fail(400, '请填写 API Key 对应的中转地址。');
    if (incoming.tokenFluxBaseUrl && incoming.tokenFluxBaseUrl !== previousSettings.tokenFluxBaseUrl && incoming.tokenFluxApiKey === undefined && previousSettings.tokenFluxApiKey) return fail(400, '更换中转地址时请同时填写对应的 API Key。');
    user.profile = { ...(user.profile || {}), ...(body.profile || {}), settings: nextSettings };
    await persist();
    return send(res, 200, { success: true, user: safeUser(user) });
  }
  if (req.method === 'GET' && (pathName === '/v1/models' || pathName === '/v1/image/models')) {
    try {
      const config = resolveAiConfig(user);
      const models = await liveGatewayModels(config, route(req).query.get('refresh') === '1');
      return send(res, 200, { success: true, models, source: accountAiOverride(user) ? 'account' : 'platform' });
    } catch (error) { return fail(502, error.message); }
  }
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
    let aiOverride;
    try { aiOverride = resolveAiConfig(user, { ...body, baseUrl: body.baseUrl || body.ai_base_url || req.headers['x-ai-base-url'], apiKey: body.apiKey || body.ai_api_key || req.headers['x-ai-key'] }); }
    catch (error) { return fail(400, error.message); }
    const job = { id: uid(), requestId, userId: user.id, prompt: String(body.prompt || ''), model: String(body.model || body.modelId || aiOverride.model), aspectRatio: String(body.aspect_ratio || '1:1'), resolution: String(body.resolution || '1K'), quality: String(body.quality || 'auto'), quantity: Math.max(1, Math.min(4, Number(body.quantity) || 1)), status: 'processing', cost, createdAt: now() };
    if (user.role !== 'admin') user.points -= cost;
    store.jobs.push(job); store.ledger.push({ id: uid(), userId: user.id, type: 'image', points: user.role === 'admin' ? 0 : -cost, requestId, createdAt: now() }); await persist();
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
  if (req.method === 'GET' && pathName === '/v1/studio/workflows') {
    const comfy = activeComfyConfig();
    return send(res, 200, {
      success: true,
      comfy: { configured: Boolean(comfy.baseUrl), enabled: comfy.enabled },
      workflows: listWorkflowPresets().map(publicWorkflowPreset),
    });
  }
  const workflowRunMatch = pathName.match(/^\/v1\/studio\/workflows\/([^/]+)\/run$/);
  if (req.method === 'POST' && workflowRunMatch) {
    const preset = findWorkflowPreset(decodeURIComponent(workflowRunMatch[1]));
    if (!preset) return fail(404, '工作流预设不存在。');
    const comfy = activeComfyConfig();
    if (!comfy.enabled || !comfy.baseUrl) {
      return send(res, 409, {
        success: false,
        code: 'comfy_not_configured',
        fallback: preset.kind === 'upscale',
        error: '尚未配置 ComfyUI 服务地址，可在运营后台填写并测试连接。',
      });
    }
    const referenceIds = [
      ...(Array.isArray(body.reference_ids) ? body.reference_ids : []),
      ...(body.reference_id ? [body.reference_id] : []),
    ].map(String).filter(Boolean);
    if (!referenceIds.length) return fail(400, '请先把图片节点连接到该工作流节点。');
    const requestId = String(body.request_id || '').trim() || `wf-${uid()}`;
    const existingJob = store.jobs.find((job) => job.requestId === requestId && job.userId === user.id);
    if (existingJob) return send(res, 200, { ...gatewayJob(existingJob), workflow: publicWorkflowPreset(preset) });
    const cost = Math.max(0, Number(preset.points ?? 3));
    if (user.role !== 'admin' && user.points < cost) return fail(402, '积分不足');
    const job = {
      id: uid(), requestId, userId: user.id,
      prompt: String(body.prompt || ''), model: preset.name, workflowCode: preset.code, engine: 'comfy',
      quality: 'high', quantity: 1, status: 'processing', progress: 0, cost, createdAt: now(),
    };
    if (user.role !== 'admin') user.points -= cost;
    store.jobs.push(job);
    store.ledger.push({ id: uid(), userId: user.id, type: 'workflow', points: user.role === 'admin' ? 0 : -cost, requestId, workflowCode: preset.code, createdAt: now() });
    await persist();
    executeComfyWorkflow(job, preset, user, referenceIds, {
      prompt: body.prompt,
      scale: body.scale,
      width: body.width,
      height: body.height,
      seed: body.seed,
      upscaleModel: body.upscale_model || body.upscaleModel,
    }).catch(async (error) => {
      if (user.role !== 'admin') user.points += cost;
      job.status = 'failed';
      job.error = String(error.message || error).slice(0, 500);
      store.ledger.push({ id: uid(), userId: user.id, type: 'workflow-refund', points: user.role === 'admin' ? 0 : cost, requestId, workflowCode: preset.code, createdAt: now() });
      await persist();
    });
    return send(res, 202, { success: true, jobId: job.id, assetId: null, status: 'processing', workflow: publicWorkflowPreset(preset) });
  }
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
  if (req.method === 'GET' && pathName === '/v1/admin/comfy-config') {
    const cfg = activeComfyConfig();
    return send(res, 200, { success: true, config: { baseUrl: cfg.baseUrl, enabled: cfg.enabled, apiKeyConfigured: Boolean(cfg.apiKey), apiKeyPreview: cfg.apiKey ? `${cfg.apiKey.slice(0, 3)}…${cfg.apiKey.slice(-3)}` : '' } });
  }
  if ((req.method === 'POST' || req.method === 'PUT') && pathName === '/v1/admin/comfy-config') {
    const current = activeComfyConfig();
    const rawBase = body.baseUrl !== undefined ? String(body.baseUrl) : current.baseUrl;
    let baseUrl = '';
    if (rawBase.trim()) { try { baseUrl = normalizeComfyBaseUrl(rawBase); } catch (error) { return fail(400, error.message); } }
    const apiKey = body.apiKey !== undefined ? String(body.apiKey).trim() : current.apiKey;
    const enabled = body.enabled === undefined ? current.enabled : Boolean(body.enabled);
    store.comfy = { baseUrl, apiKey, enabled };
    await persist();
    return send(res, 200, { success: true, config: { baseUrl, enabled, apiKeyConfigured: Boolean(apiKey), apiKeyPreview: apiKey ? `${apiKey.slice(0, 3)}…${apiKey.slice(-3)}` : '' } });
  }
  if (req.method === 'POST' && pathName === '/v1/admin/comfy/test') {
    const current = activeComfyConfig();
    let target = current.baseUrl;
    if (body.baseUrl !== undefined && String(body.baseUrl).trim()) {
      try { target = normalizeComfyBaseUrl(body.baseUrl); } catch (error) { return fail(400, error.message); }
    }
    if (!target) return fail(400, '请先填写 ComfyUI 服务地址。');
    const key = body.apiKey !== undefined ? String(body.apiKey).trim() : current.apiKey;
    try {
      const stats = await comfySystemStats(target, key);
      const objectInfo = await comfyObjectInfo(target, key, { force: true });
      const upscaleModels = objectInfo?.UpscaleModelLoader?.input?.required?.model_name?.[0];
      const vectorNode = findVectorNodeClass(objectInfo);
      return send(res, 200, {
        success: true,
        message: `连接成功：${Object.keys(objectInfo).length} 个节点可用`,
        system: { comfyui: stats?.system?.comfyui_version || '', device: stats?.devices?.[0]?.name || '' },
        nodeCount: Object.keys(objectInfo).length,
        upscaleModels: Array.isArray(upscaleModels) ? upscaleModels.slice(0, 20) : [],
        vectorNode: vectorNode || null,
      });
    } catch (error) {
      return fail(400, `连接失败：${String(error.message || error).slice(0, 240)}`);
    }
  }
  if (req.method === 'GET' && pathName === '/v1/admin/comfy/workflows') {
    return send(res, 200, { success: true, workflows: listWorkflowPresets().map((preset) => ({ ...publicWorkflowPreset(preset), summary: preset.summary || null })) });
  }
  if (req.method === 'POST' && (pathName === '/v1/admin/comfy/workflows' || pathName === '/v1/studio/workflows')) {
    try {
      const preset = await registerWorkflowPreset(body);
      return send(res, 201, { success: true, workflow: publicWorkflowPreset(preset), detected: preset.summary });
    } catch (error) {
      return fail(400, String(error.message || error));
    }
  }
  const comfyWorkflowDelete = pathName.match(/^\/v1\/admin\/comfy\/workflows\/([^/]+)$/);
  if (req.method === 'DELETE' && comfyWorkflowDelete) {
    const code = decodeURIComponent(comfyWorkflowDelete[1]);
    const before = (store.comfyPresets || []).length;
    store.comfyPresets = (store.comfyPresets || []).filter((preset) => preset.code !== code);
    await persist();
    if (before === store.comfyPresets.length) return fail(404, '该预设不是上传的工作流，无法删除。');
    return send(res, 200, { success: true, deleted: code });
  }
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
    const accountAi = accountAiOverride(user);
    await submitRemoteTask(task, accountAi);
    if (task.status === 'queued' && task.remoteTaskId) task.status = 'processing';
    if (!(accountAi || activeAiConfig()).baseUrl || !(accountAi || activeAiConfig()).apiKey) {
      task.status = 'completed';
      task.completedAt = now();
      task.progress = 100;
      task.result = { message: '任务已创建。配置 AI_BASE_URL 与 AI_API_KEY 后可启用真实模型生成。' };
    }
    await persist();
    if (task.status === 'processing') {
      const poll = setInterval(async () => {
        await pollRemoteTask(task, accountAi);
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
  if (req.method === 'GET' && pathName === '/api/v1/studio/config') { const ai = activeAiConfig(); return send(res, 200, { apiOrigin: PUBLIC_API_ORIGIN || `http://${req.headers.host || 'localhost'}`, compatibility: 'zhihui-v1', models: studioModels(), aiEnabled: Boolean(ai.baseUrl && ai.apiKey), upstreamBaseUrl: ai.baseUrl || undefined }); }
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
