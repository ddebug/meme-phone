import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoState, dayKey } from '../meme/data.js';
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

test('C2：历史记录与最后一条聊天不与历史记录重复注入', async () => {
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

test('C3：多条待回消息合并成一次请求，历史里不再重复出现', async () => {
  const state = demoState();
  const { chat, contact } = seedChat(state, [
    { id: 'h1', from: 'them', kind: 'text', text: '前面的话' },
    { id: 'p1', from: 'me', kind: 'text', text: '第一句', pending: true },
    { id: 'p2', from: 'me', kind: 'text', text: '第二句', pending: true },
    { id: 'p3', from: 'me', kind: 'text', text: '第三句', pending: true },
  ]);
  const result = await buildReplyMessages(state, chat, contact, { memoryText: '' });
  const turn = result.messages.filter(message => message.source === '最后一条聊天');
  assert.equal(turn.length, 1);
  assert.ok(turn[0].content.includes('第一句'));
  assert.ok(turn[0].content.includes('第二句'));
  assert.ok(turn[0].content.includes('第三句'));
  assert.ok(turn[0].content.includes('〔3〕'));
  for (const text of ['第一句', '第二句', '第三句']) {
    const hits = result.messages.filter(message => String(message.content).includes(text));
    assert.equal(hits.length, 1, `${text} 只能出现在当前轮，不应再进历史`);
  }
  const preview = await buildReplyMessages(state, chat, contact, { memoryText: '', omitPending: true, omitLastUser: true });
  assert.equal(preview.messages.filter(message => String(message.content).includes('第一句')).length, 0);
});

test('C2：历史按字数预算从新到旧装入，装不下就停但至少留最新一条', () => {
  const state = demoState();
  const { chat } = seedChat(state, [
    { id: 'b1', from: 'them', kind: 'text', text: '很早的一句话'.repeat(4) },
    { id: 'b2', from: 'me', kind: 'text', text: '中间的话'.repeat(4) },
    { id: 'b3', from: 'them', kind: 'text', text: '最新的一句'.repeat(4) },
  ]);
  const packed = transcript(state, chat, 30, { maxChars: 30 });
  assert.ok(packed.includes('最新的一句'));
  assert.ok(!packed.includes('很早的一句话'));
  assert.ok(packed.length <= 30);
});

test('C2：预算报告标记输入超限与整体超限，口径为估算', async () => {
  const state = demoState();
  const { chat, contact } = seedChat(state, [
    { id: 'x1', from: 'me', kind: 'text', text: '长'.repeat(3000) },
  ]);
  const preset = { id: 'p', name: '预算', context: { charBudget: 2000 }, items: [] };
  const result = await buildReplyMessages(state, chat, contact, { presetOverride: preset, memoryText: '' });
  assert.equal(result.report.estimate, true);
  assert.ok(result.report.outputReserve > 0);
  assert.equal(result.report.overLimitInput, true);
  assert.equal(result.report.inputChars, 3000);
});

test('C2：日记按自然日过滤，别的日子的消息不进当天材料', () => {
  const state = demoState();
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const { chat, contact } = seedChat(state, [
    { id: 'd1', from: 'them', kind: 'text', text: '昨天的话', at: Date.now() - 86400000 },
    { id: 'd2', from: 'me', kind: 'text', text: '今天的话', at: Date.now() },
  ]);
  const todayText = transcript(state, chat, 30, { day: today });
  assert.ok(todayText.includes('今天的话'));
  assert.ok(!todayText.includes('昨天的话'));
  const yesterdayText = transcript(state, chat, 30, { day: yesterday });
  assert.ok(yesterdayText.includes('昨天的话'));
  assert.ok(!yesterdayText.includes('今天的话'));
});
