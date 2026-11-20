/** Native, synchronous history selection. Never reads a sidecar or mutates state. */
function stripReservedBlocks(value) {
  return { text: String(value ?? '') };
}

export function localDateKey(timestamp) {
  if (timestamp == null || timestamp === '') return '';
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Change detector, not a security hash. Object key order is not message content. */
export function historyFingerprint(value) {
  const canonical = item => {
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, canonical(item[key])]));
    return item;
  };
  const text = JSON.stringify(canonical(value)) ?? 'null';
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619) >>> 0;
  return `${text.length}:${hash.toString(16)}`;
}

export function groupHistoryByDate(messages) {
  const groups = new Map();
  for (const message of messages || []) {
    const date = localDateKey(message?.at);
    if (!date) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(message);
  }
  return groups;
}

export function sanitizeHistoryContent(message, content = message?.text) {
  const text = String(content ?? '');
  return message?.from === 'them' ? stripReservedBlocks(text).text : text;
}

export function diaryParamsFingerprint(state, chat) {
  return historyFingerprint({
    prompt: state?.diary?.prompt ?? '',
    contact: state?.contacts?.[chat?.contactId] ?? null,
    characters: state?.characters ?? [],
    user: state?.settings?.user ?? null,
    userMode: state?.settings?.userMode ?? '',
    pinnedUser: state?.settings?.pinnedUser ?? '',
    users: state?.users ?? [],
    api: state?.settings?.api ?? null,
  });
}

export function diaryEntryIsCurrent(state, chat, entry, dayMessages) {
  return Boolean(entry && typeof entry.text === 'string' && entry.text.trim() &&
    dayMessages?.length > 20 && entry.sourceFingerprint &&
    entry.sourceFingerprint === historyFingerprint(dayMessages) &&
    (!entry.paramsFingerprint || entry.paramsFingerprint === diaryParamsFingerprint(state, chat)));
}

const windowCount = (value, fallback) => {
  const count = Number(value ?? fallback);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : fallback;
};

/** Filter first; raw windows remain fixed even when a diary replaces a date. */
export function selectHistoryContext(state, chat, settings = {}) {
  const validMessages = (Array.isArray(chat?.messages) ? chat.messages : []).filter(message => message && !message.excluded);
  const recentCount = windowCount(settings.recentCount, 20);
  const historyCount = windowCount(settings.historyCount, 99);
  const historyEnd = Math.max(0, validMessages.length - recentCount);
  const recentMessages = validMessages.slice(historyEnd);
  const historyMessages = validMessages.slice(Math.max(0, historyEnd - historyCount), historyEnd);
  const entries = state?.diary?.contacts?.[chat?.contactId] || {};
  const groups = groupHistoryByDate(validMessages);
  const latestDate = localDateKey(validMessages.at(-1)?.at);
  const replacedDates = new Set();
  const historyRenderList = [];
  for (const message of historyMessages) {
    const date = localDateKey(message.at);
    const entry = entries[date];
    const replace = state?.diary?.enabled !== false && date !== latestDate && entry?.useOriginal !== true &&
      diaryEntryIsCurrent(state, chat, entry, groups.get(date));
    if (!replace) historyRenderList.push(message);
    else if (!replacedDates.has(date)) {
      historyRenderList.push({ __diary: true, date, at: message.at, text: entry.text, key: date });
      replacedDates.add(date);
    }
  }
  return { validMessages, recentMessages, historyMessages, historyRenderList, recentCount, historyCount,
    latestDate, replacedDates: [...replacedDates], includedMessages: [...historyMessages, ...recentMessages] };
}

/** Explicit request identity wins. Only two legacy no-ID rows may use 30 seconds. */
export function areSameApiCall(previous, current) {
  if (!previous || !current || previous.__diary || current.__diary || previous.from !== 'them' || current.from !== 'them') return false;
  if (!localDateKey(current.at) || localDateKey(current.at) !== localDateKey(previous.at)) return false;
  if ((previous.speaker || '') !== (current.speaker || '')) return false;
  const normalized = value => value != null && String(value).trim() ? String(value) : null;
  for (const key of ['apiCallId', 'proactiveRequestId']) {
    const left = normalized(previous[key]);
    const right = normalized(current[key]);
    if (left && right && left !== right) return false;
  }
  const callId = message => normalized(message.apiCallId) ? `api:${message.apiCallId}`
    : normalized(message.proactiveRequestId) ? `proactive:${message.proactiveRequestId}` : null;
  const left = callId(previous);
  const right = callId(current);
  if (left || right) return Boolean(left && right && left === right);
  return Number.isFinite(Number(previous.at)) && Number.isFinite(Number(current.at)) &&
    Math.abs(Number(current.at) - Number(previous.at)) <= 30000;
}

export function formatHistoryTime(timestamp, previous = null, first = false) {
  const day = localDateKey(timestamp);
  if (!day) return '[时间未知] ';
  const date = new Date(Number(timestamp));
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return first || previous == null || day !== localDateKey(previous) ? `[${day} ${clock}] ` : `[${clock}] `;
}

