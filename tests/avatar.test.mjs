import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyState, normalize, addContact, setContactAvatar, clearContactAvatar, syncTavernContacts,
} from '../meme/data.js';

const IMG = 'data:image/webp;base64,AAAA';
const CARD_IMG = 'https://example.local/shen.png';

test('换头像会记住酒馆那张原图，并打上自定义标记', () => {
  const state = emptyState();
  const contact = addContact(state, { name: '沈砚', kind: 'char', avatar: CARD_IMG, tavernAvatar: 'shen.png', cardName: '沈砚' });
  assert.equal(setContactAvatar(state, contact, IMG), true);
  assert.equal(contact.avatar, IMG);
  assert.equal(contact.avatarCustom, true);
  assert.equal(contact.tavernAvatarUrl, CARD_IMG);
  assert.equal(setContactAvatar(state, contact, '   '), false);
});

test('同步酒馆角色时保留自定义头像，但仍跟着卡片更新关联名', () => {
  const state = emptyState();
  const contact = addContact(state, { name: '沈砚', kind: 'char', avatar: CARD_IMG, tavernAvatar: 'shen.png', cardName: '沈砚' });
  setContactAvatar(state, contact, IMG);
  syncTavernContacts(state, [
    { name: '沈砚', avatar: 'shen.png', avatarUrl: 'https://example.local/new.png' },
  ]);
  assert.equal(contact.avatar, IMG, '自定义头像不被卡片原图顶掉');
  assert.equal(contact.tavernAvatar, 'shen.png');
  assert.equal(contact.avatarCustom, true);

  /* 没有换过头像的联系人，仍然跟着卡片换图 */
  const plain = addContact(state, { name: '江迟', kind: 'char', avatar: 'old.png', tavernAvatar: 'jiang.png' });
  syncTavernContacts(state, [{ name: '江迟', avatar: 'jiang.png', avatarUrl: 'https://example.local/jiang2.png' }]);
  assert.equal(plain.avatar, 'https://example.local/jiang2.png');
});

test('还原头像：优先用角色卡那张，找不到卡就用换之前记下的那张', () => {
  const state = emptyState();
  const contact = addContact(state, { name: '沈砚', kind: 'char', avatar: CARD_IMG, tavernAvatar: 'shen.png' });
  setContactAvatar(state, contact, IMG);
  state.characters = [{ name: '沈砚', avatar: 'shen.png', avatarUrl: 'https://example.local/card.png' }];
  clearContactAvatar(state, contact);
  assert.equal(contact.avatar, 'https://example.local/card.png');
  assert.equal(contact.avatarCustom, undefined);

  const noCard = addContact(state, { name: '顾南风', kind: 'char', avatar: CARD_IMG, tavernAvatar: 'gu.png' });
  setContactAvatar(state, noCard, IMG);
  state.characters = [];
  clearContactAvatar(state, noCard);
  assert.equal(noCard.avatar, CARD_IMG, '没有卡片也能退回原图');
});

test('存档 round-trip 保留自定义头像与标记', () => {
  const state = emptyState();
  const contact = addContact(state, { name: '沈砚', kind: 'char', avatar: CARD_IMG, tavernAvatar: 'shen.png' });
  setContactAvatar(state, contact, IMG);
  const raw = JSON.parse(JSON.stringify(state));
  const restored = normalize(raw);
  const again = restored.contacts[contact.id];
  assert.equal(again.avatar, IMG);
  assert.equal(again.avatarCustom, true);
});
