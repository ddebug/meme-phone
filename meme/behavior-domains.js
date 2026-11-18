/**
 * meme-phone · 行为领域服务
 *
 * 钱包、会员、约定计划、好友申请、个签的唯一读写入口。
 * 所有函数只改 state 并返回结果，不渲染、不依赖 DOM。
 */

import { addContact, contactById } from './data.js';

const MAX_LEDGER = 5000;
const MAX_SIGNATURE_HISTORY = 50;
const MAX_AMOUNT = 10000;

function roundMoney(value) {
  return Math.round(Math.max(0, Math.min(MAX_AMOUNT, Number(value) || 0)) * 100) / 100;
}

function localId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function ensureWallet(state) {
  if (!state.wallet || typeof state.wallet !== 'object' || Array.isArray(state.wallet)) {
    state.wallet = { balance: 0, transactions: [] };
  }
  state.wallet.balance = roundMoney(state.wallet.balance);
  state.wallet.transactions = list(state.wallet.transactions).slice(0, MAX_LEDGER);
  return state.wallet;
}

function ensureMembership(state) {
  if (!state.membership || typeof state.membership !== 'object' || Array.isArray(state.membership)) {
    state.membership = { user: { type: 'none', expireAt: 0, queue: [], history: [] }, byContact: {} };
  }
  state.membership.user = membershipRecord(state.membership.user);
  state.membership.byContact = record(state.membership.byContact);
  return state.membership;
}

function membershipRecord(raw) {
  const source = record(raw);
  return {
    type: ['vip', 'svip'].includes(source.type) ? source.type : 'none',
    expireAt: Number(source.expireAt) || 0,
    queue: list(source.queue).map(item => ({
      type: ['vip', 'svip'].includes(item?.type) ? item.type : 'vip',
      duration: Math.max(1, Math.min(3650, Number(item?.duration) || 30)),
      messageId: String(item?.messageId || ''),
    })).slice(0, 20),
    history: list(source.history).map(item => ({ ...item })).slice(-200),
  };
}

function ensureAppointments(state) {
  if (!state.appointments || typeof state.appointments !== 'object' || Array.isArray(state.appointments)) {
    state.appointments = { byContact: {} };
  }
  if (!state.appointments.byContact || typeof state.appointments.byContact !== 'object' || Array.isArray(state.appointments.byContact)) {
    state.appointments.byContact = {};
  }
  return state.appointments;
}

function ensureFriendRequests(state) {
  if (!Array.isArray(state.friendRequests)) state.friendRequests = [];
  return state.friendRequests;
}

function ensureSignatures(state) {
  if (!state.signatures || typeof state.signatures !== 'object' || Array.isArray(state.signatures)) {
    state.signatures = { byContact: {} };
  }
  if (!state.signatures.byContact || typeof state.signatures.byContact !== 'object' || Array.isArray(state.signatures.byContact)) {
    state.signatures.byContact = {};
  }
  return state.signatures;
}

/* ---------------------------------------------------------------- 钱包 */

export function walletBalance(state) {
  return ensureWallet(state).balance;
}

export function walletTransactions(state, contactId = '') {
  const wallet = ensureWallet(state);
  return contactId
    ? wallet.transactions.filter(item => item.contactId === contactId)
    : wallet.transactions;
}

export function findWalletTransaction(state, messageId, direction = '') {
  return ensureWallet(state).transactions.find(item => (
    messageId && item.messageId === messageId && (!direction || item.direction === direction)
  )) || null;
}

function appendTransaction(state, tx) {
  const wallet = ensureWallet(state);
  wallet.transactions.unshift(tx);
  wallet.transactions = wallet.transactions.slice(0, MAX_LEDGER);
  return tx;
}

