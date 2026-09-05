import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, 'web');
const DATA_DIR = process.env.ZH_DATA_DIR ? path.resolve(process.env.ZH_DATA_DIR) : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const ADMIN_KEY = process.env.ZH_ADMIN_KEY || 'dev-admin-2026';
if (process.env.NODE_ENV === 'production' && !process.env.ZH_ADMIN_KEY) {
  throw new Error('Production requires ZH_ADMIN_KEY.');
}

const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const passwordHash = (value, salt) => crypto.scryptSync(value, salt, 64).toString('hex');
const defaultStore = () => ({ users: [], tasks: [], redemptionCodes: [], redemptions: [], ledger: [], sessions: {} });
let store = defaultStore();
async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  if (existsSync(DATA_FILE)) { try { store = JSON.parse(await readFile(DATA_FILE, 'utf8')); } catch { store = defaultStore(); } }
  store.tasks ||= []; store.redemptionCodes ||= []; store.redemptions ||= []; store.ledger ||= []; store.sessions ||= {};
  if (!store.users.length) {
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    store.users.push({ id: uid(), nickname: 'admin', passwordSalt, passwordHash: passwordHash(ADMIN_KEY, passwordSalt), points: 1000, role: 'admin', createdAt: now() });
  }
  await persist();
}
const persist = () => writeFile(DATA_FILE, JSON.stringify(store, null, 2));
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(body)); };
const parseBody = async (req) => { let data = ''; for await (const chunk of req) data += chunk; try { return data ? JSON.parse(data) : {}; } catch { return {}; } };
const tokenUser = (req) => { const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); const id = store.sessions[hash(token)]; return store.users.find((u) => u.id === id); };
const safeUser = (u) => u && ({ id: u.id, nickname: u.nickname, role: u.role, points: u.points, createdAt: u.createdAt });
const route = (req) => { const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); return { path: url.pathname, query: url.searchParams }; };