export function formatQuoteReference(quote, sources = []) {
  if (!quote) return '[引用已删除消息]';
  const sourceId = quote.id || quote.messageId;
  const known = sources.some(message => message && !message.__diary && (sourceId
    ? message.id === sourceId
    : message.from === quote.from && message.at === quote.at && message.text === quote.text));
  if (known) return '[引用较早消息]';
  const kind = quote.type || quote.kind;
  let text = kind === 'recalled' ? '[已撤回消息]' : kind === 'emoji' ? `[表情]${quote.emojiName || quote.emoji || ''}`
    : kind?.startsWith('image') || quote.image ? `[图片]${quote.description || ''}` : quote.text || quote.replyContent || '较早消息';
  text = sanitizeHistoryContent(quote, text).replace(/\s+/g, ' ').trim() || '较早消息';
  return `[引用]${text.length > 40 ? `${text.slice(0, 39)}…` : text}`;
}

export function formatHistoryMessageContent(state, chat, message, sources = []) {
  const kind = message.type || message.kind;
  let text;
  switch (kind) {
    case 'poke': text = '[戳一戳]'; break;
    case 'emoji': text = `[表情]${message.emojiName || message.emoji || message.text || ''}`; break;
    case 'image': case 'image-real': case 'image-fake': text = `[图片]${message.description || ''}`; break;
    case 'recalled': text = '[消息已撤回]'; break;
    case 'redpacket': text = `[红包]${message.amount || '0'}元`; break;
    case 'transfer': text = `[转账]${message.amount ?? ''}元${message.message ? ` ${message.message}` : ''}`; break;
    case 'video': text = `[视频]${message.description || ''}`; break;
    case 'file': text = `[文件]${message.filename || ''}${message.size ? ` ${message.size}` : ''}`; break;
    case 'plan': text = `[约定计划]${message.text || ''}`; break;
    case 'forwarded': {
      const inner = message.messages || message.forward?.messages;
      text = `[转发消息]\n${Array.isArray(inner) ? formatCompactHistory(state, chat, inner) : sanitizeHistoryContent(message, message.forward?.text || message.text || '[空聊天记录]')}\n[/转发消息]`;
      break;
    }
    default: text = message.image ? `[图片]${message.description || ''}` : message.forward
      ? `[转发消息]\n${sanitizeHistoryContent(message, message.forward.text || '')}\n[/转发消息]` : message.text || message.replyContent || '';
  }
  if (message.quote || kind === 'quote') text = `${formatQuoteReference(message.quote || message.quotedMessage, sources)}[回复]${message.replyContent ?? text}`;
  return sanitizeHistoryContent(message, text);
}

/** Metadata grouping only: multiline, forwards, diaries and user rows never merge. */
export function formatCompactHistory(state, chat, messagesOrPlan) {
  const plan = Array.isArray(messagesOrPlan) ? null : messagesOrPlan;
  const messages = Array.isArray(messagesOrPlan) ? messagesOrPlan : [...(plan?.historyRenderList || []), ...(plan?.recentMessages || [])];
  const sources = plan?.includedMessages || messages;
  const userName = state?.settings?.user?.name || '你';
  const contactName = state?.contacts?.[chat?.contactId]?.name || '角色';
  const output = [];
  let previous = null;
  let mergeable = false;
  for (const message of messages) {
    if (message.__diary) {
      output.push(`[日记 ${message.date}]\n${message.text}\n`);
      previous = null;
      mergeable = false;
      continue;
    }
    const content = formatHistoryMessageContent(state, chat, message, sources);
    const structured = (message.type || message.kind) === 'forwarded' || Boolean(message.forward);
    const singleLine = !structured && !content.includes('\n') && ![message.text, message.replyContent, message.description, message.originalContent]
      .some(value => typeof value === 'string' && value.includes('\n'));
    if (mergeable && singleLine && areSameApiCall(previous, message)) output[output.length - 1] += ` / ${content}`;
    else {
      const sender = message.from === 'me' ? userName : message.from === 'system' ? '系统' : message.speaker || contactName;
      output.push(`${formatHistoryTime(message.at, previous?.at, !previous)}${sender}: ${content}`);
    }
    previous = message;
    mergeable = singleLine;
  }
  return output.join('\n');
}

/** Diary requests always use full nonexcluded raw history, with a timestamp per row. */
export function formatDiaryTranscript(state, chat, messages) {
  const userName = state?.settings?.user?.name || '你';
  const contactName = state?.contacts?.[chat?.contactId]?.name || '角色';
  return messages.map(message => `${formatHistoryTime(message.at, null, true)}${message.from === 'me' ? userName : message.from === 'system' ? '系统' : message.speaker || contactName}：${formatHistoryMessageContent(state, chat, message, messages)}`).join('\n');
}
