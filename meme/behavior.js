/**
 * meme-phone · 聊天行为注册表
 *
 * 这里只做纯逻辑：识别行为标签、生成消息草稿、渲染气泡、生成摘要和模型上下文。
 * 钱包、会员、计划、好友申请的读写全部在 behavior-domains.js，避免渲染时产生副作用。
 */

import { icon } from './icons.js';

export const BEHAVIOR_KINDS = [
  'transfer', 'redpacket',
  'gift-membership', 'buy-membership',
  'plan', 'plan-story',
  'friend-request', 'friend-added', 'friend-deleted', 'signature',
];

const SYSTEM_KINDS = new Set(['friend-added', 'friend-deleted', 'signature']);

const STATUS_LABELS = {
  pending: '待处理',
  accepted: '已接受',
  rejected: '已拒绝',
  completed: '已完成',
  cancelled: '已取消',
  reversed: '已退回',
  failed: '失败',
};

const MEMBERSHIP_LABELS = { vip: 'VIP', svip: 'SVIP' };

const MAX_AMOUNT = 10000;
const MAX_NOTE = 80;
const MAX_TITLE = 80;
const MAX_TEXT = 400;
const MAX_SIGNATURE = 80;

function str(value, limit = MAX_TEXT) {
  return String(value ?? '').trim().slice(0, limit);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  const parsed = Math.max(0.01, Math.min(MAX_AMOUNT, num(value, 0)));
  return Math.round(parsed * 100) / 100;
}

