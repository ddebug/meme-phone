import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  emptyState, addContact, syncTavernContacts, linkContactCards,
  characterCardFor, cardNameAmbiguous, normalize,
} from '../meme/data.js';

function card(name, avatar) {
  return { name, avatar, avatarUrl: `https://example.test/${avatar}.png`, description: '设定', tags: [] };
}

test('联系人按头像文件名关卡片：改了备注也找得到那张卡', () => {
  const state = emptyState();
  state.characters = [card('沈砚', 'shen.png'), card('江迟', 'jiang.png')];
  const contact = addContact(state, { name: '老沈', cardName: '沈砚', kind: 'char', tavernAvatar: 'shen.png' });
  const found = characterCardFor(state, contact);
  assert.equal(found?.name, '沈砚');
});

test('同步不覆盖用户改过的备注，只记卡片自己的名字', () => {
  const state = emptyState();
  const contact = addContact(state, { name: '老沈', cardName: '沈砚', kind: 'char', tavernAvatar: 'shen.png', signature: '夜宵' });
  syncTavernContacts(state, [{ name: '沈砚', avatar: 'shen.png', avatarUrl: 'https://example.test/shen.png' }]);
  assert.equal(contact.name, '老沈');
  assert.equal(contact.cardName, '沈砚');
  assert.equal(contact.signature, '夜宵', '同步不该丢签名等本地资料');
});

test('没改过备注的联系人跟着卡片改名', () => {
  const state = emptyState();
  const contact = addContact(state, { name: '沈砚', cardName: '沈砚', kind: 'char', tavernAvatar: 'shen.png' });
  syncTavernContacts(state, [{ name: '沈砚（夜班）', avatar: 'shen.png' }]);
  assert.equal(contact.name, '沈砚（夜班）');
  assert.equal(contact.tavernAvatar, 'shen.png');
});

test('同名两张卡不替用户绑第一张，标记为歧义', () => {
  const state = emptyState();
  state.characters = [card('李子', 'li1.png'), card('李子', 'li2.png')];
  const contact = addContact(state, { name: '李子', kind: 'char' });
  assert.equal(characterCardFor(state, contact), null);
  assert.equal(cardNameAmbiguous(state, contact), true);
  const linked = linkContactCards(state);
  assert.equal(linked, 0, '歧义情况下不做迁移');
  assert.equal(contact.tavernAvatar, '');
});

test('旧存档只有名字：同名唯一时补上头像文件名关联', () => {
  const state = emptyState();
  state.characters = [card('顾南风', 'gu.png')];
  addContact(state, { name: '顾南风', kind: 'char' });
  const linked = linkContactCards(state);
  assert.equal(linked, 1);
  const contact = Object.values(state.contacts)[0];
  assert.equal(contact.tavernAvatar, 'gu.png');
  assert.equal(contact.cardName, '顾南风');
  assert.equal(contact.name, '顾南风', '迁移不改显示名');
});

test('旧存档把名字当关联键的，同步时升级成头像文件名且不重复建人', () => {
  const state = emptyState();
  /* 旧版 syncTavernContacts 存的是 character.tavernAvatar || character.name，宿主没给 tavernAvatar 时就是名字 */
  addContact(state, { name: '沈砚', kind: 'char', tavernAvatar: '沈砚' });
  const created = syncTavernContacts(state, [{ name: '沈砚', avatar: 'shen.png' }]);
  const contacts = Object.values(state.contacts);
  assert.equal(contacts.length, 1, '不该重复建一个联系人');
  assert.equal(created, 0);
  assert.equal(contacts[0].tavernAvatar, 'shen.png');
  assert.equal(contacts[0].cardName, '沈砚');
});

test('读旧存档时自动完成一次同名唯一迁移，重名不动', () => {
  const raw = {
    characters: [card('沈砚', 'shen.png'), card('李子', 'li1.png'), card('李子', 'li2.png')],
    contacts: {
      c1: { id: 'c1', name: '沈砚', kind: 'char' },
      c2: { id: 'c2', name: '李子', kind: 'char' },
    },
  };
  const state = normalize(raw);
  assert.equal(state.contacts.c1.tavernAvatar, 'shen.png');
  assert.equal(state.contacts.c2.tavernAvatar, '', '重名不猜');
  assert.equal(state.contacts.c2.cardName, '');
});
