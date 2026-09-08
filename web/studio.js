const APP = document.querySelector('#app');
const API_ORIGIN = ['localhost', '127.0.0.1'].includes(location.hostname) ? location.origin : 'https://zhihuiapicc-production.up.railway.app';
const state = {
  token: localStorage.getItem('zh_token') || '',
  user: JSON.parse(localStorage.getItem('zh_user') || 'null'),
  page: location.hash.slice(1) || 'home',
  mode: 'login',
  nodes: [
    { id: 'n-prompt', type: 'prompt', title: '提示词节点', x: 90, y: 300, value: '高奢护肤品主视觉，通透冰蓝色瓶身，柔和晨光，电商广告' },
    { id: 'n-image', type: 'image', title: '参考图节点', x: 370, y: 590, refs: [] },
    { id: 'n-generate', type: 'generate', title: 'AI 生成节点', x: 760, y: 330, model: 'gpt-image-2', ratio: '1:1', resolution: '1K', quality: 'auto', status: 'idle', result: null },
    { id: 'n-output', type: 'output', title: '输出预览', x: 1200, y: 470, result: null }
  ],
  selected: 'n-generate',
  camera: { x: 20, y: 10, zoom: 1 },
  tasks: [],
  models: [],
  refMap: {},
  pendingFile: null,
  toastTimer: null
};
const iconMap = { prompt: '✦', image: '▧', generate: '◈', output: '◒' };
const iconBg = { prompt: 'c-prompt', image: 'c-image', generate: 'c-generate', output: 'c-output' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = (sel) => document.querySelector(sel);
const money = (n) => Math.round(Number(n || 0)).toLocaleString();

async function api(url, options = {}) {
  const headers = Object.assign({}, options.headers || {});
  if (state.token) headers.authorization = 'Bearer ' + state.token;
  if (options.body && !(options.body instanceof FormData)) headers['content-type'] = 'application/json';
  const res = await fetch(url.indexOf('://') > -1 ? url : API_ORIGIN + url, Object.assign({}, options, { headers }));
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data.error || data.detail || data.message || '请求失败');
    err.status = res.status; err.data = data; throw err;
  }
  return data;
}

function saveAuth(token, user) {
  state.token = token; state.user = user;
  localStorage.setItem('zh_token', token); localStorage.setItem('zh_user', JSON.stringify(user));
}
function logout() {
  state.token = ''; state.user = null; state.mode = 'login';
  localStorage.removeItem('zh_token'); localStorage.removeItem('zh_user');
  state.page = 'home'; location.hash = 'home';
}
function toast(message, tone) {
  let box = $('#toast-box');
  if (!box) { box = document.createElement('div'); box.id = 'toast-box'; box.className = 'toast'; document.body.appendChild(box); }
  box.textContent = message; box.style.background = tone === 'error' ? '#d9434a' : tone === 'ok' ? '#16a37a' : '';
  requestAnimationFrame(() => box.classList.add('show'));
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => box.classList.remove('show'), 3600);
}

function userInitial() { return state.user ? (state.user.nickname || state.user.username || '?' ).slice(0, 1).toUpperCase() : '?'; }
function topbar(active) {
  const pages = state.user
    ? [['studio', '创作台', '◇'], ['history', '任务历史', '◷'], ['wallet', '积分中心', '◇'], state.user.role === 'admin' ? ['admin', '运营后台', '▣'] : null]
    : [['home', '首页', '⌂']];
  const links = (pages.filter(Boolean)).map(([p, name, ic]) => `<a href="#${p}" class="${active === p ? 'active' : ''}"><i>${ic}</i> <span>${name}</span></a>`).join('');
  return `<header class="topbar">
    <a class="brand" href="#studio"><img class="logo" src="/logo.png" alt="郅绘"><span><b>郅绘</b><small>AI DESIGN WORKSPACE</small></span></a>
    <nav class="topnav">${links}</nav>
    <div class="top-right">
      ${state.user ? `<div class="account-chip"><span class="avatar">${esc(userInitial())}</span><span class="name">${esc(state.user.nickname || state.user.username || '')}</span><span class="points-pill">${money(state.user.points ?? state.user.credits)} 积分</span></div><button class="iconbtn" data-action="logout" title="退出登录">↪</button>` : `<button class="btn primary" data-action="go-auth">登录 / 注册</button>`}
    </div>
  </header>`;
}

