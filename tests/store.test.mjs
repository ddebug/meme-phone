import test from 'node:test';
import assert from 'node:assert/strict';

import { createStore } from '../meme/store.js';
import { demoState, normalize } from '../meme/data.js';

function makeRemote() {
  let persisted = null;
  let failNext = 0;
  let delay = 0;
  return {
    failNext(n = 1) { failNext = n; },
    delay(ms) { delay = ms; },
    persisted() { return persisted; },
    async fetchImpl(url, options = {}) {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (options.method === 'GET') {
        if (!persisted) return { status: 404, ok: false, async text() { return ''; } };
        return { status: 200, ok: true, async text() { return JSON.stringify(persisted); } };
      }
      if (failNext > 0) { failNext -= 1; throw new Error('network down'); }
      const body = JSON.parse(options.body);
      persisted = JSON.parse(atob(body.data));
      return { status: 200, ok: true, async text() { return JSON.stringify(persisted); } };
    },
  };
}

function makeStore(remote, options = {}) {
  return createStore({
    fileName: 'meme-phone.json',
    fetchImpl: remote.fetchImpl,
    getHeaders: async () => ({}),
    debounceMs: 0,
    ...options,
  });
}

test('A1：touch 等待保存成功后才 resolve，落盘内容与内存一致', async () => {
  const remote = makeRemote();
  const store = makeStore(remote);
  await store.init();
  const state = demoState();
  store.replace(state);
  await store.touch();
  await store.flush();
  const saved = remote.persisted();
  assert.equal(saved.format, 'meme-phone');
  assert.ok(saved.revision);
  assert.equal(saved.meme.settings.theme, state.settings.theme);
  assert.equal(store.get(), state);
  assert.equal(store.status().dirty, false);
  assert.equal(store.status().error, null);
});

test('A1：连改 20 次防抖合并，所有等待者都结束，最终落盘是最新版', async () => {
  const remote = makeRemote();
  const store = makeStore(remote);
  await store.init();
  const state = demoState();
  store.replace(state);
  const promises = [];
  for (let index = 0; index < 20; index += 1) {
    state.settings.theme = index % 2 ? 'night' : 'day';
    promises.push(store.touch());
  }
  await Promise.all(promises);
  await store.flush();
  assert.equal(remote.persisted().meme.settings.theme, state.settings.theme);
  assert.equal(store.status().savedSeq, store.status().changeSeq);
});

test('A1：保存期间又改动，本轮写完后自动再存一版，不丢后续改动', async () => {
  const remote = makeRemote();
  remote.delay(40);
  const store = makeStore(remote);
  await store.init();
  const state = demoState();
  store.replace(state);
  const first = store.touch();
  await new Promise(resolve => setTimeout(resolve, 12));
  state.settings.theme = 'night';
  store.touch();
  await first;
  await store.flush();
  assert.equal(remote.persisted().meme.settings.theme, 'night');
  assert.equal(store.status().dirty, false);
});

test('A1：保存失败保留 dirty 与内存，等待者收到失败，重试后成功', async () => {
  const remote = makeRemote();
  remote.failNext(1);
  const store = makeStore(remote);
  await store.init();
  const state = demoState();
  store.replace(state);
  await assert.rejects(() => store.touch(), /network down/);
  assert.equal(store.status().dirty, true);
  assert.equal(store.status().error, 'network down');
  // 内存内容没被清掉
  assert.equal(store.get(), state);
  await store.retry();
  assert.equal(store.status().dirty, false);
  assert.equal(remote.persisted().meme.settings.theme, state.settings.theme);
});

test('A1：整份替换后旧等待者按“状态已替换”结算，不绑到新状态上', async () => {
  const remote = makeRemote();
  const store = makeStore(remote);
  await store.init();
  store.replace(demoState());
  const pending = store.touch();
  const next = demoState();
  store.replace(next);
  await assert.rejects(() => pending, /状态已替换/);
  await store.flush();
  assert.equal(remote.persisted().meme.settings.theme, next.settings.theme);
});

test('A2：归一化保留合法收藏，只剔除无效条目，缺字段补齐', () => {
  const state = demoState();
  state.favorites = [
    { id: 'f1', chatId: 'c1', contactName: '阿白', from: 'me', text: '第一条收藏', image: '', at: 1700000000000 },
    { id: 'f2', contactName: 'TA', text: '', image: 'data:image/png;base64,xx', at: 1700000000001 },
    // 无效：没 id 也没文字/图片
    { contactName: 'TA', text: '', image: '' },
    // 无效：只有 id，没内容
    { id: 'f3' },
  ];
  const normalized = normalize(state);
  assert.equal(normalized.favorites.length, 2);
  assert.equal(normalized.favorites[0].id, 'f1');
  assert.equal(normalized.favorites[0].from, 'me');
  assert.equal(normalized.favorites[1].image, 'data:image/png;base64,xx');
  assert.equal(normalized.favorites[1].from, 'them');
});

test('A2：收藏保存 → 重新归一化往返后数量与内容不丢', () => {
  const state = demoState();
  state.favorites = [
    { id: 'f1', chatId: 'c1', contactName: '阿白', from: 'them', text: '来回一趟', image: '', at: 1700000000000 },
  ];
  const once = normalize(state);
  const twice = normalize(once);
  assert.equal(twice.favorites.length, 1);
  assert.equal(twice.favorites[0].text, '来回一趟');
  assert.equal(twice.favorites[0].id, 'f1');
});
