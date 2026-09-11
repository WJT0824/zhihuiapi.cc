// ComfyUI bridge: connection handling, workflow auto-configuration and execution.
// A ComfyUI workflow here is the "Save (API Format)" JSON export: an object
// keyed by node id, each value holding `class_type` and `inputs`.

const DEFAULT_TIMEOUT_MS = 180000;
const OBJECT_INFO_TTL_MS = 300000;

export function normalizeComfyBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('请输入完整的 ComfyUI 地址，例如 http://127.0.0.1:8188');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('ComfyUI 地址必须使用 http/https，账号密码请单独配置。');
  }
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname
    .replace(/\/{2,}/g, '/')
    .replace(/\/+$/, '')
    .replace(/\/(?:prompt|history|view|queue|system_stats|object_info|interrupt|upload\/image)$/i, '');
  return url.toString().replace(/\/+$/, '');
}

function authHeaders(apiKey) {
  const key = String(apiKey || '').trim().replace(/^Bearer\s+/i, '');
  return key ? { authorization: `Bearer ${key}` } : {};
}

/**
 * Calls a ComfyUI HTTP endpoint, retrying on /api-prefixed mounts. ComfyUI
 * serves its API at the root while reverse proxies commonly expose it under
 * /api, so both shapes are supported.
 */
export async function comfyFetch(baseUrl, pathname, options = {}) {
  const base = normalizeComfyBaseUrl(baseUrl);
  if (!base) throw new Error('尚未配置 ComfyUI 服务地址。');
  const pathPart = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const { timeoutMs = DEFAULT_TIMEOUT_MS, apiKey, ...rest } = options;
  const urls = [...new Set([`${base}${pathPart}`, `${base}/api${pathPart}`])];
  let response;
  for (let index = 0; index < urls.length; index += 1) {
    response = await fetch(urls[index], {
      signal: AbortSignal.timeout(timeoutMs),
      ...rest,
      headers: { ...authHeaders(apiKey), ...(rest.headers || {}) },
    });
    if (response.status !== 404 && response.status !== 405) return response;
    await response.body?.cancel().catch(() => {});
  }
  return response;
}

async function readJson(response, fallbackMessage) {
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message || parsed.error || parsed.message || detail;
    } catch {
      /* keep the raw body */
    }
    throw new Error(`${fallbackMessage}（HTTP ${response.status}）${detail ? `：${String(detail).slice(0, 240)}` : ''}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${fallbackMessage}返回了非 JSON 内容。`);
  }
}

export async function comfySystemStats(baseUrl, apiKey) {
  const response = await comfyFetch(baseUrl, '/system_stats', { apiKey, timeoutMs: 20000 });
  return readJson(response, 'ComfyUI 连接失败');
}

let objectInfoCache = { key: '', at: 0, value: null };

export async function comfyObjectInfo(baseUrl, apiKey, options = {}) {
  const base = normalizeComfyBaseUrl(baseUrl);
  const cacheKey = `${base}::${String(apiKey || '').slice(0, 8)}`;
  if (!options.force && objectInfoCache.value && objectInfoCache.key === cacheKey && Date.now() - objectInfoCache.at < OBJECT_INFO_TTL_MS) {
    return objectInfoCache.value;
  }
  const response = await comfyFetch(base, '/object_info', { apiKey, timeoutMs: 60000 });
  const value = await readJson(response, '读取 ComfyUI 节点信息失败');
  objectInfoCache = { key: cacheKey, at: Date.now(), value };
  return value;
}

export async function uploadComfyImage(baseUrl, buffer, filename, apiKey) {
  const form = new FormData();
  form.append('image', new Blob([buffer]), filename || 'zhihui-input.png');
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const response = await comfyFetch(baseUrl, '/upload/image', { method: 'POST', body: form, apiKey, timeoutMs: 60000 });
  const json = await readJson(response, '上传图片到 ComfyUI 失败');
  const name = String(json.name || json.filename || '').trim();
  if (!name) throw new Error('ComfyUI 未返回上传后的文件名。');
  return { name, subfolder: String(json.subfolder || ''), type: String(json.type || 'input') };
}