function landing() {
  return topbar('home') + `<main class="landing">
    <section class="landing-copy">
      <div class="eyebrow">AD · E-COMMERCE · BRAND</div>
      <h1>把广告灵感<br>拖进<span class="accent">一张无限画布</span></h1>
      <p>郅绘把提示词、参考图、AI 生成与历史记录放进同一个工作台。从一句想法到可交付的视觉，流程都在画布上。</p>
      <div class="landing-cta"><button class="btn primary" data-action="go-studio">立即开始创作 →</button><button class="btn" data-action="go-auth">登录账号</button></div>
      <div class="feature-row">
        <div class="feature-mini"><b>◇ 节点式画布</b><span>拖拽、缩放、多节点并行</span></div>
        <div class="feature-mini"><b>◈ CDR 插件同源</b><span>平台账号与积分实时同步</span></div>
        <div class="feature-mini"><b>◷ 云端记录</b><span>历史与结果随时回看</span></div>
      </div>
    </section>
    <section class="landing-stage">
      <div class="stage-card">
        <div class="stage-top"><i></i><i></i><i></i></div>
        <div class="stage-canvas">
          <span class="stage-node" style="left:8%;top:18%"><b><i class="mini c-prompt" style="width:20px;height:20px;display:grid;place-items:center;border-radius:6px">✦</i>提示词</b><small>高奢护肤 · 晨光</small></span>
          <div class="stage-generate"><b>◈</b><span>正在生成</span></div>
          <span class="stage-node" style="right:8%;top:20%"><b><i class="mini c-image" style="width:20px;height:20px;display:grid;place-items:center;border-radius:6px">▧</i>参考图</b><small>瓶身 / 材质</small></span>
          <span class="stage-node" style="left:10%;bottom:10%"><b><i class="mini c-output" style="width:20px;height:20px;display:grid;place-items:center;border-radius:6px">◒</i>输出预览</b><small>等待结果…</small></span>
          <span class="stage-node" style="right:9%;bottom:9%"><b>◷ 任务历史</b><small>2 个任务已完成</small></span>
        </div>
      </div>
    </section>
  </main>`;
}

function authPage() {
  const register = state.mode === 'register';
  return topbar('home') + `<main class="auth-wrap"><div class="auth-card">
    <a class="brand" href="#home"><img class="logo" src="/logo.png" alt="郅绘"><span><b>郅绘</b><small>AI DESIGN WORKSPACE</small></span></a>
    <h1>${register ? '创建你的郅绘账号' : '欢迎回来'}</h1>
    <p class="muted">${register ? '注册即赠 100 积分，云端同步昵称与创作记录。' : '登录后继续你的广告创作。'}</p>
    <form id="auth-form">
      ${register ? `<label class="field"><span>账号昵称</span><input class="input" name="nickname" minlength="2" required placeholder="例如：小浪设计"></label>` : ''}
      <label class="field"><span>账号 / 邮箱</span><input class="input" name="${register ? 'email' : 'account'}" ${register ? 'type="email"' : ''} required placeholder="昵称或邮箱"></label>
      <label class="field"><span>密码</span><input class="input" name="password" type="password" minlength="6" required placeholder="至少 6 位密码"></label>
      <button class="btn primary" style="width:100%;margin-top:18px;padding:12px">${register ? '注册并开始创作' : '登录工作台'}</button>
    </form>
    <p class="error-note" id="auth-error"></p>
    <div class="switch-link">${register ? '已有账号？<a data-action="switch-auth">返回登录</a>' : '还没有账号？<a data-action="switch-auth">立即注册</a>'}</div>
  </div></main>`;
}

function pageTitle(active) {
  return ({ studio: '创作台', history: '任务历史', wallet: '积分中心', admin: '运营后台' })[active] || '';
}

function workspaceShell(content, active) {
  return topbar(active) + `<main class="shell"><div class="workspace-tools"><span class="crumb">${pageTitle(active)}</span><span class="toolbar-spacer"></span>
    <div class="zoom-group"><button class="iconbtn" data-action="zoom-out" title="缩小">−</button><span id="zoom-label" style="min-width:42px;text-align:center;font-weight:750">100%</span><button class="iconbtn" data-action="zoom-in" title="放大">＋</button></div>
  </div><div class="${active === 'studio' ? 'workbench' : 'panel-page'}">${content}</div></main>`;
}

function paletteItem(type, name, desc) {
  return `<button class="palette-item" data-action="add-node" data-type="${type}"><span class="mini ${iconBg[type]}">${iconMap[type]}</span><span><b>${name}</b><br><small style="color:#99a3b7;font-weight:500">${desc}</small></span></button>`;
}

