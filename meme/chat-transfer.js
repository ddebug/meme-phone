/**
 * meme-phone · 单角色聊天记录导出 / 导入
 *
 * 只处理一个会话（一个角色）的消息和该角色名下的日记，不包含联系人、角色卡、
 * 全局日记、记忆、预设或 API 配置。导入按消息 ID / 日记日期合并，已存在的跳过，
 * 不覆盖当前聊天和现有日记。同时兼容 acsus-phone-standalone 的单个角色导出文件。
 */

import { fromAcsusMessage } from './behavior.js';

export const MEME_CHAT_FORMAT = 'meme-phone-chat';
export const MEME_CHAT_VERSION = 1;
export const ACSUS_CHAT_FORMAT = 'acsus-phone-chat';
export const MAX_CHAT_TRANSFER_BYTES = 32 * 1024 * 1024;
export const MAX_CHAT_TRANSFER_MESSAGES = 50000;

const MAX_VALUE_DEPTH = 12;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const FROM_VALUES = new Set(['me', 'them', 'system']);
const DIARY_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ACSUS_BEHAVIOR_KINDS = new Set([
  'transfer', 'redpacket', 'gift-membership', 'buy-membership', 'plan', 'plan-story',
  'friend-request', 'friend-added', 'friend-deleted', 'signature',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function cloneJsonValue(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('消息中包含无效数字');
    return value;
  }
  if (value === undefined) return null;
  if (depth > MAX_VALUE_DEPTH) throw new TypeError('消息嵌套层级过深');
  if (Array.isArray(value)) return value.map(item => cloneJsonValue(item, depth + 1));
  if (!isRecord(value)) throw new TypeError('消息中包含不支持的数据类型');

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError('消息结构不是普通对象');

  const result = {};
  for (const key of Object.keys(value)) {
    if (BLOCKED_KEYS.has(key)) continue;
    if (value[key] === undefined) continue;
    result[key] = cloneJsonValue(value[key], depth + 1);
  }
  return result;
}

function safeKeyPart(value, fallback) {
  const text = String(value ?? '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return text || fallback;
}

function normalizeCharacter(character, chatId = '') {
  if (!isRecord(character)) throw new TypeError('导出文件缺少角色信息');
  const id = typeof character.id === 'string' ? character.id.trim() : '';
  const name = typeof character.name === 'string' ? character.name.trim() : '';
  if (!id) throw new TypeError('导出文件缺少角色 ID');
  if (!name) throw new TypeError('导出文件缺少角色名称');
  return {
    id,
    name,
    chatId: typeof character.chatId === 'string' ? character.chatId : chatId,
  };
}

function normalizeMessage(message, { chatId, fallbackKey, index }) {
  if (!isRecord(message)) throw new TypeError(`第 ${index + 1} 条消息不是对象`);
  const cleaned = /** @type {Object} */ (cloneJsonValue(message));

  if (typeof cleaned.from !== 'string' || !FROM_VALUES.has(cleaned.from)) {
    throw new TypeError(`第 ${index + 1} 条消息的发送者无效`);
  }
  if (!isFiniteNumber(cleaned.at)) throw new TypeError(`第 ${index + 1} 条消息缺少有效时间`);
  if (typeof cleaned.id !== 'string' || !cleaned.id.trim()) {
    cleaned.id = `m_import_${safeKeyPart(chatId, 'chat')}_${fallbackKey}_${index}`;
  }
  if (typeof cleaned.text !== 'string') cleaned.text = String(cleaned.text ?? '');
  if (typeof cleaned.kind !== 'string' || !cleaned.kind.trim()) cleaned.kind = 'text';
  delete cleaned.pending;
  return cleaned;
}

function exportMessageId(message, chatId, index) {
  if (typeof message.id === 'string' && message.id.trim()) return message.id;
  const at = isFiniteNumber(message.at) ? Math.floor(message.at) : 0;
  return `m_export_${safeKeyPart(chatId, 'chat')}_${index}_${at}`;
}

function normalizeDiaryNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

/** 导出 / 导入共用的日记条目清洗：只留白名单字段，日期必须合法。 */
function normalizeDiaryEntry(entry, { index, contactId }) {
  if (!isRecord(entry)) throw new TypeError(`日记第 ${index + 1} 条不是对象`);
  const cleaned = cloneJsonValue(entry);
  const date = String(cleaned.date || cleaned.key || '').trim();
  if (!DIARY_DATE_RE.test(date)) throw new TypeError(`日记第 ${index + 1} 条日期无效`);

  const tags = Array.isArray(cleaned.tags)
    ? cleaned.tags.map(tag => String(tag ?? ''))
    : [];

  return {
    date,
    text: String(cleaned.text ?? '').trim(),
    tags,
    auto: cleaned.auto !== false,
    useOriginal: cleaned.useOriginal === true,
    sourceFingerprint: String(cleaned.sourceFingerprint || ''),
    paramsFingerprint: String(cleaned.paramsFingerprint || ''),
    fromTime: normalizeDiaryNumber(cleaned.fromTime),
    toTime: normalizeDiaryNumber(cleaned.toTime),
    messageCount: normalizeDiaryNumber(cleaned.messageCount),
    createdAt: normalizeDiaryNumber(cleaned.createdAt),
    updatedAt: normalizeDiaryNumber(cleaned.updatedAt),
    contactId: String(contactId || ''),
  };
}

/**
 * 把角色名下的日记条目（date -> entry 映射）清洗成可导出的数组。
 *
 * @param {Object} [diaryEntries]
 */
function exportDiaryEntries(diaryEntries) {
  if (!isRecord(diaryEntries)) return [];
  return Object.entries(diaryEntries)
    .map(([key, entry], index) => normalizeDiaryEntry(
      { ...(isRecord(entry) ? entry : {}), date: String(entry?.date || key) },
      { index },
    ))
    .sort((left, right) => left.date.localeCompare(right.date));
}

/**
 * 构造当前会话的导出包。
 *
 * @param {Object} options
 * @param {Object} options.chat
 * @param {Object} options.contact
 * @param {Object} [options.diaryEntries] 该角色名下的日记映射（date -> entry）；不传则不带日记
 * @param {string} [options.exportedAt]
 */
export function createChatExport({ chat, contact, diaryEntries, exportedAt = new Date().toISOString() }) {
  if (!isRecord(chat)) throw new TypeError('缺少会话信息');
  if (!Array.isArray(chat.messages)) throw new TypeError('会话缺少消息数组');
  if (!isRecord(contact) || !contact.id || !contact.name) throw new TypeError('缺少角色信息');
  if (chat.messages.length > MAX_CHAT_TRANSFER_MESSAGES) {
    throw new RangeError(`聊天消息超过 ${MAX_CHAT_TRANSFER_MESSAGES} 条，无法一次导出`);
  }

  const messages = chat.messages.map((message, index) => {
    if (!isRecord(message)) throw new TypeError(`第 ${index + 1} 条消息不是对象`);
    const cleaned = /** @type {Object} */ (cloneJsonValue(message));
    cleaned.id = exportMessageId(cleaned, chat.id || contact.id, index);
    if (typeof cleaned.from !== 'string' || !FROM_VALUES.has(cleaned.from)) {
      throw new TypeError(`第 ${index + 1} 条消息的发送者无效`);
    }
    if (!isFiniteNumber(cleaned.at)) throw new TypeError(`第 ${index + 1} 条消息缺少有效时间`);
    if (typeof cleaned.text !== 'string') cleaned.text = String(cleaned.text ?? '');
    if (typeof cleaned.kind !== 'string' || !cleaned.kind.trim()) cleaned.kind = 'text';
    delete cleaned.pending;
    return cleaned;
  });

  const diary = exportDiaryEntries(diaryEntries);

  return {
    format: MEME_CHAT_FORMAT,
    version: MEME_CHAT_VERSION,
    exportedAt,
    character: {
      id: String(contact.id),
      name: String(contact.name),
      chatId: String(chat.id || ''),
    },
    messageCount: messages.length,
    messages,
    diaryCount: diary.length,
    diary,
  };
}

/* ------------------------------------------------------------ acsus 兼容 */

function acsusSenderToFrom(sender) {
  if (sender === 'user') return 'me';
  if (sender === 'contact') return 'them';
  if (sender === 'system') return 'system';
  return '';
}

function acsusTimeToAt(time) {
  if (!isFiniteNumber(time)) throw new TypeError('ac sus 消息缺少有效时间');
  return time < 1e12 ? time * 1000 : time;
}

function acsusQuoteToMeme(quoted) {
  if (!isRecord(quoted)) return null;
  const from = acsusSenderToFrom(quoted.sender) || 'them';
  const text = quoted.content ?? quoted.text ?? quoted.description ?? '';
  if (!text) return null;
  return { text: String(text), from };
}

function acsusMessageToMeme(message, index, fallbackKey) {
  const from = acsusSenderToFrom(message?.sender);
  if (!from) throw new TypeError(`ac sus 第 ${index + 1} 条消息发送者无效`);

  /* 行为消息优先走统一映射，导入只还原历史，不触发钱包 / 会员 / 计划副作用。 */
  const mapped = fromAcsusMessage(message, index, fallbackKey);
  if (mapped && ACSUS_BEHAVIOR_KINDS.has(mapped.kind)) return mapped;

  const type = typeof message.type === 'string' ? message.type : 'text';
  const content = message.content ?? message.replyContent ?? message.description ?? message.message ?? message.originalContent ?? '';
  const at = acsusTimeToAt(message.time);
  const id = typeof message.id === 'string' && message.id.trim()
    ? message.id
    : `m_import_acsus_${fallbackKey}_${index}`;

  let kind = 'text';
  let text = String(content ?? '');
  let image = '';
  let emoji = '';

  if (type === 'emoji') {
    kind = 'emoji';
    emoji = String(message.emojiName || content || '[表情]');
    text = emoji;
  } else if (type === 'image' || type === 'image-real' || type === 'image-fake') {
    kind = 'image';
    image = String(message.imageUrl || '');
    text = String(message.description || content || '[图片]');
  } else if (type === 'quote') {
    kind = 'text';
    const quote = acsusQuoteToMeme(message.quotedMessage);
    text = String(message.replyContent || content || '');
    return {
      id,
      from,
      at,
      kind,
      text,
      quote,
      proactive: Boolean(message.proactive),
      speaker: String(message.senderName || ''),
    };
  } else if (type === 'recalled') {
    kind = 'recalled';
    text = '[消息已撤回]';
  } else if (type === 'poke') {
    kind = 'poke';
    text = '[戳一戳]';
  } else if (type === 'forwarded') {
    text = String(message.content || message.description || '[转发]');
    return {
      id,
      from,
      at,
      kind,
      text,
      quote: null,
      proactive: Boolean(message.proactive),
      speaker: String(message.senderName || ''),
      forward: { text, from: String(message.forwardedFrom || '') },
    };
  } else if (type === 'transfer') {
    text = `[转账] ${String(message.amount ?? '').trim()} ${String(message.message ?? '').trim()}`.trim();
  } else if (type === 'redpacket') {
    text = `[红包] ${String(message.amount ?? '').trim()} ${String(message.message ?? '').trim()}`.trim();
  } else if (type === 'file') {
    text = `[文件] ${String(message.filename || '').trim()}`.trim();
  } else if (type === 'video') {
    text = `[视频] ${String(message.description || '').trim()}`.trim();
  } else if (type === 'plan' || type === 'plan-story') {
    text = `[${type === 'plan' ? '约定计划' : '计划故事'}] ${text}`.trim();
  } else if (from === 'system' || type === 'friend_added' || type === 'friend_deleted' || type === 'friend_request') {
    kind = 'system';
  }

  return {
    id,
    from,
    at,
    kind,
    text,
    quote: null,
    proactive: Boolean(message.proactive),
    speaker: String(message.senderName || ''),
    ...(image ? { image } : {}),
    ...(emoji ? { emoji } : {}),
  };
}

function convertAcsusPackage(parsed, exportedAt) {
  if (!isRecord(parsed) || parsed.version !== 1) throw new TypeError('acsus 聊天记录版本不支持');
  if (typeof parsed.exportedAt !== 'string' || !parsed.exportedAt.trim()) {
    throw new TypeError('acsus 导出文件缺少导出时间');
  }
  if (!Array.isArray(parsed.messages)) throw new TypeError('acsus 导出文件缺少消息数组');
  if (parsed.messages.length > MAX_CHAT_TRANSFER_MESSAGES) throw new RangeError('聊天消息超过 50000 条');
  if (parsed.messageCount !== undefined && parsed.messageCount !== parsed.messages.length) {
    throw new TypeError('ac sus 消息数量与 messageCount 不一致，文件可能不完整');
  }

  const character = normalizeCharacter(parsed.character, '');
  const fallbackKey = safeKeyPart(parsed.exportedAt || exportedAt, 'acsus');
  const messages = parsed.messages.map((message, index) => {
    if (!isRecord(message)) throw new TypeError(`ac sus 第 ${index + 1} 条消息不是对象`);
    return acsusMessageToMeme(message, index, fallbackKey);
  });

  return {
    format: MEME_CHAT_FORMAT,
    version: MEME_CHAT_VERSION,
    exportedAt: String(parsed.exportedAt || exportedAt),
    character,
    messageCount: messages.length,
    messages,
    diary: [],
    source: 'acsus',
  };
}

/* ------------------------------------------------------------ 解析 */

function validateMemePackage(parsed, exportedAt) {
  if (!isRecord(parsed) || parsed.version !== MEME_CHAT_VERSION) throw new TypeError('聊天记录版本不支持');
  if (!Array.isArray(parsed.messages)) throw new TypeError('导出文件缺少消息数组');
  if (parsed.messages.length > MAX_CHAT_TRANSFER_MESSAGES) throw new RangeError('聊天消息超过 50000 条');
  if (parsed.messageCount !== undefined && parsed.messageCount !== parsed.messages.length) {
    throw new TypeError('消息数量与 messageCount 不一致，文件可能不完整');
  }

  const character = normalizeCharacter(parsed.character, parsed.chat?.id || '');
  const fallbackKey = safeKeyPart(parsed.exportedAt || exportedAt, 'import');
  const messages = parsed.messages.map((message, index) => normalizeMessage(message, {
    chatId: character.chatId || 'chat',
    fallbackKey,
    index,
  }));

  const rawDiary = Array.isArray(parsed.diary) ? parsed.diary : [];
  if (parsed.diaryCount !== undefined && parsed.diaryCount !== rawDiary.length) {
    throw new TypeError('日记数量与 diaryCount 不一致，文件可能不完整');
  }
  const diary = rawDiary.map((entry, index) => normalizeDiaryEntry(entry, {
    index,
    contactId: character.id,
  }));

  return {
    format: MEME_CHAT_FORMAT,
    version: MEME_CHAT_VERSION,
    exportedAt: String(parsed.exportedAt || exportedAt),
    character,
    messageCount: messages.length,
    messages,
    diaryCount: diary.length,
    diary,
    source: 'meme',
  };
}

/**
 * @param {string} text
 * @returns {Object}
 */
export function parseChatTransferText(text) {
  if (typeof text !== 'string') throw new TypeError('导入文件不是文本');
  if (text.length > MAX_CHAT_TRANSFER_BYTES) throw new RangeError('导入文件超过 32 MiB');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyntaxError('文件不是有效的 JSON');
  }

  if (!isRecord(parsed)) throw new TypeError('聊天导出文件必须是 JSON 对象');
  const exportedAt = new Date().toISOString();

  if (parsed.format === ACSUS_CHAT_FORMAT) return convertAcsusPackage(parsed, exportedAt);
  if (parsed.format === MEME_CHAT_FORMAT) return validateMemePackage(parsed, exportedAt);
  throw new TypeError('不是聊天记录导出文件；请选择 meme-phone 或 acsus 导出的单个角色聊天 JSON');
}

function messageAt(message) {
  return isFiniteNumber(message?.at) ? message.at : Number.MAX_SAFE_INTEGER;
}

/**
 * 合并消息，按消息 ID 去重，按时间升序排列。
 *
 * @param {Array<Object>} currentMessages
 * @param {Array<Object>} importedMessages
 */
export function mergeChatHistory(currentMessages, importedMessages) {
  if (!Array.isArray(currentMessages)) throw new TypeError('当前聊天记录不是数组');
  if (!Array.isArray(importedMessages)) throw new TypeError('导入聊天记录不是数组');

  const seen = new Set();
  const indexed = currentMessages.map((message, index) => {
    if (message && typeof message.id === 'string' && message.id) seen.add(message.id);
    return { message, index };
  });

  const additions = [];
  let skippedCount = 0;
  for (const message of importedMessages) {
    if (!isRecord(message)) throw new TypeError('导入消息不是对象');
    if (typeof message.id !== 'string' || !message.id) throw new TypeError('导入消息缺少 ID');
    if (seen.has(message.id)) {
      skippedCount += 1;
      continue;
    }
    seen.add(message.id);
    additions.push({ message, index: indexed.length + additions.length });
  }

  const messages = [...indexed, ...additions]
    .sort((left, right) => (messageAt(left.message) - messageAt(right.message)) || (left.index - right.index))
    .map(item => item.message);

  return {
    messages,
    addedCount: additions.length,
    skippedCount,
  };
}

/**
 * 合并日记条目，按日期去重，已有日期不覆盖；直接写回传入的当前映射。
 *
 * @param {Object} currentEntries 当前角色日记映射（date -> entry）
 * @param {Array<Object>} importedEntries 导入的日记数组（已清洗）
 * @param {string} [contactId] 落到目标角色名下
 */
export function mergeDiaryEntries(currentEntries, importedEntries, contactId = '') {
  if (!isRecord(currentEntries)) throw new TypeError('当前日记映射不是对象');
  if (!Array.isArray(importedEntries)) throw new TypeError('导入日记不是数组');

  let addedCount = 0;
  let skippedCount = 0;
  for (const entry of importedEntries) {
    if (!isRecord(entry) || typeof entry.date !== 'string' || !entry.date) {
      throw new TypeError('导入日记缺少日期');
    }
    if (currentEntries[entry.date]) {
      skippedCount += 1;
      continue;
    }
    currentEntries[entry.date] = {
      ...entry,
      key: entry.date,
      contactId: String(contactId || entry.contactId || ''),
    };
    addedCount += 1;
  }

  return { entries: currentEntries, addedCount, skippedCount };
}
