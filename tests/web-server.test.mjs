import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

const port = 18787;
const origin = `http://127.0.0.1:${port}`;
const dataDir = await mkdtemp(path.join(tmpdir(), 'zhihui-test-'));
const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    ZH_DATA_DIR: dataDir,
    ZH_ADMIN_KEY: 'test-admin-password',
    ZH_RECHARGE_SHORT_SECRET: 'TEST-PRIMARY-SECRET-2026',
    ZH_RECHARGE_SHORT_SECRET_LEGACY: 'TEST-LEGACY-SECRET-2026',
  },
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
  const studioConfig = await request('/api/v1/studio/models');
  assert.equal(studioConfig.status, 401);
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
  const taskById = await request(`/api/v1/studio/tasks/${task.body.task.id}`, { headers: auth });
  assert.equal(taskById.body.task.id, task.body.task.id);

  const adminLogin = await request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ nickname: 'admin', password: 'test-admin-password' }) });
  const created = await request('/api/v1/admin/redemption-codes', { method: 'POST', headers: { authorization: `Bearer ${adminLogin.body.token}` }, body: JSON.stringify({ points: 500 }) });
  const redeemed = await request('/api/v1/points/redeem', { method: 'POST', headers: auth, body: JSON.stringify({ code: created.body.codes[0].code }) });
  assert.equal(redeemed.body.points, 590);
});

test('gateway account, reference upload, and job contract', async () => {
  const email = `gateway-${Date.now()}@example.com`;
  const registered = await request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, nickname: `网关${Date.now()}`, password: 'testpass123' }) });
  assert.equal(registered.status, 201);
  assert.equal(registered.body.user.credits, 100);
  const authHeader = { authorization: `Bearer ${registered.body.access_token}` };
  const models = await request('/v1/image/models', { headers: authHeader });
  assert.equal(models.body.models[0].modelId, 'gpt-image-2');
  const upload = await fetch(origin + '/v1/image/references', { method: 'POST', headers: { authorization: `Bearer ${registered.body.access_token}` }, body: (() => { const form = new FormData(); form.append('files', new Blob([Buffer.from('png-test')], { type: 'image/png' }), 'test.png'); return form; })() });
  assert.equal(upload.status, 201);
  const uploadBody = await upload.json();
  assert.equal(uploadBody.references[0].fileName, 'test.png');
  const referenceId = uploadBody.references[0].id;
  const removed = await request(`/v1/image/references?id=${referenceId}`, { method: 'DELETE', headers: authHeader });
  assert.equal(removed.body.success, true);
  const account = await request('/v1/account', { headers: authHeader });
  assert.equal(account.body.user.email, email);
});

