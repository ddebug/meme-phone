/**
 * meme-phone · 回复预设的唯一上下文组装入口
 * 预览和实际聊天都调用 buildReplyMessages，保证「看到的」和「发出去的」是同一份。
 * 旧的独立拼装函数已删除，避免出现两套逻辑。
 */

import { replyContextFor, replyItemsFor, replyPresetFor, normalizeReplyContext, normalizeReplyItems, fillPromptTokens, characterCardFor, itemAppliesToChat, effectivePhoneHistoryLimit, dayKey } from './data.js';
import { readWorldBook } from './host.js';
import { buildMemoryContext } from './memory.js';
import { behaviorContextText } from './behavior.js';
import { diaryDayGroups, diaryEntryIsCurrent } from './diary.js';

/* ------------------------------------------------------------ 请求统计 */

const FULL_PUNCT = '，。！？；：“”‘’、（）《》【】〈〉…—·「」『』～';
const CJK_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/u;

/** 普通回复的场景提示；预览与实际发送共用，避免两套文案。 */
export function replyLead(contact) {
  return `你在扮演「${contact?.name || '对方'}」，用手机聊天，只说一条消息。`;
}

/** 主动开口的场景提示；预览与实际发送共用。 */
export function proactiveLead(state, contact) {
  const idle = state?.settings?.proactive?.idleMinutes;
  return `你在扮演「${contact?.name || '对方'}」，现在是手机聊天。距离上次说话已经过去 ${idle} 分钟，你要主动发一条消息。`;
}

/**
 * 本地 token 估算：中文按 1 字 1 tk，其它字符按 4 字符 1 tk，emoji 按 2 tk。
 * 不引依赖，不冒充精确分词；界面上统一带 ≈。
 */
export function estimateTokens(input) {
  const text = String(input || '');
  let tokens = 0;
  let asciiRun = 0;
  const flushAscii = () => {
    if (asciiRun) tokens += Math.ceil(asciiRun / 4);
    asciiRun = 0;
  };
  for (const ch of text) {
    if (ch.charCodeAt(0) <= 0x7f) {
      asciiRun += 1;
      continue;
    }
    flushAscii();
    if (CJK_RE.test(ch) || FULL_PUNCT.includes(ch)) tokens += 1;
    else if (/\p{Extended_Pictographic}/u.test(ch)) tokens += 2;
    else tokens += 1;
  }
  flushAscii();
  return tokens;
}

const REQUEST_GROUP_LABELS = {
  rule: '规则',
  context: '设定',
  tavern: '酒馆历史',
  phone: '小手机历史',
  turn: '本轮',
  theater: '小剧场',
};

function requestGroup(message) {
  const explicit = String(message?.group || '');
  if (REQUEST_GROUP_LABELS[explicit]) return { key: explicit, label: REQUEST_GROUP_LABELS[explicit] };
  const source = String(message?.source || '');
  if (source === '小剧场') return { key: 'theater', label: '小剧场' };
  if (source === '回复要求' || source === '场景提示' || source === '行为提示') return { key: 'rule', label: '规则' };
  if (source === '最后一条聊天' || source === '主动消息占位') return { key: 'turn', label: '本轮' };
  if (source.includes('历史酒馆') || source.includes('酒馆记忆') || source.includes('酒馆总结') || source.includes('酒馆聊天')) {
    return { key: 'tavern', label: '酒馆历史' };
  }
  if (source.includes('历史小手机') || source.includes('聊天记录') || source.includes('小手机消息')) {
    return { key: 'phone', label: '小手机历史' };
  }
  return { key: 'context', label: '设定' };
}