export function sendTransfer(state, { contactId, amount, note = '', messageId = '', type = 'transfer' }) {
  const wallet = ensureWallet(state);
  const value = roundMoney(amount);
  if (value <= 0) return { ok: false, reason: '金额必须大于 0' };
  const existing = findWalletTransaction(state, messageId, 'sent');
  if (existing) return { ok: true, tx: existing, duplicate: true };
  if (wallet.balance < value) return { ok: false, reason: `余额不足，当前 ¥${wallet.balance.toFixed(2)}` };

  wallet.balance = roundMoney(wallet.balance - value);
  const tx = appendTransaction(state, {
    id: localId('tx'),
    contactId: String(contactId || ''),
    type: type === 'redpacket' ? 'redpacket' : 'transfer',
    direction: 'sent',
    amount: value,
    note: String(note || '').slice(0, 80),
    messageId: String(messageId || ''),
    status: 'completed',
    at: Date.now(),
  });
  return { ok: true, tx };
}

export function receiveTransfer(state, { contactId, amount, note = '', messageId = '', type = 'transfer' }) {
  const wallet = ensureWallet(state);
  const value = roundMoney(amount);
  if (value <= 0) return { ok: false, reason: '金额必须大于 0' };
  const existing = findWalletTransaction(state, messageId, 'received');
  if (existing) return { ok: true, tx: existing, duplicate: true };

  wallet.balance = roundMoney(wallet.balance + value);
  const tx = appendTransaction(state, {
    id: localId('tx'),
    contactId: String(contactId || ''),
    type: type === 'redpacket' ? 'redpacket' : 'transfer',
    direction: 'received',
    amount: value,
    note: String(note || '').slice(0, 80),
    messageId: String(messageId || ''),
    status: 'completed',
    at: Date.now(),
  });
  return { ok: true, tx };
}

export function refundTransfer(state, txId) {
  const wallet = ensureWallet(state);
  const tx = wallet.transactions.find(item => item.id === txId);
  if (!tx) return { ok: false, reason: '找不到这笔记录' };
  if (tx.status === 'reversed') return { ok: true, tx, duplicate: true };

  if (tx.direction === 'received') {
    if (wallet.balance < tx.amount) {
      return { ok: false, reason: `余额不足，无法退回这笔 ¥${tx.amount.toFixed(2)}` };
    }
    wallet.balance = roundMoney(wallet.balance - tx.amount);
  } else {
    wallet.balance = roundMoney(wallet.balance + tx.amount);
  }
  tx.status = 'reversed';
  tx.reversedAt = Date.now();
  return { ok: true, tx };
}

/* ---------------------------------------------------------------- 会员 */

function levelOf(type) {
  if (type === 'svip') return 2;
  if (type === 'vip') return 1;
  return 0;
}

function daysFor(months) {
  return months === 12 ? 365 : 30;
}

function grantMembership(target, { type, months, price, from, messageId }) {
  const membershipType = type === 'svip' ? 'svip' : 'vip';
  const value = months === 12 ? 12 : 1;
  const days = daysFor(value);
  const now = Date.now();
  const existing = target.history.find(item => messageId && item.messageId === messageId);
  if (existing) return { membership: target, history: existing, duplicate: true };

  if (target.type === 'none' || target.expireAt <= now) {
    target.type = membershipType;
    target.expireAt = now + days * 86400000;
    target.queue = [];
  } else {
    const currentLevel = levelOf(target.type);
    const nextLevel = levelOf(membershipType);
    if (nextLevel > currentLevel) {
      const remainingDays = Math.max(1, Math.ceil((target.expireAt - now) / 86400000));
      target.queue.push({ type: target.type, duration: remainingDays, messageId: '' });
      target.type = membershipType;
      target.expireAt = now + days * 86400000;
    } else if (nextLevel < currentLevel) {
      target.queue.push({ type: membershipType, duration: days, messageId: String(messageId || '') });
      target.queue = target.queue.slice(-20);
    } else {
      target.expireAt += days * 86400000;
    }
  }

  const history = {
    id: localId('member'),
    type: membershipType,
    months: value,
    duration: days,
    price: roundMoney(price),
    from: String(from || 'self'),
    messageId: String(messageId || ''),
    at: now,
  };
  target.history.push(history);
  target.history = target.history.slice(-200);
  return { membership: target, history, duplicate: false };
}

