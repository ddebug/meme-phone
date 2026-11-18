import test from 'node:test';
import assert from 'node:assert/strict';

import { demoState, normalize } from '../meme/data.js';

test('默认回复预设只保留自然发消息', () => {
  const state = demoState();
  assert.deepEqual(state.settings.reply.presets.map(preset => preset.name), ['自然发消息']);
});

test('旧存档里的再短一点、带点情绪会被移除，并回退到自然发消息', () => {
  const state = demoState();
  const blank = { text: '', context: {}, items: [] };
  state.settings.reply.presets.push({ id: 'reply_short', name: '再短一点', ...blank });
  state.settings.reply.presets.push({ id: 'reply_soft', name: '带点情绪', ...blank });
  state.settings.reply.activeId = 'reply_soft';
  const chatId = Object.keys(state.chats)[0];
  state.chats[chatId].replyPresetId = 'reply_short';

  const merged = normalize(state);
  assert.deepEqual(merged.settings.reply.presets.map(preset => preset.name), ['自然发消息']);
  assert.equal(merged.settings.reply.activeId, 'reply_natural');
  assert.equal(merged.chats[chatId].replyPresetId, '');
});
