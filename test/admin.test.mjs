import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import {
  accountIdForToken,
  createAdminController,
  readAccountStore,
  readRuntimeCredentials,
  writeAccountStore,
} from '../web/admin.mjs';

function makeTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'commandcode-proxy-test-'));
}

function makeRequest(method, path, body = null, cookie = '', extraHeaders = {}) {
  const raw = body === null ? '' : JSON.stringify(body);
  const request = Readable.from(raw ? [Buffer.from(raw)] : []);
  request.method = method;
  request.headers = {
    ...extraHeaders,
    ...(raw ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {}),
  };
  request.socket = { remoteAddress: '127.0.0.1', encrypted: false };
  return { request, url: new URL(path, 'http://127.0.0.1:3050') };
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = String(body);
    },
  };
}

async function call(controller, method, path, body = null, cookie = '', extraHeaders = {}) {
  const { request, url } = makeRequest(method, path, body, cookie, extraHeaders);
  const response = makeResponse();
  await controller.handle(request, response, url);
  let payload = {};
  try {
    payload = JSON.parse(response.body || '{}');
  } catch {
    payload = {};
  }
  return { response, payload };
}

function sessionCookie(response) {
  return response.headers['Set-Cookie'].split(';', 1)[0];
}

test('账号库可以从旧版 auth.json 迁移并保存当前账号', () => {
  const directory = makeTemporaryDirectory();
  const authFile = join(directory, 'legacy', 'auth.json');
  const accountsFile = join(directory, 'runtime', 'accounts.json');
  mkdirSync(join(directory, 'legacy'), { recursive: true });
  writeFileSync(authFile, JSON.stringify({ apiKey: 'user_legacy', userId: 'legacy-user', userName: '旧账号' }));

  const store = readAccountStore(accountsFile, authFile);
  assert.equal(store.accounts.length, 1);
  assert.equal(store.activeAccountId, accountIdForToken({ apiKey: 'user_legacy', userId: 'legacy-user' }));

  const saved = writeAccountStore(accountsFile, store);
  assert.equal(saved.accounts[0].userName, '旧账号');
  assert.equal(JSON.parse(readFileSync(accountsFile, 'utf8')).accounts.length, 1);
});