export function userMembership(state) {
  return ensureMembership(state).user;
}

export function contactMembership(state, contactId) {
  const membership = ensureMembership(state);
  if (!membership.byContact[contactId]) {
    membership.byContact[contactId] = membershipRecord(null);
  }
  return membership.byContact[contactId];
}

export function grantUserMembership(state, { type, months, price = 0, from = 'self', messageId = '' }) {
  const membership = ensureMembership(state);
  return grantMembership(membership.user, { type, months, price, from, messageId });
}

export function grantContactMembership(state, contactId, { type, months, price = 0, from = 'self', messageId = '' }) {
  const membership = ensureMembership(state);
  if (!membership.byContact[contactId]) membership.byContact[contactId] = membershipRecord(null);
  return grantMembership(membership.byContact[contactId], { type, months, price, from, messageId });
}

export function revokeMembership(state, { target = 'user', contactId = '', messageId }) {
  const membership = ensureMembership(state);
  const record = target === 'contact' ? (membership.byContact[contactId] || null) : membership.user;
  if (!record || !messageId) return { ok: false, reason: '找不到会员记录' };
  const history = record.history.find(item => item.messageId === messageId);
  if (!history) return { ok: false, reason: '找不到这次开通记录' };
  if (history.reversed) return { ok: true, duplicate: true };
  history.reversed = true;
  record.expireAt = Math.max(0, record.expireAt - history.duration * 86400000);
  if (record.expireAt <= Date.now()) {
    record.type = 'none';
    record.expireAt = 0;
  }
  const queued = record.queue.findIndex(item => messageId && item.messageId === messageId);
  if (queued >= 0) record.queue.splice(queued, 1);
  return { ok: true };
}

export function membershipLabel(type) {
  return type === 'svip' ? 'SVIP' : type === 'vip' ? 'VIP' : '未开通';
}

export function membershipSummary(state, { target = 'user', contactId = '' } = {}) {
  const membership = target === 'contact' ? contactMembership(state, contactId) : userMembership(state);
  const active = membership.expireAt > Date.now();
  if (!active) return { type: 'none', label: '未开通', expireAt: 0, queue: 0 };
  return {
    type: membership.type,
    label: membershipLabel(membership.type),
    expireAt: membership.expireAt,
    queue: membership.queue.length,
  };
}

/* ---------------------------------------------------------------- 约定计划 */

export function appointmentsFor(state, contactId) {
  const appointments = ensureAppointments(state);
  if (!appointments.byContact[contactId]) appointments.byContact[contactId] = [];
  return appointments.byContact[contactId];
}

export function appointmentById(state, contactId, planId) {
  return appointmentsFor(state, contactId).find(item => item.id === planId) || null;
}

export function appointmentByMessage(state, contactId, messageId) {
  if (!messageId) return null;
  return appointmentsFor(state, contactId).find(item => item.messageId === messageId) || null;
}

export function createAppointment(state, { contactId, title, initiator = 'them', messageId = '' }) {
  const appointments = appointmentsFor(state, contactId);
  const existing = messageId ? appointments.find(item => item.messageId === messageId) : null;
  if (existing) return { plan: existing, duplicate: true };
  const plan = {
    id: localId('plan'),
    contactId: String(contactId || ''),
    messageId: String(messageId || ''),
    title: String(title || '').trim().slice(0, 80),
    initiator: initiator === 'me' ? 'me' : 'them',
    status: 'pending',
    createdAt: Date.now(),
    respondedAt: 0,
    completedAt: 0,
    story: null,
  };
  if (!plan.title) return { ok: false, reason: '计划标题是空的' };
  appointments.unshift(plan);
  return { plan, duplicate: false };
}

