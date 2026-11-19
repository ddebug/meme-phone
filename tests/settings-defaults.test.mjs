import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState, normalize } from '../meme/data.js';

test('请求调试栏默认关着，想要的人自己开', () => {
  const state = emptyState();
  assert.equal(state.settings.chat.debugBar, false);
});

test('老存档里明确开着调试栏的，读进来仍然开着', () => {
  const state = normalize({ settings: { chat: { debugBar: true } } });
  assert.equal(state.settings.chat.debugBar, true);
});

test('老存档没这个字段时按新默认关着', () => {
  const state = normalize({ settings: { chat: { remind: true } } });
  assert.equal(state.settings.chat.debugBar, false);
});