test('控制台支持添加、切换和删除多个账号', async () => {
  const directory = makeTemporaryDirectory();
  const runtimeDir = join(directory, 'runtime');
  const authFile = join(directory, 'auth', 'auth.json');
  const accountsFile = join(runtimeDir, 'accounts.json');
  const config = {
    apiBase: 'https://api.commandcode.ai',
    gatewayApiKey: 'gateway-pass',
    gatewayApiKeys: ['gateway-pass'],
    ccApiKey: '',
    apiKey: '',
    host: '127.0.0.1',
    port: 3050,
    allowedModelIds: null,
  };
  const controller = createAdminController({
    config,
    projectDir: directory,
    runtimeDir,
    authFile,
    accountsFile,
    server: { listening: true },
  });

  const login = await call(controller, 'POST', '/admin/api/auth/login', { password: 'gateway-pass' });
  assert.equal(login.response.statusCode, 200);
  const cookie = sessionCookie(login.response);

  const firstStart = await call(controller, 'POST', '/admin/api/auth/start', {}, cookie, {
    host: 'proxy.example.com',
    'x-forwarded-host': 'console.example.com',
    'x-forwarded-proto': 'https',
  });
  assert.equal(new URL(firstStart.payload.loginUrl).searchParams.get('callback'), 'https://console.example.com/callback');
  const firstState = new URL(firstStart.payload.loginUrl).searchParams.get('state');
  await call(controller, 'GET', `/callback?state=${encodeURIComponent(firstState)}&apiKey=user_first&userId=first-user&userName=第一个账号&email=first@example.com`);
  const firstConfig = await call(controller, 'GET', '/admin/api/config', null, cookie);
  assert.equal(firstConfig.payload.accounts.length, 1);
  assert.equal(firstConfig.payload.accounts[0].userName, '第一个账号');
  assert.equal(JSON.stringify(firstConfig.payload).includes('user_first'), false);
  assert.equal(config.ccApiKey, 'user_first');

  const secondStart = await call(controller, 'POST', '/admin/api/auth/start', {}, cookie);
  const secondState = new URL(secondStart.payload.loginUrl).searchParams.get('state');
  await call(controller, 'GET', `/callback?state=${encodeURIComponent(secondState)}&apiKey=user_second&userId=second-user&userName=第二个账号&email=second@example.com`);
  const secondConfig = await call(controller, 'GET', '/admin/api/config', null, cookie);
  assert.equal(secondConfig.payload.accounts.length, 2);
  assert.equal(secondConfig.payload.accounts.find((item) => item.active).userName, '第二个账号');
  assert.equal(config.ccApiKey, 'user_second');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const apiKey = options.headers?.Authorization?.replace(/^Bearer /, '');
    const accountName = apiKey === 'user_first' ? '第一个账号' : '第二个账号';
    const suffix = apiKey === 'user_first' ? 'first' : 'second';
    const path = String(url);
    let payload;
    if (path.includes('/alpha/whoami')) payload = { user: { id: `${suffix}-user`, userName: accountName, email: `${suffix}@example.com` }, org: { id: `org-${suffix}` } };
    else if (path.includes('/alpha/billing/credits')) payload = { credits: { monthlyCredits: apiKey === 'user_first' ? 11 : 22 }, windowLimits: { fiveHour: { used: 2, cap: 10, resetAt: 1_700_000_000 }, weekly: { used: 4, cap: 20, resetAt: 1_700_100_000 } } };
    else if (path.includes('/alpha/billing/subscriptions')) payload = { data: { planId: 'individual-pro', currentPeriodStart: '2026-01-01T00:00:00.000Z' } };
    else payload = { totalCost: 3, totalCount: 5 };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const refreshed = await call(controller, 'POST', '/admin/api/accounts/refresh', {}, cookie);
    assert.equal(refreshed.payload.accounts.find((item) => item.userName === '第一个账号').usage.monthly.remaining, 11);
    assert.equal(refreshed.payload.accounts.find((item) => item.userName === '第二个账号').usage.fiveHour.remaining, 8);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const firstAccount = secondConfig.payload.accounts.find((item) => item.userName === '第一个账号');
  const switched = await call(controller, 'POST', `/admin/api/accounts/${encodeURIComponent(firstAccount.id)}/activate`, {}, cookie);
  assert.equal(switched.response.statusCode, 200);
  assert.equal(switched.payload.accounts.find((item) => item.active).userName, '第一个账号');
  assert.equal(config.ccApiKey, 'user_first');
  assert.equal(readRuntimeCredentials(runtimeDir).CC_API_KEY, 'user_first');

  const deleted = await call(controller, 'DELETE', `/admin/api/accounts/${encodeURIComponent(firstAccount.id)}`, null, cookie);
  assert.equal(deleted.payload.accounts.length, 1);
  assert.equal(deleted.payload.accounts[0].userName, '第二个账号');
  assert.equal(config.ccApiKey, 'user_second');
  await call(controller, 'DELETE', `/admin/api/accounts/${encodeURIComponent(deleted.payload.accounts[0].id)}`, null, cookie);
  assert.equal(config.ccApiKey, '');
  assert.equal(existsSync(authFile), false);
});

test('浏览器登录同时支持本地和远程回调地址', async () => {
  const directory = makeTemporaryDirectory();
  const runtimeDir = join(directory, 'runtime');
  const controller = createAdminController({
    config: {
      apiBase: 'https://api.commandcode.ai',
      gatewayApiKey: 'gateway-pass',
      gatewayApiKeys: ['gateway-pass'],
      ccApiKey: '',
      host: '0.0.0.0',
      port: 3050,
      publicUrl: 'https://fixed.example.com/',
      allowedModelIds: null,
    },
    projectDir: directory,
    runtimeDir,
    authFile: join(directory, 'auth', 'auth.json'),
    accountsFile: join(runtimeDir, 'accounts.json'),
    server: { listening: true },
  });

  const login = await call(controller, 'POST', '/admin/api/auth/login', { password: 'gateway-pass' });
  const cookie = sessionCookie(login.response);
  const localStart = await call(controller, 'POST', '/admin/api/auth/start', {}, cookie);
  assert.equal(new URL(localStart.payload.loginUrl).searchParams.get('callback'), 'http://127.0.0.1:3050/callback');
  const remoteStart = await call(controller, 'POST', '/admin/api/auth/start', {}, cookie, {
    host: 'proxy.internal:3050',
    'x-forwarded-host': 'fixed.example.com',
    'x-forwarded-proto': 'https',
  });
  assert.equal(new URL(remoteStart.payload.loginUrl).searchParams.get('callback'), 'https://fixed.example.com/callback');
});
