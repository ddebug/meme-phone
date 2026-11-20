import assert from 'node:assert/strict';
import { test } from 'node:test';
import { savedSettingsObject } from '../meme/host.js';

test('settings/get 的字符串形状能解出设置对象', () => {
  const inner = {
    oai_settings: { chat_completion_source: 'custom', custom_url: 'http://127.0.0.1:8080' },
    world_info_settings: { world_info: { charLore: [{ name: '徐诺千', extraBooks: ['附加书'] }] } },
  };
  const saved = { settings: JSON.stringify(inner), world_names: ['主书'] };
  const parsed = savedSettingsObject(saved);
  assert.equal(parsed.oai_settings.custom_url, 'http://127.0.0.1:8080');
  assert.deepEqual(parsed.world_info_settings.world_info.charLore[0].extraBooks, ['附加书']);
});

test('已经铺平成对象的响应也能直接读', () => {
  const saved = { oai_settings: { reverse_proxy: 'http://x' }, world_info_settings: { world_info: {} } };
  const parsed = savedSettingsObject(saved);
  assert.equal(parsed.oai_settings.reverse_proxy, 'http://x');
});

test('settings 字符串坏掉时返回空对象，不抛错', () => {
  assert.deepEqual(savedSettingsObject({ settings: '{broken' }), {});
});

test('空响应与非对象返回空对象', () => {
  assert.deepEqual(savedSettingsObject(null), {});
  assert.deepEqual(savedSettingsObject(undefined), {});
  assert.deepEqual(savedSettingsObject(''), {});
  assert.deepEqual(savedSettingsObject({ settings: null }), {});
});