function nodeHtml(node) {
  const selected = state.selected === node.id ? ' selected' : '';
  const running = node.status === 'running';
  const statusBadge = node.type === 'generate' && node.status && node.status !== 'idle'
    ? `<span class="node-status ${node.status === 'failed' ? 'failed' : running ? 'running' : ''}">${node.status === 'running' ? '生成中' : node.status === 'done' ? '已完成' : '失败'}</span>` : '';
  let body = '';
  if (node.type === 'prompt') body = `<div class="preview">${esc(node.value || '点击右侧面板输入创作描述…')}</div>`;
  if (node.type === 'image') body = node.refs && node.refs.length
    ? node.refs.map((r) => r.preview ? `<img class="thumb" src="${r.preview}" alt="">` : '<div class="placeholder">已上传</div>').slice(0, 2).join('')
    : '<div class="placeholder">未添加参考图</div>';
  if (node.type === 'generate') body = `<div class="preview">${esc(node.prompt || '自动收集画布上的提示词节点')}</div><div style="font-size:11px;color:#8b96ad;margin-top:5px">${esc(node.model || '')} · ${esc(node.ratio || '')} · ${esc(node.resolution || '')}</div>`;
  if (node.type === 'output') body = node.result && node.result.preview ? `<img class="thumb" src="${node.result.preview}" alt="result">` : '<div class="placeholder">生成结果将显示在这里</div>';
  return `<article class="node${selected}" data-node="${node.id}" data-action="select-node" data-id="${node.id}" data-type="${node.type}" style="left:${node.x}px;top:${node.y}px">
    <div class="node-head"><span class="node-icon ${iconBg[node.type]}">${iconMap[node.type]}</span><span class="node-title">${node.title}</span>${statusBadge}</div>
    <div class="node-body">${body}</div>
    ${node.type === 'generate' ? '<div class="node-actions"><button class="mini-btn" data-action="run-node" data-id="' + node.id + '">▶ 生成此节点</button></div>' : ''}
    <div class="node-actions"><button class="mini-btn" data-action="select-node" data-id="${node.id}">编辑节点</button></div>
  </article>`;
}

function edgePath(from, to) {
  const sx = from.x + 222; const sy = from.y + 40;
  const ex = to.x; const ey = to.y + 40;
  const mx = (sx + ex) / 2;
  return `M ${sx} ${sy} C ${mx + 20} ${sy}, ${mx - 20} ${ey}, ${ex} ${ey}`;
}

