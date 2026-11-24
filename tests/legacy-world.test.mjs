import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../meme/data.js';
import { isWorldChat } from '../meme/world.js';
import { migrateLegacyWorlds } from '../meme/legacy-world.js';
import { chatApp, worldChatApp } from '../meme/apps/chat.js';

function worldPhone(id, overrides = {}) {
  return {
    id,
    key: `key_${id}`,
    sourceChatFile: `world-${id}.jsonl`,
    sourceChatId: `tavern-${id}`,
    ownerName: '沈砚',
    ownerAvatar: 'a.png',
    storyDate: '第 3 天',
    contactId: 'c1',
    createdAt: 11,
    data: {
      contacts: { c1: { id: 'c1', name: '沈砚', avatar: 'a.png' } },
      chats: {
        c1: {
          id: 'c1',
          contactId: 'c1',
          messages: [{ id: `${id}_m1`, from: 'them', text: '同层小手机的话', at: 1 }],
        },
      },
    },
    ...overrides,
  };
}

function baseRaw(overrides = {}) {
  return {
    version: 3,
    contacts: {},
    chats: {},
    ...overrides,
  };
}

test('旧存档停在同层小手机：顶层聊天补 world 标记，metaPhone 的聊天回到普通会话', () => {
  const raw = baseRaw({
    phoneSurface: 'world',
    activeWorldId: 'w1',
    contacts: { c1: { id: 'c1', name: '沈砚', avatar: 'a.png' } },
    chats: {
      c1: { id: 'c1', contactId: 'c1', messages: [{ id: 'wm1', from: 'them', text: '顶层同层小手机', at: 1 }] },
    },
    metaPhone: {
      data: {
        contacts: { m1: { id: 'm1', name: '阿蓝' } },
        chats: { m1: { id: 'm1', contactId: 'm1', messages: [{ id: 'mm1', from: 'me', text: 'Meta', at: 2 }] } },
      },
    },
    worldPhones: { w1: worldPhone('w1') },
  });
  const state = normalize(raw);
  const changed = migrateLegacyWorlds(raw, state);

  assert.equal(changed, true);
  assert.equal(state.chats.c1.messages[0].text, '顶层同层小手机');
  assert.equal(isWorldChat(state.chats.c1), true);
  assert.equal(state.chats.c1.world.chatFile, 'world-w1');
  assert.equal(state.chats.c1.world.ownerName, '沈砚');
  assert.equal(state.chats.c1.world.storyDate, '第 3 天');
  assert.equal(state.chats.m1.messages[0].text, 'Meta');
  assert.equal(isWorldChat(state.chats.m1), false);
  assert.equal(Object.keys(state.chats).length, 2);
  assert.equal(state.legacyWorldsMerged, true);

  /* 迁完两个 App 各自能看到：Meta 列表有阿蓝，同层小手机列表有沈砚。 */
  const metaList = chatApp.render({ state });
  const worldList = worldChatApp.render({ state });
  assert.match(metaList, /阿蓝/);
  assert.doesNotMatch(metaList, /同层小手机的话/);
  assert.match(worldList, /沈砚/);
  assert.match(worldList, /第 3 天/);
});

test('旧存档停在 Meta：顶层保持普通会话，worldPhones 的聊天补 world 并避开重名 id', () => {
  const raw = baseRaw({
    phoneSurface: 'meta',
    contacts: { c1: { id: 'c1', name: '沈砚', avatar: 'a.png' } },
    chats: {
      c1: { id: 'c1', contactId: 'c1', messages: [{ id: 'mm1', from: 'me', text: 'Meta 里的话', at: 2 }] },
    },
    metaPhone: { data: { contacts: {}, chats: {} } },
    worldPhones: { w1: worldPhone('w1') },
  });
  const state = normalize(raw);
  const changed = migrateLegacyWorlds(raw, state);

  assert.equal(changed, true);
  assert.equal(isWorldChat(state.chats.c1), false);
  assert.equal(state.chats.c1.messages[0].text, 'Meta 里的话');
  const worldChat = Object.values(state.chats).find(chat => isWorldChat(chat));
  assert.ok(worldChat);
  assert.notEqual(worldChat.id, 'c1');
  assert.equal(worldChat.world.chatFile, 'world-w1');
  assert.equal(worldChat.contactId, 'c1');
});

test('不同世界的同名 id 联系人会被拆开，聊天跟着改 contactId', () => {
  const raw = baseRaw({
    phoneSurface: 'meta',
    contacts: { c1: { id: 'c1', name: '甲' } },
    chats: { c1: { id: 'c1', contactId: 'c1', messages: [{ id: 'm', from: 'me', text: 'hi', at: 1 }] } },
    worldPhones: {
      w1: worldPhone('w1', {
        data: {
          contacts: { c1: { id: 'c1', name: '乙' } },
          chats: { c1: { id: 'c1', contactId: 'c1', messages: [{ id: 'w', from: 'them', text: 'yo', at: 2 }] } },
        },
      }),
    },
  });
  const state = normalize(raw);
  migrateLegacyWorlds(raw, state);

  const worldChat = Object.values(state.chats).find(chat => isWorldChat(chat));
  assert.ok(worldChat);
  assert.notEqual(worldChat.contactId, 'c1');
  assert.equal(state.contacts[worldChat.contactId].name, '乙');
});

test('迁移只做一次；没有旧快照的存档不动它', () => {
  const legacy = baseRaw({
    phoneSurface: 'meta',
    chats: { m1: { id: 'm1', contactId: '', messages: [] } },
    metaPhone: { data: { contacts: {}, chats: {} } },
    worldPhones: { w1: worldPhone('w1') },
  });
  const state = normalize(legacy);
  assert.equal(migrateLegacyWorlds(legacy, state), true);
  const before = Object.keys(state.chats).length;
  const persisted = JSON.parse(JSON.stringify(state));
  const reloaded = normalize(persisted);
  assert.equal(migrateLegacyWorlds(persisted, reloaded), false);
  assert.equal(Object.keys(reloaded.chats).length, before);

  const fresh = baseRaw({ chats: { m1: { id: 'm1', contactId: '', messages: [] } } });
  const freshState = normalize(fresh);
  assert.equal(migrateLegacyWorlds(fresh, freshState), false);
  assert.equal(freshState.legacyWorldsMerged, undefined);
});