/** 把组装好的 messages 变成调试栏要展示的分组统计。 */
export function requestStats(messages) {
  const rows = (Array.isArray(messages) ? messages : []).map((message, index) => {
    const content = String(message?.content || '');
    const group = requestGroup(message);
    return {
      index,
      role: message?.role || 'system',
      source: String(message?.source || '消息'),
      content,
      chars: content.length,
      tokens: estimateTokens(content) + 4,
      group,
    };
  });
  const order = ['rule', 'context', 'tavern', 'phone', 'turn', 'theater'];
  const groupMap = new Map();
  rows.forEach(row => {
    const item = groupMap.get(row.group.key) || {
      key: row.group.key,
      label: row.group.label,
      tokens: 0,
      chars: 0,
      count: 0,
    };
    item.tokens += row.tokens;
    item.chars += row.chars;
    item.count += 1;
    groupMap.set(row.group.key, item);
  });
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.tokens, 0),
    totalChars: rows.reduce((sum, row) => sum + row.chars, 0),
    groups: [...groupMap.values()].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)),
  };
}

/** 消息在历史里显示给谁；发言者来自分组消息，否则取联系人。 */
function messageWho(state, contact, message) {
  return message.from === 'me'
    ? (state.settings?.user?.name || '我')
    : (state.contacts?.[message.speaker]?.name || contact?.name || 'TA');
}

/**
 * 统一的模型侧消息序列化：引用、转发、表情、图片说明、撤回、行为标签都转成可读文本。
 * 图片 URL 不发给模型，只保留说明文字；没有说明时明确标注「未提供说明」，不用纯文字冒充模型真看到了图片。
 */
export function serializeMessage(message) {
  if (!message) return '';
  const rawText = message.text != null ? message.text : message.content;
  if (message.kind === 'recalled') return `[撤回]${String(rawText || '').trim()}`;
  if (message.kind === 'image') {
    const desc = String(rawText || '').trim();
    return desc ? `[图片]${desc}` : '[图片]（未提供说明）';
  }
  if (message.kind === 'emoji') return `[表情]${String(message.emoji || rawText || '').trim()}`;
  if (message.kind === 'forwarded') return `[转发]${String(message.forward?.text || rawText || '').trim()}`;
  const behavior = behaviorContextText(message);
  const body = behavior || String(rawText || '').trim();
  if (message.quote?.text) return `[引用]${String(message.quote.text).trim()}｜${body}`;
  return body;
}

export function transcript(state, chat, limit = 10, options = {}) {
  if (!chat) return '';
  const contact = state.contacts?.[chat.contactId];
  const omitId = options.omitId || '';
  const day = options.day || '';
  const maxChars = Math.max(0, Number(options.maxChars) || 0);
  const valid = (chat.messages || [])
    .filter(message => message && message.kind !== 'system' && message.kind !== 'recalled' && !message.excluded)
    .filter(message => message.id !== omitId)
    .filter(message => !day || dayKey(new Date(Number(message.at) || Date.now())) === day);
  const lines = valid.slice(-Math.max(1, limit)).map(message => {
    const text = serializeMessage(message);
    return text ? `${messageWho(state, contact, message)}：${text}` : '';
  }).filter(Boolean);

  if (!maxChars) return lines.join('\n');

  /* 按字数预算从新到旧装入：保留最近的话，装不下就停；至少留最新一条，避免整段历史全丢。 */
  const kept = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const cost = line.length + (kept.length ? 1 : 0);
    if (used + cost > maxChars) {
      if (!kept.length) kept.unshift(line.slice(0, maxChars) + '…');
      break;
    }
    kept.unshift(line);
    used += cost;
  }
  return kept.join('\n');
}

/**
 * 聊天上下文里的手机历史。和普通 transcript 不同的只有一点：
 * 发送窗口内的旧日期，如果已有当前有效的日记，就用一篇日记替换那天的原文；
 * 最近一天永远发原文，逐日切回原文也不会删掉日记。
 */