function redrawCanvas() {
  const viewport = $('#canvas-viewport'); const world = $('#canvas-world');
  if (!viewport || !world) return;
  const c = state.camera;
  world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`;
  const zoom = $('#zoom-label'); if (zoom) zoom.textContent = Math.round(c.zoom * 100) + '%';
  const generators = state.nodes.filter((n) => n.type === 'generate');
  const target = generators[0];
  const sources = state.nodes.filter((n) => n.type === 'prompt' || n.type === 'image');
  const paths = [];
  if (target) sources.forEach((n) => { paths.push(n.type === 'prompt' ? edgePath(n, target) : edgePath(n, target).replace('stroke:#b7c3ff', '')); });
  world.innerHTML = `<svg class="edge-svg" viewBox="0 0 1800 1100" preserveAspectRatio="none"><defs><linearGradient id="edgeGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff8a73"/><stop offset="55%" stop-color="#5a4cf4"/><stop offset="100%" stop-color="#14b8d4"/></linearGradient></defs>${paths.map((d) => `<path class="edge-path" d="${d}"/>`).join('')}</svg>` + state.nodes.map(nodeHtml).join('');
}

function studioPage() {
  const gen = state.nodes.find((n) => n.type === 'generate') || state.nodes[0];
  const sel = state.nodes.find((n) => n.id === state.selected) || gen;
  const add = (type, label, desc) => paletteItem(type, label, desc);
  return `<section class="workbench">
    <aside class="rail">
      <h3>节点库</h3>
      <div class="node-palette">
        ${add('prompt', '提示词', '输入创作想法')}
        ${add('image', '参考图', '上传 1-4 张')}
        ${add('generate', 'AI 生成', '跑当前画布')}
        ${add('output', '输出预览', '查看结果')}
      </div>
      <div class="quick-help">拖动节点调整布局；滚轮缩放；选择节点后在右侧编辑。<br><br>“生成此节点”会自动收集画布里的提示词与参考图。</div>
      <button class="btn primary" style="width:100%;margin-top:18px" data-action="run-node" data-id="${gen.id}">运行整个工作流</button>
    </aside>
    <div class="canvas-wrap">
      <div class="canvas-grid"></div>
      <div class="canvas-viewport" id="canvas-viewport"><div class="world" id="canvas-world"></div></div>
    </div>
    <aside class="inspector open" id="inspector">${inspectorHtml(sel)}</aside>
  </section>`;
}

function inspectorHtml(node) {
  if (!node) return `<div class="empty">点击左侧画布中的节点开始编辑</div>`;
  const modelOptions = state.models.length ? state.models.map((m) => `<option value="${esc(m.modelId || m.id)}">${esc(m.displayName || m.id)}</option>`).join('') : '<option value="gpt-image-2">GPT Image 2</option>';
  let core = '';
  if (node.type === 'prompt') core = `<div class="field"><label>创作提示词</label><textarea class="input" data-node-input="value" data-id="${node.id}">${esc(node.value || '')}</textarea></div>`;
  if (node.type === 'image') core = `<div class="field"><label>参考图片（可多选）</label><input type="file" class="input" id="image-upload" data-id="${node.id}" accept="image/*" multiple><div id="refs-preview">${(node.refs || []).map((r) => r.preview ? `<img class="result-thumb" style="margin-top:7px" src="${r.preview}">` : '').join('')}</div></div>`;
  if (node.type === 'generate') core = `
    <div class="field"><label>生成补充提示（可留空）</label><textarea class="input" data-node-input="prompt" data-id="${node.id}">${esc(node.prompt || '')}</textarea></div>
    <div class="field"><label>模型</label><select class="input" data-node-input="model" data-id="${node.id}">${modelOptions}</select></div>
    <div class="form-grid">
      <div class="field"><label>比例</label><select class="input" data-node-input="ratio" data-id="${node.id}">${['1:1', '4:3', '3:4', '16:9', '9:16'].map((r) => `<option ${node.ratio === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div class="field"><label>分辨率</label><select class="input" data-node-input="resolution" data-id="${node.id}">${['1K', '2K', '4K'].map((r) => `<option ${node.resolution === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    </div>
    <div class="field"><label>质量</label><select class="input" data-node-input="quality" data-id="${node.id}">${['auto', 'high', 'medium', 'low'].map((r) => `<option ${node.quality === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <button class="btn primary" style="width:100%;margin-top:18px" data-action="run-node" data-id="${node.id}">${node.status === 'running' ? '生成中…' : '生成此节点'}</button>`;
  if (node.type === 'output') core = `<div class="field"><p style="color:#68748e;line-height:1.6">生成成功的结果会自动写入该节点，也可在“任务历史”中查看云端记录。</p></div>`;
  return `<h3>节点设置</h3><div style="display:flex;align-items:center;gap:9px;margin-top:10px"><span class="node-icon ${iconBg[node.type]}">${iconMap[node.type]}</span><b>${node.title}</b><button class="btn ghost danger" style="margin-left:auto" data-action="delete-node" data-id="${node.id}">删除</button></div>${core}`;
}

function taskStatusLabel(t) {
  const s = t.status;
  if (s === 'succeeded' || s === 'completed' || s === 'done') return '<span class="badge done">完成</span>';
  if (s === 'processing' || s === 'queued' || s === 'running') return '<span class="badge proc">生成中</span>';
  if (s === 'failed') return '<span class="badge fail">失败</span>';
  return `<span class="badge">${esc(s || '未知')}</span>`;
}

async function taskThumb(job) {
  if (!job.assetId && !job.asset) return '';
  try {
    const assetId = job.assetId || job.asset;
    const res = await fetch(`${API_ORIGIN}/v1/image/assets/${encodeURIComponent(assetId)}`, { headers: { authorization: 'Bearer ' + state.token } });
    if (!res.ok) return '';
    const blob = await res.blob(); const url = URL.createObjectURL(blob);
    return `<img src="${url}" alt="result" data-action="preview" data-url="${url}">`;
  } catch { return ''; }
}

async function historyPage() {
  let jobs = [];
  try { const d = await api('/v1/image/history'); jobs = d.history || []; }
  catch { try { const d = await api('/api/v1/tasks'); jobs = (d.tasks || []).map((t) => ({ id: t.id, status: t.status, prompt: t.prompt, modelId: t.model, createdAt: t.createdAt, error: t.error })); } catch {} }
  const rows = await Promise.all(jobs.slice(0, 40).map(async (j) => {
    const thumb = j.assetId || j.asset ? await taskThumb(j) : '';
    return `<div class="task-card">${thumb}<div style="flex:1;min-width:0"><div style="font-weight:750">${esc(j.prompt || '未命名任务')}</div><div style="font-size:12px;color:#8a94a8">${esc(j.modelId || j.model || '')} · ${new Date(j.createdAt).toLocaleString('zh-CN')}</div>${j.error ? `<div style="font-size:12px;color:#d9434a;margin-top:4px">${esc(j.error)}</div>` : ''}</div>${taskStatusLabel(j)}</div>`;
  }));
  const items = rows.length ? rows.join('') : '<div class="empty">还没有生成记录，去创作台发起第一次生成吧。</div>';
  return workspaceShell(`<div style="max-width:1080px;margin:0 auto;padding:26px 18px"><div class="panel-card"><h3 style="margin-bottom:18px">云端生成记录</h3><div class="task-list">${items}</div></div></div>`, 'history');
}

function walletPage() {
  const points = state.user ? state.user.points ?? state.user.credits : 0;
  return workspaceShell(`<div style="max-width:860px;margin:0 auto;padding:26px 18px">
    <div class="panel-card"><h3 style="margin-bottom:12px">可用积分</h3><div class="stats"><div class="stat"><b>${money(points)}</b><span>积分余额</span></div><div class="stat"><b>10</b><span>每次生成消耗</span></div><div class="stat"><b>平台</b><span>服务模式</span></div><div class="stat"><b>∞</b><span>云端记录</span></div></div></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">积分兑换</h3><form id="redeem-form"><label class="field"><span>兑换码</span><input class="input" name="code" required placeholder="输入 ZH- 开头的兑换码"></label><button class="btn primary" style="margin-top:14px">立即兑换</button></form><p class="error-note" id="redeem-error"></p></div>
  </div>`, 'wallet');
}

async function adminPage() {
  let d = null;
  try { d = await api('/v1/admin/dashboard'); }
  catch { try { const old = await api('/api/v1/admin/overview'); d = { stats: old.metrics, users: old.users, jobs: old.tasks || [], workflows: [] }; } catch {} }
  if (!d) return workspaceShell(`<div class="empty">需要管理员权限</div>`, 'admin');
  const stats = d.stats || {};
  const userRows = (d.users || []).slice(-12).reverse().map((u) => `<tr><td>${esc(u.nickname || u.email || u.username || '')}</td><td>${esc(u.email || '')}</td><td>${u.role}</td><td>${money(u.points ?? u.credits)}</td><td>${new Date(u.createdAt).toLocaleString('zh-CN')}</td></tr>`).join('');
  const jobRows = (d.jobs || []).slice(0, 12).map((j) => `<tr><td>${esc(j.prompt || (j.requestId || '').slice(0, 12))}</td><td>${taskStatusLabel(j)}</td><td>${esc(j.model || '')}</td><td>${j.cost ?? ''}</td><td>${new Date(j.createdAt).toLocaleString('zh-CN')}</td></tr>`).join('');
  const wfRows = (d.workflows || []).map((w) => `<tr><td><b>${esc(w.name || w.code)}</b></td><td>${esc(w.code)}</td><td>v${w.version || 1}</td><td>${w.published ? '<span class="badge done">已发布</span>' : '<span class="badge">草稿</span>'}</td><td>${new Date(w.updatedAt || w.createdAt).toLocaleString('zh-CN')}</td></tr>`).join('');
  return workspaceShell(`<div style="max-width:1100px;margin:0 auto;padding:24px 18px">
    <div class="stats">${Object.entries({ 用户: stats.users, 任务: stats.jobs, 积分总量: stats.credits, 成功任务: stats.succeeded }).map(([k, v]) => `<div class="stat"><b>${v ?? 0}</b><span>${k}</span></div>`).join('')}</div>
    <div class="panel-card"><h3 style="margin-bottom:14px">生成充值码</h3><form id="admin-code-form" style="display:flex;gap:10px;flex-wrap:wrap"><input class="input" name="amount" type="number" min="1" placeholder="单码积分" style="width:130px" value="100"><input class="input" name="count" type="number" min="1" placeholder="数量" style="width:100px" value="1"><button class="btn primary">生成</button><p id="code-result" style="width:100%;font-size:12px;color:#09835e;white-space:pre-wrap"></p></form></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">AI 图像服务</h3><form id="ai-config-form"><div class="form-grid"><label class="field"><span>服务地址</span><input class="input" name="baseUrl" value="https://tokenflux.cloud/" placeholder="https://tokenflux.cloud/"></label><label class="field"><span>模型</span><input class="input" name="model" value="gpt-image-2" placeholder="gpt-image-2"></label></div><label class="field"><span>平台 API Key</span><input class="input" name="apiKey" type="password" placeholder="留空表示不修改当前密钥"></label><button class="btn primary" style="margin-top:14px">保存 AI 服务配置</button><p id="ai-config-result" style="font-size:12px;color:#09835e"></p></form></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">工作流上传 / 功能同步</h3><form id="workflow-form"><label class="field"><span>工作流 JSON（可粘贴或上传）</span><textarea class="input" name="workflow" style="min-height:150px" placeholder='{"code":"product-hero","name":"产品主视觉","version":1,...}'></textarea></label><input class="input" type="file" id="workflow-file" accept=".json,application/json" style="margin-top:10px"><button class="btn primary" style="margin-top:14px">上传并发布工作流</button><p id="workflow-result" style="font-size:12px;color:#09835e;white-space:pre-wrap"></p></form></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">已发布工作流</h3><table class="table"><thead><tr><th>名称</th><th>代码</th><th>版本</th><th>状态</th><th>更新时间</th></tr></thead><tbody>${wfRows || '<tr><td colspan="5">暂无工作流</td></tr>'}</tbody></table></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">用户</h3><table class="table"><thead><tr><th>昵称</th><th>邮箱</th><th>角色</th><th>积分</th><th>注册时间</th></tr></thead><tbody>${userRows}</tbody></table></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">最近任务</h3><table class="table"><thead><tr><th>任务</th><th>状态</th><th>模型</th><th>消耗</th><th>时间</th></tr></thead><tbody>${jobRows}</tbody></table></div>
  </div>`, 'admin');
}

async function render() {
  if (state.user && ['home'].includes(state.page)) state.page = state.user ? 'studio' : 'home';
  if (!state.user && ['studio', 'history', 'wallet', 'admin'].includes(state.page)) state.page = 'home';
  if (state.page === 'home' && !state.user) { APP.innerHTML = landing(); bindLanding(); return; }
  if (state.page === 'auth') { APP.innerHTML = authPage(); bindAuth(); return; }
  if (state.page === 'studio') { APP.innerHTML = workspaceShell(studioPage(), 'studio'); bindCanvas(); bindInspectorEvents(); loadModels(); return; }
  if (state.page === 'history') { APP.innerHTML = await historyPage(); return; }
  if (state.page === 'wallet') { APP.innerHTML = walletPage(); bindWallet(); return; }
  if (state.page === 'admin') { APP.innerHTML = await adminPage(); bindAdmin(); return; }
  if (state.user) { state.page = 'studio'; location.hash = 'studio'; render(); return; }
  APP.innerHTML = landing(); bindLanding();
}

function bindLanding() {
  return;
}

async function submitAuth(form) {
  const data = Object.fromEntries(new FormData(form));
  const payload = { nickname: data.nickname || data.account, account: data.account, email: data.email || (data.account && data.account.includes('@') ? data.account : ''), password: data.password };
  const isLogin = !payload.nickname || !state.mode;
  try {
    let d;
    try {
      d = state.mode === 'register'
        ? await api('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ nickname: data.nickname, email: data.email, password: data.password }) })
        : await api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ nickname: data.account || data.nickname, email: payload.email, password: data.password }) });
    } catch (err) {
      if (!err.status) throw err;
      d = err.data;
      if (d && d.token) { /* server sometimes returns 200-ish with error object no */ }
      throw new Error(d.error || d.detail || '登录失败');
    }
    saveAuth(d.token || d.access_token, d.user || d.data?.user);
    if (d.credits !== undefined && state.user) state.user.points = d.credits;
    toast(state.mode === 'register' ? '账号已创建' : '登录成功', 'ok');
    state.page = 'studio'; location.hash = 'studio'; render();
    refreshAccount();
  } catch (err) {
    const box = $('#auth-error'); if (box) { box.style.display = 'block'; box.textContent = err.message; }
  }
}

function bindAuth() {
  return;
}

async function loadModels() {
  if (!state.token) return;
  try {
    const d = await api('/v1/image/models');
    state.models = d.models || [];
    const sel = state.nodes.find((n) => n.id === state.selected);
    const inspector = $('#inspector');
    if (inspector && sel) { inspector.innerHTML = inspectorHtml(sel); bindInspectorEvents(); }
  } catch {}
}

async function refreshAccount() {
  if (!state.token) return;
  try { const d = await api('/v1/account'); if (d.user) { state.user = Object.assign({}, state.user, d.user, { points: d.user.credits }); localStorage.setItem('zh_user', JSON.stringify(state.user)); } }
  catch { try { const d = await api('/api/v1/auth/me'); if (d.user) { state.user = d.user; localStorage.setItem('zh_user', JSON.stringify(state.user)); } } catch {} }
}

function bindCanvas() {
  redrawCanvas();
  const viewport = $('#canvas-viewport');
  if (!viewport) return;
  let panning = null;
  viewport.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.node');
    if (target) { if (e.target.closest('button,input,textarea,select')) return; startNodeDrag(e, target.dataset.node); return; }
    panning = { x: e.clientX - state.camera.x, y: e.clientY - state.camera.y };
    viewport.classList.add('panning');
  });
  window.addEventListener('pointermove', (e) => {
    if (panning) { state.camera.x = e.clientX - panning.x; state.camera.y = e.clientY - panning.y; redrawCanvas(); }
  });
  window.addEventListener('pointerup', () => { panning = null; viewport && viewport.classList.remove('panning'); state.drag = null; });
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.93;
    state.camera.zoom = Math.max(.45, Math.min(1.8, state.camera.zoom * factor));
    redrawCanvas();
  }, { passive: false });
}