export async function queueComfyPrompt(baseUrl, graph, apiKey, clientId) {
  const response = await comfyFetch(baseUrl, '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: graph,
      client_id: clientId || `zhihui-${Math.random().toString(36).slice(2, 12)}`,
    }),
    apiKey,
    timeoutMs: 60000,
  });
  const json = await readJson(response, '提交 ComfyUI 任务失败');
  const nodeErrors = json.node_errors && Object.keys(json.node_errors).length ? json.node_errors : null;
  if (nodeErrors) {
    const first = Object.values(nodeErrors)[0];
    const message = first?.errors?.[0]?.message || first?.error || '工作流节点校验失败';
    throw new Error(`工作流校验失败：${String(message).slice(0, 300)}`);
  }
  const promptId = String(json.prompt_id || '').trim();
  if (!promptId) throw new Error('ComfyUI 未返回任务编号。');
  return { promptId, number: json.number };
}

export async function fetchComfyHistory(baseUrl, promptId, apiKey) {
  const response = await comfyFetch(baseUrl, `/history/${encodeURIComponent(promptId)}`, { apiKey, timeoutMs: 30000 });
  return readJson(response, '读取 ComfyUI 任务结果失败');
}

const FILE_KEYS = ['filename', 'name', 'file'];

export function collectComfyOutputs(historyEntry) {
  const outputs = [];
  const walk = (value, nodeId) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, nodeId));
      return;
    }
    if (typeof value === 'string') {
      if (/^\s*<svg[\s>]/i.test(value)) outputs.push({ kind: 'svg', inline: value, nodeId });
      return;
    }
    if (typeof value !== 'object') return;
    if (FILE_KEYS.some((key) => typeof value[key] === 'string' && value[key])) {
      const filename = String(value.filename || value.name || value.file);
      outputs.push({
        kind: /\.svg$/i.test(filename) ? 'svg' : /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(filename) ? 'image' : 'file',
        filename,
        subfolder: String(value.subfolder || ''),
        type: String(value.type || 'output'),
        nodeId,
      });
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (/^(gifs|images|files|videos|audio|svg|result|results|outputs)$/i.test(key)) walk(nested, nodeId);
    }
  };
  for (const [nodeId, nodeOutput] of Object.entries(historyEntry?.outputs || {})) walk(nodeOutput, nodeId);
  return outputs;
}