function cleanStatus(value, allowed = Object.keys(STATUS_LABELS)) {
  return allowed.includes(value) ? value : allowed[0];
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function statusLabel(status) {
  return STATUS_LABELS[status] || '';
}

function membershipLabel(type) {
  return MEMBERSHIP_LABELS[type] || '会员';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/* ---------------------------------------------------------------- 归一化 */

/** 把任意来源的行为字段收紧成可存进 state 的结构。 */
export function normalizeBehavior(kind, raw) {
  if (!BEHAVIOR_KINDS.includes(kind) || !isRecord(raw)) return null;
  const source = raw;
  if (kind === 'transfer' || kind === 'redpacket') {
    return {
      txId: str(source.txId, 48),
      amount: money(source.amount),
      note: str(source.note ?? source.message, MAX_NOTE),
      status: source.status === 'reversed' ? 'reversed' : 'completed',
      direction: source.direction === 'received' ? 'received' : 'sent',
    };
  }
  if (kind === 'gift-membership' || kind === 'buy-membership') {
    const type = source.membershipType === 'svip' ? 'svip' : 'vip';
    const months = source.months === 12 ? 12 : 1;
    return {
      membershipType: type,
      months,
      duration: months === 12 ? 365 : 30,
      price: Math.max(0, num(source.price, 0)),
      status: source.status === 'reversed' ? 'reversed' : 'completed',
      target: source.target === 'contact' ? 'contact' : 'user',
    };
  }
  if (kind === 'plan' || kind === 'plan-story') {
    return {
      planId: str(source.planId, 48),
      title: str(source.title ?? source.text, MAX_TITLE),
      status: cleanStatus(source.status, ['pending', 'accepted', 'rejected', 'completed', 'cancelled']),
      initiator: source.initiator === 'them' ? 'them' : source.initiator === 'me' ? 'me' : 'them',
    };
  }
  if (kind === 'friend-request') {
    return {
      requestId: str(source.requestId, 48),
      text: str(source.text, MAX_TEXT),
      status: cleanStatus(source.status, ['pending', 'accepted', 'rejected']),
    };
  }
  if (kind === 'friend-added' || kind === 'friend-deleted') {
    return { contactId: str(source.contactId, 60) };
  }
  if (kind === 'signature') {
    return { signature: str(source.signature, MAX_SIGNATURE), actionType: source.actionType === 'like' ? 'like' : 'update' };
  }
  return null;
}

/** 消息工厂：只生成字段，不写 state。 */
export function makeBehaviorMessage(kind, fields = {}, context = {}) {
  const behavior = normalizeBehavior(kind, fields.behavior || fields);
  if (!behavior) return null;
  const from = fields.from === 'me' || fields.from === 'system' ? fields.from : 'them';
  return {
    from,
    kind,
    text: str(fields.text, MAX_TEXT),
    behavior,
    quote: fields.quote || null,
    speaker: str(fields.speaker, 40),
    at: Number.isFinite(fields.at) ? fields.at : (context.at || Date.now()),
  };
}

/* ---------------------------------------------------------------- 解析 */

function parseAmountAndNote(rest) {
  const text = String(rest || '').trim();
  const match = text.match(/^(?:¥|￥)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*(?:元)?\s*(.*)$/);
  if (!match) return null;
  const amount = money(match[1]);
  let note = String(match[2] || '').trim();
  note = note.replace(/^[|｜\-–—]\s*/, '').trim();
  return { amount, note: str(note, MAX_NOTE) };
}

function parseMembership(rest) {
  const match = String(rest || '').trim().match(/^(VIP|SVIP)\s*[\/|｜]\s*(\d+)\s*个月$/i);
  if (!match) return null;
  const membershipType = match[1].toLowerCase() === 'svip' ? 'svip' : 'vip';
  const months = Number(match[2]) === 12 ? 12 : 1;
  const price = membershipType === 'vip' ? (months === 12 ? 108 : 10) : (months === 12 ? 216 : 20);
  return { membershipType, months, duration: months === 12 ? 365 : 30, price };
}

function parsePlanLine(line) {
  const completed = line.match(/^\[约定计划已完成\]\s*(.+)$/);
  if (completed) return { title: completed[1], status: 'completed' };
  const plan = line.match(/^\[约定计划\]\s*(.+)$/);
  if (!plan) return null;
  return { title: plan[1], status: 'pending' };
}

function parseQuoteLine(line) {
  const match = line.match(/^\[引用\]#\d+\[回复\]\s*(.+)$/s);
  if (!match) return null;
  return { text: match[1].trim(), quote: { text: '引用的消息', from: 'them' } };
}

function parseOneBubble(line, index, options) {
  const text = String(line || '').trim();
  if (!text) return null;
  if (text === '[不发]') return null;

  const base = {
    from: options.from || 'them',
    at: options.at + index * 1000,
    speaker: options.speaker || '',
  };

  const transfer = text.match(/^\[转账\]\s*(.+)$/);
  if (transfer) {
    const parsed = parseAmountAndNote(transfer[1]);
    if (!parsed) return { ...base, kind: 'text', text };
    return makeBehaviorMessage('transfer', {
      ...base,
      text: `[转账] ¥${parsed.amount}${parsed.note ? ` ${parsed.note}` : ''}`,
      behavior: { ...parsed, txId: '', status: 'completed', direction: base.from === 'me' ? 'sent' : 'received' },
    }, options);
  }

  const redpacket = text.match(/^\[红包\]\s*(.+)$/);
  if (redpacket) {
    const parsed = parseAmountAndNote(redpacket[1]);
    if (!parsed) return { ...base, kind: 'text', text };
    return makeBehaviorMessage('redpacket', {
      ...base,
      text: `[红包] ¥${parsed.amount}${parsed.note ? ` ${parsed.note}` : ''}`,
      behavior: { ...parsed, txId: '', status: 'completed', direction: base.from === 'me' ? 'sent' : 'received' },
    }, options);
  }

  const gift = text.match(/^\[送会员\]\s*(.+)$/);
  if (gift) {
    const parsed = parseMembership(gift[1]);
    if (!parsed) return { ...base, kind: 'text', text };
    return makeBehaviorMessage('gift-membership', {
      ...base,
      text: `[送会员]${parsed.months}个月${membershipLabel(parsed.membershipType)}会员`,
      behavior: { ...parsed, status: 'completed', target: 'user' },
    }, options);
  }

  const buy = text.match(/^\[开会员\]\s*(.+)$/);
  if (buy) {
    const parsed = parseMembership(buy[1]);
    if (!parsed) return { ...base, kind: 'text', text };
    return makeBehaviorMessage('buy-membership', {
      ...base,
      text: `[开会员]${parsed.months}个月${membershipLabel(parsed.membershipType)}会员`,
      behavior: { ...parsed, status: 'completed', target: 'contact' },
    }, options);
  }

  const plan = parsePlanLine(text);
  if (plan) {
    return makeBehaviorMessage('plan', {
      ...base,
      text: `[约定计划]${plan.title}`,
      behavior: { title: plan.title, status: plan.status, initiator: base.from === 'me' ? 'me' : 'them' },
    }, options);
  }

  const quote = parseQuoteLine(text);
  if (quote) {
    return { ...base, kind: 'text', text: quote.text, quote: quote.quote };
  }

  const friend = text.match(/^\[好友申请\]\s*(.+)$/s);
  if (friend) {
    return makeBehaviorMessage('friend-request', {
      ...base,
      text: `[好友申请]${friend[1]}`,
      behavior: { text: friend[1], status: 'pending' },
    }, options);
  }

  const signature = text.match(/^\[改个签\]\s*(.+)$/s);
  if (signature) {
    const value = str(signature[1], MAX_SIGNATURE);
    if (!value) return { ...base, kind: 'text', text };
    return makeBehaviorMessage('signature', {
      ...base,
      text: `[改个签]${value}`,
      behavior: { signature: value, actionType: 'update' },
    }, options);
  }

  const image = text.match(/^\[图片\]\s*(.+)$/);
  if (image) {
    const parts = image[1].split('|');
    const description = str(parts[0], MAX_TEXT);
    const imageUrl = str(parts[1], 4000);
    return { ...base, kind: 'image', text: description, image: imageUrl || '', behavior: null };
  }

  const emoji = text.match(/^\[表情\]\s*(.+)$/);
  if (emoji) {
    return { ...base, kind: 'emoji', text: emoji[1], emoji: emoji[1] };
  }

  if (text === '[戳一戳]') return { ...base, kind: 'poke', text: '' };
  const recalled = text.match(/^\[撤回\]\s*(.+)$/);
  if (recalled) return { ...base, kind: 'recalled', text: recalled[1] };
  const forwarded = text.match(/^\[转发\]\s*(.+)$/s);
  if (forwarded) {
    return { ...base, kind: 'forwarded', text: forwarded[1], forward: { text: forwarded[1], from: '' } };
  }

  return { ...base, kind: 'text', text };
}

function messageLines(text) {
  const source = String(text || '').trim();
  if (!source) return [];
  const wrapped = source.match(/\[消息\]\s*([\s\S]*?)(?:\[\/消息\]|$)/);
  if (wrapped) {
    return wrapped[1].split('\n').map(line => line.trim()).filter(Boolean);
  }
  const lines = source.split('\n').map(line => line.trim()).filter(Boolean);
  const tagged = lines.some(line => /^\[(转账|红包|送会员|开会员|约定计划|约定计划已完成|好友申请|改个签|图片|表情|戳一戳|撤回|转发|引用|心里|潜台词)\]/.test(line));
  if (!tagged) return [source];
  return lines;
}

/* 心理活动 / 潜台词：藏在气泡后面的标注，只给用户点开看，不算一条消息。
   心理活动属于「这一整段话」，一轮只收一条；潜台词逐条气泡跟在它前面那条后面。
   上限与 data.js 的 MESSAGE_INNER_MAX / MESSAGE_SUBTEXT_MAX 保持一致。 */
const MIND_LIMITS = { inner: 240, subtext: 160 };

export function parseMindLine(line) {
  const match = String(line || '').trim().match(/^\[(心里|潜台词)\]\s*([\s\S]*)$/);
  if (!match) return null;
  const key = match[1] === '心里' ? 'inner' : 'subtext';
  const text = match[2].replace(/\[\/(?:心里|潜台词)\]/g, '').trim();
  if (!text) return null;
  return { key, value: text.slice(0, MIND_LIMITS[key]) };
}

/**
 * 解析模型回复。
 * - 有 [消息] 外层标签时，一行一个气泡；
 * - 没有外层标签、但至少一行是行为标签时，也按行解析；
 * - 否则保持旧逻辑：整段是一条普通文字消息。
 */
const BEHAVIOR_GATE = {
  transfer: 'transfer',
  redpacket: 'redpacket',
  'gift-membership': 'membership',
  'buy-membership': 'membership',
  plan: 'plan',
  'friend-request': 'friend',
  signature: 'signature',
};

export function parseBehaviorReply(text, options = {}) {
  const source = String(text || '').trim();
  if (!source || source === '[不发]') return [];
  const at = Number.isFinite(options.at) ? options.at : Date.now();
  const lines = messageLines(source);
  const max = Math.max(1, Math.min(30, Number(options.max) || 30));
  const messages = [];
  let turnInner = '';
  for (const line of lines) {
    const mind = parseMindLine(line);
    if (mind) {
      if (mind.key === 'inner') {
        /* [心里] 是这一整段话的念头，不跟某一条气泡走：一轮只留第一条，统一挂到这一轮开头那个气泡上。 */
        if (!turnInner) turnInner = mind.value;
        continue;
      }
      /* 潜台词才是逐条气泡的第二层意思：挂在它前面那个气泡上。 */
      const target = messages[messages.length - 1];
      if (target) target.subtext = mind.value;
      continue;
    }
    if (messages.length >= max) continue;
    const parsed = parseOneBubble(line, messages.length, { ...options, at });
    if (!parsed) continue;
    const gate = BEHAVIOR_GATE[parsed.kind];
    if (gate && options.allowed && options.allowed[gate] === false) {
      parsed.kind = 'text';
      parsed.text = line;
      parsed.behavior = null;
    }
    messages.push(parsed);
  }
  if (turnInner && messages.length) messages[0].inner = turnInner;
  return messages;
}

/* ---------------------------------------------------------------- 渲染 */

function bubbleClass(message, extra = '') {
  const mine = message.from === 'me';
  return `mp-bubble ${mine ? 'is-me' : 'is-them'}${extra ? ` ${extra}` : ''}`;
}

function renderTransfer(message) {
  const behavior = message.behavior || {};
  const amount = money(behavior.amount);
  const note = str(behavior.note, MAX_NOTE);
  const status = behavior.status === 'reversed' ? '已退回' : '已到账';
  return `
    <div class="${bubbleClass(message, 'mp-bubble-pay')}">
      <div class="mp-pay-head">${icon('transfer')}<span>${message.kind === 'redpacket' ? '红包' : '转账'}</span><b>¥${amount.toFixed(2)}</b></div>
      ${note ? `<div class="mp-pay-note">${escapeHtml(note)}</div>` : ''}
      <div class="mp-pay-foot"><span>${status}</span><span>${message.from === 'me' ? '你发出' : 'TA 发来'}</span></div>
    </div>`;
}

function renderMembership(message) {
  const behavior = message.behavior || {};
  const type = membershipLabel(behavior.membershipType);
  const months = behavior.months === 12 ? '12 个月' : '1 个月';
  return `
    <div class="${bubbleClass(message, 'mp-bubble-member')}">
      <div class="mp-member-head">${icon('spark')}<span>${message.kind === 'gift-membership' ? '赠送会员' : '开通会员'}</span></div>
      <div class="mp-member-main">${escapeHtml(type)} · ${months}</div>
      <div class="mp-member-foot">${message.from === 'me' ? '你送出' : 'TA 送出'}${behavior.price ? ` · ¥${Number(behavior.price).toFixed(2)}` : ''}</div>
    </div>`;
}

function renderPlan(message, context = {}) {
  const behavior = message.behavior || {};
  const status = behavior.status || 'pending';
  const mine = message.from === 'me';
  const showActions = status === 'pending' && !mine;
  const showComplete = status === 'accepted' && !mine;
  return `
    <div class="${bubbleClass(message, 'mp-bubble-plan')}">
      <div class="mp-plan-head">${icon('plan')}<span>约定计划</span><em class="mp-plan-status is-${status}">${statusLabel(status)}</em></div>
      <div class="mp-plan-title">${escapeHtml(behavior.title || message.text || '')}</div>
      ${showActions || showComplete ? `<div class="mp-plan-actions">
        ${showActions ? `<button class="mp-mini-btn" data-act="behavior-plan-respond" data-chat="${escapeHtml(context.chatId || '')}" data-msg="${escapeHtml(message.id || '')}" data-accept="1" type="button">接受</button>
        <button class="mp-mini-btn plain" data-act="behavior-plan-respond" data-chat="${escapeHtml(context.chatId || '')}" data-msg="${escapeHtml(message.id || '')}" data-accept="0" type="button">拒绝</button>` : ''}
        ${showComplete ? `<button class="mp-mini-btn" data-act="behavior-plan-complete" data-chat="${escapeHtml(context.chatId || '')}" data-msg="${escapeHtml(message.id || '')}" type="button">完成了</button>` : ''}
      </div>` : ''}
    </div>`;
}

function renderPlanStory(message, context = {}) {
  const behavior = message.behavior || {};
  return `
    <div class="${bubbleClass(message, 'mp-bubble-story')}">
      <div class="mp-plan-head">${icon('theater')}<span>计划故事</span><em class="mp-plan-status is-completed">${statusLabel(behavior.status || 'completed')}</em></div>
      <div class="mp-plan-title">${escapeHtml(behavior.title || '')}</div>
      <button class="mp-story-link" data-act="behavior-plan-story" data-chat="${escapeHtml(context.chatId || '')}" data-msg="${escapeHtml(message.id || '')}" type="button">打开故事 →</button>
    </div>`;
}

function renderFriendRequest(message, context = {}) {
  const behavior = message.behavior || {};
  const status = behavior.status || 'pending';
  return `
    <div class="${bubbleClass(message, 'mp-bubble-friend')}">
      <div class="mp-friend-head">${icon('contacts')}<span>好友申请</span>${status !== 'pending' ? `<em class="mp-plan-status is-${status}">${statusLabel(status)}</em>` : ''}</div>
      <div class="mp-friend-text">${escapeHtml(behavior.text || message.text || '')}</div>
      ${status === 'pending' ? `<div class="mp-plan-actions">
        <button class="mp-mini-btn" data-act="behavior-friend-respond" data-chat="${escapeHtml(context.chatId || '')}" data-msg="${escapeHtml(message.id || '')}" data-accept="1" type="button">通过</button>
        <button class="mp-mini-btn plain" data-act="behavior-friend-respond" data-chat="${escapeHtml(context.chatId || '')}" data-msg="${escapeHtml(message.id || '')}" data-accept="0" type="button">不通过</button>
      </div>` : ''}
    </div>`;
}

function renderSignature(message) {
  const behavior = message.behavior || {};
  return `<div class="mp-sys is-signature">${icon('reply')}<span>${escapeHtml(message.from === 'me' ? '你' : 'TA')} 换了个签：${escapeHtml(behavior.signature || '')}</span></div>`;
}

function renderSystemEvent(message) {
  const behavior = message.behavior || {};
  const name = behavior.contactName || behavior.name || 'TA';
  if (message.kind === 'friend-added') return `<div class="mp-sys">${icon('contacts')}<span>${escapeHtml(name)} 已通过好友申请</span></div>`;
  if (message.kind === 'friend-deleted') return `<div class="mp-sys">${icon('trash')}<span>${escapeHtml(name)} 已从通讯录移除</span></div>`;
  return `<div class="mp-sys">${escapeHtml(message.text || '')}</div>`;
}

export function isSystemBehavior(message) {
  return SYSTEM_KINDS.has(message?.kind);
}

/** 纯渲染：绝不写 state。 */
export function renderBehaviorBubble(message, context = {}) {
  if (!message) return '';
  if (message.kind === 'transfer' || message.kind === 'redpacket') return renderTransfer(message);
  if (message.kind === 'gift-membership' || message.kind === 'buy-membership') return renderMembership(message);
  if (message.kind === 'plan') return renderPlan(message, context);
  if (message.kind === 'plan-story') return renderPlanStory(message, context);
  if (message.kind === 'friend-request') return renderFriendRequest(message, context);
  if (message.kind === 'signature') return renderSignature(message);
  if (message.kind === 'friend-added' || message.kind === 'friend-deleted') return renderSystemEvent(message);
  return '';
}

/* ---------------------------------------------------------------- 摘要 / 上下文 */

export function behaviorPreview(message) {
  if (!message) return '';
  if (message.kind === 'transfer') return `[转账] ¥${money(message.behavior?.amount).toFixed(2)}`;
  if (message.kind === 'redpacket') return `[红包] ¥${money(message.behavior?.amount).toFixed(2)}`;
  if (message.kind === 'gift-membership') return `[送会员] ${message.behavior?.months === 12 ? '12' : '1'} 个月${membershipLabel(message.behavior?.membershipType)}`;
  if (message.kind === 'buy-membership') return `[开会员] ${message.behavior?.months === 12 ? '12' : '1'} 个月${membershipLabel(message.behavior?.membershipType)}`;
  if (message.kind === 'plan') return `[约定计划] ${message.behavior?.title || message.text || ''}`;
  if (message.kind === 'plan-story') return `[计划故事] ${message.behavior?.title || ''}`;
  if (message.kind === 'friend-request') return `[好友申请] ${message.behavior?.text || message.text || ''}`;
  if (message.kind === 'friend-added') return '[好友通过]';
  if (message.kind === 'friend-deleted') return '[好友删除]';
  if (message.kind === 'signature') return `[个签] ${message.behavior?.signature || ''}`;
  return message.text || '';
}

export function behaviorContextText(message) {
  if (!message) return '';
  if (message.kind === 'transfer') {
    const amount = money(message.behavior?.amount);
    const note = message.behavior?.note ? ` ${message.behavior.note}` : '';
    return `[转账]${amount}元${note}`;
  }
  if (message.kind === 'redpacket') return `[红包]${money(message.behavior?.amount)}`;
  if (message.kind === 'gift-membership') return `[送会员]${membershipLabel(message.behavior?.membershipType)}/${message.behavior?.months === 12 ? 12 : 1}个月`;
  if (message.kind === 'buy-membership') return `[开会员]${membershipLabel(message.behavior?.membershipType)}/${message.behavior?.months === 12 ? 12 : 1}个月`;
  if (message.kind === 'plan') {
    const status = message.behavior?.status;
    if (status === 'completed') return `[约定计划已完成]${message.behavior?.title || ''}`;
    return `[约定计划]${message.behavior?.title || message.text || ''}`;
  }
  if (message.kind === 'plan-story') return `[计划故事]${message.behavior?.title || ''}`;
  if (message.kind === 'friend-request') return `[好友申请]${message.behavior?.text || message.text || ''}`;
  if (message.kind === 'signature') return `[改个签]${message.behavior?.signature || ''}`;
  if (message.kind === 'friend-added') return '[好友申请通过]';
  if (message.kind === 'friend-deleted') return '[好友已删除]';
  return message.text || '';
}

/* ---------------------------------------------------------------- 模型提示 */

const PROMPT_LINES = {
  transfer: '[转账]金额|留言',
  redpacket: '[红包]金额',
  membership: '[送会员]VIP/1个月 或 [送会员]SVIP/12个月',
  plan: '[约定计划]一句话标题',
  friend: '[好友申请]一句话',
  signature: '[改个签]新签名',
};

export function behaviorSettings(state, chat) {
  const defaults = {
    transfer: false, redpacket: false, membership: false, plan: true, friend: false, signature: true,
  };
  return { ...defaults, ...(state?.settings?.chat?.behavior || {}), ...(chat?.behavior || {}) };
}

/** 只在对应开关开启时把行为标签注入；默认不放开转账、红包、会员和好友申请。 */
export function behaviorPrompt(state, chat) {
  const settings = behaviorSettings(state, chat);
  const lines = [];
  if (settings.transfer) lines.push(PROMPT_LINES.transfer);
  if (settings.redpacket) lines.push(PROMPT_LINES.redpacket);
  if (settings.membership) lines.push(PROMPT_LINES.membership);
  if (settings.plan) lines.push(PROMPT_LINES.plan);
  if (settings.friend) lines.push(PROMPT_LINES.friend);
  if (settings.signature) lines.push(PROMPT_LINES.signature);
  if (!lines.length) return '';
  return [
    '【聊天行为】',
    '需要时可以在回复里加入下面这些行为标签。每个标签单独占一行；普通文字也一行一条时，请用 [消息] 包裹。',
    ...lines,
    '不要连续发送多条转账或会员行为；没有明确必要时不要使用。',
  ].join('\n');
}

export function behaviorOptions(state, chat) {
  return behaviorSettings(state, chat);
}

/* ---------------------------------------------------------------- acsus 兼容 */

function acsusContent(message) {
  return String(message?.content ?? message?.replyContent ?? message?.description ?? message?.message ?? '').trim();
}

function acsusKind(type) {
  if (type === 'gift-membership') return 'gift-membership';
  if (type === 'buy-membership') return 'buy-membership';
  if (type === 'plan') return 'plan';
  if (type === 'plan-story') return 'plan-story';
  if (type === 'friend-request' || type === 'friend_request') return 'friend-request';
  if (type === 'friend-added' || type === 'friend_added') return 'friend-added';
  if (type === 'friend-deleted' || type === 'friend_deleted') return 'friend-deleted';
  if (type === 'signature') return 'signature';
  if (type === 'transfer') return 'transfer';
  if (type === 'redpacket') return 'redpacket';
  return '';
}

/**
 * acsus 消息 -> meme 行为消息。只做字段映射，不执行钱包 / 会员 / 计划副作用。
 * 导入器调用它之后仍然只做 pushMessage。
 */
export function fromAcsusMessage(message, index = 0, fallbackKey = '') {
  if (!isRecord(message)) return null;
  const type = String(message.type || 'text');
  const from = message.sender === 'user' ? 'me' : message.sender === 'contact' ? 'them' : 'system';
  const at = Number.isFinite(message.time) ? (message.time < 1e12 ? message.time * 1000 : message.time) : Date.now();
  const id = typeof message.id === 'string' && message.id.trim()
    ? message.id
    : `m_import_acsus_${fallbackKey}_${index}`;
  const content = acsusContent(message);
  const kind = acsusKind(type);
  if (!kind) return null;

  if (kind === 'transfer' || kind === 'redpacket') {
    const amount = money(message.amount);
    const note = str(message.message ?? message.content, MAX_NOTE);
    return {
      id,
      from,
      at,
      kind,
      text: `[${kind === 'transfer' ? '转账' : '红包'}] ¥${amount.toFixed(2)}${note ? ` ${note}` : ''}`,
      quote: null,
      speaker: str(message.senderName, 40),
      behavior: { txId: str(message.transactionId ?? message.txId, 48), amount, note, status: 'completed', direction: from === 'me' ? 'sent' : 'received' },
    };
  }

  if (kind === 'gift-membership' || kind === 'buy-membership') {
    const membershipType = message.membershipType === 'svip' ? 'svip' : 'vip';
    const months = Number(message.months) === 12 ? 12 : 1;
    const duration = Number(message.duration) || (months === 12 ? 365 : 30);
    return {
      id,
      from,
      at,
      kind,
      text: `[${kind === 'gift-membership' ? '送会员' : '开会员'}]${months}个月${membershipLabel(membershipType)}会员`,
      quote: null,
      speaker: str(message.senderName, 40),
      behavior: {
        membershipType, months, duration,
        price: Math.max(0, num(message.price, membershipType === 'vip' ? (months === 12 ? 108 : 10) : (months === 12 ? 216 : 20))),
        status: 'completed',
        target: kind === 'gift-membership' ? 'user' : 'contact',
      },
    };
  }

  if (kind === 'plan') {
    const title = str(content.replace(/^\[约定计划(?:已完成)?\]\s*/, ''), MAX_TITLE);
    const status = content.startsWith('[约定计划已完成]') ? 'completed' : 'pending';
    return {
      id,
      from,
      at,
      kind,
      text: content || `[约定计划]${title}`,
      quote: null,
      speaker: str(message.senderName, 40),
      behavior: {
        planId: str(message.planId, 48),
        title,
        status,
        initiator: from === 'me' ? 'me' : 'them',
      },
    };
  }

  if (kind === 'plan-story') {
    const story = str(message.story ?? message.content ?? message.description, 4000);
    return {
      id,
      from,
      at,
      kind,
      text: `[计划故事]${str(message.title, MAX_TITLE)}`,
      quote: null,
      speaker: str(message.senderName, 40),
      behavior: { planId: str(message.planId, 48), title: str(message.title, MAX_TITLE), status: 'completed', initiator: 'them', story },
    };
  }

  if (kind === 'friend-request') {
    return {
      id,
      from,
      at,
      kind,
      text: `[好友申请]${content}`,
      quote: null,
      speaker: str(message.senderName, 40),
      behavior: { requestId: str(message.requestId ?? message.id, 48), text: str(content, MAX_TEXT), status: 'pending' },
    };
  }

  if (kind === 'friend-added' || kind === 'friend-deleted') {
    return {
      id,
      from: 'system',
      at,
      kind,
      text: content,
      quote: null,
      speaker: '',
      behavior: { contactId: str(message.contactId, 60), name: str(message.contactName ?? message.name, 40) },
    };
  }

  return {
    id,
    from,
    at,
    kind: 'signature',
    text: `[改个签]${str(message.signature ?? content, MAX_SIGNATURE)}`,
    quote: null,
    speaker: '',
    behavior: { signature: str(message.signature ?? content, MAX_SIGNATURE), actionType: 'update' },
  };
}