function startNodeDrag(e, id) {
  const node = state.nodes.find((n) => n.id === id); if (!node) return;
  state.selected = id;
  state.drag = { id, dx: e.clientX - node.x, dy: e.clientY - node.y };
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', stopDrag, { once: true });
}
function moveDrag(e) {
  if (!state.drag) return;
  const node = state.nodes.find((n) => n.id === state.drag.id); if (!node) return;
  node.x = Math.max(0, Math.min(1550, e.clientX - state.drag.dx));
  node.y = Math.max(0, Math.min(760, e.clientY - state.drag.dy));
  redrawCanvas();
}
function stopDrag() { state.drag = null; window.removeEventListener('pointermove', moveDrag); }

function bindInspectorEvents() {
  document.querySelectorAll('[data-node-input]').forEach((el) => {
    el.addEventListener(el.tagName === 'TEXTAREA' ? 'input' : 'change', () => {
      const node = state.nodes.find((n) => n.id === el.dataset.id); if (node) node[el.dataset.nodeInput] = el.value;
      if (el.dataset.nodeInput === 'value') redrawCanvas();
    });
  });
  const upload = $('#image-upload');
  if (upload) upload.addEventListener('change', async (e) => handleImageUpload(e.target));
}

async function handleImageUpload(input) {
  const node = state.nodes.find((n) => n.id === input.dataset.id); if (!node || !input.files || !input.files.length) return;
  node.refs = node.refs || [];
  for (const file of Array.from(input.files)) {
    const preview = URL.createObjectURL(file);
    const local = { id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), fileName: file.name, preview };
    node.refs.push(local);
    if (state.token) {
      try {
        const form = new FormData(); form.append('files', file, file.name);
        const d = await api('/v1/image/references', { method: 'POST', body: form });
        if (d.references && d.references[0]) local.id = d.references[0].id;
      } catch (err) { toast('参考图上传失败：' + err.message, 'error'); }
    }
  }
  const previewBox = $('#refs-preview'); if (previewBox) previewBox.innerHTML = node.refs.map((r) => `<img class="result-thumb" style="margin-top:7px" src="${r.preview}">`).join('');
  const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(node); bindInspectorEvents();
}

