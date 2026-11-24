import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalize, addContact, addChat } from '../meme/data.js';
import { installWorld, createWorldChatForTests } from '../meme/world.js';
import { threadSettingsApp } from '../meme/apps/chat.js';

function worldState() {
  const state = normalize(emptyState());
  const contact = addContact(state, { name: '沈砚', avatar: 'a.png', tavernAvatar: 'a.png' });
  const world = createWorldChatForTests(state, {
    contact, chatFile: 'sync-file', chatId: 'sync-file', storyDate: '第 3 天',
  });
  const meta = addChat(state, contact.id, { name: '普通会话' });
  return { state, contact, world, meta };
}

test('写回开关默认打开；旧存档没有字段也按打开处理', () => {
  const { world } = worldState();
  assert.notEqual(world.world.syncEnabled, false);
  const loaded = normalize({
    version: 3,
    contacts: {},
    chats: { c1: { id: 'c1', messages: [], world: { kind: 'world', chatFile: 'x' } } },
  });
  assert.equal(loaded.chats.c1.world.syncEnabled, true);
  const off = normalize({
    version: 3,
    contacts: {},
    chats: { c1: { id: 'c1', messages: [], world: { kind: 'world', chatFile: 'x', syncEnabled: false } } },
  });
  assert.equal(off.chats.c1.world.syncEnabled, false);
});

test('聊天设置里只有同层小手机显示「写回酒馆聊天记录」', () => {
  const { state, world, meta } = worldState();
  const ctx = { state, save() {}, rerender() {}, toast() {}, shell: { stack: [] } };
  const worldHtml = threadSettingsApp.render(ctx, { chatId: world.id });
  assert.match(worldHtml, /写回酒馆聊天记录/);
  assert.match(worldHtml, /ts-toggle-world-sync/);
  assert.match(worldHtml, /mp-switch on/);

  const metaHtml = threadSettingsApp.render(ctx, { chatId: meta.id });
  assert.doesNotMatch(metaHtml, /写回酒馆聊天记录/);

  threadSettingsApp.handle(ctx, 'ts-toggle-world-sync', { chat: world.id });
  assert.equal(world.world.syncEnabled, false);
  const offHtml = threadSettingsApp.render(ctx, { chatId: world.id });
  assert.match(offHtml, /只在手机里保留/);
  threadSettingsApp.handle(ctx, 'ts-toggle-world-sync', { chat: world.id });
  assert.equal(world.world.syncEnabled, true);
});

test('关掉写回后新的一轮不入队，重新打开才恢复', async () => {
  const { state, world } = worldState();
  const ctx = { state, save() {}, toast() {}, shell: { stack: [] } };
  installWorld(ctx);
  const turn = [{ id: 'm1', from: 'me', text: '这一句', turnId: 't1' }];

  world.world.syncEnabled = false;
  await ctx.world.syncTurn(world, 't1', turn);
  assert.equal(world.world.queue.length, 0);

  world.world.syncEnabled = true;
  await ctx.world.syncTurn(world, 't2', turn);
  assert.equal(world.world.queue.length, 1);
  assert.equal(world.world.queue[0].turnId, 't2');
});
