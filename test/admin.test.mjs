import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { browserLaunchSpec } from '../tools/remote-login.mjs';
import {
  accountIdForToken,
  createAdminController,
  readAccountStore,
  readRuntimeCredentials,
  usageHasAvailableQuotas,
  usageHasExhaustedQuota,
  writeAccountStore,
} from '../web/admin.mjs';

function makeTemporaryDirectory() {
  return mkdtempSync(join(tmpdir(), 'commandcode-proxy-test-'));
}

test('Windows 授权助手会把完整授权地址作为一个参数打开', () => {
  const loginUrl = 'https://commandcode.ai/studio/auth/cli?callback=http%3A%2F%2F127.0.0.1%3A41234%2Fcallback&state=test-state&mode=redirect&client=commandcode-proxy-bridge';
  assert.deepEqual(browserLaunchSpec(loginUrl, 'win32'), {
    command: 'rundll32.exe',
    args: ['url.dll,FileProtocolHandler', loginUrl],
  });
});

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

function makeStoredUsage({ fiveHourRemaining = 8, weeklyRemaining = 16, monthlyRemaining = 100 } = {}) {
  const makeWindow = (remaining, cap) => ({
    used: cap - remaining,
    cap,
    remaining,
    ratio: (cap - remaining) / cap,
    resetAt: 1_700_000_000,
    exceeded: remaining <= 0,
    known: true,
  });
  return {
    account: { id: 'stored-user', userName: '保存账号', email: 'stored@example.com' },
    plan: 'Pro',
    monthly: { used: 0, remaining: monthlyRemaining, totalCount: 0, known: true },
    fiveHour: makeWindow(fiveHourRemaining, 10),
    weekly: makeWindow(weeklyRemaining, 20),
    periodStart: '2026-01-01T00:00:00.000Z',
    fetchedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeUsageController(accounts, activeAccountId = accounts[0]?.id) {
  const directory = makeTemporaryDirectory();
  const runtimeDir = join(directory, 'runtime');
  const authFile = join(directory, 'auth', 'auth.json');
  const accountsFile = join(runtimeDir, 'accounts.json');
  writeAccountStore(accountsFile, { activeAccountId, accounts });
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
  return { controller, config, runtimeDir };
}

function makeUsageFetch(states) {
  return async (url, options = {}) => {
    const apiKey = options.headers?.Authorization?.replace(/^Bearer /, '');
    const state = states[apiKey];
    assert.ok(state, `没有为 ${apiKey} 设置测试用量`);
    const path = String(url);
    let payload;
    if (path.includes('/alpha/whoami')) {
      payload = { user: { id: state.userId, userName: state.userName, email: state.email }, org: { id: `org-${state.userId}` } };
    } else if (path.includes('/alpha/billing/credits')) {
      payload = {
        credits: { monthlyCredits: state.monthlyCredits },
        windowLimits: {
          fiveHour: { used: state.fiveHourUsed, cap: state.fiveHourCap, resetAt: 1_700_000_000 },
          weekly: { used: state.weeklyUsed, cap: state.weeklyCap, resetAt: 1_700_100_000 },
        },
      };
    } else if (path.includes('/alpha/billing/subscriptions')) {
      payload = { data: { planId: 'individual-pro', currentPeriodStart: '2026-01-01T00:00:00.000Z' } };
    } else {
      payload = { totalCost: 3, totalCount: 5 };
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function makeUsageState(userId, userName, options = {}) {
  return {
    userId,
    userName,
    email: `${userId}@example.com`,
    fiveHourUsed: 2,
    fiveHourCap: 10,
    weeklyUsed: 4,
    weeklyCap: 20,
    monthlyCredits: 100,
    ...options,
  };
}

test('三个额度窗口的满额判定要求数据完整，且任一窗口满额即视为耗尽', () => {
  for (const key of ['fiveHour', 'weekly', 'monthly']) {
    const usage = makeStoredUsage();
    if (key === 'fiveHour') usage.fiveHour = makeStoredUsage({ fiveHourRemaining: 0 }).fiveHour;
    if (key === 'weekly') usage.weekly = makeStoredUsage({ weeklyRemaining: 0 }).weekly;
    if (key === 'monthly') usage.monthly = { ...usage.monthly, remaining: 0 };
    assert.equal(usageHasExhaustedQuota(usage), true, `${key} 满额应触发耗尽判定`);
    assert.equal(usageHasAvailableQuotas(usage), false, `${key} 满额时不应视为可用账号`);
  }
  assert.equal(usageHasAvailableQuotas({ fiveHour: {}, weekly: {}, monthly: {} }), false);
});

test('当前账号任一额度窗口用尽时自动切换到下一个可用账号', async () => {
  const first = { id: 'account-first', apiKey: 'user_first', userId: 'first-user', userName: '第一个账号', usage: makeStoredUsage({ fiveHourRemaining: 1 }) };
  const second = { id: 'account-second', apiKey: 'user_second', userId: 'second-user', userName: '第二个账号', usage: makeStoredUsage() };
  const { controller, config, runtimeDir } = makeUsageController([first, second]);
  const login = await call(controller, 'POST', '/admin/api/auth/login', { password: 'gateway-pass' });
  const cookie = sessionCookie(login.response);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeUsageFetch({
    user_first: makeUsageState('first-user', '第一个账号', { fiveHourUsed: 10 }),
  });
  try {
    const result = await call(controller, 'GET', '/admin/api/usage', null, cookie);
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.payload.autoSwitched, true);
    assert.equal(result.payload.accounts.find((account) => account.active).userName, '第二个账号');
    assert.deepEqual(result.payload.usage, result.payload.accounts.find((account) => account.active).usage);
    assert.equal(config.ccApiKey, 'user_second');
    assert.equal(readRuntimeCredentials(runtimeDir).CC_API_KEY, 'user_second');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('没有三类额度都未满的账号时不会自动切换', async () => {
  const first = { id: 'account-first', apiKey: 'user_first', userId: 'first-user', userName: '第一个账号', usage: makeStoredUsage() };
  const second = { id: 'account-second', apiKey: 'user_second', userId: 'second-user', userName: '第二个账号', usage: makeStoredUsage({ weeklyRemaining: 0 }) };
  const { controller, config } = makeUsageController([first, second]);
  const login = await call(controller, 'POST', '/admin/api/auth/login', { password: 'gateway-pass' });
  const cookie = sessionCookie(login.response);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeUsageFetch({
    user_first: makeUsageState('first-user', '第一个账号', { monthlyCredits: 0 }),
  });
  try {
    const result = await call(controller, 'GET', '/admin/api/usage', null, cookie);
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.payload.autoSwitched, false);
    assert.equal(result.payload.accounts.find((account) => account.active).userName, '第一个账号');
    assert.equal(config.ccApiKey, 'user_first');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('刷新全部账号时按列表顺序切换，并在列表末尾循环查找', async () => {
  const first = { id: 'account-first', apiKey: 'user_first', userId: 'first-user', userName: '第一个账号', usage: makeStoredUsage() };
  const second = { id: 'account-second', apiKey: 'user_second', userId: 'second-user', userName: '第二个账号', usage: makeStoredUsage({ fiveHourRemaining: 0 }) };
  const third = { id: 'account-third', apiKey: 'user_third', userId: 'third-user', userName: '第三个账号', usage: makeStoredUsage() };
  const { controller, config } = makeUsageController([first, second, third], second.id);
  const login = await call(controller, 'POST', '/admin/api/auth/login', { password: 'gateway-pass' });
  const cookie = sessionCookie(login.response);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = makeUsageFetch({
    user_first: makeUsageState('first-user', '第一个账号'),
    user_second: makeUsageState('second-user', '第二个账号', { weeklyUsed: 20 }),
    user_third: makeUsageState('third-user', '第三个账号'),
  });
  try {
    const result = await call(controller, 'POST', '/admin/api/accounts/refresh', {}, cookie);
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.payload.autoSwitched, true);
    assert.equal(result.payload.accounts.find((account) => account.active).userName, '第三个账号');
    assert.equal(config.ccApiKey, 'user_third');

    const secondOnly = { id: 'account-second-only', apiKey: 'user_second_only', userId: 'second-only-user', userName: '第二个账号', usage: makeStoredUsage({ fiveHourRemaining: 0 }) };
    const firstOnly = { id: 'account-first-only', apiKey: 'user_first_only', userId: 'first-only-user', userName: '第一个账号', usage: makeStoredUsage() };
    const wrapped = makeUsageController([firstOnly, secondOnly], secondOnly.id);
    const wrappedLogin = await call(wrapped.controller, 'POST', '/admin/api/auth/login', { password: 'gateway-pass' });
    const wrappedCookie = sessionCookie(wrappedLogin.response);
    globalThis.fetch = makeUsageFetch({
      user_second_only: makeUsageState('second-only-user', '第二个账号', { fiveHourUsed: 10 }),
      user_first_only: makeUsageState('first-only-user', '第一个账号'),
    });
    const wrappedResult = await call(wrapped.controller, 'POST', '/admin/api/accounts/refresh', {}, wrappedCookie);
    assert.equal(wrappedResult.payload.autoSwitched, true);
    assert.equal(wrappedResult.payload.accounts.find((account) => account.active).userName, '第一个账号');
    assert.equal(wrapped.config.ccApiKey, 'user_first_only');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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
    host: '127.0.0.1:3050',
  });
  assert.equal(firstStart.payload.mode, 'browser');
  assert.equal(new URL(firstStart.payload.loginUrl).searchParams.get('callback'), 'http://127.0.0.1:3050/callback');
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

test('本地使用浏览器授权，远程通过本地授权助手自动桥接', async () => {
  const directory = makeTemporaryDirectory();
  const runtimeDir = join(directory, 'runtime');
  mkdirSync(join(directory, 'tools'), { recursive: true });
  writeFileSync(join(directory, 'tools', 'remote-login.mjs'), 'console.log("helper");\n');
  const config = {
    apiBase: 'https://api.commandcode.ai',
    gatewayApiKey: 'gateway-pass',
    gatewayApiKeys: ['gateway-pass'],
    ccApiKey: '',
    host: '0.0.0.0',
    port: 3050,
    publicUrl: 'https://fixed.example.com/',
    allowedModelIds: null,
  };
  const controller = createAdminController({
    config,
    projectDir: directory,
    runtimeDir,
    authFile: join(directory, 'auth', 'auth.json'),
    accountsFile: join(runtimeDir, 'accounts.json'),
    server: { listening: true },
  });

  const login = await call(controller, 'POST', '/admin/api/auth/login', { password: 'gateway-pass' });
  const cookie = sessionCookie(login.response);
  const localStart = await call(controller, 'POST', '/admin/api/auth/start', {}, cookie);
  assert.equal(localStart.payload.mode, 'browser');
  assert.equal(new URL(localStart.payload.loginUrl).searchParams.get('callback'), 'http://127.0.0.1:3050/callback');
  const remoteStart = await call(controller, 'POST', '/admin/api/auth/start', {}, cookie, {
    host: 'proxy.internal:3050',
    'x-forwarded-host': 'fixed.example.com',
    'x-forwarded-proto': 'https',
  });
  assert.equal(remoteStart.payload.mode, 'bridge');
  assert.equal(remoteStart.payload.loginUrl, undefined);
  assert.match(remoteStart.payload.command, /mktemp -t cmdc-remote-login/);
  assert.match(remoteStart.payload.command, /curl -fsSL/);
  assert.match(remoteStart.payload.powershellCommand, /Invoke-WebRequest/);
  const ticketMatch = remoteStart.payload.command.match(/['"]--ticket['"] ['"]([^'"]+)['"]/);
  assert.ok(ticketMatch);
  const ticket = ticketMatch[1];
  assert.match(remoteStart.payload.helperUrl, /^https:\/\/fixed\.example\.com\/admin\/api\/auth\/bridge\/helper$/);
  const helper = await call(controller, 'GET', '/admin/api/auth/bridge/helper');
  assert.equal(helper.response.statusCode, 200);
  assert.match(helper.response.body, /console\.log/);

  const insecureAdded = await call(controller, 'POST', '/admin/api/auth/bridge/complete', {
    state: remoteStart.payload.state,
    ticket,
    apiKey: 'user_remote',
  });
  assert.equal(insecureAdded.response.statusCode, 400);
  const forgedCallback = await call(controller, 'GET', `/callback?state=${encodeURIComponent(remoteStart.payload.state)}&apiKey=user_remote&userId=remote-user&userName=伪造账号`, null, cookie, {
    host: 'fixed.example.com',
    'x-forwarded-proto': 'https',
  });
  assert.equal(forgedCallback.response.statusCode, 400);

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /\/alpha\/whoami\?limits=1$/);
    return new Response(JSON.stringify({ user: { id: 'remote-user', userName: '远程账号', email: 'remote@example.com' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const added = await call(controller, 'POST', '/admin/api/auth/bridge/complete', {
      state: remoteStart.payload.state,
      ticket,
      apiKey: 'user_remote',
    }, '', {
      host: 'proxy.internal:3050',
      'x-forwarded-host': 'fixed.example.com',
      'x-forwarded-proto': 'https',
    });
    assert.equal(added.response.statusCode, 200);
    assert.equal(added.payload.account.userName, '远程账号');
    assert.equal(JSON.stringify(added.payload).includes('user_remote'), false);
    assert.equal(config.ccApiKey, 'user_remote');
    const status = await call(controller, 'GET', `/admin/api/auth/status?state=${encodeURIComponent(remoteStart.payload.state)}`, null, cookie);
    assert.equal(status.payload.status, 'success');
    const replay = await call(controller, 'POST', '/admin/api/auth/bridge/complete', {
      state: remoteStart.payload.state,
      ticket,
      apiKey: 'user_remote',
    }, '', {
      host: 'proxy.internal:3050',
      'x-forwarded-host': 'fixed.example.com',
      'x-forwarded-proto': 'https',
    });
    assert.equal(replay.response.statusCode, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
