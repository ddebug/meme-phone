import test from 'node:test';
import assert from 'node:assert/strict';

import {
  demoState, normalizeChatHistory, chatHistoryFor, effectivePhoneHistoryLimit, effectiveTavernHistory,
  normalizeReplyContext, memoryPresetFor,
} from '../meme/data.js';
import { buildReplyMessages } from '../meme/reply-context.js';

test('会话历史设置会归一化，非法值回落到跟随', () => {
  assert.deepEqual(normalizeChatHistory({}), { phoneLimit: 0, tavernMode: '', tavernFloors: 0 });
  assert.deepEqual(normalizeChatHistory({ phoneLimit: 999, tavernMode: 'wat', tavernFloors: -3 }), {
    phoneLimit: 50,
    tavernMode: '',
    tavernFloors: 0,
  });
  assert.deepEqual(normalizeChatHistory({ phoneLimit: 12, tavernMode: 'summary', tavernFloors: 8 }), {
    phoneLimit: 12,
    tavernMode: 'summary',
    tavernFloors: 8,
  });
});

test('小手机历史条数：会话覆盖优先，否则跟随回复预设', () => {
  const context = normalizeReplyContext({ historyLimit: 20 });
  assert.equal(effectivePhoneHistoryLimit({ history: {} }, context), 20);
  assert.equal(effectivePhoneHistoryLimit({ history: { phoneLimit: 5 } }, context), 5);
  assert.equal(effectivePhoneHistoryLimit({ history: { phoneLimit: 0 } }, { ...context, historyLimit: 1 }), 1);
});

test('酒馆历史：跟随方案、全部总结、最近 N 层三种取值', () => {
  const state = demoState();
  const chat = Object.values(state.chats).find(item => item.contactId === Object.values(state.contacts).find(c => c.name === '沈砚').id);
  const preset = memoryPresetFor(state, chat);
  assert.equal(effectiveTavernHistory(state, chat, preset).mode, 'auto');

  chat.history = chatHistoryFor(chat);
  chat.history.tavernMode = 'summary';
  const summary = effectiveTavernHistory(state, chat, preset);
  assert.equal(summary.mode, 'summary');
  assert.equal(summary.floors, preset.floors);
  assert.equal(summary.fromChat, true);

  chat.history = { ...chatHistoryFor(chat), tavernMode: 'recent', tavernFloors: 6 };
  const recent = effectiveTavernHistory(state, chat, preset);
  assert.equal(recent.mode, 'recent');
  assert.equal(recent.floors, 6);
});

test('角色聊天设置会实际改变小手机历史注入条数', async () => {
  const state = demoState();
  const contact = Object.values(state.contacts).find(c => c.name === '沈砚');
  const chat = Object.values(state.chats).find(c => c.contactId === contact.id);
  chat.history = { ...chatHistoryFor(chat), phoneLimit: 2 };

  const { messages } = await buildReplyMessages(state, chat, contact);
  const history = messages.find(message => message.source === '历史小手机消息');
  assert.ok(history, '历史小手机消息条目已注入');
  const lines = history.content.split('\n').slice(1);
  assert.equal(lines.length, 2, '只保留最近 2 条小手机消息');
  assert.match(history.content, /我到了，路上小心。/);
});
