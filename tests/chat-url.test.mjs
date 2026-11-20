import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { chatCompletionsRoot, generate, listTavernModels, __resetHostScriptForTests } from '../meme/host.js';

afterEach(() => {
  delete globalThis.SillyTavern;
  delete globalThis.fetch;
  __resetHostScriptForTests();
});

test('Base URL 只填域名时收成 /v1 根', () => {
  assert.equal(chatCompletionsRoot('https://host', ''), 'https://host/v1');
  assert.equal(chatCompletionsRoot('https://host', '/v1/chat/completions'), 'https://host/v1');
});

test('Base URL 已带 /v1 时不重复 /v1', () => {
  assert.equal(chatCompletionsRoot('https://host/v1', '/v1/chat/completions'), 'https://host/v1');
  assert.equal(chatCompletionsRoot('https://host/v1/', '/chat/completions'), 'https://host/v1');
});

test('Base URL 误填完整 endpoint 时剥掉 /chat/completions', () => {
  assert.equal(chatCompletionsRoot('https://host/v1/chat/completions', ''), 'https://host/v1');
  assert.equal(chatCompletionsRoot('https://host/v1/chat/completions', '/v1/chat/completions'), 'https://host/v1');
});

test('带额外路径的代理保留自身前缀', () => {
  assert.equal(chatCompletionsRoot('https://host/api', '/v1/chat/completions'), 'https://host/api/v1');
});

test('拉模型状态检查同样把 custom_url 收到 /v1', async () => {
  globalThis.SillyTavern = {
    getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf' }) }),
  };
  let body = null;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/api\/backends\/chat-completions\/status$/);
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ data: [{ id: 'claude-sonnet-4-6' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await listTavernModels({
    url: 'https://claude9137.cloud9137.cc.cd',
    path: '/v1/chat/completions',
    key: 'sk-test',
    tavernSource: 'custom',
  });

  assert.deepEqual(result.models, ['claude-sonnet-4-6']);
  assert.equal(body.custom_url, 'https://claude9137.cloud9137.cc.cd/v1');
  assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer sk-test' });
});

test('发送给酒馆的 custom_url 只到 /v1，且用 include_headers 带 Key', async () => {
  globalThis.SillyTavern = {
    getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 'csrf' }) }),
  };
  let body = null;
  globalThis.fetch = async (url, options) => {
    assert.match(String(url), /\/api\/backends\/chat-completions\/generate$/);
    body = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await generate({
    messages: [{ role: 'user', content: 'hi' }],
    preset: {
      engine: 'custom',
      url: 'https://claude9137.cloud9137.cc.cd',
      path: '/v1/chat/completions',
      model: 'claude-sonnet-4-6',
      key: 'sk-test',
      temp: 0.8,
    },
    demo: false,
  });

  assert.equal(result.text, 'ok');
  assert.equal(body.custom_url, 'https://claude9137.cloud9137.cc.cd/v1');
  assert.deepEqual(JSON.parse(body.custom_include_headers), { Authorization: 'Bearer sk-test' });
  assert.equal(body.reverse_proxy, 'https://claude9137.cloud9137.cc.cd/v1');
});
