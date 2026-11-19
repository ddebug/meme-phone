import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoState } from '../meme/data.js';
import { buildReplyMessages } from '../meme/reply-context.js';

test('C1：预览显式传入编辑中的预设 B，组装结果只含 B 的条目，不按当前会话预设 A', async () => {
  const state = demoState();
  const chatId = Object.keys(state.chats)[0];
  const chat = state.chats[chatId];
  const contact = state.contacts[chat.contactId];

  const presetB = {
    id: 'preset_b',
    name: '编辑中的 B',
    text: 'B 主文案',
    context: {},
    items: [
      { id: 'b1', label: 'B 标记', role: 'system', kind: 'chat', content: 'B-ONLY-MARKER', enabled: true, group: 'group_chat', order: 1 },
    ],
  };

  const overridden = await buildReplyMessages(state, chat, contact, { presetOverride: presetB, memoryText: '' });
  assert.equal(overridden.report.presetId, 'preset_b');
  assert.ok(overridden.messages.some(message => String(message.content).includes('B-ONLY-MARKER')));

  const normal = await buildReplyMessages(state, chat, contact, { memoryText: '' });
  assert.ok(!normal.messages.some(message => String(message.content).includes('B-ONLY-MARKER')));
});