function extensionOf(name) {
  const match = /(\.[a-z0-9]+)$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

function mimeForExt(ext) {
  switch (ext) {
    case '.svg': return 'image/svg+xml';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.tif':
    case '.tiff': return 'image/tiff';
    case '.bmp': return 'image/bmp';
    default: return 'image/png';
  }
}

export async function downloadComfyOutput(baseUrl, fileInfo, apiKey) {
  if (fileInfo.inline) {
    return { buffer: Buffer.from(fileInfo.inline, 'utf8'), mime: 'image/svg+xml', ext: '.svg' };
  }
  const query = new URLSearchParams({
    filename: fileInfo.filename,
    subfolder: fileInfo.subfolder || '',
    type: fileInfo.type || 'output',
  });
  const response = await comfyFetch(baseUrl, `/view?${query.toString()}`, { apiKey, timeoutMs: 120000 });
  if (!response.ok) throw new Error(`下载 ComfyUI 输出文件失败（HTTP ${response.status}）`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionOf(fileInfo.filename) || '.png';
  return { buffer, mime: mimeForExt(ext), ext };
}

export function readImageSize(buffer) {
  if (!buffer || buffer.length < 16) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
    return null;
  }
  if (buffer.slice(0, 3).toString() === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.slice(0, 4).toString() === 'RIFF' && buffer.slice(8, 12).toString() === 'WEBP' && buffer.slice(12, 16).toString() === 'VP8X') {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  return null;
}

export const PLACEHOLDER_PATTERN = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

const IMAGE_CLASS = /loadimage|loadimageoutput|loadimagefromurl|loadimagefrompath|imageloader/i;
const OUTPUT_CLASS = /saveimage|previewimage|saveanimated|savewebp|savepng|savejpe?g|savetext|savefile|savesvg|savevector|exportsvg/i;
const VECTOR_CLASS = /vector|potrace|trace|svg/i;
const UPSCALE_MODEL_CLASS = /upscalemodelloader|upscale_model/i;
const IMAGE_UPSCALE_CLASS = /imageupscalewithmodel|upscalemodel/i;

const SCALE_INPUT = /^(scale|scale_by|upscale_by|magnification|magnify|factor|multiplier|resize_scale)$/i;
const WIDTH_INPUT = /^(width|target_width|out_width|resize_width)$/i;
const HEIGHT_INPUT = /^(height|target_height|out_height|resize_height)$/i;
const SEED_INPUT = /^(seed|noise_seed|rand_seed)$/i;
const TEXT_INPUT = /^(text|string|prompt|positive|value)$/i;
const IMAGE_INPUT = /^(image|images|input_image|image_path|img|source_image|photo)$/i;

function isGraphLike(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).some((node) => node && typeof node === 'object' && typeof node.class_type === 'string');
}

function isUiFormat(value) {
  return Boolean(value) && typeof value === 'object' && Array.isArray(value.nodes) && Array.isArray(value.links);
}

/** Normalises an uploaded workflow and detects where runtime values belong. */
export function parseComfyWorkflow(input) {
  let workflow = input;
  if (typeof input === 'string') {
    const text = input.trim();
    if (!text) throw new Error('工作流内容为空。');
    try {
      workflow = JSON.parse(text);
    } catch {
      throw new Error('工作流不是有效的 JSON，请从 ComfyUI 使用「保存（API 格式）」导出。');
    }
  }
  if (isUiFormat(workflow)) {
    throw new Error('检测到的是界面格式工作流。请在 ComfyUI 中使用「保存（API 格式）/ Save (API Format)」重新导出。');
  }
  if (!isGraphLike(workflow)) {
    throw new Error('无法识别工作流结构，请上传 ComfyUI 的 API 格式 JSON。');
  }

  const bindings = { image: null, prompt: null, scale: null, size: null, seed: null, upscaleModel: null, output: null };
  const classes = {};
  const placeholders = new Set();
  const imageCandidates = [];
  const promptCandidates = [];
  const scaleCandidates = [];
  const sizeCandidates = [];
  const seedCandidates = [];
  const outputCandidates = [];
  const upscaleModelCandidates = [];
  let hasVectorNode = false;

  for (const [nodeId, node] of Object.entries(workflow)) {
    const classType = String(node.class_type || '');
    classes[classType] = (classes[classType] || 0) + 1;
    if (VECTOR_CLASS.test(classType) && !OUTPUT_CLASS.test(classType) && !UPSCALE_MODEL_CLASS.test(classType)) hasVectorNode = true;
    if (OUTPUT_CLASS.test(classType)) outputCandidates.push({ nodeId, classType });
    if (UPSCALE_MODEL_CLASS.test(classType)) upscaleModelCandidates.push({ nodeId, classType, input: 'model_name' });

    const inputs = node.inputs && typeof node.inputs === 'object' ? node.inputs : {};
    for (const [inputName, rawValue] of Object.entries(inputs)) {
      if (typeof rawValue === 'string') {
        for (const match of rawValue.matchAll(PLACEHOLDER_PATTERN)) placeholders.add(String(match[1]).toLowerCase());
      }
      if (IMAGE_CLASS.test(classType) && IMAGE_INPUT.test(inputName)) imageCandidates.push({ nodeId, input: inputName });
      if (typeof rawValue === 'number' && SCALE_INPUT.test(inputName)) scaleCandidates.push({ nodeId, input: inputName });
      if (typeof rawValue === 'number' && WIDTH_INPUT.test(inputName)) sizeCandidates.push({ nodeId, input: inputName });
      if (typeof rawValue === 'number' && HEIGHT_INPUT.test(inputName)) sizeCandidates.push({ nodeId, input: inputName });
      if (typeof rawValue === 'number' && SEED_INPUT.test(inputName)) seedCandidates.push({ nodeId, input: inputName });
      if (typeof rawValue === 'string' && TEXT_INPUT.test(inputName) && /text|clip|prompt/i.test(classType)) {
        promptCandidates.push({ nodeId, input: inputName });
      }
    }
  }

  bindings.image = imageCandidates[0] || null;
  bindings.prompt = promptCandidates[0] || null;
  bindings.scale = scaleCandidates[0] || null;
  const widthBinding = sizeCandidates.find((item) => WIDTH_INPUT.test(item.input)) || null;
  const heightBinding = sizeCandidates.find((item) => HEIGHT_INPUT.test(item.input)) || null;
  if (widthBinding && heightBinding && widthBinding.nodeId === heightBinding.nodeId) {
    bindings.size = { nodeId: widthBinding.nodeId, widthInput: widthBinding.input, heightInput: heightBinding.input };
  }
  bindings.seed = seedCandidates[0] || null;
  bindings.upscaleModel = upscaleModelCandidates[0] || null;
  bindings.output = outputCandidates[0] || null;

  const warnings = [];
  if (!bindings.image && !placeholders.has('image')) warnings.push('未找到图片输入节点，运行时可能不会替换参考图。');
  if (!bindings.output && !hasVectorNode) warnings.push('未找到输出节点，请确认工作流包含保存图片或导出矢量节点。');

  const kind = hasVectorNode || placeholders.has('svg') || (bindings.output && VECTOR_CLASS.test(String(bindings.output.classType || '')))
    ? 'vectorize'
    : (bindings.scale || bindings.size || classes.ImageUpscaleWithModel || classes.UpscaleModelLoader || placeholders.has('scale') || placeholders.has('width'))
      ? 'upscale'
      : 'custom';

  return {
    workflow,
    bindings,
    placeholders: [...placeholders],
    nodeCount: Object.keys(workflow).length,
    classes,
    kind,
    warnings,
  };
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Writes runtime values into a parsed workflow. Placeholders such as
 * `{{image}}` are substituted first, then detected node inputs are filled in so
 * uploaded workflows without placeholders still receive the reference image.
 */
export function applyComfyBindings(workflow, bindings, values = {}) {
  const graph = deepClone(workflow);
  const tokens = {
    image: values.imageName || '',
    image_name: values.imageName || '',
    image_subfolder: values.imageSubfolder || '',
    prompt: values.prompt ?? '',
    negative: values.negative ?? '',
    scale: values.scale ?? '',
    width: values.width ?? '',
    height: values.height ?? '',
    seed: values.seed ?? '',
    model: values.model ?? '',
    upscale_model: values.upscaleModel ?? '',
  };
  const numericTokens = new Set(['scale', 'width', 'height', 'seed']);
  const substitute = (value) => {
    const whole = /^\{\{\s*([a-z0-9_]+)\s*\}\}$/i.exec(value);
    if (whole) {
      const key = String(whole[1]).toLowerCase();
      if (!(key in tokens)) return value;
      if (numericTokens.has(key)) {
        const numeric = Number(tokens[key]);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return tokens[key];
    }
    return value.replace(PLACEHOLDER_PATTERN, (match, rawKey) => {
      const key = String(rawKey).toLowerCase();
      return key in tokens ? String(tokens[key]) : match;
    });
  };
  for (const node of Object.values(graph)) {
    if (!node || typeof node !== 'object' || !node.inputs) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value === 'string') node.inputs[key] = substitute(value);
      else if (Array.isArray(value)) node.inputs[key] = value.map((item) => (typeof item === 'string' ? substitute(item) : item));
    }
  }

  const setInput = (nodeId, input, value) => {
    const node = graph[nodeId];
    if (node && node.inputs) node.inputs[input] = value;
  };

  if (bindings?.image && values.imageName) {
    setInput(bindings.image.nodeId, bindings.image.input, values.imageName);
    const node = graph[bindings.image.nodeId];
    if (node && node.inputs) {
      if (node.inputs.upload !== undefined) node.inputs.upload = 'image';
      if (node.inputs.subfolder !== undefined) node.inputs.subfolder = values.imageSubfolder || '';
    }
  }
  if (bindings?.prompt && typeof values.prompt === 'string' && values.prompt) {
    setInput(bindings.prompt.nodeId, bindings.prompt.input, values.prompt);
  }
  if (bindings?.seed && values.seed !== undefined && values.seed !== null && values.seed !== '') {
    setInput(bindings.seed.nodeId, bindings.seed.input, Number(values.seed) || 0);
  }
  if (bindings?.upscaleModel && values.upscaleModel) {
    setInput(bindings.upscaleModel.nodeId, bindings.upscaleModel.input, values.upscaleModel);
  }
  if (bindings?.scale && values.scale) {
    setInput(bindings.scale.nodeId, bindings.scale.input, Number(values.scale) || 1);
  }
  if (bindings?.size && values.width && values.height) {
    const node = graph[bindings.size.nodeId];
    if (node && node.inputs) {
      node.inputs[bindings.size.widthInput] = Math.max(64, Math.round(Number(values.width)));
      node.inputs[bindings.size.heightInput] = Math.max(64, Math.round(Number(values.height)));
      if (/imagescale/i.test(String(node.class_type || ''))) {
        if (node.inputs.upscale_method === undefined) node.inputs.upscale_method = 'lanczos';
        if (node.inputs.crop === undefined) node.inputs.crop = 'disabled';
      }
    }
  }
  return graph;
}

export function targetDimensions(source, targetLongEdge) {
  const width = Number(source?.width) || 1024;
  const height = Number(source?.height) || 1024;
  const edge = Number(targetLongEdge) || 0;
  if (!edge) return { width, height };
  const factor = edge / Math.max(width, height);
  const round8 = (value) => Math.max(64, Math.round((value * factor) / 8) * 8);
  return { width: round8(width), height: round8(height) };
}

const upscaleWorkflow = (prefix) => ({
  '1': { class_type: 'LoadImage', inputs: { image: '{{image}}', upload: 'image' } },
  '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: '{{upscale_model}}' } },
  '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['2', 0], image: ['1', 0] } },
  '4': { class_type: 'ImageScale', inputs: { image: ['3', 0], upscale_method: 'lanczos', width: '{{width}}', height: '{{height}}', crop: 'disabled' } },
  '5': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: prefix } },
});