export function historyTranscript(state, chat, limit = 10, options = {}) {
  if (!chat) return '';
  const contact = state.contacts?.[chat.contactId];
  const omitId = options.omitId || '';
  const maxChars = Math.max(0, Number(options.maxChars) || 0);
  const valid = (chat.messages || [])
    .filter(message => message && message.kind !== 'system' && message.kind !== 'recalled' && !message.excluded)
    .filter(message => message.id !== omitId);
  const selected = valid.slice(-Math.max(1, limit));
  const latestDate = valid.length ? dayKey(new Date(Number(valid[valid.length - 1].at))) : '';
  const groups = diaryDayGroups(chat);
  const entries = state?.diary?.contacts?.[chat.contactId] || {};
  const replaced = new Set();
  const lines = [];
  for (const message of selected) {
    const date = dayKey(new Date(Number(message.at)));
    const entry = entries[date];
    const replace = options.diary !== false && state?.diary?.enabled !== false && date !== latestDate &&
      entry?.useOriginal !== true && diaryEntryIsCurrent(state, chat, entry, groups.get(date));
    if (replace) {
      if (!replaced.has(date)) {
        lines.push(`[日记 ${date}]\n${entry.text}`);
        replaced.add(date);
      }
      continue;
    }
    const text = serializeMessage(message);
    if (text) lines.push(`${messageWho(state, contact, message)}：${text}`);
  }

  if (!maxChars) return lines.join('\n');
  const kept = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const cost = line.length + (kept.length ? 1 : 0);
    if (used + cost > maxChars) {
      if (!kept.length) kept.unshift(line.slice(0, maxChars) + '…');
      break;
    }
    kept.unshift(line);
    used += cost;
  }
  return kept.join('\n');
}

/** 日记生成专用：完整未排除历史，每条带日期和时间，不受发送窗口影响。 */
export function diaryTranscript(state, chat) {
  return diaryTranscriptForMessages(state, chat, (chat?.messages || []));
}