async function api(req, res, pathName) {
  if (req.method === 'OPTIONS') return send(res, 204, null);
  if (req.method === 'GET' && pathName === '/api/health') return send(res, 200, { ok: true, service: 'zhihui-web', time: now() });
  const body = await parseBody(req);
  if (req.method === 'POST' && pathName === '/api/v1/auth/register') {
    const nickname = String(body.nickname || '').trim(); const password = String(body.password || '');
    if (nickname.length < 2 || password.length < 6) return send(res, 400, { error: '昵称至少 2 个字符，密码至少 6 位。' });
    if (store.users.some((u) => u.nickname === nickname)) return send(res, 409, { error: '该账号已存在。' });
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const user = { id: uid(), nickname, passwordSalt, passwordHash: passwordHash(password, passwordSalt), points: 100, role: 'user', createdAt: now() }; store.users.push(user);
    const token = uid(); store.sessions[hash(token)] = user.id; await persist(); return send(res, 201, { token, user: safeUser(user) });
  }
  if (req.method === 'POST' && pathName === '/api/v1/auth/login') {
    const user = store.users.find((u) => u.nickname === String(body.nickname || '').trim());
    if (!user || user.passwordHash !== passwordHash(String(body.password || ''), user.passwordSalt)) return send(res, 401, { error: '账号或密码错误。' });
    const token = uid(); store.sessions[hash(token)] = user.id; await persist(); return send(res, 200, { token, user: safeUser(user) });
  }
  const user = tokenUser(req);
  if (pathName === '/api/v1/auth/me' && req.method === 'GET') return user ? send(res, 200, { user: safeUser(user) }) : send(res, 401, { error: '未登录。' });
  if (!user) return send(res, 401, { error: '请先登录。' });
  if (req.method === 'GET' && pathName === '/api/v1/tasks') return send(res, 200, { tasks: store.tasks.filter((t) => t.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
  if (req.method === 'POST' && (pathName === '/api/v1/tasks' || pathName === '/api/v1/studio/generate' || pathName === '/api/v1/studio/tasks')) {
    const cost = 10; const prompt = String(body.prompt || '').trim(); if (!prompt) return send(res,400,{error:'请输入创作描述。'}); if (user.points < cost) return send(res,402,{error:'积分不足。'});
    user.points -= cost; const task = { id: uid(), userId: user.id, prompt, model: body.model || 'gpt-image-2', status: 'queued', cost, createdAt: now() }; store.tasks.push(task); store.ledger.push({id:uid(),userId:user.id,type:'task',points:-cost,taskId:task.id,createdAt:now()});
    setTimeout(async () => { task.status = 'completed'; task.completedAt = now(); task.result = { message: '任务已完成。配置图像模型密钥后可替换为真实生成结果。' }; await persist(); }, 450); await persist(); return send(res, 201, { task, points: user.points });
  }
  if (req.method === 'GET' && pathName === '/api/v1/studio/tasks') return send(res, 200, { tasks: store.tasks.filter((t) => t.userId === user.id) });
  if (req.method === 'GET' && pathName === '/api/v1/studio/models') return send(res, 200, { models: [{ id:'gpt-image-2', name:'GPT Image 2', capabilities:['generate','edit'] }] });
  if (req.method === 'GET' && pathName === '/api/v1/studio/profile') return send(res, 200, { user: safeUser(user) });
  const studioTask = pathName.match(/^\/api\/v1\/studio\/tasks\/([^/]+)$/);
  if (req.method === 'GET' && studioTask) { const task = store.tasks.find((t)=>t.id===studioTask[1] && t.userId===user.id); return task ? send(res,200,{task}) : send(res,404,{error:'任务不存在。'}); }
  if (req.method === 'POST' && pathName === '/api/v1/points/redeem') { const code = String(body.code || '').trim().toUpperCase(); const available = store.redemptionCodes.find((r)=>r.code===code && !r.usedAt); if (!available) return send(res,400,{error:'兑换码无效或已使用。'}); available.usedAt=now(); available.userId=user.id; store.redemptions.push({ id:uid(), code, userId:user.id, points:available.points, createdAt:now() }); store.ledger.push({id:uid(),userId:user.id,type:'redeem',points:available.points,createdAt:now()}); user.points += available.points; await persist(); return send(res,200,{points:user.points, message:`已兑换 ${available.points} 积分。`}); }
  const isAdmin = user.role === 'admin' || req.headers['x-admin-key'] === ADMIN_KEY;
  if (req.method === 'GET' && pathName === '/api/v1/admin/overview') { if (!isAdmin) return send(res,403,{error:'无权限。'}); return send(res,200,{users:store.users.map(safeUser), tasks:store.tasks, redemptions:store.redemptions, metrics:{users:store.users.length,tasks:store.tasks.length,points:store.users.reduce((n,u)=>n+u.points,0)}}); }
  if (req.method === 'POST' && pathName === '/api/v1/admin/redemption-codes') { if (!isAdmin) return send(res,403,{error:'无权限。'}); const points=Math.max(1,Math.min(100000,Number(body.points)||100)); const count=Math.max(1,Math.min(100,Number(body.count)||1)); const codes=Array.from({length:count},()=>({id:uid(),code:`ZH-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,points,createdAt:now()})); store.redemptionCodes.push(...codes); await persist(); return send(res,201,{codes}); }
  if (/^\/api\/v1\/studio\//.test(pathName)) return send(res, 404, { error:'不支持的插件接口。', compatibility:'zhihui-v1' });
  return send(res, 404, { error:'接口不存在。' });
}

const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg' };
const server = http.createServer(async (req,res) => { res.setHeader('access-control-allow-origin', process.env.CORS_ORIGIN || '*'); res.setHeader('access-control-allow-headers','authorization, content-type, x-admin-key'); res.setHeader('access-control-allow-methods','GET, POST, OPTIONS'); res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); const { path: p } = route(req); if (p.startsWith('/api/')) return api(req,res,p); let file = path.join(PUBLIC_DIR, p === '/' ? 'index.html' : p); if (!file.startsWith(PUBLIC_DIR)) return send(res,403,{error:'forbidden'}); if (!existsSync(file)) file = path.join(PUBLIC_DIR,'index.html'); try { res.writeHead(200, {'content-type': mime[path.extname(file)] || mime['.html']}); createReadStream(file).pipe(res); } catch { send(res,500,{error:'server error'}); } });
await load(); server.listen(PORT, HOST, () => console.log(`Zhihui web listening on http://${HOST}:${PORT}`));
