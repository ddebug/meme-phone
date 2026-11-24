import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, chatFor, addContact, addChat, normalize } from '../meme/data.js';
import { clockBlock } from '../meme/reply-context.js';
import { installWorld, isWorldChat, createWorldChatForTests, storyDateOf } from '../meme/world.js';
import { chatApp, worldChatApp } from '../meme/apps/chat.js';
import { __resetHostScriptForTests } from '../meme/host.js';

function stateWithMeta() {
  const state = emptyState();
  const contact = addContact(state, { name: '沈砚', avatar: 'a.png', tavernAvatar: 'a.png' });
  const meta = addChat(state, contact.id, { name: 'Meta 聊天' });
  meta.messages.push({ id: 'm1', from: 'me', text: 'meta 里的消息', at: Date.now() });
  meta.updatedAt = Date.now();
  return { state, contact, meta };
}

test('里世界和 Meta 是两个聊天 App，列表互不混入', () => {
  const { state, contact } = stateWithMeta();
  const world = createWorldChatForTests(state, {
    contact, chatFile: 'file-split', chatId: 'file-split', storyDate: '第 2 天',
  });
  world.messages.push({ id: 'w1', from: 'them', text: '里世界的话', at: Date.now() });
  const ctx = { state, shell: {} };
  const metaList = chatApp.render(ctx);
  const worldList = worldChatApp.render(ctx);
  assert.match(metaList, /沈砚/);
  assert.doesNotMatch(metaList, /file-split/);
  assert.match(worldList, /file-split/);
  assert.match(worldList, /第 2 天/);
  assert.doesNotMatch(worldList, /Meta 聊天/);
  assert.equal(chatApp.id, 'chat');
  assert.equal(worldChatApp.id, 'worldchat');
});

test('里世界聊天就是普通会话，只多绑一份酒馆聊天文件', () => {
  const { state, contact, meta } = stateWithMeta();
  const world = createWorldChatForTests(state, {
    contact,
    chatFile: 'file-a.jsonl',
    chatId: 'file-a',
    storyDate: '第 3 天',
  });
  assert.ok(world);
  assert.notEqual(world.id, meta.id);
  assert.equal(world.contactId, contact.id);
  assert.equal(world.world.kind, 'world');
  assert.equal(world.world.chatFile, 'file-a');
  assert.equal(world.world.chatId, 'file-a');
  assert.equal(storyDateOf(world), '第 3 天');
  assert.equal(isWorldChat(meta), false);
});

test('同一份酒馆聊天不会重复开；Meta 会话也不会被里世界聊天顶掉', () => {
  const { state, contact } = stateWithMeta();
  const first = createWorldChatForTests(state, {
    contact, chatFile: 'file-b', chatId: 'file-b',
  });
  const again = createWorldChatForTests(state, {
    contact, chatFile: 'file-b.jsonl', chatId: 'file-b', storyDate: '第 9 天',
  });
  assert.equal(again.id, first.id);

  const meta = chatFor(state, contact.id);
  assert.equal(isWorldChat(meta), false);
  assert.notEqual(meta.id, first.id);
});

test('里世界聊天是剧情日期 + 现实钟点；普通会话仍是现实日期', () => {
  const { state, contact, meta } = stateWithMeta();
  const world = createWorldChatForTests(state, {
    contact, chatFile: 'file-a', chatId: 'file-a', storyDate: '第 3 天',
  });
  const now = new Date(2026, 10, 24, 21, 5);
  assert.match(clockBlock(state, now, world), /剧情日期：第 3 天/);
  assert.match(clockBlock(state, now, world), /21:05/);
  assert.match(clockBlock(state, now, meta), /当前时间：/);
  assert.doesNotMatch(clockBlock(state, now, meta), /剧情日期/);
});

test('归一化保留 chat.world 的绑定和剧情日期', () => {
  const { state, contact } = stateWithMeta();
  const world = createWorldChatForTests(state, {
    contact, chatFile: 'file-c', chatId: 'file-c', storyDate: '霜月十二日',
  });
  world.world.queue.push({ turnId: 't1', text: '你好', storyDate: '霜月十二日', at: 1 });
  const next = normalize(state);
  const saved = Object.values(next.chats).find(chat => chat.world?.kind === 'world');
  assert.ok(saved);
  assert.equal(saved.world.chatFile, 'file-c');
  assert.equal(saved.world.storyDate, '霜月十二日');
  assert.equal(saved.world.queue.length, 1);
});

test('从当前酒馆聊天新建时，会话真的挂到那个联系人上', async () => {
  const { state, contact } = stateWithMeta();
  globalThis.SillyTavern = {
    getContext: () => ({
      chat: [{ is_user: true, name: '我', mes: '在吗' }],
      characters: [{ name: '沈砚', avatar: 'a.png', chat: 'file-e' }],
      this_chid: 0,
      characterId: 0,
      chatMetadata: { meme_phone_story_date: '第 4 天' },
      getCurrentChatId: () => 'file-e',
      saveChat: async () => {},
    }),
  };
  __resetHostScriptForTests();
  const ctx = { state, save() {}, toast() {}, shell: { stack: [] } };
  installWorld(ctx);
  const chat = await ctx.world.createFromCurrent({ open: false });
  assert.ok(chat);
  assert.equal(chat.contactId, contact.id);
  assert.equal(chat.world.chatFile, 'file-e');
  assert.equal(chat.world.storyDate, '第 4 天');
  delete globalThis.SillyTavern;
});

test('状态栏的里世界标签只在打开里世界聊天时出现', () => {
  const { state, contact, meta } = stateWithMeta();
  const world = createWorldChatForTests(state, {
    contact, chatFile: 'file-d', chatId: 'file-d', storyDate: '第 5 天',
  });
  const ctx = { state, save() {}, toast() {}, shell: { stack: [] } };
  installWorld(ctx);
  assert.equal(ctx.world.active(), null);

  ctx.shell.stack.push({ view: 'thread', params: { chatId: meta.id } });
  assert.equal(ctx.world.active(), null);

  ctx.shell.stack.push({ view: 'thread', params: { chatId: world.id } });
  assert.equal(ctx.world.active()?.id, world.id);
  assert.equal(ctx.world.label(world), '里世界 · 第 5 天');
});