export const BUILT_IN_PRESETS = [
  {
    code: 'hd-restore-4k',
    name: '高清修复 4K',
    kind: 'upscale',
    description: 'AI 超分后重采样到长边 4096，适合印刷与电商主图。',
    points: 3,
    targetLongEdge: 4096,
    scale: 2,
    builtIn: true,
    workflow: upscaleWorkflow('zhihui_4k'),
  },
  {
    code: 'hd-upscale-8k',
    name: '超清放大 8K',
    kind: 'upscale',
    description: 'AI 超分后输出长边 8192 的超大图，用于大幅面输出。',
    points: 4,
    targetLongEdge: 8192,
    scale: 4,
    builtIn: true,
    workflow: upscaleWorkflow('zhihui_8k'),
  },
  {
    code: 'vectorize',
    name: '图转矢量',
    kind: 'vectorize',
    description: '调用 ComfyUI 矢量描摹节点输出 SVG。上传自己的图转矢量工作流会自动替换此预设。',
    points: 3,
    builtIn: true,
    requiresCustomWorkflow: true,
    workflow: null,
  },
];

export function builtInPreset(code) {
  return BUILT_IN_PRESETS.find((preset) => preset.code === code) || null;
}

const UPSCALE_MODEL_HINTS = [/ultrasharp/i, /realesrgan/i, /esrgan/i, /swinir/i, /hat/i, /4x/i, /8x/i];

