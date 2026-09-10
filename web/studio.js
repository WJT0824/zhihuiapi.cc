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
  settings: JSON.parse(localStorage.getItem('zh_settings') || '{}'),
  edges: [
    { id: 'e1', source: 'n-prompt', target: 'n-generate' },
    { id: 'e2', source: 'n-image', target: 'n-generate' },
    { id: 'e3', source: 'n-generate', target: 'n-output' }
  ],
  connecting: null,
  camera: { x: 20, y: 10, zoom: 1 },
  tasks: [],
  models: [],
  refMap: {},
  pendingFile: null,
  toastTimer: null
};
const iconMap = { prompt: '✦', image: '▧', generate: '◈', upscale: '⇪', output: '◒', background: '⌁' };
const iconBg = { prompt: 'c-prompt', image: 'c-image', generate: 'c-generate', upscale: 'c-generate', background: 'c-image', output: 'c-output' };
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
    ? [['studio', '创作台', '◇'], ['history', '任务历史', '◷'], ['wallet', '积分中心', '◇'], ['settings', '个人设置', '⚙'], ['download', '下载插件', '⭳'], state.user.role === 'admin' ? ['admin', '运营后台', '▣'] : null]
    : [['home', '首页', '⌂'], ['download', '下载插件', '⭳']];
  const links = (pages.filter(Boolean)).map(([p, name, ic]) => `<a href="${p === 'download' ? '/downloads/' : '#' + p}" class="${active === p ? 'active' : ''}"><i>${ic}</i> <span>${name}</span></a>`).join('');
  return `<header class="topbar">
    <a class="brand" href="#studio"><img class="logo" src="/logo.png" alt="郅绘"><span><b>郅绘</b><small>AI DESIGN WORKSPACE</small></span></a>
    <nav class="topnav">${links}</nav>
    <div class="top-right">
      ${state.user ? `<button class="account-chip" data-action="open-settings" title="个人设置"><span class="avatar">${esc(userInitial())}</span><span class="name">${esc(state.user.nickname || state.user.username || '')}</span><span class="points-pill">${money(state.user.points ?? state.user.credits)} 积分</span></button><button class="iconbtn" data-action="logout" title="退出登录">↪</button>` : `<button class="btn primary" data-action="go-auth">登录 / 注册</button>`}
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
  return ({ studio: '创作台', history: '任务历史', wallet: '积分中心', settings: '个人设置', admin: '运营后台' })[active] || '';
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
  const statusBadge = ['generate', 'upscale', 'background'].includes(node.type) && node.status && node.status !== 'idle'
    ? `<span class="node-status ${node.status === 'failed' ? 'failed' : running ? 'running' : ''}">${node.status === 'running' ? '生成中' : node.status === 'done' ? '已完成' : '失败'}</span>` : '';
  const hasIn = ['generate', 'upscale', 'background', 'output'].includes(node.type);
  const hasOut = ['prompt', 'image', 'generate', 'upscale', 'background'].includes(node.type);
  return `<article class="node${selected}" data-node="${node.id}" data-action="select-node" data-id="${node.id}" data-type="${node.type}" style="left:${node.x}px;top:${node.y}px">
    <div class="node-head"><span class="node-icon ${iconBg[node.type]}">${iconMap[node.type]}</span><span class="node-title">${node.title}</span>${statusBadge}</div>
    ${hasIn ? '<i class="port in" data-port="in" data-node="' + node.id + '" title="输入"></i>' : ''}${hasOut ? '<i class="port out" data-port="out" data-node="' + node.id + '" title="输出"></i>' : ''}
    <div class="node-body">${nodeInlineBody(node)}</div>
    ${['generate', 'upscale', 'background'].includes(node.type) ? '<div class="node-actions"><button class="mini-btn" data-action="run-node" data-id="' + node.id + '">▶ ' + (node.type === 'upscale' ? '高清放大' : node.type === 'background' ? '处理' : '生成') + '</button></div>' : ''}
  </article>`;
}

function modelOptionHtml(selected = 'gpt-image-2') {
  const list = state.models.length ? state.models.slice() : [{ id: 'gpt-image-2', modelId: 'gpt-image-2', displayName: 'GPT Image 2' }];
  const matched = list.some((m) => (m.modelId || m.id || '').toLowerCase() === String(selected || 'gpt-image-2').toLowerCase());
  if (!matched) list.unshift({ id: selected || 'gpt-image-2', modelId: selected || 'gpt-image-2', displayName: (selected || 'gpt-image-2') === 'gpt-image-2' ? 'GPT Image 2' : (selected || 'gpt-image-2') });
  return list.map((m) => `<option ${((m.modelId || m.id) === (selected || 'gpt-image-2') || (m.modelId || m.id || '').toLowerCase() === String(selected || 'gpt-image-2').toLowerCase()) ? 'selected' : ''} value="${esc(m.modelId || m.id)}">${esc(m.displayName || m.id)}</option>`).join('');
}

function nodeInlineBody(node) {
  if (node.type === 'prompt') return `<textarea class="input node-inline-input" data-node-input="value" data-id="${node.id}" rows="5" placeholder="输入创作描述…">${esc(node.value || '')}</textarea>`;
  if (node.type === 'image') {
    const previews = (node.refs || []).map((r) => r.preview ? `<img class="thumb" style="height:86px" src="${r.preview}" alt="">` : '').join('');
    return `<div class="field" style="margin:0"><input type="file" class="input" data-image-input="1" data-id="${node.id}" accept="image/*" multiple><div style="display:flex;gap:6px;margin-top:6px">${previews || '<div class="placeholder" style="height:60px">上传图片后在此预览</div>'}</div></div>`;
  }
  if (node.type === 'generate') return `
    <div class="field"><label>补充提示</label><textarea class="input node-inline-input" data-node-input="prompt" data-id="${node.id}" rows="3">${esc(node.prompt || '')}</textarea></div>
    <div class="inline-grid"><select class="input" data-node-input="model" data-id="${node.id}">${modelOptionHtml()}</select><select class="input" data-node-input="ratio" data-id="${node.id}">${['1:1', '4:3', '3:4', '16:9', '9:16'].map((r) => `<option ${node.ratio === r ? 'selected' : ''}>${r}</option>`).join('')}</select><select class="input" data-node-input="resolution" data-id="${node.id}">${['1K', '2K', '4K'].map((r) => `<option ${node.resolution === r ? 'selected' : ''}>${r}</option>`).join('')}</select><select class="input" data-node-input="quality" data-id="${node.id}">${['auto', 'high', 'medium', 'low'].map((r) => `<option ${node.quality === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>`;
  if (node.type === 'upscale') return `
    <div class="field"><label>放大模式</label><select class="input" data-node-input="tool" data-id="${node.id}"><option value="restore-4k" ${node.tool === 'restore-4k' ? 'selected' : ''}>4K 修复（2x）</option><option value="upscale-8k" ${node.tool === 'upscale-8k' ? 'selected' : ''}>8K 超分（4x）</option></select></div>
    <div class="field"><label>放大提示</label><textarea class="input node-inline-input" data-node-input="prompt" data-id="${node.id}" rows="3">${esc(node.prompt || '')}</textarea></div>
    <div class="inline-grid"><select class="input" data-node-input="model" data-id="${node.id}">${modelOptionHtml()}</select><select class="input" data-node-input="resolution" data-id="${node.id}"><option value="2K" ${node.resolution === '2K' ? 'selected' : ''}>2K</option><option value="4K" ${node.resolution === '4K' ? 'selected' : ''}>4K</option></select></div>`;
  if (node.type === 'output') return node.result && node.result.preview ? `<img class="thumb" style="height:180px" src="${node.result.preview}" alt="result">` : '<div class="placeholder" style="height:130px">生成结果将显示在这里</div>';
  if (node.type === 'background') return `<div class="field"><label>处理提示</label><textarea class="input node-inline-input" data-node-input="prompt" data-id="${node.id}" rows="3">${esc(node.prompt || '')}</textarea></div>`;
  return '<div class="preview"></div>';
}

function edgePath(from, to) {
  const sx = from.x + 222; const sy = from.y + 52;
  const ex = to.x; const ey = to.y + 52;
  const mx = (sx + ex) / 2;
  return `M ${sx} ${sy} C ${mx + 18} ${sy}, ${mx - 18} ${ey}, ${ex} ${ey}`;
}

function redrawCanvas() {
  const viewport = $('#canvas-viewport'); const world = $('#canvas-world');
  if (!viewport || !world) return;
  const c = state.camera;
  world.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.zoom})`;
  const zoom = $('#zoom-label'); if (zoom) zoom.textContent = Math.round(c.zoom * 100) + '%';
  const edgeMarkup = state.edges.map((edge) => {
    const source = state.nodes.find((n) => n.id === edge.source);
    const target = state.nodes.find((n) => n.id === edge.target);
    return source && target ? `<path class="edge-path" data-edge-id="${edge.id}" d="${edgePath(source, target)}"/>` : '';
  }).join('');
  let ghost = '';
  if (state.connecting) {
    const source = state.nodes.find((n) => n.id === state.connecting.source);
    if (source) {
      ghost = `<path class="edge-path ghost" d="${edgePath(source, { x: state.connecting.x, y: state.connecting.y, id: '__ghost__' })}"/>`;
    }
  }
  world.innerHTML = `<svg class="edge-svg" viewBox="0 0 1800 1100" preserveAspectRatio="none"><defs><linearGradient id="edgeGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff8a73"/><stop offset="55%" stop-color="#5a4cf4"/><stop offset="100%" stop-color="#14b8d4"/></linearGradient></defs>${edgeMarkup}${ghost}</svg>` + state.nodes.map(nodeHtml).join('');
  world.querySelectorAll('.port').forEach((port) => {
    port.addEventListener('click', (e) => handlePortClick(port.dataset.node, port.dataset.port, e));
    port.addEventListener('pointerdown', (e) => handlePortDown(port.dataset.node, port.dataset.port, e));
    port.addEventListener('mousedown', (e) => handlePortDown(port.dataset.node, port.dataset.port, e));
  });
  bindInlineNodeInputs();
}

function bindInlineNodeInputs() {
  const world = $('#canvas-world'); if (!world) return;
  world.querySelectorAll('[data-node-input]').forEach((el) => {
    const isText = el.tagName === 'TEXTAREA';
    el.addEventListener(isText ? 'input' : 'change', () => {
      const node = state.nodes.find((n) => n.id === el.dataset.id); if (!node) return;
      node[el.dataset.nodeInput] = el.value;
      if (!isText) redrawCanvas();
    });
  });
  world.querySelectorAll('[data-image-input]').forEach((el) => {
    el.addEventListener('change', () => handleImageUpload(el));
  });
}

function handlePortDown(nodeId, kind, e) {
  if (kind !== 'out' || state.connecting) return;
  e.preventDefault();
  e.stopPropagation();
  const node = state.nodes.find((n) => n.id === nodeId); if (!node) return;
  state.connecting = { source: nodeId, x: node.x + 222, y: node.y + 52 };
  redrawCanvas();
}

function handlePortClick(nodeId, kind, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const node = state.nodes.find((n) => n.id === nodeId); if (!node) return;
  const viewport = $('#canvas-viewport');
  if (kind === 'out') {
    state.connecting = state.connecting && state.connecting.source === nodeId ? null : { source: nodeId, x: node.x + 222, y: node.y + 52 };
    redrawCanvas();
    if (state.connecting) openConnectionMenu(e.clientX, e.clientY, nodeId);
    else closeConnectionMenu();
  } else if (kind === 'in' && state.connecting && state.connecting.source !== nodeId) {
    const exists = state.edges.some((edge) => edge.source === state.connecting.source && edge.target === nodeId);
    if (!exists) state.edges.push({ id: 'edge-' + Date.now(), source: state.connecting.source, target: nodeId });
    state.connecting = null;
    closeConnectionMenu();
    redrawCanvas();
  }
}

function finishPortConnection(e) {
  if (!state.connecting) return;
  const sourceId = state.connecting.source;
  const over = document.elementFromPoint(e.clientX, e.clientY);
  const inPort = over && over.closest && over.closest('.port.in');
  const targetId = inPort ? inPort.dataset.node : null;
  if (targetId && targetId !== sourceId) {
    const exists = state.edges.some((edge) => edge.source === sourceId && edge.target === targetId);
    if (!exists) state.edges.push({ id: 'edge-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), source: sourceId, target: targetId });
    state.connecting = null;
    closeConnectionMenu();
    redrawCanvas();
    return;
  }
  state.connecting = null;
  closeConnectionMenu();
  openConnectionMenu(e.clientX, e.clientY, sourceId);
  redrawCanvas();
}

function redrawEdgesOnly() {
  const world = $('#canvas-world'); if (!world) return;
  const svg = world.querySelector('svg.edge-svg'); if (!svg) return;
  svg.innerHTML = state.edges.map((edge) => {
    const source = state.nodes.find((n) => n.id === edge.source);
    const target = state.nodes.find((n) => n.id === edge.target);
    return source && target ? `<path class="edge-path" data-edge-id="${edge.id}" d="${edgePath(source, target)}"/>` : '';
  }).join('');
}

function studioPage() {
  const gen = state.nodes.find((n) => n.type === 'generate') || state.nodes[0];
  const add = (type, label, desc) => paletteItem(type, label, desc);
  return `<section class="workbench">
    <aside class="rail">
      <div class="side-user"><span class="avatar">${esc(userInitial())}</span><div><b>${esc(state.user.nickname || state.user.username || '')}</b><small>${money(state.user.points ?? state.user.credits)} 积分</small></div></div>
      <h3>画布入口</h3>
      <div class="quick-nav"><a href="#home">模板库</a><a href="#history">我的工程</a><a href="#history">本地资源</a><a href="#history">任务历史</a><a href="#settings">用户中心</a></div>
      <h3 style="margin-top:20px">节点库</h3>
      <div class="palette-section"><p>输入</p><div class="node-palette">${add('prompt', '文本输入', '提示词 / 群组')}${add('image', '图片输入', '上传参考图')}</div></div>
      <div class="palette-section"><p>AI 图像</p><div class="node-palette">${add('generate', 'AI 图像生成', '文生图 / 图生图')}${add('upscale', '高清放大', '4K / 8K 超分')}</div></div>
      <div class="palette-section"><p>处理与输出</p><div class="node-palette">${add('background', '图像处理', '抠图 / 变换')}${add('output', '输出预览', '查看结果')}</div></div>
      <button class="btn primary" style="width:100%;margin-top:14px" data-action="run-node" data-id="${gen.id}">运行整个工作流</button>
      <button class="btn" style="width:100%;margin-top:8px" data-action="upscale-workflow" data-preset="4k">⇪ 完整 4K 修复工作流</button>
      <div class="quick-help">右键新建节点，拖动节点圆点建立连线；提示词和图片会自动输入到连接的生成节点。</div>
    </aside>
    <div class="canvas-wrap">
      <div class="canvas-grid"></div>
      <div class="canvas-viewport" id="canvas-viewport"><div class="world" id="canvas-world"></div></div>
      <div class="canvas-floating-tools">
        <button class="mini-btn" data-action="layout-flow" data-mode="auto" title="智能整理节点">⇶ 自动整理</button>
        <button class="mini-btn" data-action="toggle-rail" title="展开/收起节点库">◧ 节点库</button>
      </div>
    </div>
  </section>`;
}

function inspectorHtml(node) {
  if (!node) return `<div class="empty">点击左侧画布中的节点开始编辑</div>`;
  const modelOptions = state.models.length ? state.models.map((m) => `<option value="${esc(m.modelId || m.id)}">${esc(m.displayName || m.id)}</option>`).join('') : '<option value="gpt-image-2">GPT Image 2</option>';
  let core = '';
  if (node.type === 'prompt') core = `<div class="field"><label>创作提示词</label><textarea class="input" data-node-input="value" data-id="${node.id}">${esc(node.value || '')}</textarea></div>`;
  if (node.type === 'image') core = `<div class="field"><label>参考图片（可多选）</label><input type="file" class="input" id="image-upload" data-id="${node.id}" accept="image/*" multiple><div id="refs-preview">${(node.refs || []).map((r) => r.preview ? `<img class="result-thumb" style="margin-top:7px" src="${r.preview}">` : '').join('')}</div></div>`;
  if (node.type === 'upscale') core = `
    <div class="field"><label>放大模式</label><select class="input" data-node-input="tool" data-id="${node.id}"><option value="restore-4k" ${node.tool === 'restore-4k' ? 'selected' : ''}>4K 修复（2x）</option><option value="upscale-8k" ${node.tool === 'upscale-8k' ? 'selected' : ''}>8K 超分（4x）</option><option value="hd-upscale" ${node.tool === 'hd-upscale' ? 'selected' : ''}>自定义高清放大</option></select></div>
    <div class="field"><label>放大提示（自动接入上游参考图）</label><textarea class="input" data-node-input="prompt" data-id="${node.id}">${esc(node.prompt || '')}</textarea></div>
    <div class="form-grid"><div class="field"><label>模型</label><select class="input" data-node-input="model" data-id="${node.id}">${modelOptions}</select></div><div class="field"><label>输出分辨率</label><select class="input" data-node-input="resolution" data-id="${node.id}"><option value="2K" ${node.resolution === '2K' ? 'selected' : ''}>2K</option><option value="4K" ${node.resolution === '4K' ? 'selected' : ''}>4K</option></select></div></div>
    <div class="form-grid"><div class="field"><label>比例</label><select class="input" data-node-input="ratio" data-id="${node.id}">${['1:1', 'auto', '16:9', '3:4'].map((r) => `<option ${node.ratio === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div><div class="field"><label>质量</label><select class="input" data-node-input="quality" data-id="${node.id}">${['high', 'auto', 'medium'].map((r) => `<option ${node.quality === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div></div>
    <button class="btn primary" style="width:100%;margin-top:18px" data-action="run-node" data-id="${node.id}">开始高清放大</button>`;
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
  let source = 'job';
  try { const d = await api('/v1/image/history?limit=24'); jobs = (d.history || []).map((j) => ({ ...j, id: j.id || j.jobId, source: 'job' })); }
  catch { try { const d = await api('/api/v1/tasks'); jobs = (d.tasks || []).map((t) => ({ id: t.id, status: t.status, prompt: t.prompt, modelId: t.model, createdAt: t.createdAt, error: t.error, source: 'task' })); source = 'task'; } catch {} }
  const rows = jobs.slice(0, 24).map((j) => {
    const thumb = j.assetId || j.asset
      ? `<div class="task-thumb-slot" data-thumb-asset="${esc(j.assetId || j.asset)}"></div>`
      : '<div class="task-thumb-slot empty"></div>';
    return `<div class="task-card"><label style="display:flex;align-items:center"><input type="checkbox" data-task-check data-task-id="${esc(j.id)}" data-task-source="${j.source}"></label>${thumb}<div style="flex:1;min-width:0"><div style="font-weight:750">${esc(j.prompt || '未命名任务')}</div><div style="font-size:12px;color:#8a94a8">${esc(j.modelId || j.model || '')} · ${new Date(j.createdAt).toLocaleString('zh-CN')}</div>${j.error ? `<div style="font-size:12px;color:#d9434a;margin-top:4px">${esc(j.error)}</div>` : ''}</div>${taskStatusLabel(j)}<button class="btn" style="margin-left:10px" data-action="delete-task" data-task-id="${esc(j.id)}" data-task-source="${j.source}">删除</button></div>`;
  });
  const items = rows.length ? rows.join('') : '<div class="empty">还没有生成记录，去创作台发起第一次生成吧。</div>';
  const toolbar = rows.length ? `<div class="toolbar" style="display:flex;gap:10px;align-items:center;margin-bottom:14px"><label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="task-select-all"> 全选</label><button class="btn" id="task-delete-selected" disabled>删除选中</button><span id="task-select-count" style="font-size:12px;color:#8a94a8">已选 0 项</span></div>` : '';
  return workspaceShell(`<div style="max-width:1080px;margin:0 auto;padding:26px 18px"><div class="panel-card"><h3 style="margin-bottom:18px">云端生成记录</h3>${toolbar}<div class="task-list">${items}</div></div></div>`, 'history');
}

function bindHistory() {
  const thumbSlots = Array.from(document.querySelectorAll('[data-thumb-asset]'));
  if (window.__taskThumbObserver) window.__taskThumbObserver.disconnect();
  if (thumbSlots.length) {
    const pending = [];
    let active = 0;
    const loadOne = async (slot) => {
      const assetId = slot.dataset.thumbAsset;
      if (!assetId || slot.dataset.thumbLoaded) return;
      slot.dataset.thumbLoaded = '1';
      active += 1;
      try {
        const res = await fetch(`${API_ORIGIN}/v1/image/assets/${encodeURIComponent(assetId)}`, { headers: { authorization: 'Bearer ' + state.token } });
        if (res.ok) {
          const url = URL.createObjectURL(await res.blob());
          slot.innerHTML = `<img src="${url}" alt="result" loading="lazy" data-action="preview" data-url="${url}">`;
        }
      } catch {}
      active -= 1;
      if (pending.length) void loadOne(pending.shift());
    };
    const enqueue = (slot) => { pending.push(slot); if (active < 3) void loadOne(pending.shift()); };
    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          enqueue(entry.target);
        }
      }, { rootMargin: '240px' });
      thumbSlots.forEach((slot) => observer.observe(slot));
      window.__taskThumbObserver = observer;
    } else {
      thumbSlots.slice(0, 6).forEach((slot) => enqueue(slot));
    }
  }
  const checks = Array.from(document.querySelectorAll('[data-task-check]'));
  const selectAll = document.querySelector('#task-select-all');
  const countBox = document.querySelector('#task-select-count');
  const deleteBtn = document.querySelector('#task-delete-selected');
  const sync = () => {
    const selected = checks.filter((el) => el.checked);
    if (countBox) countBox.textContent = `已选 ${selected.length} 项`;
    if (deleteBtn) deleteBtn.disabled = !selected.length;
    if (selectAll) selectAll.checked = selected.length === checks.length && checks.length > 0;
    if (selectAll) selectAll.indeterminate = selected.length > 0 && selected.length < checks.length;
  };
  if (selectAll) selectAll.onchange = () => { checks.forEach((el) => { el.checked = selectAll.checked; }); sync(); };
  checks.forEach((el) => { el.onchange = sync; });
  const remove = async (items) => {
    if (!items.length) return;
    const jobIds = items.filter((item) => item.source === 'job').map((item) => item.id);
    const taskIds = items.filter((item) => item.source === 'task').map((item) => item.id);
    try {
      if (jobIds.length) await api('/v1/image/history', { method: 'DELETE', body: JSON.stringify({ job_ids: jobIds }) });
      if (taskIds.length) await api('/api/v1/tasks', { method: 'DELETE', body: JSON.stringify({ ids: taskIds }) });
      toast(`已删除 ${items.length} 条任务记录`, 'ok');
      render();
    } catch (err) { toast(err.message, 'error'); }
  };
  if (deleteBtn) deleteBtn.onclick = () => remove(checks.filter((el) => el.checked).map((el) => ({ id: el.dataset.taskId, source: el.dataset.taskSource })));
  document.querySelectorAll('[data-action="delete-task"]').forEach((btn) => {
    btn.onclick = () => remove([{ id: btn.dataset.taskId, source: btn.dataset.taskSource }]);
  });
  sync();
}

function walletPage() {
  const points = state.user ? state.user.points ?? state.user.credits : 0;
  return workspaceShell(`<div style="max-width:860px;margin:0 auto;padding:26px 18px">
    <div class="panel-card"><h3 style="margin-bottom:12px">可用积分</h3><div class="stats"><div class="stat"><b>${money(points)}</b><span>积分余额</span></div><div class="stat"><b>10</b><span>每次生成消耗</span></div><div class="stat"><b>平台</b><span>服务模式</span></div><div class="stat"><b>∞</b><span>云端记录</span></div></div></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">积分兑换</h3><form id="redeem-form"><label class="field"><span>兑换码</span><input class="input" name="code" required placeholder="输入 ZHRC1 开头的积分访问码"></label><button class="btn primary" style="margin-top:14px">立即兑换</button></form><p class="error-note" id="redeem-error"></p></div>
  </div>`, 'wallet');
}

function settingsPage() {
  const profile = (state.user && state.user.profile) || {};
  const saved = Object.assign({}, profile.settings || {}, state.settings);
  const values = {
    nickname: state.user.displayName || state.user.nickname || '',
    defaultModel: saved.defaultModel === '平台图像模型' ? 'gpt-image-2' : (saved.defaultModel || 'gpt-image-2'),
    defaultRatio: saved.defaultRatio || '1:1',
    defaultResolution: saved.defaultResolution || '1K',
    defaultQuality: saved.defaultQuality || 'auto',
    outputPosition: saved.outputPosition || '原图右侧',
    autoCheckUpdates: saved.autoCheckUpdates !== false,
    rememberHistory: saved.rememberHistory !== false,
    showStatusTips: saved.showStatusTips !== false
  };
  return workspaceShell(`<div style="max-width:760px;margin:0 auto;padding:26px 18px">
    <div class="panel-card"><h3 style="margin-bottom:18px">个人资料</h3><form id="settings-form">
      <label class="field"><span>昵称</span><input class="input" name="nickname" minlength="2" value="${esc(values.nickname)}"></label>
      <div class="form-grid" style="margin-top:14px">
        <div class="field"><label>默认模型</label><select class="input" name="defaultModel">${modelOptionHtml(values.defaultModel)}</select><small style="display:block;color:#8a94a8;margin-top:5px">模型下拉来自平台 API 实际读取列表，已读取 ${state.models.length ? state.models.length + ' 个' : '内置默认'}。</small></div>
        <div class="field"><label>默认比例</label><select class="input" name="defaultRatio">${['1:1', '4:3', '3:4', '16:9', '9:16'].map((r) => `<option ${values.defaultRatio === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>默认分辨率</label><select class="input" name="defaultResolution">${['1K', '2K', '4K'].map((r) => `<option ${values.defaultResolution === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div class="field"><label>默认质量</label><select class="input" name="defaultQuality">${['auto', 'high', 'medium', 'low'].map((r) => `<option ${values.defaultQuality === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      </div>
      <div class="field"><label>生成结果默认放入</label><select class="input" name="outputPosition">${['原图右侧', '当前页中心', '新建页面'].map((r) => `<option ${values.outputPosition === r ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
      <div style="display:grid;gap:9px;margin-top:15px">
        <label style="display:flex;align-items:center;gap:9px;font-size:13px"><input type="checkbox" name="autoCheckUpdates" ${values.autoCheckUpdates ? 'checked' : ''}> 打开插件时自动检查更新</label>
        <label style="display:flex;align-items:center;gap:9px;font-size:13px"><input type="checkbox" name="rememberHistory" ${values.rememberHistory ? 'checked' : ''}> 保留 AI 生成历史记录</label>
        <label style="display:flex;align-items:center;gap:9px;font-size:13px"><input type="checkbox" name="showStatusTips" ${values.showStatusTips ? 'checked' : ''}> 显示操作提示与状态消息</label>
      </div>
      <button class="btn primary" style="width:100%;margin-top:20px">保存个人设置</button>
      <p class="error-note" id="settings-error"></p>
    </form></div>
  </div>`, 'settings');
}

async function adminPage() {
  let d = null;
  try { d = await api('/v1/admin/dashboard'); }
  catch { try { const old = await api('/api/v1/admin/overview'); d = { stats: old.metrics, users: old.users, jobs: old.tasks || [], workflows: [] }; } catch {} }
  if (!d) return workspaceShell(`<div class="empty">需要管理员权限</div>`, 'admin');
  let aiConfig = {};
  try { const cfg = await api('/v1/admin/ai-config'); aiConfig = cfg.config || {}; } catch {}
  let rechargeKeyConfigured = false;
  try { const keyInfo = await api('/v1/admin/recharge-key'); rechargeKeyConfigured = Boolean(keyInfo.configured); } catch {}
  const stats = d.stats || {};
  const userRows = (d.users || []).slice(-12).reverse().map((u) => `<tr><td>${esc(u.nickname || u.email || u.username || '')}</td><td>${esc(u.email || '')}</td><td>${u.role}</td><td>${money(u.points ?? u.credits)}</td><td>${new Date(u.createdAt).toLocaleString('zh-CN')}</td></tr>`).join('');
  const jobRows = (d.jobs || []).slice(0, 12).map((j) => `<tr><td>${esc(j.prompt || (j.requestId || '').slice(0, 12))}</td><td>${taskStatusLabel(j)}</td><td>${esc(j.model || '')}</td><td>${j.cost ?? ''}</td><td>${new Date(j.createdAt).toLocaleString('zh-CN')}</td></tr>`).join('');
  const wfRows = (d.workflows || []).map((w) => `<tr><td><b>${esc(w.name || w.code)}</b></td><td>${esc(w.code)}</td><td>v${w.version || 1}</td><td>${w.published ? '<span class="badge done">已发布</span>' : '<span class="badge">草稿</span>'}</td><td>${new Date(w.updatedAt || w.createdAt).toLocaleString('zh-CN')}</td></tr>`).join('');
  return workspaceShell(`<div style="max-width:1100px;margin:0 auto;padding:24px 18px">
    <div class="stats">${Object.entries({ 用户: stats.users, 任务: stats.jobs, 积分总量: stats.credits, 成功任务: stats.succeeded }).map(([k, v]) => `<div class="stat"><b>${v ?? 0}</b><span>${k}</span></div>`).join('')}</div>
    <div class="panel-card"><h3 style="margin-bottom:14px">生成充值码</h3><form id="admin-code-form" style="display:flex;gap:10px;flex-wrap:wrap"><input class="input" name="amount" type="number" min="1" placeholder="单码积分" style="width:130px" value="100"><input class="input" name="count" type="number" min="1" placeholder="数量" style="width:100px" value="1"><button class="btn primary">生成</button><p id="code-result" style="width:100%;font-size:12px;color:#09835e;white-space:pre-wrap"></p></form></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">积分码签名私钥（与插件互通）</h3><form id="recharge-key-form"><label class="field"><span>Ed25519 私钥（PEM）</span><textarea class="input" name="privateKey" style="min-height:110px" placeholder="-----BEGIN PRIVATE KEY-----"></textarea></label><button class="btn primary" type="submit">导入并启用插件格式积分码</button><p id="recharge-key-result" style="font-size:12px;color:#09835e">${rechargeKeyConfigured ? '当前已配置签名私钥，生成的积分码为插件通用格式。' : '当前未配置签名私钥；生成的是网站专用 ZH- 兑换码。导入私钥后，网站生成的兑换码即可在插件中使用。'}</p></form></div>
    <div class="panel-card"><h3 style="margin-bottom:14px">AI 图像服务（运行时可切换上游）</h3><form id="ai-config-form"><div class="form-grid"><label class="field"><span>上游中转地址</span><input class="input" name="baseUrl" value="${esc(aiConfig.baseUrl || 'https://tokenflux.cloud/')}" placeholder="支持 https://host、https://host/v1 或完整接口地址"></label><label class="field"><span>生成模型</span><input class="input" name="model" value="${esc(aiConfig.model || 'gpt-image-2')}" placeholder="gpt-image-2"></label></div><label class="field"><span>上游 API Key</span><input class="input" name="apiKey" type="password" placeholder="留空表示不修改当前密钥"></label><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px"><button class="btn primary" type="submit">保存并立即生效</button><button class="btn" type="button" id="ai-config-test">测试并读取模型</button></div><p id="ai-config-result" style="font-size:12px;color:#09835e"></p><p style="font-size:12px;color:#8a94a8;margin-top:8px">切换上游只需填这里并保存，无需重新部署；系统会自动兼容根地址、/v1 和完整接口地址。</p></form></div>
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
  if (state.page === 'studio') {
    APP.innerHTML = topbar('studio') + '<main class="canvas-embed"><iframe src="/canvas/?from=site" title="郅绘完整画布" allow="clipboard-read; clipboard-write"></iframe></main>';
    return;
  }
  if (state.page === 'history') { APP.innerHTML = await historyPage(); bindHistory(); return; }
  if (state.page === 'wallet') { APP.innerHTML = walletPage(); bindWallet(); return; }
  if (state.page === 'settings') { await loadModels(); APP.innerHTML = settingsPage(); bindSettings(); return; }
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
    loadModels();
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
    let list = [];
    try { const d = await api('/v1/models'); list = d.models || []; } catch {}
    if (!list.length) { const d = await api('/v1/image/models'); list = d.models || []; }
    if (!list.length) { try { list = JSON.parse(localStorage.getItem('zh_models') || '[]'); } catch {} }
    state.models = list;
    try { localStorage.setItem('zh_models', JSON.stringify(list)); } catch {}
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
  const world = $('#canvas-world');
  if (!viewport) return;
  let panning = null;
  const wrap = viewport.closest('.canvas-wrap');
  if (wrap) wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const node = e.target.closest('.node');
    openContextMenu(e.clientX, e.clientY, node ? node.dataset.node : null);
  }, true);
  viewport.addEventListener('dblclick', (e) => {
    const node = e.target.closest('.node'); if (!node) return;
    state.selected = node.dataset.node; redrawCanvas();
    const inspector = $('#inspector'); if (inspector) { inspector.innerHTML = inspectorHtml(state.nodes.find((n) => n.id === state.selected)); bindInspectorEvents(); }
    const first = inspector && inspector.querySelector('textarea, input:not([type=file])'); if (first) setTimeout(() => first.focus(), 30);
  });
  viewport.addEventListener('click', (e) => {
    const port = e.target.closest('.port');
    if (port) return;
    if (state.connecting) { state.connecting = null; closeConnectionMenu(); redrawCanvas(); }
  });
  viewport.addEventListener('pointerdown', (e) => {
    const target = e.target.closest('.node');
    if (target) return;
    panning = { x: e.clientX - state.camera.x, y: e.clientY - state.camera.y };
    viewport.classList.add('panning');
  });
  if (world) {
    world.addEventListener('pointerdown', (e) => {
      const nodeEl = e.target.closest('.node');
      if (!nodeEl || e.button !== 0) return;
      if (e.target.closest('button,input,textarea,select,.port')) return;
      startNodeDrag(e, nodeEl.dataset.node, nodeEl);
    }, true);
    world.addEventListener('mousedown', (e) => {
      const nodeEl = e.target.closest('.node');
      if (!nodeEl || e.button !== 0) return;
      if (e.target.closest('button,input,textarea,select,.port')) return;
      startNodeDrag(e, nodeEl.dataset.node, nodeEl);
    }, true);
  }
  window.addEventListener('pointermove', (e) => {
    if (panning) { state.camera.x = e.clientX - panning.x; state.camera.y = e.clientY - panning.y; redrawCanvas(); }
    if (state.connecting) {
      const rect = viewport.getBoundingClientRect();
      state.connecting.x = (e.clientX - rect.left - state.camera.x) / state.camera.zoom;
      state.connecting.y = (e.clientY - rect.top - state.camera.y) / state.camera.zoom;
      redrawCanvas();
    }
  });
  window.addEventListener('pointerup', (e) => { if (state.connecting) finishPortConnection(e); panning = null; viewport && viewport.classList.remove('panning'); if (state.drag) stopDrag(); });
  window.addEventListener('mouseup', (e) => { if (state.connecting) finishPortConnection(e); });
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.08 : 0.93;
    state.camera.zoom = Math.max(.45, Math.min(1.8, state.camera.zoom * factor));
    redrawCanvas();
  }, { passive: false });
}

function startNodeDrag(e, id, nodeEl) {
  const node = state.nodes.find((n) => n.id === id); if (!node) return;
  if (state.drag) return;
  e.preventDefault();
  e.stopPropagation();
  state.selected = id;
  document.querySelectorAll('.node.selected').forEach((el) => el.classList.remove('selected'));
  if (nodeEl) { nodeEl.classList.add('selected', 'dragging'); try { nodeEl.setPointerCapture(e.pointerId); } catch {} }
  const inspector = $('#inspector'); if (inspector) { inspector.innerHTML = inspectorHtml(node); bindInspectorEvents(); }
  state.drag = { id, dx: e.clientX - node.x, dy: e.clientY - node.y };
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('mousemove', moveDrag);
  window.addEventListener('pointerup', stopDrag, { once: true });
  window.addEventListener('mouseup', stopDrag, { once: true });
}
function moveDrag(e) {
  if (!state.drag) return;
  const node = state.nodes.find((n) => n.id === state.drag.id); if (!node) return;
  node.x = Math.max(0, Math.min(1550, e.clientX - state.drag.dx));
  node.y = Math.max(0, Math.min(760, e.clientY - state.drag.dy));
  const nodeEl = document.querySelector(`.node[data-node="${state.drag.id}"]`);
  if (nodeEl) { nodeEl.style.left = node.x + 'px'; nodeEl.style.top = node.y + 'px'; }
  redrawEdgesOnly();
}
function stopDrag() {
  if (state.drag) {
    const nodeEl = document.querySelector(`.node[data-node="${state.drag.id}"]`);
    if (nodeEl) nodeEl.classList.remove('dragging');
  }
  state.drag = null;
  window.removeEventListener('pointermove', moveDrag);
  window.removeEventListener('mousemove', moveDrag);
  window.removeEventListener('pointerup', stopDrag);
  window.removeEventListener('mouseup', stopDrag);
}

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
  redrawCanvas();
}

function addNode(type, x, y) {
  const base = { x: x !== undefined ? x : 300 + Math.random() * 150, y: y !== undefined ? y : 130 + Math.random() * 240 };
  const node = Object.assign(base, {
    id: 'n-' + type + '-' + Date.now(), type,
    title: type === 'prompt' ? '提示词节点' : type === 'image' ? '参考图节点' : type === 'generate' ? 'AI 生成节点' : type === 'upscale' ? '高清放大节点' : type === 'background' ? '图像处理节点' : '输出预览',
    value: '', refs: [], prompt: '', model: 'gpt-image-2', ratio: '1:1', resolution: '1K', quality: 'auto', tool: type === 'upscale' ? 'restore-4k' : '', status: 'idle', result: null
  });
  state.nodes.push(node); state.selected = node.id; redrawCanvas();
  const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(node); bindInspectorEvents();
}

function duplicateNode(id) {
  const source = state.nodes.find((n) => n.id === id); if (!source) return;
  const copy = JSON.parse(JSON.stringify(source));
  copy.id = source.type + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  copy.x = Math.min(1500, source.x + 34); copy.y = Math.min(820, source.y + 34);
  copy.status = copy.type === 'generate' ? 'idle' : copy.status;
  copy.result = null;
  if (copy.type === 'image' && copy.refs) copy.refs = copy.refs.map((r) => ({ ...r }));
  state.nodes.push(copy); state.selected = copy.id;
  redrawCanvas();
  const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(copy); bindInspectorEvents();
}

function createUpscaleWorkflow(preset) {
  preset = preset === '8k' ? '8k' : '4k';
  const tool = preset === '8k' ? 'upscale-8k' : 'restore-4k';
  let image = state.nodes.find((n) => n.type === 'image');
  if (!image) { addNode('image', 330, 560); image = state.nodes[state.nodes.length - 1]; }
  const up = {
    id: 'n-upscale-' + Date.now(), type: 'upscale', title: preset === '8k' ? '8K 超分节点' : '4K 修复节点',
    x: 800, y: 330, model: 'gpt-image-2', ratio: '1:1', resolution: '4K', quality: 'high', status: 'idle', result: null,
    tool,
    prompt: preset === '8k' ? '进行8K级超分辨率处理，保留真实细节，不改变主体和构图' : '高质量修复图片，恢复细节、纹理和清晰度，保持主体与构图不变'
  };
  state.nodes.push(up);
  const out = { id: 'n-output-' + Date.now(), type: 'output', title: '高清输出', x: 1430, y: 520, result: null };
  state.nodes.push(out);
  state.edges = state.edges.filter((e) => e.source !== up.id && e.target !== up.id);
  state.edges.push({ id: 'edge-img-up-' + Date.now(), source: image.id, target: up.id });
  state.edges.push({ id: 'edge-up-out-' + Date.now(), source: up.id, target: out.id });
  state.selected = up.id;
  redrawCanvas();
  const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(up); bindInspectorEvents();
  toast('已配置完整高清放大工作流：上传参考图后运行该节点', 'ok');
}

function closeContextMenu() { const menu = $('#node-context-menu'); if (menu) menu.remove(); }
function closeConnectionMenu() { const menu = $('#connection-menu'); if (menu) menu.remove(); }

function openConnectionMenu(x, y, sourceId) {
  closeConnectionMenu();
  const source = state.nodes.find((n) => n.id === sourceId);
  if (!source) return;
  const candidates = state.nodes.filter((target) => {
    if (target.id === sourceId) return false;
    if (!['generate', 'upscale', 'background', 'output'].includes(target.type)) return false;
    return !state.edges.some((edge) => edge.source === sourceId && edge.target === target.id);
  });
  const menu = document.createElement('div');
  menu.id = 'connection-menu';
  menu.style.cssText = 'position:fixed;z-index:180;min-width:220px;max-height:320px;overflow:auto;background:#fff;border:1px solid #dfe6f2;border-radius:14px;box-shadow:0 18px 54px rgba(25,35,70,.22);padding:7px;font-size:13px';
  const head = document.createElement('div');
  head.textContent = '连接到 ' + (source.title || source.type);
  head.style.cssText = 'font-size:11px;font-weight:800;letter-spacing:.08em;color:#9aa6bf;padding:6px 9px 9px';
  menu.appendChild(head);
  if (!candidates.length) {
    const empty = document.createElement('div');
    empty.textContent = '没有可连接的目标节点';
    empty.style.cssText = 'padding:8px 9px;color:#8a94a8';
    menu.appendChild(empty);
  } else {
    candidates.forEach((target) => {
      const b = document.createElement('button');
      b.style.cssText = 'display:flex;align-items:center;gap:9px;width:100%;text-align:left;padding:9px;border:0;border-radius:10px;background:transparent;font-weight:650;color:#3d4865';
      b.innerHTML = `<span class="node-icon ${iconBg[target.type]}" style="width:24px;height:24px;border-radius:8px;font-size:11px">${iconMap[target.type]}</span><span>${esc(target.title)}<small style="display:block;color:#98a2b8;font-weight:500;font-size:11px">${target.type === 'generate' ? 'AI 图像生成' : target.type === 'upscale' ? '高清放大' : target.type === 'output' ? '结果输出' : '图像处理'}</small></span>`;
      b.addEventListener('mouseenter', () => { b.style.background = '#eef1ff'; });
      b.addEventListener('mouseleave', () => { b.style.background = ''; });
      b.addEventListener('click', () => {
        state.edges.push({ id: 'edge-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5), source: sourceId, target: target.id });
        state.connecting = null;
        closeConnectionMenu();
        redrawCanvas();
        toast('已自动连接：' + source.title + ' → ' + target.title, 'ok');
      });
      menu.appendChild(b);
    });
  }
  menu.style.left = Math.min(x + 12, window.innerWidth - 240) + 'px';
  menu.style.top = Math.min(y + 12, window.innerHeight - menu.offsetHeight - 12) + 'px';
  document.body.appendChild(menu);
}

function openContextMenu(x, y, nodeId) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.id = 'node-context-menu';
  menu.style.cssText = 'position:fixed;z-index:150;min-width:190px;background:#fff;border:1px solid #dfe6f2;border-radius:14px;box-shadow:0 18px 50px rgba(25,35,70,.2);padding:6px;font-size:13px';
  const button = (label, action, extra) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.menuAction = action;
    if (extra) b.dataset.menuId = extra;
    b.style.cssText = 'display:block;width:100%;text-align:left;padding:9px 11px;border:0;border-radius:9px;background:transparent;font-weight:600;color:#3d4865';
    b.addEventListener('mouseenter', () => { b.style.background = '#eef1ff'; b.style.color = '#4f5dfa'; });
    b.addEventListener('mouseleave', () => { b.style.background = ''; b.style.color = '#3d4865'; });
    return b;
  };
  if (nodeId) {
    const node = state.nodes.find((n) => n.id === nodeId);
    if (node) {
      menu.appendChild(button('打开节点设置', 'select-node', nodeId));
      if (node.type === 'generate') menu.appendChild(button('运行此节点', 'run-node', nodeId));
      if (node.type === 'upscale') menu.appendChild(button('高清放大此节点', 'run-node', nodeId));
      menu.appendChild(button('复制节点', 'duplicate-node', nodeId));
      menu.appendChild(document.createElement('hr'));
      menu.appendChild(button('在下方新建 AI 生成节点', 'add-generate'));
      menu.appendChild(button('在下方新建提示词节点', 'add-prompt'));
      menu.appendChild(button('在下方新建高清放大节点', 'add-upscale'));
      menu.appendChild(button('新建 4K 修复工作流', 'upscale-workflow', '4k'));
      menu.appendChild(button('新建 8K 超分工作流', 'upscale-workflow', '8k'));
      menu.appendChild(document.createElement('hr'));
      const del = button('删除节点', 'delete-node', nodeId); del.style.color = '#d9434a'; menu.appendChild(del);
    }
  } else {
    menu.appendChild(button('新建提示词节点', 'add-prompt'));
    menu.appendChild(button('上传参考图节点', 'add-image'));
    menu.appendChild(button('新建 AI 生成节点', 'add-generate'));
    menu.appendChild(button('新建高清放大节点', 'add-upscale'));
    menu.appendChild(button('新建输出预览', 'add-output'));
    menu.appendChild(button('新建完整 4K 修复工作流', 'upscale-workflow', '4k'));
    menu.appendChild(button('新建完整 8K 超分工作流', 'upscale-workflow', '8k'));
    menu.appendChild(document.createElement('hr'));
    const reset = button('恢复默认工作流布局', 'reset-flow'); menu.appendChild(reset);
  }
  menu.style.left = Math.min(x, window.innerWidth - 210) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - menu.offsetHeight - 12) + 'px';
  document.body.appendChild(menu);
  menu.addEventListener('click', (e) => {
    const el = e.target.closest('[data-menu-action]'); if (!el) return;
    const action = el.dataset.menuAction;
    const rect = $('#canvas-viewport');
    const worldPos = rect ? worldFromScreen(rect, x, y) : { x: 300, y: 200 };
    if (action === 'select-node') { state.selected = el.dataset.menuId; const node = state.nodes.find((n) => n.id === state.selected); redrawCanvas(); const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(node); bindInspectorEvents(); }
    if (action === 'run-node') runNode(el.dataset.menuId);
    if (action === 'duplicate-node') duplicateNode(el.dataset.menuId);
    if (action === 'delete-node') deleteNode(el.dataset.menuId);
    if (action === 'add-prompt') addNode('prompt', worldPos.x, worldPos.y + 24);
    if (action === 'add-image') addNode('image', worldPos.x, worldPos.y + 24);
    if (action === 'add-generate') addNode('generate', worldPos.x, worldPos.y + 24);
    if (action === 'add-upscale') addNode('upscale', worldPos.x, worldPos.y + 24);
    if (action === 'add-output') addNode('output', worldPos.x, worldPos.y + 24);
    if (action === 'upscale-workflow') createUpscaleWorkflow(el.dataset.menuId || '4k');
    if (action === 'reset-flow') resetFlow();
    closeContextMenu();
  });
}

function worldFromScreen(rect, x, y) {
  return { x: Math.max(20, (x - rect.left - state.camera.x) / state.camera.zoom - 80), y: Math.max(20, (y - rect.top - state.camera.y) / state.camera.zoom) };
}

function resetFlow() {
  state.nodes = [
    { id: 'n-prompt', type: 'prompt', title: '提示词节点', x: 90, y: 300, value: '高奢护肤品主视觉，通透冰蓝色瓶身，柔和晨光，电商广告' },
    { id: 'n-image', type: 'image', title: '参考图节点', x: 370, y: 590, refs: [] },
    { id: 'n-generate', type: 'generate', title: 'AI 生成节点', x: 760, y: 330, model: 'gpt-image-2', ratio: '1:1', resolution: '1K', quality: 'auto', status: 'idle', result: null },
    { id: 'n-output', type: 'output', title: '输出预览', x: 1200, y: 470, result: null }
  ];
  state.edges = [
    { id: 'e1', source: 'n-prompt', target: 'n-generate' },
    { id: 'e2', source: 'n-image', target: 'n-generate' },
    { id: 'e3', source: 'n-generate', target: 'n-output' }
  ];
  state.selected = 'n-generate'; state.camera = { x: 20, y: 10, zoom: 1 };
  redrawCanvas(); const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(state.nodes.find((n) => n.id === state.selected)); bindInspectorEvents();
}

function layoutFlow(mode) {
  const inputs = state.nodes.filter((n) => ['prompt', 'image'].includes(n.type));
  const processors = state.nodes.filter((n) => ['generate', 'upscale', 'background'].includes(n.type));
  const outputs = state.nodes.filter((n) => n.type === 'output');
  const groups = [inputs, processors, outputs];
  let cursorX = 60;
  groups.forEach((group) => {
    group.forEach((node, index) => {
      node.x = cursorX;
      node.y = 120 + index * 190;
    });
    cursorX += 360;
  });
  state.camera = { x: 20, y: 10, zoom: state.camera.zoom };
  redrawCanvas();
  toast('节点布局已自动整理', 'ok');
}

async function runNode(nodeId) {
  const gen = state.nodes.find((n) => n.id === nodeId && ['generate', 'upscale', 'background'].includes(n.type)) || state.nodes.find((n) => ['generate', 'upscale'].includes(n.type));
  if (!gen) { toast('请先选择一个可运行的 AI 节点', 'error'); return; }
  if (!state.token || !state.user) { state.page = 'auth'; location.hash = 'auth'; render(); toast('登录后才能调用云端生成'); return; }
  const upstreamPrompts = state.edges.filter((edge) => edge.target === gen.id).map((edge) => state.nodes.find((n) => n.id === edge.source)).filter((n) => n && n.type === 'prompt');
  const upstreamImages = state.edges.filter((edge) => edge.target === gen.id).map((edge) => state.nodes.find((n) => n.id === edge.source)).filter((n) => n && n.type === 'image');
  const prompts = (upstreamPrompts.length ? upstreamPrompts : state.nodes.filter((n) => n.type === 'prompt')).map((n) => n.value).filter(Boolean);
  if (gen.prompt && gen.prompt.trim()) prompts.push(gen.prompt);
  const prompt = [...new Set(prompts)].join('\n');
  const sourceImages = upstreamImages.length ? upstreamImages : state.nodes.filter((n) => n.type === 'image');
  const refs = sourceImages.flatMap((n) => (n.refs || []).map((r) => r.id)).filter((id) => id && !id.startsWith('local-'));
  if (gen.type === 'upscale' && !refs.length) { toast('高清放大前请先在上游参考图节点上传图片', 'error'); return; }
  if (!prompt.trim() && gen.type !== 'upscale') { toast('请先在提示词节点输入内容', 'error'); return; }
  const outgoingEdges = state.edges.filter((edge) => edge.source === gen.id);
  const output = outgoingEdges.map((edge) => state.nodes.find((n) => n.id === edge.target)).find((n) => n && n.type === 'output') || state.nodes.find((n) => n.type === 'output');
  gen.status = 'running'; gen.error = '';
  if (output) { output.status = 'running'; output.result = null; }
  redrawCanvas();
  try {
    const payload = { request_id: 'web-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), model: gen.model || 'gpt-image-2', prompt: prompt || gen.prompt || '高清放大，保持主体细节不变', reference_ids: refs, aspect_ratio: gen.ratio === 'auto' ? '1:1' : gen.ratio || '1:1', resolution: gen.resolution || (gen.type === 'upscale' ? '4K' : '1K'), quality: gen.quality || 'auto', quantity: 1 };
    const d = await api('/v1/image/generations', { method: 'POST', body: JSON.stringify(payload) });
    if (d.assetId) {
      const blob = await fetch(`${API_ORIGIN}/v1/image/assets/${encodeURIComponent(d.assetId)}`, { headers: { authorization: 'Bearer ' + state.token } }).then((r) => r.blob());
      const preview = URL.createObjectURL(blob);
      gen.result = { preview, assetId: d.assetId, url: preview }; gen.status = 'done';
      if (output) { output.result = { preview, assetId: d.assetId }; output.status = 'done'; }
      refreshAccount(); toast('生成完成，结果已写入输出节点', 'ok');
    } else if (d.status === 'failed') {
      if (gen.type === 'upscale' && sourceImages.length) {
        await localCanvasUpscale(gen, sourceImages, output);
      } else {
        gen.status = 'failed'; gen.error = d.error || '生成失败'; if (output) output.status = 'failed';
        toast('生成失败：' + (d.error || '服务器暂未配置图像上游'), 'error');
      }
    } else {
      gen.status = 'running'; toast('任务仍在生成，可稍后查看任务历史');
    }
  } catch (err) {
    if (gen.type === 'upscale' && sourceImages.length) { await localCanvasUpscale(gen, sourceImages, output); }
    else { gen.status = 'failed'; gen.error = err.message; if (output) output.status = 'failed'; toast(err.message, 'error'); }
  }
  redrawCanvas();
  const inspector = $('#inspector'); if (inspector) inspector.innerHTML = inspectorHtml(gen); bindInspectorEvents();
}

async function localCanvasUpscale(gen, sourceImages, output) {
  try {
    const source = sourceImages.find((n) => n.refs && n.refs.length);
    const ref = source && source.refs[0];
    if (!ref || !ref.preview) throw new Error('没有可放大的图片');
    const blob = await fetch(ref.preview).then((r) => r.blob());
    const bitmap = await createImageBitmap(blob);
    const factor = gen.tool === 'upscale-8k' ? 4 : 2;
    const longEdge = Math.max(bitmap.width, bitmap.height);
    const target = Math.min(4096, longEdge * factor);
    const scale = target / longEdge;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(2, Math.round(bitmap.width * scale));
    canvas.height = Math.max(2, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const preview = canvas.toDataURL('image/png');
    gen.result = { preview, local: true, width: canvas.width, height: canvas.height }; gen.status = 'done'; gen.error = '';
    if (output) { output.result = { preview, local: true }; output.status = 'done'; }
    toast('已在本机完成高清放大（' + canvas.width + '×' + canvas.height + '）', 'ok');
  } catch (e) {
    gen.status = 'failed'; gen.error = String(e.message || e); if (output) output.status = 'failed';
    toast('高清放大失败：' + e.message, 'error');
  }
}

async function deleteNode(id) {
  if (state.nodes.length <= 2) { toast('画布至少保留一个工作节点'); return; }
  state.nodes = state.nodes.filter((n) => n.id !== id);
  state.edges = state.edges.filter((e) => e.source !== id && e.target !== id);
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

function bindSettings() {
  const form = $('#settings-form'); if (!form) return;
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const profile = Object.assign({}, (state.user && state.user.profile) || {});
    profile.settings = {
      defaultModel: f.defaultModel, defaultRatio: f.defaultRatio, defaultResolution: f.defaultResolution,
      defaultQuality: f.defaultQuality, outputPosition: f.outputPosition,
      autoCheckUpdates: f.autoCheckUpdates === 'on', rememberHistory: f.rememberHistory === 'on', showStatusTips: f.showStatusTips === 'on'
    };
    try {
      const d = await api('/v1/account', { method: 'PUT', body: JSON.stringify({ nickname: f.nickname, profile }) });
      state.user = d.user; localStorage.setItem('zh_user', JSON.stringify(d.user));
      state.settings = profile.settings; localStorage.setItem('zh_settings', JSON.stringify(profile.settings));
      toast('个人设置已保存', 'ok'); render();
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
  const aiTest = $('#ai-config-test'); if (aiTest && aiForm) aiTest.onclick = async () => {
    const f = Object.fromEntries(new FormData(aiForm));
    const box = $('#ai-config-result');
    if (box) box.textContent = '正在测试上游连接…';
    try {
      const d = await api('/v1/ai/test-connection', { method: 'POST', body: JSON.stringify({ baseUrl: f.baseUrl, apiKey: f.apiKey, model: f.model, mode: 'models' }) });
      const ids = (d.models || []).slice(0, 12).map((m) => m.modelId || m.id).join('、');
      if (box) box.textContent = `${d.message || '连接成功'}${ids ? '：' + ids : ''}`;
      toast('上游连接正常', 'ok');
    } catch (err) { if (box) box.textContent = '测试失败：' + err.message; toast(err.message, 'error'); }
  };
  const keyForm = $('#recharge-key-form'); if (keyForm) keyForm.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(keyForm));
    const box = $('#recharge-key-result');
    try {
      const d = await api('/v1/admin/recharge-key', { method: 'POST', body: JSON.stringify({ privateKey: f.privateKey }) });
      if (box) box.textContent = d.configured ? '签名私钥已导入，网站现在可以生成插件通用积分码。' : '导入失败。';
      toast('积分码签名私钥已保存', 'ok');
    } catch (err) { if (box) box.textContent = '导入失败：' + err.message; toast(err.message, 'error'); }
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
    if (actionEl && actionEl.classList.contains('node') && e.target.closest('input,textarea,select')) return;
    if (!actionEl) return;
    if (actionEl) {
      const action = actionEl.dataset.action;
      if (action === 'go-auth') { state.page = 'auth'; state.mode = 'login'; location.hash = 'auth'; render(); }
      if (action === 'go-studio') { if (!state.user) { state.page = 'auth'; state.mode = 'login'; location.hash = 'auth'; } else { state.page = 'studio'; location.hash = 'studio'; } render(); }
      if (action === 'switch-auth') { state.mode = state.mode === 'login' ? 'register' : 'login'; render(); }
      if (action === 'logout') logout();
      if (action === 'open-settings') { state.page = 'settings'; location.hash = 'settings'; render(); }
      if (action === 'add-node') addNode(actionEl.dataset.type);
      if (action === 'upscale-workflow') createUpscaleWorkflow(actionEl.dataset.preset || actionEl.dataset.menuId || '4k');
      if (action === 'layout-flow') layoutFlow(actionEl.dataset.mode || 'auto');
      if (action === 'toggle-rail') { const wb = document.querySelector('.workbench'); if (wb) wb.classList.toggle('rail-hidden'); }
      if (action === 'toggle-inspector') { const insp = $('#inspector'); if (insp) insp.classList.toggle('open'); }
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
document.addEventListener('click', closeContextMenu);
document.addEventListener('click', (e) => {
  if (!e.target.closest('#connection-menu, .port')) closeConnectionMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeContextMenu(); closeConnectionMenu(); } });
render();