function addNode(type) {
  const base = { x: 300 + Math.random() * 150, y: 130 + Math.random() * 240 };
  const node = Object.assign(base, {
    id: 'n-' + type + '-' + Date.now(), type,
    title: type === 'prompt' ? '提示词节点' : type === 'image' ? '参考图节点' : type === 'generate' ? 'AI 生成节点' : '输出预览',
    value: '', refs: [], prompt: '', model: 'gpt-image-2', ratio: '1:1', resolution: '1K', quality: 'auto', status: 'idle', result: null
  });
  state.nodes.push(node); state.selected = node.id; redrawCanvas();
  const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(node); bindInspectorEvents();
}

async function runNode(nodeId) {
  const gen = state.nodes.find((n) => n.id === nodeId && n.type === 'generate') || state.nodes.find((n) => n.type === 'generate');
  if (!gen) { toast('请先添加一个 AI 生成节点', 'error'); return; }
  if (!state.token || !state.user) { state.page = 'auth'; location.hash = 'auth'; render(); toast('登录后才能调用云端生成'); return; }
  const prompts = state.nodes.filter((n) => n.type === 'prompt').map((n) => n.value).filter(Boolean);
  if (gen.prompt && gen.prompt.trim()) prompts.push(gen.prompt);
  const prompt = [...new Set(prompts)].join('\n');
  if (!prompt.trim()) { toast('请先在提示词节点输入内容', 'error'); return; }
  const refs = state.nodes.filter((n) => n.type === 'image').flatMap((n) => (n.refs || []).map((r) => r.id)).filter((id) => id && !id.startsWith('local-'));
  const output = state.nodes.find((n) => n.type === 'output');
  gen.status = 'running'; gen.error = '';
  if (output) { output.status = 'running'; output.result = null; }
  redrawCanvas();
  try {
    const payload = { request_id: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), model: gen.model || 'gpt-image-2', prompt, reference_ids: refs, aspect_ratio: gen.ratio || '1:1', resolution: gen.resolution || '1K', quality: gen.quality || 'auto', quantity: 1 };
    const d = await api('/v1/image/generations', { method: 'POST', body: JSON.stringify(payload) });
    if (d.assetId) {
      const blob = await fetch(`${API_ORIGIN}/v1/image/assets/${encodeURIComponent(d.assetId)}`, { headers: { authorization: 'Bearer ' + state.token } }).then((r) => r.blob());
      const preview = URL.createObjectURL(blob);
      gen.result = { preview, assetId: d.assetId, url: preview }; gen.status = 'done';
      if (output) { output.result = { preview, assetId: d.assetId }; output.status = 'done'; }
      refreshAccount(); toast('生成完成，结果已写入输出节点', 'ok');
    } else if (d.status === 'failed') {
      gen.status = 'failed'; gen.error = d.error || '生成失败'; if (output) output.status = 'failed';
      toast('生成失败：' + (d.error || '服务器暂未配置图像上游'), 'error');
    } else {
      gen.status = 'running'; toast('任务仍在生成，可稍后查看任务历史');
    }
  } catch (err) {
    gen.status = 'failed'; gen.error = err.message; if (output) output.status = 'failed';
    toast(err.message, 'error');
  }
  redrawCanvas();
  const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(gen); bindInspectorEvents();
}