export function pickUpscaleModel(objectInfo, preferred) {
  const options = objectInfo?.UpscaleModelLoader?.input?.required?.model_name?.[0];
  const list = Array.isArray(options) ? options.map(String) : [];
  if (!list.length) return '';
  if (preferred && list.includes(preferred)) return preferred;
  for (const hint of UPSCALE_MODEL_HINTS) {
    const match = list.find((name) => hint.test(name));
    if (match) return match;
  }
  return list[0];
}

export function findVectorNodeClass(objectInfo) {
  const names = Object.keys(objectInfo || {});
  const candidates = names.filter((name) => /vector|potrace|trace|svg/i.test(name) && !/loader|save|preview/i.test(name));
  const withImageInput = candidates.filter((name) => /IMAGE/.test(JSON.stringify(objectInfo[name]?.input?.required || {})));
  return withImageInput[0] || candidates[0] || '';
}

/** Best-effort auto wiring for image-to-vector: LoadImage plus a vectorizer node. */
export function buildVectorWorkflow(objectInfo, imageName) {
  const classType = findVectorNodeClass(objectInfo);
  if (!classType) {
    throw new Error('当前 ComfyUI 没有检测到图转矢量节点（例如 Potrace / SVG 节点）。请安装对应节点，或在后台直接上传你的图转矢量工作流。');
  }
  const required = objectInfo[classType]?.input?.required || {};
  const inputs = {};
  for (const [name, spec] of Object.entries(required)) {
    const type = Array.isArray(spec) ? spec[0] : spec;
    if (Array.isArray(type)) inputs[name] = type[0];
    else if (type === 'IMAGE') inputs[name] = ['1', 0];
    else if (type === 'INT') inputs[name] = Number(spec[1]?.default ?? 0);
    else if (type === 'FLOAT') inputs[name] = Number(spec[1]?.default ?? 0);
    else if (type === 'STRING') inputs[name] = String(spec[1]?.default ?? '');
    else if (type === 'BOOLEAN') inputs[name] = Boolean(spec[1]?.default ?? false);
  }
  return {
    graph: {
      '1': { class_type: 'LoadImage', inputs: { image: imageName, upload: 'image' } },
      '2': { class_type: classType, inputs },
    },
    classType,
  };
}

export function summarizeParsed(parsed) {
  return {
    kind: parsed.kind,
    nodeCount: parsed.nodeCount,
    classes: parsed.classes,
    placeholders: parsed.placeholders,
    warnings: parsed.warnings,
    hasImageInput: Boolean(parsed.bindings.image) || parsed.placeholders.includes('image'),
    hasPromptInput: Boolean(parsed.bindings.prompt) || parsed.placeholders.includes('prompt'),
    hasScaleInput: Boolean(parsed.bindings.scale) || parsed.placeholders.includes('scale'),
    hasSizeInput: Boolean(parsed.bindings.size) || parsed.placeholders.includes('width'),
    hasSeedInput: Boolean(parsed.bindings.seed) || parsed.placeholders.includes('seed'),
  };
}

export function detectPresetKind(parsed, requestedKind) {
  const kind = String(requestedKind || '').trim();
  if (kind === 'upscale' || kind === 'vectorize' || kind === 'custom') return kind;
  return parsed.kind;
}

