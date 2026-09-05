import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const port = 18787;
const origin = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(path.join(tmpdir(), 'zhihui-test-'));
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ZH_DATA_DIR: dataDir, ZH_ADMIN_KEY: 'test-admin-password' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

async function request(route, options = {}) {
  const response = await fetch(origin + route, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  return { status: response.status, body: await response.json() };
}

for (let attempt = 0; attempt < 40; attempt += 1) {
  try { if ((await request('/api/health')).status === 200) break; } catch {}
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test.after(async () => { server.kill(); await rm(dataDir, { recursive: true, force: true }); });

test('health and website are served', async () => {
  assert.equal((await request('/api/health')).body.ok, true);
  const page = await fetch(origin + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /郅绘/);
});

test('auth, task, plugin aliases, and redemption flow', async () => {
  const username = `tester-${Date.now()}`;
  const registered = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ nickname: username, password: 'password123' }) });
  assert.equal(registered.status, 201);
  const auth = { authorization: `Bearer ${registered.body.token}` };
  const task = await request('/api/v1/studio/generate', { method: 'POST', headers: auth, body: JSON.stringify({ prompt: '绿色饮料广告图' }) });
  assert.equal(task.status, 201);
  assert.equal(task.body.points, 90);
  const models = await request('/api/v1/studio/models', { headers: auth });
  assert.equal(models.body.models[0].id, 'gpt-image-2');

  const adminLogin = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ nickname: 'admin', password: 'test-admin-password' }) });
  const created = await request('/api/v1/admin/redemption-codes', { method: 'POST', headers: { authorization: `Bearer ${adminLogin.body.token}` }, body: JSON.stringify({ points: 500 }) });
  const redeemed = await request('/api/v1/points/redeem', { method: 'POST', headers: auth, body: JSON.stringify({ code: created.body.codes[0].code }) });
  assert.equal(redeemed.body.points, 590);
});