test('account upstream can be switched at runtime with a prefixed /v1 URL', async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === '/prefix/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'gpt-image-2.5', owned_by: 'switchable', supported_endpoint_types: ['images'] }, { id: 'reasoning-x', owned_by: 'switchable', supported_endpoint_types: ['chat'] }] }));
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const port = upstream.address().port;
  try {
    const email = `switch-${Date.now()}@example.com`;
    const registered = await request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, nickname: `切换${Date.now()}`, password: 'testpass123' }) });
    const authHeader = { authorization: `Bearer ${registered.body.access_token}` };
    const saved = await request('/v1/account', { method: 'PUT', headers: authHeader, body: JSON.stringify({ settings: { tokenFluxBaseUrl: `http://127.0.0.1:${port}/prefix/v1`, tokenFluxApiKey: 'switch-key' } }) });
    assert.equal(saved.status, 200);
    const models = await request('/v1/models?refresh=1', { headers: authHeader });
    assert.equal(models.status, 200);
    assert.equal(models.body.source, 'account');
    assert.deepEqual(models.body.models.map((model) => model.id), ['gpt-image-2.5', 'reasoning-x']);
    const tested = await request('/v1/ai/test-connection', { method: 'POST', headers: authHeader, body: JSON.stringify({ baseUrl: `http://127.0.0.1:${port}/prefix/v1`, apiKey: 'switch-key', mode: 'image' }) });
    assert.equal(tested.status, 200);
    assert.equal(tested.body.matchedModels[0].id, 'gpt-image-2.5');
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('comfyui workflows auto-configure, run and produce an ultra HD asset', async () => {
  const queued = [];
  const comfy = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/upload/image') {
      for await (const _ of req) { /* drain the multipart body */ }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ name: 'uploaded-input.png', subfolder: '', type: 'input' }));
      return;
    }
    if (url.pathname === '/object_info') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        UpscaleModelLoader: { input: { required: { model_name: [['4x-UltraSharp.pth', 'RealESRGAN_x4plus.pth']] } } },
        LoadImage: { input: { required: { image: [['input.png']] } } },
        SaveImage: { input: { required: { images: ['IMAGE'] } } },
        VectorTraceNode: { input: { required: { image: ['IMAGE'], threshold: ['FLOAT', { default: 0.5 }] } } },
      }));
      return;
    }
    if (url.pathname === '/system_stats') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ system: { comfyui_version: 'test' }, devices: [{ name: 'CPU' }] }));
      return;
    }
    if (url.pathname === '/prompt' && req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      queued.push(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ prompt_id: 'prompt-1', number: 1 }));
      return;
    }
    if (url.pathname === '/history/prompt-1') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ 'prompt-1': { status: { completed: true, status_str: 'success' }, outputs: { '5': { images: [{ filename: 'zhihui_4k_00001_.png', subfolder: '', type: 'output' }] } } } }));
      return;
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(onePixelPng);
      return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise((resolve) => comfy.listen(0, '127.0.0.1', resolve));
  const comfyPort = comfy.address().port;
  try {
    const adminLogin = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ nickname: 'admin', password: 'test-admin-password' }) });
    const adminHeader = { authorization: `Bearer ${adminLogin.body.access_token}` };
    const saved = await request('/v1/admin/comfy-config', { method: 'PUT', headers: adminHeader, body: JSON.stringify({ baseUrl: `http://127.0.0.1:${comfyPort}` }) });
    assert.equal(saved.status, 200);
    const tested = await request('/v1/admin/comfy/test', { method: 'POST', headers: adminHeader, body: JSON.stringify({}) });
    assert.equal(tested.status, 200);
    assert.equal(tested.body.vectorNode, 'VectorTraceNode');
    assert.deepEqual(tested.body.upscaleModels, ['4x-UltraSharp.pth', 'RealESRGAN_x4plus.pth']);

    const uploaded = await request('/v1/admin/comfy/workflows', {
      method: 'POST',
      headers: adminHeader,
      body: JSON.stringify({
        code: 'brand-vector',
        name: '品牌图转矢量',
        kind: 'vectorize',
        workflow: { '1': { class_type: 'LoadImage', inputs: { image: '{{image}}' } }, '2': { class_type: 'VectorTraceNode', inputs: { image: ['1', 0], threshold: 0.4 } } },
      }),
    });
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.detected.kind, 'vectorize');
    assert.equal(uploaded.body.detected.hasImageInput, true);

    const email = `comfy-${Date.now()}@example.com`;
    const registered = await request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, nickname: `放大${Date.now()}`, password: 'testpass123' }) });
    const authHeader = { authorization: `Bearer ${registered.body.access_token}` };
    const presets = await request('/v1/studio/workflows', { headers: authHeader });
    assert.equal(presets.status, 200);
    assert.equal(presets.body.comfy.configured, true);
    assert.ok(presets.body.workflows.some((item) => item.code === 'hd-restore-4k' && item.kind === 'upscale'));
    assert.ok(presets.body.workflows.some((item) => item.code === 'brand-vector'));

    const upload = await fetch(origin + '/v1/image/references', {
      method: 'POST',
      headers: authHeader,
      body: (() => { const form = new FormData(); form.append('files', new Blob([onePixelPng], { type: 'image/png' }), 'source.png'); return form; })(),
    });
    const referenceId = (await upload.json()).references[0].id;

    const started = await request('/v1/studio/workflows/hd-restore-4k/run', { method: 'POST', headers: authHeader, body: JSON.stringify({ reference_ids: [referenceId], prompt: '保持细节' }) });
    assert.equal(started.status, 202);
    assert.equal(started.body.status, 'processing');
    assert.equal(started.body.workflow.kind, 'upscale');

    let job = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      job = (await request(`/v1/image/jobs/${started.body.jobId}`, { headers: authHeader })).body;
      if (job.status !== 'processing') break;
    }
    assert.equal(job.status, 'succeeded');
    assert.equal(job.progress, 100);
    const asset = await fetch(origin + `/v1/image/assets/${job.assetId}`, { headers: authHeader });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'image/png');

    assert.equal(queued.length, 1);
    const graph = queued[0].prompt;
    assert.equal(graph['1'].inputs.image, 'uploaded-input.png');
    assert.equal(graph['2'].inputs.model_name, '4x-UltraSharp.pth');
    assert.equal(graph['4'].inputs.width, 4096);
    assert.equal(graph['4'].inputs.height, 4096);
  } finally {
    await new Promise((resolve) => comfy.close(resolve));
  }
});

