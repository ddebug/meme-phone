import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoState } from '../meme/data.js';
import { transcript, serializeMessage, buildReplyMessages } from '../meme/reply-context.js';

function seedChat(state, messages) {
  const chatId = Object.keys(state.chats)[0];
  const chat = state.chats[chatId];
  chat.messages = messages;
  return { chat, contact: state.contacts[chat.contactId] };
}

test('C2：序列化覆盖图片说明/表情/转发/引用，图片不把 URL 当成可见内容', () => {
  assert.equal(serializeMessage({ kind: 'image', text: '一只猫', image: 'https://x/y.png' }), '[图片]一只猫');
  assert.equal(serializeMessage({ kind: 'image', image: 'https://x/y.png' }), '[图片]（未提供说明）');
  assert.equal(serializeMessage({ kind: 'emoji', emoji: '害羞', text: '害羞' }), '[表情]害羞');
  assert.equal(serializeMessage({ kind: 'forwarded', forward: { text: '转发的话' }, text: '转发的话' }), '[转发]转发的话');
  assert.equal(serializeMessage({ quote: { text: '引用原文' }, text: '我的回复' }), '[引用]引用原文｜我的回复');
});

test('C2：历史先过滤 system/撤回/excluded，再按条数取最近 N 条', () => {
  const state = demoState();
  const { chat, contact } = seedChat(state, [
    { id: 'm1', from: 'them', kind: 'system', text: '系统消息' },
    { id: 'm2', from: 'them', kind: 'recalled', text: '撤回的话' },
    { id: 'm3', from: 'me', kind: 'text', excluded: true, text: '被排除的话' },
    { id: 'm4', from: 'them', kind: 'text', text: '第一条有效' },
    { id: 'm5', from: 'me', kind: 'text', text: '第二条有效' },
    { id: 'm6', from: 'them', kind: 'text', text: '第三条有效' },
  ]);
  const text = transcript(state, chat, 2);
  assert.ok(text.includes('第二条有效'));
  assert.ok(text.includes('第三条有效'));
  assert.ok(!text.includes('第一条有效'));
  assert.ok(!text.includes('系统消息'));
  assert.ok(!text.includes('撤回的话'));
  assert.ok(!text.includes('被排除的话'));
});

test('C2：最后一条聊天不与历史记录重复注入', async () => {
  const state = demoState();
  const { chat, contact } = seedChat(state, [
    { id: 'h1', from: 'them', kind: 'text', text: '前面的话' },
    { id: 'h2', from: 'me', kind: 'text', text: '最后一句在吗' },
  ]);
  const result = await buildReplyMessages(state, chat, contact, { memoryText: '' });
  const hits = result.messages.filter(message => String(message.content).includes('最后一句在吗'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, '最后一条聊天');
});