async function deleteNode(id) {
  if (state.nodes.length <= 2) { toast('画布至少保留一个工作节点'); return; }
  state.nodes = state.nodes.filter((n) => n.id !== id);
  if (state.selected === id) state.selected = (state.nodes.find((n) => n.type === 'generate') || state.nodes[0]).id;
  redrawCanvas(); const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(state.nodes.find((n) => n.id === state.selected)); bindInspectorEvents();
}

function bindWallet() {
  const form = $('#redeem-form'); if (form) form.onsubmit = async (e) => {
    e.preventDefault(); const data = Object.fromEntries(new FormData(form));
    try {
      const d = await api('/v1/redeem', { method: 'POST', body: JSON.stringify({ code: data.code }) });
      if (state.user) { state.user.points = d.balance; localStorage.setItem('zh_user', JSON.stringify(state.user)); }
      toast('兑换成功，已到账 ' + d.credited + ' 积分', 'ok'); render();
    } catch (err) { toast(err.message, 'error'); }
  };
}

function bindAdmin() {
  const aiForm = $('#ai-config-form'); if (aiForm) aiForm.onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(aiForm));
    try {
      const d = await api('/v1/admin/ai-config', { method: 'POST', body: JSON.stringify({ baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model }) });
      const box = $('#ai-config-result'); if (box) box.textContent = '已保存：' + d.config.baseUrl + ' · ' + d.config.model + ' · 密钥已配置';
      toast('AI 图像服务配置已保存', 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };
  const codeForm = $('#admin-code-form'); if (codeForm) codeForm.onsubmit = async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(codeForm));
    try {
      const d = await api('/v1/admin/redeem-codes', { method: 'POST', body: JSON.stringify({ amount: Number(f.amount), count: Number(f.count) }) });
      $('#code-result').textContent = '充值码：\n' + d.codes.join('\n');
    } catch (err) { toast(err.message, 'error'); }
  };
  const workflowForm = $('#workflow-form');
  const workflowFile = $('#workflow-file');
  if (workflowFile) workflowFile.addEventListener('change', async () => {
    const file = workflowFile.files && workflowFile.files[0]; if (!file) return;
    const text = await file.text();
    const area = workflowForm && workflowForm.querySelector('[name=workflow]'); if (area) area.value = text;
  });
  if (workflowForm) workflowForm.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const raw = workflowForm.workflow.value.trim();
      const workflow = JSON.parse(raw);
      const d = await api('/v1/studio/workflows', { method: 'POST', body: JSON.stringify({ workflow }) });
      const box = $('#workflow-result'); if (box) box.textContent = '已发布：' + d.workflow.code + ' v' + d.workflow.version;
      toast('工作流已发布，插件可在下一次同步时获取', 'ok');
      setTimeout(() => render(), 900);
    } catch (err) { toast('JSON 无效或发布失败：' + err.message, 'error'); }
  };
}