const SHORT_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function buildShortCode(secret, tier) {
  const digest = crypto.createHmac('sha256', secret).update('').digest();
  let nonce = '';
  while (nonce.length < 7) nonce += SHORT_ALPHABET[crypto.randomInt(0, SHORT_ALPHABET.length)];
  const payload = SHORT_ALPHABET[tier] + nonce;
  const full = crypto.createHmac('sha256', secret).update(payload).digest();
  let bits = 0;
  let buffer = 0;
  let signature = '';
  for (const byte of full) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      signature += SHORT_ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) signature += SHORT_ALPHABET[(buffer << (5 - bits)) & 31];
  void digest;
  return `ZHRC1.${payload}${signature.slice(0, 10)}`;
}

test('plugin short recharge codes keep redeeming after the signing key moves to config', async () => {
  const email = `short-${Date.now()}@example.com`;
  const registered = await request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, nickname: `短码${Date.now()}`, password: 'testpass123' }) });
  const authHeader = { authorization: `Bearer ${registered.body.access_token}` };
  const startBalance = registered.body.user.credits;

  const legacyCode = buildShortCode('TEST-LEGACY-SECRET-2026', 1);
  const legacy = await request('/v1/redeem', { method: 'POST', headers: authHeader, body: JSON.stringify({ code: legacyCode }) });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.credited, 200);

  const primaryCode = buildShortCode('TEST-PRIMARY-SECRET-2026', 2);
  const primary = await request('/v1/redeem', { method: 'POST', headers: authHeader, body: JSON.stringify({ code: primaryCode }) });
  assert.equal(primary.status, 200);
  assert.equal(primary.body.credited, 300);

  const repeat = await request('/v1/redeem', { method: 'POST', headers: authHeader, body: JSON.stringify({ code: legacyCode }) });
  assert.equal(repeat.status, 409);

  const forged = await request('/v1/redeem', { method: 'POST', headers: authHeader, body: JSON.stringify({ code: buildShortCode('NOT-THE-SECRET-2026', 5) }) });
  assert.equal(forged.status, 400);

  const adminLogin = await request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ nickname: 'admin', password: 'test-admin-password' }) });
  const adminHeader = { authorization: `Bearer ${adminLogin.body.access_token}` };
  const status = await request('/v1/admin/short-code', { headers: adminHeader });
  assert.equal(status.body.status.source, 'env');
  assert.equal(status.body.status.allowLegacy, true);
  assert.ok(status.body.status.acceptedKeys >= 2);

  const generated = await request('/v1/admin/short-code/generate', { method: 'POST', headers: adminHeader, body: JSON.stringify({ points: 500, count: 2 }) });
  assert.equal(generated.status, 201);
  assert.equal(generated.body.codes.length, 2);
  const minted = await request('/v1/redeem', { method: 'POST', headers: authHeader, body: JSON.stringify({ code: generated.body.codes[0] }) });
  assert.equal(minted.status, 200);
  assert.equal(minted.body.credited, 500);

  const account = await request('/v1/account', { headers: authHeader });
  assert.equal(account.body.user.credits, startBalance + 200 + 300 + 500);
});
