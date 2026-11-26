import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mindForMessage, turnMessages } from '../meme/apps/chat.js';
import { demoState, normalize, pushMessage } from '../meme/data.js';

const ids = (group) => group.map(entry => entry.item.id);

test('B2：同一 turnId 的多气泡被识别为完整一轮', () => {
  const messages = [
    { id: 'u1', from: 'me' },
    { id: 'a', from: 'them', turnId: 't1' },
    { id: 'b', from: 'them', turnId: 't1' },
    { id: 'c', from: 'them', turnId: 't1' },
    { id: 'u2', from: 'me' },
    { id: 'd', from: 'them', turnId: 't2' },
  ];
  const turn = turnMessages({ messages }, messages[2]);
  assert.deepEqual(ids(turn), ['a', 'b', 'c']);
  assert.deepEqual(turn.map(entry => entry.i), [1, 2, 3]);
});

test('B2：同一轮里任意气泡都能读到首条气泡上的心理活动', () => {
  const messages = [
    { id: 'u1', from: 'me' },
    { id: 'a', from: 'them', turnId: 't1', inner: '这一轮的心理活动' },
    { id: 'b', from: 'them', turnId: 't1' },
    { id: 'c', from: 'them', turnId: 't1' },
  ];
  assert.equal(mindForMessage({ messages }, messages[1]), '这一轮的心理活动');
  assert.equal(mindForMessage({ messages }, messages[2]), '这一轮的心理活动');
  assert.equal(mindForMessage({ messages }, messages[3]), '这一轮的心理活动');
  assert.equal(mindForMessage({ messages }, messages[0]), '');
});

test('B2：老存档没有 turnId 时，后面的气泡也能读到这一轮首条的心理活动', () => {
  const messages = [
    { id: 'u1', from: 'me' },
    { id: 'x', from: 'them', inner: '老存档的心理活动' },
    { id: 'y', from: 'them' },
    { id: 'z', from: 'them' },
  ];
  assert.equal(mindForMessage({ messages }, messages[3]), '老存档的心理活动');
});

test('B2：老存档没有 turnId 时，回退到上一条 me 之后的连续 them 段', () => {
  const messages = [
    { id: 'u1', from: 'me' },
    { id: 'x', from: 'them' },
    { id: 'y', from: 'them' },
    { id: 'z', from: 'them' },
    { id: 'u2', from: 'me' },
  ];
  const turn = turnMessages({ messages }, messages[3]);
  assert.deepEqual(ids(turn), ['x', 'y', 'z']);
});

test('B2：用户原话不属于可重生成的角色轮次', () => {
  const messages = [
    { id: 'u1', from: 'me' },
    { id: 'a', from: 'them', turnId: 't1' },
  ];
  assert.deepEqual(turnMessages({ messages }, messages[0]), []);
});

test('B2：pushMessage 写入的 turnId 能随归一化往返保留', () => {
  const state = demoState();
  const chatId = Object.keys(state.chats)[0];
  pushMessage(state, chatId, { from: 'them', turnId: 't-round', text: '整轮第一条' });
  pushMessage(state, chatId, { from: 'them', turnId: 't-round', text: '整轮第二条' });
  const rebuilt = normalize(state);
  const saved = rebuilt.chats[chatId].messages.filter(m => m.turnId === 't-round');
  assert.equal(saved.length, 2);
});