export function diaryTranscriptForMessages(state, chat, messages) {
  if (!chat) return '';
  const contact = state.contacts?.[chat.contactId];
  return (Array.isArray(messages) ? messages : [])
    .filter(message => message && !message.excluded)
    .map(message => {
      const date = new Date(Number(message.at));
      const stamp = Number.isFinite(date.getTime())
        ? `${dayKey(date)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        : '时间未知';
      return `[${stamp}] ${messageWho(state, contact, message)}：${serializeMessage(message)}`;
    })
    .filter(line => line.trim())
    .join('\n');
}

export function characterBlock(state, contact) {
  const card = characterCardFor(state, contact);
  if (!card) return '';
  return [
    `【角色档案 · ${contact?.name || card.name || 'TA'}】`,
    card.description ? String(card.description).slice(0, 400) : '',
    card.personality ? `性格：${String(card.personality).slice(0, 160)}` : '',
  ].filter(Boolean).join('\n');
}

export function sceneBlock(state, contact) {
  const card = characterCardFor(state, contact);
  if (!card?.scenario) return '';
  return `【场景信息】\n${String(card.scenario).slice(0, 240)}`;
}

export function userBlock(state) {
  const me = (state.users || []).find(item => item.key === state.settings.user?.key) || (state.users || [])[0];
  if (!me) return '';
  return [
    '【我的设定】',
    `名字：${me.name || state.settings.user?.name || '我'}`,
    me.description ? String(me.description).slice(0, 300) : '',
  ].filter(Boolean).join('\n');
}

export function clockBlock(now = new Date()) {
  const text = now.toLocaleString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return [
    '【时间信息】',
    `当前时间：${text}`,
    '角色的手机能看到当前时间，可以据此判断时段、对方状态和聊天间隔。',
  ].join('\n');
}

/** 当前用户签名；meme 没有签名历史，只能读现在的资料。 */
export function signatureBlock(state) {
  const bio = String(state?.settings?.profile?.bio || '').trim();
  if (!bio) return '';
  return `【我的个性签名】\n${bio}`;
}

/** 表情包库：给模型一份当前表情名称，避免它编不存在的表情。 */
export function emojiBlock(state) {
  const list = (Array.isArray(state?.emoji) ? state.emoji : [])
    .map(item => {
      const name = String(item?.name || '').trim();
      const char = String(item?.char || '').trim();
      if (!name) return '';
      return char ? `${name}（${char}）` : name;
    })
    .filter(Boolean);
  if (!list.length) return '';
  return [
    '【表情包库】',
    list.join('\n'),
    '[/表情包库]',
    '角色回复时可以使用这些表情，但不要编造表情库里没有的表情。',
  ].join('\n');
}

/** 当前选中的酒馆人设；预览环境没有酒馆时退回第一条。 */
function activePersona(state) {
  const users = Array.isArray(state.users) ? state.users : [];
  return users.find(user => user.key === state.settings.user?.key) || users[0] || null;
}

/** 扫描最近 N 条聊天，判断关键词条目是否命中。 */
function bookScanText(chat, floors) {
  if (!chat) return '';
  return (chat.messages || [])
    .slice(-Math.max(1, floors))
    .map(message => String(message.text || ''))
    .join('\n')
    .toLowerCase();
}

function entryHits(entry, text) {
  if (!text) return false;
  return (entry.keys || []).some(key => {
    const needle = String(key || '').trim().toLowerCase();
    return needle && text.includes(needle);
  });
}

function normalizeForCompare(text) {
  return String(text || '').replace(/\s+/g, '').trim();
}

/**
 * 人设世界书：常驻条目始终注入，关键词条目按最近聊天命中。
 * 读不到酒馆时退回演示数据（只用于 preview / demo）。
 */
async function lorebookBlock(state, chat, contact, context) {
  const persona = activePersona(state);
  const bookName = String(persona?.lorebook || '').trim();
  if (!bookName) {
    return { text: '', status: 'empty', reason: '当前人设没绑定世界书' };
  }

  const loaded = await readWorldBook(bookName).catch(error => ({
    available: false, name: bookName, entries: [], reason: error?.message || '世界书读取失败',
  }));
  const entries = (loaded.available ? loaded.entries : (persona?.demoBook?.entries || []))
    .filter(entry => entry && !entry.disabled && String(entry.content || '').trim());

  if (!entries.length) {
    return { text: '', status: 'empty', reason: loaded.reason || '这本世界书没有可用条目' };
  }

  const scan = bookScanText(chat, context.bookFloors);
  const constant = entries.filter(entry => entry.constant);
  const hit = entries.filter(entry => !entry.constant && entryHits(entry, scan));
  const picked = [...constant, ...hit];

  /* 同一段内容只注入一次：常驻和关键词条目可能写重复。 */
  const seen = new Set();
  const blocks = [];
  let used = 0;
  const budget = Math.max(400, Number(context.bookBudget) || 2000);
  let cut = false;

  for (const entry of picked) {
    const head = `【${entry.title || '世界书条目'}】`;
    const body = String(entry.content || '').trim();
    const key = normalizeForCompare(body);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const piece = `${head}\n${body}`;
    if (used + piece.length > budget) {
      const room = budget - used;
      if (room > 80) {
        blocks.push(`${piece.slice(0, room)}…`);
        used = budget;
      }
      cut = true;
      break;
    }
    blocks.push(piece);
    used += piece.length;
  }

  if (!blocks.length) {
    return { text: '', status: 'empty', reason: `最近 ${context.bookFloors} 条聊天没有命中关键词` };
  }
  const note = `【人设世界书 · ${loaded.name || bookName}】${loaded.available ? '' : '（演示数据）'}`;
  const tail = cut ? '\n（世界书已到字数上限，后面的条目没有注入）' : '';
  return {
    text: `${note}\n${blocks.join('\n')}${tail}`,
    status: 'injected',
    reason: `常驻 ${constant.length} 条 / 命中 ${Math.min(hit.length, blocks.length)} 条`,
    source: loaded.available ? 'tavern' : 'demo',
  };
}

/** 单个上下文条目的内容；只有世界书是异步读宿主，其余同步。 */
async function contextBlockFor(item, state, chat, contact, context, memoryText, ctxOpts = {}) {
  const key = item.auto;
  if (key === 'character') {
    const text = characterBlock(state, contact);
    return { text, status: text ? 'injected' : 'empty', reason: text ? '' : '没找到这个联系人的角色卡' };
  }
  if (key === 'user') {
    const text = userBlock(state);
    return { text, status: text ? 'injected' : 'empty', reason: text ? '' : '当前人设没有设定内容' };
  }
  if (key === 'scene') {
    const text = sceneBlock(state, contact);
    return { text, status: text ? 'injected' : 'empty', reason: text ? '' : '角色卡没有填场景' };
  }
  if (key === 'signature') {
    const text = signatureBlock(state);
    return { text, status: text ? 'injected' : 'empty', reason: text ? '' : '我还没有写个性签名' };
  }
  if (key === 'emoji') {
    const text = emojiBlock(state);
    return { text, status: text ? 'injected' : 'empty', reason: text ? '' : '表情面板还是空的' };
  }
  if (key === 'lorebook') return lorebookBlock(state, chat, contact, context);
  if (key === 'memory') {
    const text = memoryText ? `【历史酒馆消息】\n${memoryText}` : '';
    return { text, status: text ? 'injected' : 'empty', reason: text ? '' : '这个会话还没读到记忆' };
  }
  if (key === 'time') return { text: clockBlock(), status: 'injected', reason: '' };
  if (key === 'history') {
    const limit = effectivePhoneHistoryLimit(chat, context);
    const lastId = ctxOpts.omitLast ? (chat.messages?.[chat.messages.length - 1]?.id || '') : '';
    const text = historyTranscript(state, chat, limit, {
      omitId: lastId,
      maxChars: ctxOpts.historyMaxChars,
      diary: true,
    });
    return {
      text: text ? `【历史小手机消息】\n${text}` : '',
      status: text ? 'injected' : 'empty',
      reason: text ? '' : '这个会话还没有聊天记录',
    };
  }
  return { text: '', status: 'empty', reason: '不认识的上下文来源' };
}

/**
 * 唯一组装入口。
 * @returns {{messages: Array, report: object}}
 * report.items 记录每条的去向：injected / disabled / app / other-character / empty / duplicate / over-budget，
 * 预览页直接拿它解释「为什么没出现」。
 */
export async function buildReplyMessages(state, chat, contact, options = {}) {
  const preset = options.presetOverride || replyPresetFor(state, chat);
  const context = options.presetOverride
    ? normalizeReplyContext(preset?.context)
    : replyContextFor(state, chat);
  const items = options.presetOverride
    ? normalizeReplyItems(preset?.items, context)
    : replyItemsFor(state, chat);
  const messages = [];
  const reportItems = [];

  if (options.memoryText === undefined && context.memory && chat) {
    try {
      const story = await buildMemoryContext(state, chat, 1200);
      options.memoryText = String(story?.text || story || '');
    } catch {
      options.memoryText = '';
    }
  }
  const memoryText = String(options.memoryText || '');

  if (options.lead) messages.push({ role: 'system', content: options.lead, source: '场景提示', group: 'rule' });

  const seen = new Set();
  let used = 0;
  const charBudget = Math.max(2000, Number(context.charBudget) || 8000);
  /* 给模型回复预留的篇幅；这里只是字数口径的估算，不是精确 token，UI 带 ≈。 */
  const outputReserve = 1200;

  /* 先算出这一轮的当前输入（不注入但先占预算），历史只能吃剩下的空间 */
  const omitIds = new Set(options.omitIds || []);
  const lastMessage = chat?.messages?.[chat.messages.length - 1];
  const pendingUserText = (chat && !options.omitLastUser && !options.proactive && lastMessage
    && !lastMessage.excluded && !omitIds.has(lastMessage.id))
    ? serializeMessage(lastMessage)
    : '';
  const pendingExtraChars = [options.behaviorPrompt, options.extraPrompt]
    .reduce((sum, text) => sum + String(text || '').length, 0);

  for (const item of items) {
    const base = { id: item.id, label: item.label, kind: item.kind };
    if (!item.enabled) {
      reportItems.push({ ...base, status: 'disabled', chars: 0, reason: '已关闭' });
      continue;
    }
    if (item.kind === 'app') {
      reportItems.push({ ...base, status: 'app', chars: 0, reason: '给其他软件的条目，不进聊天' });
      continue;
    }
    if (!itemAppliesToChat(state, item, chat, contact)) {
      reportItems.push({ ...base, status: 'other-character', chars: 0, reason: '只对别的角色生效' });
      continue;
    }

    let block;
    if (item.kind === 'context') {
      const historyMaxChars = Math.max(0, charBudget - used - pendingUserText.length - pendingExtraChars - outputReserve - 24);
      block = await contextBlockFor(item, state, chat, contact, context, memoryText, {
        omitLast: !options.proactive,
        historyMaxChars,
      });
    } else {
      const text = fillPromptTokens(item.content, state, chat).trim();
      block = { text, status: text ? 'injected' : 'empty', reason: text ? '' : '条目内容是空的' };
    }

    const content = String(block.text || '').trim();
    if (!content) {
      reportItems.push({ ...base, status: block.status === 'empty' ? 'empty' : block.status, chars: 0, reason: block.reason || '没有内容' });
      continue;
    }
    const key = normalizeForCompare(content);
    if (seen.has(key)) {
      reportItems.push({ ...base, status: 'duplicate', chars: 0, reason: '和前面的条目内容重复' });
      continue;
    }
    if (used + content.length > charBudget) {
      reportItems.push({ ...base, status: 'over-budget', chars: 0, reason: `整套上下文超过 ${charBudget} 字上限` });
      continue;
    }

    seen.add(key);
    used += content.length;
    const group = item.kind === 'context'
      ? (item.auto === 'memory' ? 'tavern' : item.auto === 'history' ? 'phone' : 'context')
      : 'rule';
    messages.push({ role: item.role || 'system', content, source: item.label, id: item.id, group });
    reportItems.push({ ...base, status: 'injected', chars: content.length, reason: block.reason || '' });
  }

  /* 行为标签：只把当前打开的转账 / 计划 / 会员等写进系统提示，关掉的就不教模型。 */
  if (options.behaviorPrompt) messages.push({ role: 'system', content: String(options.behaviorPrompt), source: '行为提示', group: 'rule' });

  /* 小剧场放在全部预设条目之后、最后一条聊天之前，避免被前面的回复格式/行为条目盖掉。 */
  if (options.extraPrompt) messages.push({ role: 'system', content: String(options.extraPrompt), source: '小剧场', group: 'theater' });

  let lastUserText = '';
  if (pendingUserText) {
    lastUserText = pendingUserText;
    messages.push({ role: 'user', content: `${messageWho(state, contact, lastMessage)}：${pendingUserText}`, source: '最后一条聊天', group: 'turn' });
  }
  if (options.proactive && !messages.some(message => message.role === 'user')) {
    messages.push({ role: 'user', content: '（现在没有新消息，主动发一条。）', source: '主动消息占位', group: 'turn' });
  }

  const charTotal = messages.reduce((sum, message) => sum + String(message?.content || '').length, 0);

  return {
    messages,
    report: {
      presetId: preset?.id || '',
      presetName: preset?.name || '',
      modelCount: messages.length,
      charUsed: used,
      charTotal,
      estimate: true,
      charBudget,
      outputReserve,
      overBudget: charTotal > charBudget,
      inputChars: lastUserText.length,
      overLimitInput: lastUserText.length > charBudget,
      items: reportItems,
      memoryChars: memoryText.length,
      personaBook: String(activePersona(state)?.lorebook || ''),
    },
  };
}