export function respondAppointment(state, { contactId, planId, accept }) {
  const plan = appointmentById(state, contactId, planId);
  if (!plan) return { ok: false, reason: '找不到这个约定' };
  if (plan.status !== 'pending') return { ok: false, reason: '这个约定已经处理过了' };
  plan.status = accept ? 'accepted' : 'rejected';
  plan.respondedAt = Date.now();
  return { ok: true, plan };
}

export function completeAppointment(state, { contactId, planId, story = null }) {
  const plan = appointmentById(state, contactId, planId);
  if (!plan) return { ok: false, reason: '找不到这个约定' };
  if (!['accepted', 'completed'].includes(plan.status)) return { ok: false, reason: '先接受这个约定' };
  plan.status = 'completed';
  plan.completedAt = Date.now();
  if (story) {
    plan.story = {
      id: localId('story'),
      title: String(story.title || plan.title || '').slice(0, 80),
      text: String(story.text || '').slice(0, 4000),
      outcome: String(story.outcome || '').slice(0, 20),
      at: Date.now(),
    };
  }
  return { ok: true, plan };
}

export function cancelAppointment(state, { contactId, planId }) {
  const plan = appointmentById(state, contactId, planId);
  if (!plan) return { ok: false, reason: '找不到这个约定' };
  plan.status = 'cancelled';
  return { ok: true, plan };
}

/* ---------------------------------------------------------------- 好友 / 个签 */

export function friendRequests(state) {
  return ensureFriendRequests(state);
}

export function pendingFriendRequests(state) {
  return friendRequests(state).filter(item => item.status === 'pending');
}

export function requestFriend(state, { contactId, name = '', text = '', messageId = '' }) {
  const requests = ensureFriendRequests(state);
  const existing = requests.find(item => item.contactId === contactId && item.status === 'pending');
  if (existing) {
    existing.text = String(text || existing.text).slice(0, 400);
    return { request: existing, duplicate: true };
  }
  const request = {
    id: localId('fr'),
    contactId: String(contactId || ''),
    name: String(name || '').slice(0, 40),
    text: String(text || '').slice(0, 400),
    status: 'pending',
    messageId: String(messageId || ''),
    at: Date.now(),
  };
  requests.unshift(request);
  return { request, duplicate: false };
}

export function respondFriendRequest(state, { requestId, accept }) {
  const requests = ensureFriendRequests(state);
  const request = requests.find(item => item.id === requestId);
  if (!request) return { ok: false, reason: '找不到这条好友申请' };
  if (request.status !== 'pending') return { ok: false, reason: '这条申请已经处理过了' };
  request.status = accept ? 'accepted' : 'rejected';
  if (!accept) return { ok: true, request };

  let contact = contactById(state, request.contactId);
  if (!contact) {
    contact = addContact(state, {
      id: request.contactId,
      name: request.name || '新朋友',
      kind: 'char',
      signature: '',
    });
  }
  return { ok: true, request, contact };
}

export function signatureHistory(state, contactId) {
  const signatures = ensureSignatures(state);
  if (!signatures.byContact[contactId]) signatures.byContact[contactId] = [];
  return signatures.byContact[contactId];
}

export function updateSignature(state, { contactId, text, actionType = 'update' }) {
  const value = String(text || '').trim().slice(0, 80);
  if (!value) return { ok: false, reason: '签名是空的' };
  const contact = contactById(state, contactId);
  if (!contact) return { ok: false, reason: '找不到这个联系人' };
  contact.signature = value;
  const list = signatureHistory(state, contactId);
  list.unshift({
    id: localId('sig'),
    text: value,
    actionType: actionType === 'like' ? 'like' : 'update',
    at: Date.now(),
  });
  list.splice(MAX_SIGNATURE_HISTORY);
  return { ok: true, contact };
}

export function revertSignature(state, { contactId, signatureId }) {
  const history = signatureHistory(state, contactId);
  const entry = history.find(item => item.id === signatureId);
  const contact = contactById(state, contactId);
  if (!entry || !contact) return { ok: false, reason: '找不到这条个签记录' };
  contact.signature = entry.text;
  return { ok: true, entry };
}

