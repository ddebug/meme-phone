import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, chatFor, addContact, addChat, normalize } from '../meme/data.js';
import { clockBlock } from '../meme/reply-context.js';
import {
  ensurePhoneWorlds, createWorldPhoneForTests, activateWorldForTests,
  activateMetaForTests, syncActivePhone, captureData,
} from '../meme/world.js';

function stateWithMeta() {
  const state = emptyState();
  const contact = addContact(state, { name: '沈砚', avatar: 'a.png', tavernAvatar: 'a.png' });
  const chat = addChat(state, contact.id, { name: 'Meta 聊天' });
  chat.messages.push({ id: 'm1', from: 'me', text: 'meta 里的消息', at: Date.now() });
  chat.updatedAt = Date.now();
  ensurePhoneWorlds(state);
  return { state, contact, chat };
}

test('老存档读进来时，顶层这一份就是 Meta，并且只留一份快照', () => {
  const { state } = stateWithMeta();
  assert.equal(state.phoneSurface, 'meta');
  assert.equal(Object.keys(state.metaPhone?.data?.contacts || {}).length, 1);
  assert.equal(Object.keys(state.worldPhones).length, 0);

  const again = normalize(state);
  ensurePhoneWorlds(again);
  assert.ok(again.metaPhone?.data, '再次归一化不丢 Meta 快照');
  assert.equal(again.phoneSurface, 'meta');
});

test('每台里世界手机有自己独立的联系人 / 聊天，翻回 Meta 不串数据', () => {
  const { state, contact } = stateWithMeta();
  const metaContacts = captureData(state).contacts;

  const world = createWorldPhoneForTests(state, {
    key: `chat:file-a:${contact.tavernAvatar}:main`,
    contact,
    ownerName: contact.name,
    ownerAvatar: contact.avatar,
    chatFile: 'file-a',
    chatId: 'file-a',
    storyDate: '第 3 天',
  });
  assert.ok(world);
  assert.ok(activateWorldForTests(state, world.id));
  assert.equal(state.phoneSurface, 'world');
  assert.equal(state.activeWorldId, world.id);

  const worldContactId = Object.keys(state.contacts)[0];
  addContact(state, { name: '只属于这条线的路人', avatar: '', kind: 'custom' });
  state.contacts[worldContactId].note = '这条线改过';
  syncActivePhone(state);

  assert.ok(activateMetaForTests(state));
  assert.equal(state.phoneSurface, 'meta');
  assert.equal(state.contacts[worldContactId].note, '', 'Meta 的联系人不被里世界的改动污染');
  assert.deepEqual(Object.keys(state.contacts).sort(), Object.keys(metaContacts).sort());

  assert.ok(activateWorldForTests(state, world.id));
  assert.equal(state.contacts[worldContactId].note, '这条线改过');
  assert.ok(state.contacts[Object.keys(state.contacts).find(id => state.contacts[id].name === '只属于这条线的路人')]);
});

test('里世界手机里的会话带着酒馆文件，供记忆读准那一份', () => {  const { state, contact } = stateWithMeta();
  const world = createWorldPhoneForTests(state, {
    key: 'char:a:file-b',
    contact,
    chatFile: 'file-b',
    chatId: 'file-b',
    storyDate: '霜月十二日',
  });
  const chat = Object.values(world.data.chats)[0];
  assert.ok(chat);
  assert.equal(chat.tavernFile, 'file-b');
  assert.equal(chat.contactId, contact.id);
  assert.equal(world.data.theaters && Object.keys(world.data.theaters).length, 0);
  assert.equal(world.storyDate, '霜月十二日');
  assert.ok(chatFor(world.data, contact.id), '里世界里能正常拿到会话');
});

test('里世界的时钟是剧情日期 + 现实钟点；Meta 仍是现实日期', () => {
  const { state, contact } = stateWithMeta();
  const world = createWorldPhoneForTests(state, {
    key: 'clock:file-a',
    contact,
    chatFile: 'file-a',
    storyDate: '第 3 天',
  });
  activateWorldForTests(state, world.id);
  const now = new Date(2026, 10, 24, 21, 5);
  const worldClock = clockBlock(state, now);
  assert.match(worldClock, /剧情日期：第 3 天/);
  assert.match(worldClock, /21:05/);

  activateMetaForTests(state);
  const metaClock = clockBlock(state, now);
  assert.match(metaClock, /当前时间：/);
  assert.doesNotMatch(metaClock, /剧情日期/);
});
