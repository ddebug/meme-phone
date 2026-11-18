import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_REPLY_GROUPS, defaultReplyItems, demoState, normalize,
  normalizeReplyGroups, normalizeReplyItems, replyGroupIdFor,
} from '../meme/data.js';

test('默认条目按聊天行为 / 上下文注入分组', () => {
  const items = defaultReplyItems();
  const chat = items.filter(item => item.kind === 'chat');
  const context = items.filter(item => item.kind === 'context');
  assert.ok(chat.every(item => item.group === 'group_chat'));
  assert.ok(context.every(item => item.group === 'group_context'));
});

test('分组归一化：缺省给三组，自定义组保留并去重', () => {
  assert.deepEqual(normalizeReplyGroups(undefined).map(group => group.id), ['group_chat', 'group_context', 'group_app']);
  const groups = normalizeReplyGroups([
    { id: 'group_chat', name: '我的聊天' },
    { id: 'group_custom', name: '脑洞' },
    { id: 'group_chat', name: '重复', kind: 'app' },
    null,
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[1].name, '脑洞');
  assert.equal(groups[1].kind, 'chat');
  assert.notEqual(groups[2].id, 'group_chat');
});

test('条目分组：合法分组保留，非法分组按类型回退', () => {
  const groups = normalizeReplyGroups([{ id: 'group_mine', name: '我的组', kind: 'chat' }]);
  const chat = normalizeReplyItems([{ id: 'c1', label: '聊天', kind: 'chat', group: 'group_mine' }])[0];
  assert.equal(replyGroupIdFor(chat, groups), 'group_mine');
  assert.equal(replyGroupIdFor({ id: 'c2', kind: 'chat', group: 'missing' }, groups), 'group_mine');
  assert.equal(replyGroupIdFor({ id: 'x1', kind: 'context', group: '' }, groups), 'group_mine');
});

test('旧存档补上默认分组，聊天行为落在同一组', () => {
  const state = demoState();
  delete state.settings.reply.presets[0].groups;
  const merged = normalize(state);
  const preset = merged.settings.reply.presets[0];
  assert.equal(preset.groups.length, DEFAULT_REPLY_GROUPS.length);
  assert.deepEqual(preset.groups.map(group => group.name), ['聊天行为', '上下文注入', '其他软件']);
  const chatItems = preset.items.filter(item => item.kind === 'chat');
  assert.ok(chatItems.every(item => replyGroupIdFor(item, preset.groups) === 'group_chat'));
});
