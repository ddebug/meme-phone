import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyState, normalize, pushMessage } from '../meme/data.js';
import {
  walletBalance, sendTransfer, receiveTransfer, refundTransfer,
  grantUserMembership, userMembership, grantContactMembership, contactMembership,
  createAppointment, respondAppointment, completeAppointment,
  requestFriend, respondFriendRequest, updateSignature,
  applyBehaviorMessage,
} from '../meme/behavior-domains.js';
import { parseBehaviorReply } from '../meme/behavior.js';
import { parseChatTransferText } from '../meme/chat-transfer.js';

function stateWithContact() {
  const state = emptyState();
  state.contacts.c1 = { id: 'c1', name: '沈砚', kind: 'char', signature: '' };
  state.chats.ch1 = { id: 'ch1', contactId: 'c1', messages: [], unread: 0, updatedAt: 0 };
  return state;
}

test('parseBehaviorReply 只解析打开的标签，关掉的降级成文字', () => {
  const text = '[转账] 12.50 奶茶钱\n[约定计划] 周末去看海';
  const open = parseBehaviorReply(text, { allowed: { transfer: true, plan: true } });
  assert.equal(open.length, 2);
  assert.equal(open[0].kind, 'transfer');
  assert.equal(open[0].behavior.amount, 12.5);
  assert.equal(open[1].kind, 'plan');

  const closed = parseBehaviorReply('[转账] 12.50 奶茶钱', { allowed: { transfer: false } });
  assert.equal(closed.length, 1);
  assert.equal(closed[0].kind, 'text');
  assert.match(closed[0].text, /转账/);
});

test('钱包收发幂等，退款能把余额退回来', () => {
  const state = stateWithContact();
  state.wallet.balance = 100;

  const sent = sendTransfer(state, { contactId: 'c1', amount: 20, note: '午饭', messageId: 'm1' });
  assert.equal(sent.ok, true);
  assert.equal(walletBalance(state), 80);
  const again = sendTransfer(state, { contactId: 'c1', amount: 20, note: '午饭', messageId: 'm1' });
  assert.equal(again.duplicate, true);
  assert.equal(walletBalance(state), 80);

  const received = receiveTransfer(state, { contactId: 'c1', amount: 8, messageId: 'm2' });
  assert.equal(received.ok, true);
  assert.equal(walletBalance(state), 88);

  assert.equal(refundTransfer(state, sent.tx.id).ok, true);
  assert.equal(walletBalance(state), 108);
});

test('余额不足时不发钱，也不产生交易', () => {
  const state = stateWithContact();
  state.wallet.balance = 5;
  const result = sendTransfer(state, { contactId: 'c1', amount: 10, messageId: 'm3' });
  assert.equal(result.ok, false);
  assert.equal(walletBalance(state), 5);
  assert.equal(state.wallet.transactions.length, 0);
});

test('会员同等级叠加、高等级插队、低等级排队', () => {
  const state = stateWithContact();
  const first = grantUserMembership(state, { type: 'vip', months: 1, from: 'c1', messageId: 'm4' });
  const before = userMembership(state).expireAt;
  assert.equal(first.duplicate, false);

  grantUserMembership(state, { type: 'vip', months: 1, from: 'c1', messageId: 'm5' });
  assert.ok(userMembership(state).expireAt > before);

  grantUserMembership(state, { type: 'svip', months: 1, from: 'c1', messageId: 'm6' });
  assert.equal(userMembership(state).type, 'svip');
  assert.equal(userMembership(state).queue.length, 1);

  grantUserMembership(state, { type: 'vip', months: 12, from: 'c1', messageId: 'm7' });
  assert.equal(userMembership(state).queue.length, 2);

  grantContactMembership(state, 'c1', { type: 'vip', months: 1, from: 'self', messageId: 'm8' });
  assert.equal(contactMembership(state, 'c1').type, 'vip');
});

test('约定计划可以创建、接受、完成并留下故事', () => {
  const state = stateWithContact();
  const created = createAppointment(state, { contactId: 'c1', title: '周末去看海', initiator: 'them', messageId: 'm9' });
  assert.equal(created.plan.status, 'pending');
  assert.equal(respondAppointment(state, { contactId: 'c1', planId: created.plan.id, accept: true }).ok, true);
  assert.equal(created.plan.status, 'accepted');
  const done = completeAppointment(state, { contactId: 'c1', planId: created.plan.id, story: { title: '看海', text: '风很大，但还是去了。' } });
  assert.equal(done.plan.status, 'completed');
  assert.equal(done.plan.story.text, '风很大，但还是去了。');
});

test('好友申请通过后会进通讯录', () => {
  const state = stateWithContact();
  const request = requestFriend(state, { contactId: 'c2', name: '江迟', text: '想加你', messageId: 'm10' });
  assert.equal(request.request.status, 'pending');
  assert.equal(state.contacts.c2, undefined);
  const result = respondFriendRequest(state, { requestId: request.request.id, accept: true });
  assert.equal(result.ok, true);
  assert.equal(state.contacts.c2.name, '江迟');
});

test('行为消息落库后副作用只执行一次', () => {
  const state = stateWithContact();
  const message = pushMessage(state, 'ch1', {
    from: 'them', kind: 'transfer', text: '[转账] ¥10.00',
    behavior: { amount: 10, note: '', status: 'completed', direction: 'received' },
  });
  applyBehaviorMessage(state, message, { contactId: 'c1', contact: state.contacts.c1 });
  applyBehaviorMessage(state, message, { contactId: 'c1', contact: state.contacts.c1 });
  assert.equal(walletBalance(state), 10);
  assert.equal(state.wallet.transactions.length, 1);
  assert.ok(message.behavior.txId);
});

test('旧存档 normalize 不会清空钱包和会员', () => {
  const raw = {
    ...emptyState(),
    wallet: { balance: 42, transactions: [] },
    membership: { user: { type: 'vip', expireAt: 9999999999999, queue: [], history: [] }, byContact: {} },
    schemaVersion: 1,
  };
  const normalized = normalize(raw);
  assert.equal(normalized.wallet.balance, 42);
  assert.equal(normalized.membership.user.type, 'vip');
  assert.equal(normalized.wallet.transactions.length, 0);
});

test('个签会更新联系人并留下历史', () => {
  const state = stateWithContact();
  updateSignature(state, { contactId: 'c1', text: '今天风很大', actionType: 'update' });
  assert.equal(state.contacts.c1.signature, '今天风很大');
  assert.equal(state.signatures.byContact.c1.length, 1);
});

test('ac sus 转账映射为行为消息，不触发钱包副作用', () => {
  const source = {
    version: 1,
    format: 'acsus-phone-chat',
    exportedAt: '2026-01-01T00:00:00.000Z',
    messageCount: 1,
    character: { id: 'shenyan', name: '沈砚' },
    messages: [{ id: 'a1', type: 'transfer', sender: 'contact', amount: 30, message: '饭钱', time: 1700000000 }],
  };
  const converted = parseChatTransferText(JSON.stringify(source));
  assert.equal(converted.messages.length, 1);
  assert.equal(converted.messages[0].kind, 'transfer');
  assert.equal(converted.messages[0].behavior.amount, 30);
});