function bindDelegated() {
  APP.addEventListener('click', async (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'go-auth') { state.page = 'auth'; state.mode = 'login'; location.hash = 'auth'; render(); }
      if (action === 'go-studio') { if (!state.user) { state.page = 'auth'; state.mode = 'login'; location.hash = 'auth'; } else { state.page = 'studio'; location.hash = 'studio'; } render(); }
      if (action === 'switch-auth') { state.mode = state.mode === 'login' ? 'register' : 'login'; render(); }
      if (action === 'logout') logout();
      if (action === 'add-node') addNode(actionEl.dataset.type);
      if (action === 'select-node') { state.selected = actionEl.dataset.id; const node = state.nodes.find((n) => n.id === state.selected); redrawCanvas(); const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(node); bindInspectorEvents(); }
      if (action === 'delete-node') deleteNode(actionEl.dataset.id);
      if (action === 'run-node') runNode(actionEl.dataset.id);
      if (action === 'zoom-in' || action === 'zoom-out') { state.camera.zoom = Math.max(.45, Math.min(1.8, state.camera.zoom * (action === 'zoom-in' ? 1.12 : .9))); redrawCanvas(); }
      if (action === 'preview') { const url = actionEl.dataset.url; if (url) openPreview(url); }
    }
  });
  APP.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'image-upload') handleImageUpload(t);
  });
  APP.addEventListener('submit', (e) => {
    const form = e.target;
    if (form.id === 'auth-form') { e.preventDefault(); submitAuth(form); }
  });
}

function openPreview(url) {
  let modal = $('#preview-modal');
  if (!modal) {
    modal = document.createElement('div'); modal.id = 'preview-modal'; modal.className = 'modal';
    modal.innerHTML = `<div class="modal-card"><div style="display:flex;justify-content:flex-end"><button class="btn" data-action="close-preview">关闭</button></div><img id="preview-image" alt="preview"></div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-action="close-preview"]')) modal.classList.remove('open'); });
  }
  $('#preview-image').src = url; modal.classList.add('open');
}

window.addEventListener('hashchange', () => { state.page = location.hash.slice(1) || 'home'; render(); });
bindDelegated();
render();
