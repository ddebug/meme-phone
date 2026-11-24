import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { generate, __resetHostScriptForTests } from '../meme/host.js';

const customPreset = {
  engine: 'custom',
  url: 'http://127.0.0.1:8080',
  path: '/v1/chat/completions',
  model: 'm',
  key: 'k',
};

function stubHost(rawSpy, quietSpy) {
  globalThis.SillyTavern = { getContext: () => ({ generateRaw: rawSpy, generateQuietPrompt: quietSpy }) };
}

afterEach(() => {
  delete globalThis.SillyTavern;
  delete globalThis.fetch;
  __resetHostScriptForTests();
});

test('B3：自定义接口 503 时抛出原错误，不静默退回酒馆模型', async () => {
  let tavernCalls = 0;
  stubHost(async () => { tavernCalls += 1; return 'tavern 回复'; });
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'up' }) });

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }], preset: customPreset, demo: false }),
    /503/,
  );
  assert.equal(tavernCalls, 0, '酒馆后备模型不应被调用');
});

test('B3：自定义接口空返回同样报错，不退回酒馆', async () => {
  let tavernCalls = 0;
  stubHost(async () => { tavernCalls += 1; return 'tavern 回复'; });
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) });

  await assert.rejects(
    () => generate({ messages: [{ role: 'user', content: 'hi' }], preset: customPreset, demo: false }),
    /没有返回内容/,
  );
  assert.equal(tavernCalls, 0);
});

test('酒馆 API 走 generateRaw：只发手机自己组装的 messages，不拼酒馆预设', async () => {
  let captured = null;
  let quietCalls = 0;
  stubHost(async (args) => { captured = args; return '来自酒馆'; }, async () => { quietCalls += 1; return '不该走到'; });
  const result = await generate({
    messages: [
      { role: 'system', content: '手机自己的回复要求' },
      { role: 'user', content: 'hi' },
    ],
    preset: { engine: 'tavern' },
    demo: false,
  });
  assert.equal(result.text, '来自酒馆');
  assert.equal(result.provider, 'tavern');
  assert.equal(result.demo, false);
  assert.deepEqual(captured.prompt, [
    { role: 'system', content: '手机自己的回复要求' },
    { role: 'user', content: 'hi' },
  ], '发出去的就是手机组装好的 messages，不摊平成酒馆安静提示');
  assert.equal(captured.systemPrompt, '');
  assert.equal(quietCalls, 0, '不再走 generateQuietPrompt，酒馆预设/角色卡/世界书不会被拼进来');
});

test('B3：正式模式宿主不可用时返回错误，不拿演示文案冒充真实回复', async () => {
  globalThis.fetch = async () => { throw new Error('不应发起请求'); };
  const result = await generate({ demo: false, demoReply: '演示文案', preset: null });
  assert.equal(result.demo, false);
  assert.equal(result.text, '');
  assert.equal(result.provider, 'none');
  assert.match(result.error || '', /宿主不可用/);
});

test('B3：只有演示模式才允许返回演示文案', async () => {
  const result = await generate({ demo: true, demoReply: '演示文案', preset: null });
  assert.equal(result.demo, true);
  assert.equal(result.text, '演示文案');
  assert.equal(result.provider, 'demo');
});