/* ---------------------------------------------------------------- 消息副作用 */

/**
 * 行为消息落库后执行一次领域副作用。
 * 导入历史消息不要调用这里，否则会重复加钱 / 开通会员。
 */
export function applyBehaviorMessage(state, message, context = {}) {
  if (!message || !message.behavior) return { ok: true, skipped: true };
  const kind = message.kind;
  const behavior = message.behavior;
  const contactId = String(context.contactId || context.contact?.id || '');
  const fromMe = message.from === 'me';

  if (kind === 'transfer' || kind === 'redpacket') {
    const result = fromMe
      ? sendTransfer(state, { contactId, amount: behavior.amount, note: behavior.note, messageId: message.id, type: kind })
      : receiveTransfer(state, { contactId, amount: behavior.amount, note: behavior.note, messageId: message.id, type: kind });
    if (result.ok && result.tx) {
      behavior.txId = result.tx.id;
      behavior.status = result.tx.status === 'reversed' ? 'reversed' : 'completed';
      behavior.direction = result.tx.direction;
    }
    return result;
  }

  if (kind === 'gift-membership' || kind === 'buy-membership') {
    const target = kind === 'gift-membership'
      ? (fromMe ? 'contact' : 'user')
      : (fromMe ? 'user' : 'contact');
    if (fromMe && behavior.price > 0) {
      const wallet = ensureWallet(state);
      if (wallet.balance < behavior.price) {
        return { ok: false, reason: `余额不足，当前 ¥${wallet.balance.toFixed(2)}` };
      }
      wallet.balance = roundMoney(wallet.balance - behavior.price);
      appendTransaction(state, {
        id: localId('tx'),
        contactId,
        type: 'gift',
        direction: 'sent',
        amount: behavior.price,
        note: target === 'contact' ? '赠送会员' : '开通会员',
        messageId: message.id,
        status: 'completed',
        at: Date.now(),
      });
    }
    const result = target === 'contact'
      ? grantContactMembership(state, contactId, {
        type: behavior.membershipType, months: behavior.months, price: behavior.price,
        from: fromMe ? 'self' : 'contact', messageId: message.id,
      })
      : grantUserMembership(state, {
        type: behavior.membershipType, months: behavior.months, price: behavior.price,
        from: fromMe ? 'self' : contactId, messageId: message.id,
      });
    return { ok: true, ...result };
  }

  if (kind === 'plan') {
    const result = createAppointment(state, {
      contactId,
      title: behavior.title || message.text,
      initiator: fromMe ? 'me' : 'them',
      messageId: message.id,
    });
    if (result.plan) behavior.planId = result.plan.id;
    return result.ok === false ? result : { ok: true, ...result };
  }

  if (kind === 'plan-story') {
    const plan = appointmentById(state, contactId, behavior.planId) || appointmentByMessage(state, contactId, message.id);
    if (!plan) return { ok: false, reason: '找不到关联的约定' };
    const result = completeAppointment(state, { contactId, planId: plan.id, story: { title: behavior.title, text: behavior.story || message.text } });
    behavior.planId = plan.id;
    return result;
  }

  if (kind === 'friend-request') {
    const result = requestFriend(state, {
      contactId,
      name: context.contact?.name || '',
      text: behavior.text || message.text,
      messageId: message.id,
    });
    if (result.request) behavior.requestId = result.request.id;
    return result.ok === false ? result : { ok: true, ...result };
  }

  if (kind === 'signature') {
    if (fromMe) {
      state.settings.profile = state.settings.profile || { bio: '', banner: '' };
      state.settings.profile.bio = String(behavior.signature || '').slice(0, 30);
      return { ok: true };
    }
    return updateSignature(state, { contactId, text: behavior.signature, actionType: behavior.actionType });
  }

  return { ok: true, skipped: true };
}
