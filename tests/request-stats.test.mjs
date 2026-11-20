import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoState } from '../meme/data.js';
import { buildReplyMessages, requestStats } from '../meme/reply-context.js';

const msg = (source, content, extra = {}) => ({ role: 'system', source, content, ...extra });

test('requestStats 按上下文来源拆成酒馆历史、小手机历史和其它组', () => {
  const stats = requestStats([
    msg('场景提示', '规则'),
    msg('历史小手机消息', '手机记录'),
    msg('历史酒馆消息', '酒馆记录'),
    msg('回复格式要求', '格式'),
    msg('最后一条聊天', '当前这句', { role: 'user' }),
    msg('小剧场', '剧场'),
  ]);
  assert.deepEqual(stats.groups.map(group => group.key), ['rule', 'context', 'tavern', 'phone', 'turn', 'theater']);
  assert.equal(stats.groups.find(group => group.key === 'tavern').chars, 4);
  assert.equal(stats.groups.find(group => group.key === 'phone').chars, 4);
  assert.equal(stats.groups.reduce((sum, group) => sum + group.tokens, 0), stats.total);
  assert.equal(stats.totalChars, 4 + 4 + 2 + 2 + 4 + 2);
});

test('requestStats 优先使用消息自带的 group，不依赖用户改过的条目名', () => {
  const stats = requestStats([
    msg('我自己的记忆名字', '酒馆内容', { group: 'tavern' }),
    msg('我的手机记录', '手机内容', { group: 'phone' }),
    msg('自定义设定', '设定内容', { group: 'context' }),
  ]);
  assert.deepEqual(stats.groups.map(group => group.label), ['设定', '酒馆历史', '小手机历史']);
  assert.equal(stats.rows[0].group.key, 'tavern');
  assert.equal(stats.rows[1].group.key, 'phone');
});

test('实际组装后酒馆历史与小手机历史分开统计，字符数与注入内容一致', async () => {
  const state = demoState();
  const chat = state.chats[Object.keys(state.chats)[0]];
  const contact = state.contacts[chat.contactId];
  const built = await buildReplyMessages(state, chat, contact, {
    memoryText: '酒馆历史'.repeat(100),
    omitLastUser: true,
  });
  const stats = requestStats(built.messages);
  for (const [label, key] of [['历史酒馆消息', 'tavern'], ['历史小手机消息', 'phone']]) {
    const item = built.report.items.find(entry => entry.label === label);
    const group = stats.groups.find(entry => entry.key === key);
    assert.ok(item && item.status === 'injected');
    assert.ok(group);
    assert.equal(group.chars, item.chars);
    assert.ok(group.tokens > 0);
  }
});
