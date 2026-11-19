/**
 * meme-phone · 聊天
 * 两个页面：会话列表（app-chat）与单人会话（thread）。
 */

import { icon } from '../icons.js';
import {
  chatsOf, chatById, lastMessage, contactById, pushMessage, chatFor, unreadTotal, contactsOf,
  wakeAllowed, messagePreview, addExtrasEntry, theaterKindFor, THEATER_KINDS, theaterKindById,
  apiPresetsOf, memoryPresetsOf, memoryPresetFor, memoryReadModeFor,
  replyPresetsOf, replyPresetFor, replyContextFor, normalizeReplyItems,
  chatHistoryFor, effectiveTavernHistory,
} from '../data.js';
import { memoryPresetSummary } from '../memory.js';
import { requestStats, estimateTokens, proactiveLead } from '../reply-context.js';
import { createChatExport, parseChatTransferText, mergeChatHistory, MAX_CHAT_TRANSFER_BYTES } from '../chat-transfer.js';
import { avatarHtml, chatAvatarHtml, esc, shortText, timeText } from '../shell.js';
import { renderBehaviorBubble, isSystemBehavior, behaviorSettings } from '../behavior.js';
import {
  applyBehaviorMessage, appointmentByMessage, respondAppointment, completeAppointment,
  respondFriendRequest, friendRequests, walletBalance, refundTransfer, revokeMembership,
  cancelAppointment,
} from '../behavior-domains.js';

const REPLY_POOL = {
  沈砚: ['到楼下了，风比刚才小一点。', '你先忙，我在便利店坐着。', '记得吃点东西，别又是咖啡。', '刚看到你窗户还亮着。'],
  江迟: ['那首歌我存下来了。', '下次你在车上再放一次。', '今天听了一下午，副歌有点上头。'],
  林小满: ['雨好像小了一点。', '你带伞了吗。', '我这边刚停，云还很厚。'],
  顾南风: ['书店这本我觉得你会喜欢。', '封面是深蓝色的，摸起来有点粗。', '要给你留着吗。'],
};

function poolFor(contact) {
  return REPLY_POOL[contact?.name] || ['嗯，我在。', '刚看到消息。', '你说吧，我听着。'];
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

/* --------------------------------------------------------- 请求调试栏 */

let activeThreadId = '';

/* 聊天一页渲染多少条：只影响屏幕，不影响发给模型的历史条数。 */
export const THREAD_PAGE = 80;

/** 取聊天要渲染的那一页；返回起始下标和可见消息。 */
export function threadWindow(messages, shown = THREAD_PAGE) {
  const list = Array.isArray(messages) ? messages : [];
  const page = Math.max(1, Number(shown) || THREAD_PAGE);
  const startIndex = Math.max(0, list.length - page);
  return { startIndex, visible: list.slice(startIndex) };
}
let debugPendingKey = '';
let debugSeq = 0;

/* --------------------------------------------------------- 生成任务控制器
 * 发送 / 主动开口 / 重生成共用：每个会话同一时刻只允许一个有效生成任务，
 * 其他会话不被全局锁阻塞。任务冻结会话身份与状态代次，提交前后都再校验。 */
const activeGenerations = new Map(); // chatId -> { reqId, epoch, kind, done, cancelReason }
let generationSeq = 0;

export function startGeneration(ctx, chatId, kind) {
  const existing = activeGenerations.get(chatId);
  if (existing && !existing.done) return null;
  const task = { reqId: `g${++generationSeq}`, epoch: ctx.epoch(), kind, done: false, cancelReason: '' };
  activeGenerations.set(chatId, task);
  return task;
}

export function generationValid(ctx, task, chatId) {
  if (!task || task.done) return false;
  if (task.cancelReason) return false;                 // 已取消：仅忽略结果，不承诺已中止网络
  if (task.epoch !== ctx.epoch()) return false;        // 导入 / 清空已整份替换状态
  const chat = chatById(ctx.state, chatId);
  return Boolean(chat);                                // 会话已被删除
}

export function finishGeneration(chatId) {
  const task = activeGenerations.get(chatId);
  if (task) { task.done = true; activeGenerations.delete(chatId); }
}

/** 取消会话上的在途任务：仅忽略结果；宿主无法终止服务端生成时，不承诺已停止计费。 */
export function cancelGeneration(chatId, reason = 'state-replaced') {
  const task = activeGenerations.get(chatId);
  if (task) { task.cancelReason = reason; task.done = true; activeGenerations.delete(chatId); }
}

/** 仅供测试：清空在途任务表。 */
export function __resetGenerationsForTests() {
  activeGenerations.clear();
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

/* 找出一条消息所属的完整角色轮次（多气泡整轮）。返回带索引的消息数组。 */
export function turnMessages(chat, message) {
  const messages = chat.messages || [];
  const index = messages.findIndex(item => item.id === message.id);
  if (index < 0) return [];
  const turnId = message.turnId;
  if (turnId) {
    const group = messages
      .map((item, i) => ({ item, i }))
      .filter(entry => entry.item.turnId === turnId && entry.item.from === 'them');
    if (group.length) return group;
  }
  /* 老存档没有 turnId：回退到「上一条 me/system 之后的连续 them 段」。 */
  let start = index;
  while (start - 1 >= 0 && messages[start - 1].from === 'them') start -= 1;
  const group = [];
  for (let i = start; i <= index; i += 1) {
    if (messages[i].from === 'them') group.push({ item: messages[i], i });
  }
  return group;
}


function debugEnabled(ctx) {
  /* 默认关着，想要的人自己去设置里打开（老存档里写着开的仍然开） */
  return ctx.state.settings?.chat?.debugBar === true;
}

function debugKey(ctx, chat) {
  const last = chat.messages?.[chat.messages.length - 1];
  return [
    chat.id,
    chat.messages?.length || 0,
    last?.id || '',
    (ctx.state.extrasOn || []).includes(String(chat.contactId)) ? 'theater' : 'plain',
    ctx.state.settings?.api?.activeChat || '',
    replyPresetFor(ctx.state, chat)?.id || '',
    JSON.stringify(chat.history || {}),
    ctx.state.settings?.memory?.activeId || '',
    ctx.state.settings?.memory?.readMode || '',
    wakeAllowed(ctx.state, chat) ? 'wake' : 'nowake',
  ].join('|');
}

function debugMode(ctx, chat, draft) {
  if (String(draft || '').trim()) return 'reply';
  return wakeAllowed(ctx.state, chat) ? 'proactive' : 'none';
}

/** 在缓存的 base 上补最后一条；输入变化时不用重新读记忆 / 世界书。 */
function debugMessages(ctx, chat, contact, cache, draft) {
  const mode = debugMode(ctx, chat, draft);
  const messages = (cache.messages || []).map(message => ({ ...message }));
  if (mode === 'proactive') {
    const lead = proactiveLead(ctx.state, contact);
    const index = messages.findIndex(message => message.source === '场景提示');
    if (index >= 0) messages[index] = { ...messages[index], content: lead };
    else messages.push({ role: 'system', content: lead, source: '场景提示' });
    messages.push({ role: 'user', content: '（现在没有新消息，主动发一条。）', source: '主动消息占位' });
  } else if (mode === 'reply') {
    const who = ctx.state.settings?.user?.name || '我';
    messages.push({ role: 'user', content: `${who}：${String(draft || '').trim()}`, source: '最后一条聊天' });
  }
  return { mode, messages };
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function roleLabel(role) {
  return role === 'user' ? '用户' : role === 'assistant' ? '角色' : '系统';
}

function snippet(text, limit = 56) {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > limit ? `${line.slice(0, limit)}…` : line;
}

function debugRowHtml(row) {
  return `
    <details class="mp-debug-row">
      <summary>
        <span class="mp-debug-dot mp-debug-dot-${row.group.key}"></span>
        <span class="mp-debug-rowmain">
          <span class="mp-debug-rowtop"><span class="mp-debug-source">${esc(row.source)}</span><span class="mp-debug-role">${roleLabel(row.role)}</span></span>
          <span class="mp-debug-snippet">${esc(snippet(row.content) || '（空）')}</span>
        </span>
        <span class="mp-debug-num">${formatNumber(row.tokens)} tk</span>
      </summary>
      <div class="mp-debug-content">${esc(row.content || '（空）')}</div>
      <div class="mp-debug-rowmeta">${formatNumber(row.chars)} 字 · ${roleLabel(row.role)}</div>
    </details>`;
}

function debugPanelHtml(ctx, chat, contact, cache, draft) {
  const { mode, messages } = debugMessages(ctx, chat, contact, cache, draft);
  const stats = requestStats(messages);
  const skipped = (cache.report?.items || []).filter(item => item.status !== 'injected');
  const want = mode === 'proactive' ? '主动开口' : mode === 'reply' ? '这一轮' : '基础上下文';
  const groups = stats.groups;
  const total = stats.total || 1;
  const bars = groups.map(group => `<span class="mp-debug-seg mp-debug-seg-${group.key}" style="width:${Math.max(2, Math.round(group.tokens / total * 100))}%"></span>`).join('');
  const report = cache.report || {};
  const budget = report.charBudget ? `${formatNumber(report.charUsed || 0)} / ${formatNumber(report.charBudget)} 字` : '';
  const inputWarn = report.overLimitInput ? '<div class="mp-composer-tip is-error">当前这条消息过长，建议缩短后再发送。</div>' : '';
  const budgetWarn = !report.overLimitInput && report.overBudget ? '<div class="mp-composer-tip is-error">整套上下文已超出预算，部分条目可能不会注入。</div>' : '';
  const preset = cache.replyPreset?.name || '回复预设';
  const model = cache.model;
  const modelName = model ? `${model.name || model.model || '当前接口'}${model.model && model.name ? ` · ${model.model}` : ''}` : '酒馆 API';

  return `
    <div class="mp-debug-panel">
      <div class="mp-debug-summary">
        <div class="mp-debug-summary-main">${want} · ${formatNumber(stats.rows.length)} 条消息${budget ? ` · 上下文 ${budget}` : ''}</div>
        <div class="mp-debug-model">${esc(modelName)} · ${esc(preset)}</div>
      </div>
      <div class="mp-debug-share" aria-hidden="true">${bars || '<span class="mp-debug-seg mp-debug-seg-empty" style="width:100%"></span>'}</div>
      ${inputWarn}${budgetWarn}
      <div class="mp-debug-list">${stats.rows.map(debugRowHtml).join('') || '<div class="mp-debug-empty">这一轮没有可发送的消息。</div>'}</div>
      ${skipped.length ? `
      <details class="mp-debug-more">
        <summary>未进入这一次 · ${skipped.length} 条</summary>
        ${skipped.map(item => `<div class="mp-debug-skip"><span>${esc(item.label || '条目')}</span><small>${esc(item.reason || item.status || '')}</small></div>`).join('')}
      </details>` : ''}
      <div class="mp-debug-foot">按字符估算，实际 token 以模型分词为准。${mode === 'none' ? ' 空发送已关闭，这里只显示基础上下文。' : ''}</div>
    </div>`;
}

function debugBarHtml(ctx, chat, contact) {
  if (!debugEnabled(ctx)) return '';
  const cache = ctx.shell.debugPreview;
  const draft = String(ctx.shell.live.inputValue || chat.draft || '');
  const open = Boolean(ctx.shell.debugOpen?.[chat.id]);
  const ready = cache?.chatId === chat.id && Array.isArray(cache.messages) && cache.key === debugKey(ctx, chat);
  const loading = !ready;
  let head = '统计中…';
  let mode = '';
  if (ready) {
    const built = debugMessages(ctx, chat, contact, cache, draft);
    const stats = requestStats(built.messages);
    mode = built.mode;
    head = mode === 'none' ? '输入后统计' : `≈ ${formatNumber(stats.total)} tk`;
  } else if (cache?.chatId === chat.id && cache.error) {
    head = '统计失败';
  }
  return `
    <div class="mp-debug${open ? ' is-open' : ''}${loading ? ' is-loading' : ''}${mode === 'proactive' ? ' is-proactive' : ''}">
      <button class="mp-debug-head" data-act="debug-toggle" data-chat="${chat.id}" type="button" aria-expanded="${open ? 'true' : 'false'}">
        <span class="mp-debug-title">${mode === 'proactive' ? '主动开口' : '请求预览'}</span>
        <span class="mp-debug-tk" data-debug-tk>${head}</span>
        <span class="mp-debug-caret">${icon('chevron')}</span>
      </button>
      ${open && ready ? debugPanelHtml(ctx, chat, contact, cache, draft) : ''}
      ${open && !ready ? `<div class="mp-debug-panel"><div class="mp-debug-empty">${cache?.error ? `统计失败：${esc(cache.error)}` : '正在读这一轮的上下文…'}</div>${cache?.error ? `<button class="mp-debug-retry" data-act="debug-refresh" data-chat="${chat.id}" type="button">重新统计</button>` : ''}</div>` : ''}
    </div>`;
}

function ensureDebugPreview(ctx, chat, contact) {
  if (!debugEnabled(ctx)) return;
  const key = debugKey(ctx, chat);
  const cache = ctx.shell.debugPreview;
  if (cache?.chatId === chat.id && cache.key === key) return;
  if (debugPendingKey === key) return;
  debugPendingKey = key;
  const seq = ++debugSeq;
  setTimeout(async () => {
    try {
      const value = await ctx.ai.preview(chat, contact);
      if (seq !== debugSeq || activeThreadId !== chat.id) return;
      ctx.shell.debugPreview = { chatId: chat.id, ...value, key };
    } catch (error) {
      if (seq !== debugSeq || activeThreadId !== chat.id) return;
      ctx.shell.debugPreview = { chatId: chat.id, key, error: String(error?.message || error || '统计失败') };
    } finally {
      if (debugPendingKey === key) debugPendingKey = '';
      if (activeThreadId === chat.id && ctx.shell.root?.querySelector?.('.mp-thread')) ctx.rerender();
    }
  }, 180);
}

/* 聊天设置页：行样式沿用全局设置页，不另造一套 */
function chatSetRow(chatId, { iconName, title, sub, act, toggle, value, danger, kind }) {
  return `
    <button class="mp-set-row${danger ? ' is-danger' : ''}" data-act="${act}" data-chat="${esc(chatId)}"${kind ? ` data-kind="${esc(kind)}"` : ''} type="button">
      <span class="mp-set-ico">${icon(iconName)}</span>
      <span class="mp-set-name">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${toggle !== undefined
        ? `<span class="mp-switch${toggle ? ' on' : ''}"></span>`
        : value ? `<span class="mp-set-value">${esc(value)}</span>` : ''}
      ${toggle === undefined ? `<span style="color:var(--text-4)">${icon('chevron')}</span>` : ''}
    </button>`;
}

/* 数字设置行：直接填数字，change 时立即保存，交互对齐 acsus 的聊天设置。 */
function chatNumberRow(chatId, { iconName, title, sub, act, value, placeholder, min = 1, max = 50 }) {
  const maxAttr = max ? ` max="${max}"` : '';
  return `
    <label class="mp-set-row mp-set-row-number">
      <span class="mp-set-ico">${icon(iconName)}</span>
      <span class="mp-set-name">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      <input class="mp-set-number" type="number" inputmode="numeric"
        min="${min}"${maxAttr} step="1"
        value="${esc(value)}" placeholder="${esc(placeholder)}"
        data-act="${act}" data-chat="${esc(chatId)}" aria-label="${esc(title)}">
    </label>`;
}

function saveMessageExtra(ctx, chat, contact, message) {
  const list = (ctx.state.extras[chat.contactId] = ctx.state.extras[chat.contactId] || []);
  const item = {
    id: 'x' + Date.now().toString(36),
    title: (message.text || '这一条').slice(0, 12),
    kind: theaterKindFor(ctx.state),
    sections: [{ title: '原文', content: message.text || '' }],
    date: new Date(message.at || Date.now()).toLocaleDateString('sv-SE'),
    lines: [message.text || ''],
    messageId: message.id,
    chatId: chat.id,
  };
  list.unshift(item);
  ctx.save();
  return item;
}

function openMessageExtra(ctx, chat, contact, message) {
  const extras = (ctx.state.extras[chat.contactId] || [])
    .filter(item => item.messageId === message.id);
  if (extras.length === 1) {
    ctx.go('extra-detail', { contactId: chat.contactId, extraId: extras[0].id });
    return;
  }
  if (extras.length > 1) {
    ctx.openSheet({
      title: '这条消息的小剧场',
      items: extras.map(item => ({ label: item.title, value: item.id, icon: 'theater' })),
      onPick: (value) => ctx.go('extra-detail', { contactId: chat.contactId, extraId: value }),
    });
    return;
  }
  ctx.openSheet({
    title: '这条消息还没有小剧场',
    items: [
      { label: '把这条存成小剧场', value: 'save', icon: 'theater' },
      { label: '看 TA 的全部小剧场', value: 'all', icon: 'book' },
    ],
    onPick: (value) => {
      if (value === 'save') {
        const item = saveMessageExtra(ctx, chat, contact, message);
        ctx.toast('已存进小剧场');
        ctx.go('extra-detail', { contactId: chat.contactId, extraId: item.id });
      }
      if (value === 'all') ctx.go('app-extras', { contactId: chat.contactId });
    },
  });
}

function theaterPanelHtml(ctx, chat) {
  const state = ctx.state;
  const currentId = chat?.contactId ? String(chat.contactId) : '';
  const current = contactById(state, currentId);
  const on = new Set(Array.isArray(state.extrasOn) ? state.extrasOn.map(String) : []);
  const kind = theaterKindById(theaterKindFor(state));
  const currentOn = current ? on.has(current.id) : false;

  const typeButtons = THEATER_KINDS.map(item => {
    const badge = item.gate ? '<span class="mp-extra-kind-badge">18+</span>' : '';
    return `
      <button class="mp-extra-kind mp-theater-type is-${item.id}${kind.id === item.id ? ' on' : ''}" data-act="theater-kind" data-kind="${item.id}" type="button">
        ${badge}<span class="mp-extra-kind-label">${esc(item.label)}</span>
      </button>`;
  }).join('');

  const currentRow = current
    ? `
      <button class="mp-theater-row is-current" data-act="theater-toggle" data-contact="${esc(current.id)}" type="button">
        ${chatAvatarHtml(current)}
        <div class="mp-theater-row-main">
          <div class="mp-theater-row-name">这轮带小剧场</div>
          <div class="mp-theater-row-sub">${currentOn ? `会带 ${esc(kind.label)} 小剧场` : '当前角色只聊天'}</div>
        </div>
        <span class="mp-switch${currentOn ? ' on' : ''}"></span>
      </button>`
    : '<div class="mp-empty">这个会话没有关联角色。</div>';

  return `
    <div class="mp-theater-panel">
      <div class="mp-theater-head">
        <div>
          <div class="mp-theater-title">小剧场</div>
          <div class="mp-theater-sub">只控制当前角色这一轮带不带；内容只进小剧场 App，不显示在聊天里。</div>
        </div>
      </div>

      <div class="mp-theater-section">
        <div class="mp-theater-section-head">
          <span>写哪种</span>
          <span>${esc(kind.sub)}</span>
        </div>
        <div class="mp-theater-types">${typeButtons}</div>
      </div>

      <div class="mp-theater-now">${currentRow}</div>

      <div class="mp-theater-foot">
        <button class="mp-theater-link" data-act="theater-app" data-chat="${chat?.id || ''}" type="button">${icon('theater')}打开小剧场 App</button>
      </div>
    </div>`;
}

function openTheaterSheet(ctx, chat) {
  ctx.openSheet({
    kind: 'panel',
    title: '',
    doneLabel: '完成',
    render: () => theaterPanelHtml(ctx, chat),
  });
}

function settingsBody(ctx, chatId) {
  const state = ctx.state;
  const chat = chatById(state, chatId);
  if (!chat) return `<div class="mp-page-body"><div class="mp-empty">这个会话已经不在了。</div></div>`;
  const contact = contactById(state, chat.contactId);
  const card = (state.characters || []).find(item => item.name === contact?.name);
  const count = chat.messages?.length || 0;
  const mode = contact?.kind === 'group' ? '群聊' : contact?.kind === 'char' ? '酒馆角色' : '单聊';
  const status = [mode, `${count} 条消息`, chat.pinned ? '置顶' : '', chat.muted ? '免打扰' : ''].filter(Boolean).join(' · ');
  const presets = apiPresetsOf(state);
  const ownPreset = presets.find(item => item.id === chat.llmPresetId) || null;
  const globalPreset = presets.find(item => item.id === state.settings.api?.activeChat) || presets[0] || null;
  const llmSub = ownPreset
    ? `只对这个会话 · ${ownPreset.name || '未命名方案'}`
    : `跟随手机 · ${globalPreset?.name || '酒馆 API'}`;
  const memoryPresets = memoryPresetsOf(state);
  const ownMemory = memoryPresets.find(item => item.id === chat.memoryPresetId) || null;
  const globalMemory = memoryPresetFor(state, null);
  const memorySub = ownMemory
    ? `只对这个会话 · ${memoryPresetSummary(ownMemory)}`
    : `跟随手机 · ${memoryPresetSummary(globalMemory)}`;
  const replyPresets = replyPresetsOf(state);
  const ownReply = replyPresets.find(item => item.id === chat.replyPresetId) || null;
  const globalReply = replyPresetFor(state, null);
  const activeReply = ownReply || globalReply;
  const replyItems = normalizeReplyItems(activeReply?.items, activeReply?.context);
  const replyItemCount = replyItems.filter(item => item.kind === 'chat').length;
  const replyAppCount = replyItems.filter(item => item.kind === 'app').length;
  const injectedCount = replyItems.filter(item => item.kind === 'context' && item.enabled).length;
  const replySub = `${ownReply ? `只对这个会话 · ${ownReply.name || '未命名'}` : `跟随手机 · ${globalReply?.name || '默认回复方式'}`} · ${replyItemCount} 条聊天提示${replyAppCount ? ` · ${replyAppCount} 条其他软件` : ''} · ${injectedCount ? `注入 ${injectedCount} 段` : '不注入上下文'}`;
  const behavior = behaviorSettings(state, chat);
  const historyConfig = chatHistoryFor(chat);
  const tavern = effectiveTavernHistory(state, chat, memoryPresetFor(state, chat));
  const followTavernMode = memoryReadModeFor(state, chat.contactId, memoryPresetFor(state, chat));
  const tavernValue = tavern.mode === 'summary'
    ? '全部总结'
    : tavern.mode === 'recent' ? `最近 ${tavern.floors} 层`
      : followTavernMode === 'summary' ? '方案 · 总结'
        : followTavernMode === 'recent' ? `方案 · 原文 ${tavern.floors} 层`
          : `自动 · ${tavern.floors} 层`;
  const phoneFollowLimit = replyContextFor(state, chat).historyLimit;
  const tavernSub = [
    '只改这个角色',
    historyConfig.tavernMode || historyConfig.tavernFloors ? '已单独设置' : '跟随记忆方案',
  ].join(' · ');
  const tavernFloorSub = [
    '最近原文层数',
    historyConfig.tavernFloors ? '已单独设置' : `空着跟随记忆方案 · ${tavern.floors} 层`,
    '填数字后自动切到最近原文',
  ].join(' · ');
  const phoneNumberSub = [
    '最近几条',
    historyConfig.phoneLimit ? '已单独设置' : `空着跟随回复预设 · ${phoneFollowLimit} 条`,
  ].join(' · ');

  const effectiveLines = [
    ['用哪个模型', `${ownPreset ? ownPreset.name || '未命名方案' : `${globalPreset?.name || '酒馆 API'}（跟随手机）`}`],
    ['怎么回复', `${activeReply?.name || '默认回复方式'}${ownReply ? '（这个会话单独设）' : '（跟随手机）'}`],
    ['参考什么', `酒馆记忆 ${memoryPresetSummary(memoryPresetFor(state, chat))}${ownMemory ? '（这个会话单独设）' : '（跟随手机）'} · 小手机历史 ${chatHistoryFor(chat).phoneLimit || phoneFollowLimit} 条`],
  ];

  return `
    <div class="mp-page-body">
      <div class="mp-subtitle" style="margin-top:0">聊天设置 · 只改这个会话的开关和引用；角色卡、世界书是全局的，改会写到酒馆</div>

      <div class="mp-chat-set-head">
        ${avatarHtml(contact?.name || '?', contact?.avatar)}
        <div class="mp-chat-set-main">
          <div class="mp-chat-set-name">${esc(contact?.name || '这个会话')}</div>
          <div class="mp-chat-set-sub">${esc(status)}</div>
        </div>
        ${chat.pinned ? `<span class="mp-pill">置顶</span>` : ''}
      </div>

      <div class="mp-card" style="margin-top:12px">
        <div class="mp-card-title">这条会话实际用到的</div>
        ${effectiveLines.map(([label, value]) => `<div class="mp-card-sub">${esc(label)}：${esc(value)}</div>`).join('')}
        <div class="mp-card-sub" style="color:var(--text-4)">下面每一行写着「跟随」就是用手机的，写着「单独」就是这条会话自己设的。</div>
      </div>

      <div class="mp-group" style="margin-top:16px">
        <div class="mp-group-label">聊天</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, { iconName: 'pin', title: '置顶聊天', sub: chat.pinned ? '已固定在会话列表最上面' : '让这个会话排在前面', act: 'ts-toggle-pin', toggle: chat.pinned })}
          ${chatSetRow(chat.id, { iconName: 'bell', title: '消息免打扰', sub: chat.muted ? '新消息不显示未读角标' : '这个会话的新消息照常计数', act: 'ts-toggle-mute', toggle: chat.muted })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">模型</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, {
            iconName: 'spark', title: '这个聊天的 LLM',
            sub: llmSub, act: 'ts-llm', value: ownPreset ? '单独' : '跟随',
          })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">回复</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, {
            iconName: 'reply', title: '回复预设',
            sub: replySub, act: 'ts-reply', value: ownReply ? '单独' : '跟随',
          })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">行为</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, { iconName: 'transfer', title: '转账', sub: '允许 TA 在回复里发转账标签', act: 'ts-behavior-toggle', kind: 'transfer', toggle: behavior.transfer })}
          ${chatSetRow(chat.id, { iconName: 'transfer', title: '红包', sub: '允许 TA 在回复里发红包标签', act: 'ts-behavior-toggle', kind: 'redpacket', toggle: behavior.redpacket })}
          ${chatSetRow(chat.id, { iconName: 'spark', title: '会员', sub: '允许 TA 送会员或自己开会员', act: 'ts-behavior-toggle', kind: 'membership', toggle: behavior.membership })}
          ${chatSetRow(chat.id, { iconName: 'plan', title: '约定计划', sub: '允许 TA 发约定，接受后可以完成并写故事', act: 'ts-behavior-toggle', kind: 'plan', toggle: behavior.plan })}
          ${chatSetRow(chat.id, { iconName: 'contacts', title: '好友申请', sub: '允许 TA 发好友申请，你可以在聊天里通过', act: 'ts-behavior-toggle', kind: 'friend', toggle: behavior.friend })}
          ${chatSetRow(chat.id, { iconName: 'reply', title: '个签', sub: '允许 TA 改自己的个签', act: 'ts-behavior-toggle', kind: 'signature', toggle: behavior.signature })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">上下文</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, {
            iconName: 'clock', title: '历史酒馆消息',
            sub: `全部总结或最近几层原文 · ${tavernSub}`, act: 'ts-tavern-history', value: tavernValue,
          })}
          ${chatNumberRow(chat.id, {
            iconName: 'book', title: '酒馆原文层数',
            sub: tavernFloorSub, act: 'ts-tavern-floors',
            value: historyConfig.tavernFloors || '', placeholder: String(tavern.floors),
          })}
          ${chatNumberRow(chat.id, {
            iconName: 'chat', title: '历史小手机消息',
            sub: phoneNumberSub, act: 'ts-phone-history',
            value: historyConfig.phoneLimit || '', placeholder: String(phoneFollowLimit), max: null,
          })}
          ${chatSetRow(chat.id, {
            iconName: 'book', title: '酒馆记忆方案',
            sub: memorySub, act: 'ts-memory', value: ownMemory ? '单独' : '跟随',
          })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">这个角色</div>
        <div class="mp-group-box">
          ${card
            ? chatSetRow(chat.id, { iconName: 'contacts', title: '角色设定与世界书', sub: '角色卡正文只读；世界书开关会写回酒馆，影响所有会话', act: 'ts-open-character' })
            : chatSetRow(chat.id, { iconName: 'search', title: '去查角色', sub: '还没同步这张角色卡', act: 'ts-open-characters' })}
          ${chatSetRow(chat.id, { iconName: 'diary', title: 'TA 的日记', sub: '按天记录这个角色和你的聊天', act: 'ts-diary' })}
          ${chatSetRow(chat.id, { iconName: 'theater', title: '看 TA 的小剧场', sub: '这个角色存下来的片段', act: 'ts-extras' })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">记录</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, { iconName: 'download', title: '导出这段聊天', sub: '存成 json；换手机或导入别的会话时用', act: 'ts-export-chat' })}
          ${chatSetRow(chat.id, { iconName: 'upload', title: '导入聊天记录', sub: '合并到这段聊天，重复消息自动跳过；只带正文，excluded 之类标记不识别', act: 'ts-import-chat' })}
          ${chatSetRow(chat.id, { iconName: 'trash', title: '清空这个会话的消息', sub: '只删聊天记录，联系人和角色卡都还在', act: 'ts-clear', danger: true })}
          ${chatSetRow(chat.id, { iconName: 'close', title: '删除这个会话', sub: '连同会话设置一起删掉', act: 'ts-delete', danger: true })}
        </div>
      </div>
    </div>`;
}


/* ------------------------------------------------------ 会话列表 */

function listBody(ctx) {
  const state = ctx.state;
  const chats = chatsOf(state).filter(chat => chat.messages.length || chat.unread);

  const rows = chats.map(chat => {
    const contact = contactById(state, chat.contactId);
    if (!contact) return '';
    const message = lastMessage(chat);
    const preview = message
      ? `${message.from === 'me' ? '我：' : ''}${messagePreview(message)}`
      : '还没有消息，说点什么吧。';
    return `
      <button class="mp-row" data-act="open-thread" data-chat="${chat.id}" data-hold="chat-menu" type="button">
        ${avatarHtml(contact.name, contact.avatar)}
        <div class="mp-row-main">
          <div class="mp-row-name">
            ${esc(contact.name)}
            ${chat.pinned ? `<span class="mp-pill plain">${icon('pin')}</span>` : ''}
            ${contact.kind === 'group' ? '<span class="mp-pill plain">群</span>' : ''}
          </div>
          <div class="mp-row-sub">${esc(preview)}</div>
        </div>
        <div class="mp-row-side">
          <span>${chat.updatedAt ? shortText(chat.updatedAt) : ''}</span>
          ${chat.unread && !chat.muted ? `<span class="mp-badge-count">${chat.unread > 99 ? '99+' : chat.unread}</span>` : ''}
        </div>
      </button>`;
  }).join('');

  return `
    <div class="mp-page-body">
      <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
        <span style="flex:1"></span>
        <button class="mp-icon-btn" data-act="chat-new" type="button" aria-label="新建会话">${icon('plus')}</button>
      </div>
      <div class="mp-subtitle">聊天 · ${chats.length} 个会话 · ${unreadTotal(state)} 条未读</div>
      ${rows || '<div class="mp-empty">还没有会话。<br>先去「通讯录」把角色加进来。</div>'}
    </div>`;
}

/* --------------------------------------------------------- 会话页 */

function threadBody(ctx, chatId) {
  activeThreadId = chatId;
  const state = ctx.state;
  const chat = chatById(state, chatId);
  if (!chat) {
    activeThreadId = '';
    return `${nav(ctx)}<div class="mp-page-body"><div class="mp-empty">这个会话已经不在了。</div></div>`;
  }
  const contact = contactById(state, chat.contactId);
  const messages = chat.messages || [];
  const quote = ctx.shell.quote?.[chatId] || null;

  /* 显示窗口：只渲染最近一页，往上翻再加载更早的。
     注意这里只管屏幕上的 DOM 数量，发给模型的历史仍按上下文预算从完整 messages 里取。 */
  const PAGE = THREAD_PAGE;
  if (!ctx.shell.msgWindow) ctx.shell.msgWindow = {};
  const shown = Math.max(PAGE, Number(ctx.shell.msgWindow[chatId]) || PAGE);
  const { startIndex, visible } = threadWindow(messages, shown);

  const blocks = [];
  if (startIndex > 0) {
    blocks.push(`<button class="mp-msg-more" data-act="load-older" data-chat="${chat.id}" type="button">加载更早的 ${startIndex} 条</button>`);
  }
  let lastAt = startIndex > 0 ? (messages[startIndex - 1]?.at || 0) : 0;
  const speakerName = (message) => {
    const speaker = message.speaker ? contactById(state, message.speaker) : null;
    return speaker?.name || contact?.name || 'TA';
  };
  for (const message of visible) {
    const startGroup = message.at - lastAt > 30 * 60 * 1000;
    if (message.kind === 'system' || message.from === 'system' || message.kind === 'recalled' || message.kind === 'poke' || isSystemBehavior(message)) {
      if (startGroup) {
        blocks.push(`<div class="mp-time">${timeText(message.at)}</div>`);
        lastAt = message.at;
      }
      if (message.kind === 'recalled') {
        blocks.push(`<div class="mp-sys is-recall">${message.from === 'me' ? '你撤回了一条消息' : `${esc(speakerName(message))}撤回了一条消息`}</div>`);
      } else if (message.kind === 'poke') {
        blocks.push(`<div class="mp-sys is-poke">${message.from === 'me' ? `你拍了拍「${esc(contact?.name || 'TA')}」` : `「${esc(contact?.name || 'TA')}」拍了拍你`}</div>`);
      } else if (isSystemBehavior(message)) {
        blocks.push(renderBehaviorBubble(message, { chatId: chat.id, contact }));
      } else {
        blocks.push(`<div class="mp-sys">${esc(message.text)}</div>`);
      }
      continue;
    }
    if (startGroup) {
      blocks.push(`<div class="mp-time">${timeText(message.at)}</div>`);
      lastAt = message.at;
    }
    const me = message.from === 'me';
    const speaker = message.speaker ? contactById(state, message.speaker) : null;
    const behaviorBubble = renderBehaviorBubble(message, { chatId: chat.id, contact });
    const bubble = behaviorBubble || (message.image
      ? `<button class="mp-bubble mp-bubble-photo" data-act="view-photo" data-chat="${chat.id}" data-msg="${message.id}" type="button"><img src="${esc(message.image)}" alt="照片"></button>`
      : message.emoji
        ? `<div class="mp-bubble mp-bubble-emoji">${esc(message.emoji)}</div>`
        : message.forward
          ? `<div class="mp-bubble mp-bubble-forward"><div class="mp-forward-head">${icon('forward')}<span>转发的消息</span></div><div class="mp-forward-text">${esc(message.forward.text || '')}</div>${message.forward.from ? `<div class="mp-forward-src">来自 ${esc(message.forward.from)}</div>` : ''}</div>`
          : `<div class="mp-bubble">${esc(message.text)}</div>`);
    blocks.push(`
      <div class="mp-msg${me ? ' me' : ''}" data-hold="message-menu" data-chat="${chat.id}" data-msg="${message.id}">
        ${me
          ? avatarHtml(state.settings.user.name, state.settings.user.avatar)
          : `<button class="mp-avatar-btn" data-act="avatar-extra" data-chat="${chat.id}" data-msg="${message.id}" type="button" aria-label="看 TA 的小剧场">${avatarHtml(speaker?.name || contact?.name, speaker?.avatar || contact?.avatar)}</button>`}
        <div class="mp-msg-body">
          ${message.quote ? `<div class="mp-quote-line">${icon('reply')}<span>${esc(message.quote.text)}</span></div>` : ''}
          ${bubble}
          <div class="mp-msg-meta">
            ${message.proactive ? '<span class="mp-tag-proactive">主动开口</span>' : ''}
            ${speaker ? `<span>${esc(speaker.name)}</span>` : ''}
            <span>${startGroup ? '' : timeText(message.at)}</span>
          </div>
        </div>
      </div>`);
  }

  if (chat.typing) {
    blocks.push(`<div class="mp-msg">${avatarHtml(contact?.name, contact?.avatar)}<div class="mp-msg-body"><div class="mp-typing"><i></i><i></i><i></i></div></div></div>`);
  }

  ensureDebugPreview(ctx, chat, contact);
  const debugBar = debugBarHtml(ctx, chat, contact);

  return `
    <div class="mp-thread">
      <div class="mp-thread-head">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        ${avatarHtml(contact?.name, contact?.avatar)}
        <div style="flex:1;min-width:0">
          <div class="mp-thread-name">${esc(contact?.name || '')}</div>
          <div class="mp-thread-status"><span class="mp-dot"></span>${esc(contact?.signature || '在线')}</div>
        </div>
        <button class="mp-icon-btn" data-act="thread-settings" data-chat="${chat.id}" type="button" aria-label="聊天设置">${icon('settings')}</button>
      </div>
      <div class="mp-messages" id="mpMessages">${blocks.join('')}</div>
      <div class="mp-composer">
        ${debugBar}
        ${behaviorFormHtml(ctx, chat)}
        <div class="mp-composer-tip">空着发出去，TA 会主动开口</div>
        ${quote ? `
        <div class="mp-quote-chip">
          <span style="color:var(--accent-deep)">${icon('reply')}</span>
          <span class="mp-quote-chip-text">${esc(quote.text)}</span>
          <button class="mp-sq-btn" data-act="clear-quote" data-chat="${chat.id}" type="button" style="width:26px;height:26px">${icon('close')}</button>
        </div>` : ''}
        ${chat.failedTurn ? `<div class="mp-composer-tip is-error">${esc(chat.failedTurn.reason || '这一轮没接通')} <button class="mp-mini-btn" data-act="retry-turn" data-chat="${chat.id}" type="button">重试</button></div>` : ''}
        <div class="mp-composer-row">
          <button class="mp-sq-btn" data-act="composer-plus" data-chat="${chat.id}" type="button" aria-label="更多">${icon('plus')}</button>
          <div class="mp-compose-box">
            <input type="text" placeholder="发消息…" value="${esc(ctx.shell.live.inputValue || '')}" aria-label="输入消息">
          </div>
          <button class="mp-sq-btn" data-act="say-first" data-chat="${chat.id}" type="button" aria-label="让 TA 先说" title="让 TA 主动开口">${icon('reply')}</button>
          <button class="mp-send" data-act="send" data-chat="${chat.id}" type="button" aria-label="发送">${icon('send')}</button>
        </div>
        <input id="mpMsgPhoto" type="file" accept="image/*" data-chat="${chat.id}" style="position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0">
      </div>
    </div>`;
}

function behaviorFormHtml(ctx, chat) {
  const form = ctx.shell.behaviorForm;
  if (!form || form.chatId !== chat.id) return '';
  const kind = form.kind;
  if (kind === 'transfer' || kind === 'redpacket') {
    return `
      <div class="mp-behavior-form">
        <div class="mp-behavior-form-head"><span>${kind === 'redpacket' ? '红包' : '转账'} · 余额 ¥${walletBalance(ctx.state).toFixed(2)}</span><button class="mp-sq-btn" data-act="behavior-form-cancel" data-chat="${chat.id}" type="button" aria-label="收起">${icon('close')}</button></div>
        <input id="mpBehaviorAmount" class="mp-behavior-input" type="text" inputmode="decimal" placeholder="金额" aria-label="金额">
        <input id="mpBehaviorNote" class="mp-behavior-input" type="text" maxlength="80" placeholder="留言（可不写）" aria-label="留言">
        <div class="mp-behavior-actions">
          <button class="mp-mini-btn plain" data-act="behavior-form-cancel" data-chat="${chat.id}" type="button">取消</button>
          <button class="mp-mini-btn" data-act="behavior-form-send" data-chat="${chat.id}" data-kind="${kind}" type="button">发送</button>
        </div>
      </div>`;
  }
  if (kind === 'plan') {
    return `
      <div class="mp-behavior-form">
        <div class="mp-behavior-form-head"><span>约定计划</span><button class="mp-sq-btn" data-act="behavior-form-cancel" data-chat="${chat.id}" type="button" aria-label="收起">${icon('close')}</button></div>
        <input id="mpBehaviorTitle" class="mp-behavior-input" type="text" maxlength="80" placeholder="比如：周末一起去看海" aria-label="计划">
        <div class="mp-behavior-actions">
          <button class="mp-mini-btn plain" data-act="behavior-form-cancel" data-chat="${chat.id}" type="button">取消</button>
          <button class="mp-mini-btn" data-act="behavior-form-send" data-chat="${chat.id}" data-kind="plan" type="button">发起</button>
        </div>
      </div>`;
  }
  if (kind === 'membership') {
    return `
      <div class="mp-behavior-form">
        <div class="mp-behavior-form-head"><span>送会员</span><button class="mp-sq-btn" data-act="behavior-form-cancel" data-chat="${chat.id}" type="button" aria-label="收起">${icon('close')}</button></div>
        <div class="mp-behavior-form-row">
          <select id="mpBehaviorMemberType" class="mp-behavior-input">
            <option value="vip">VIP</option>
            <option value="svip">SVIP</option>
          </select>
          <select id="mpBehaviorMemberMonths" class="mp-behavior-input">
            <option value="1">1 个月</option>
            <option value="12">12 个月</option>
          </select>
        </div>
        <div class="mp-behavior-hint">会从钱包余额扣除，赠送记录会写进收支。</div>
        <div class="mp-behavior-actions">
          <button class="mp-mini-btn plain" data-act="behavior-form-cancel" data-chat="${chat.id}" type="button">取消</button>
          <button class="mp-mini-btn" data-act="behavior-form-send" data-chat="${chat.id}" data-kind="membership" type="button">赠送</button>
        </div>
      </div>`;
  }
  return '';
}

function nav(ctx, right = '') {
  return `<div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button><span style="flex:1"></span>${right}</div>`;
}/* --------------------------------------------------------- 发送逻辑 */

function scrollToBottom(ctx) {
  const box = ctx.shell.root.querySelector('.mp-messages');
  if (box) box.scrollTop = box.scrollHeight;
  ctx.shell.scroller = null;
}

function doSend(ctx, chatId) {
  const input = ctx.shell.root.querySelector('.mp-compose-box input');
  const text = (input?.value || '').trim();
  const chat = chatById(ctx.state, chatId);
  if (!chat) return;
  const contact = contactById(ctx.state, chat.contactId);

  const busy = activeGenerations.get(chatId);
  if (busy && !busy.done) { ctx.toast('正在回复这条会话，稍等一下'); return; }

  if (!text) {
    runGeneration(ctx, chat, contact, { kind: 'proactive' });
    return;
  }

  pushMessage(ctx.state, chatId, { from: 'me', text, quote: ctx.shell.quote?.[chatId] || null });
  chat.draft = '';
  chat.unread = 0;
  if (ctx.shell.quote) delete ctx.shell.quote[chatId];
  ctx.shell.live = { inputValue: '', focus: true };
  ctx.save();
  ctx.rerender();
  scrollToBottom(ctx);
  runGeneration(ctx, chat, contact, { kind: 'reply' });
}

function commitBehaviorMessage(ctx, chat, contact, draft) {
  const saved = pushMessage(ctx.state, chat.id, draft);
  if (!saved) return null;
  const applied = applyBehaviorMessage(ctx.state, saved, {
    chatId: chat.id,
    contactId: chat.contactId,
    contact,
  });
  if (!applied.ok) {
    chat.messages = chat.messages.filter(item => item.id !== saved.id);
    ctx.toast(applied.reason || '这一步没做成');
    ctx.rerender();
    return null;
  }
  return saved;
}

function rollbackBehavior(ctx, chat, message) {
  const behavior = message.behavior;
  if (!behavior) return { ok: true };
  if (message.kind === 'transfer' || message.kind === 'redpacket') {
    if (!behavior.txId) return { ok: true };
    const result = refundTransfer(ctx.state, behavior.txId);
    if (!result.ok && /余额不足/.test(result.reason || '')) return result;
    return { ok: true };
  }
  if (message.kind === 'gift-membership' || message.kind === 'buy-membership') {
    const target = behavior.target || (message.from === 'me' ? 'contact' : 'user');
    const membership = revokeMembership(ctx.state, { target, contactId: chat.contactId, messageId: message.id });
    return membership.ok ? membership : { ok: true };
  }
  if (message.kind === 'plan') {
    const plan = appointmentByMessage(ctx.state, chat.contactId, message.id)
      || (behavior.planId ? appointmentByMessage(ctx.state, chat.contactId, behavior.planId) : null);
    return plan ? cancelAppointment(ctx.state, { contactId: chat.contactId, planId: plan.id }) : { ok: true };
  }
  return { ok: true };
}

function bubbleEntry(bubble, turnId) {
  return {
    from: 'them',
    turnId,
    kind: bubble.kind || 'text',
    text: bubble.text || '',
    image: bubble.image || '',
    emoji: bubble.emoji || '',
    forward: bubble.forward || null,
    quote: bubble.quote || null,
    behavior: bubble.behavior || null,
  };
}

/** 统一生成任务：发送 / 主动开口 / 重生成都走这里。 */
async function runGeneration(ctx, chat, contact, options = {}) {
  const { kind = 'reply', replaceIds = [] } = options;
  const task = startGeneration(ctx, chat.id, kind);
  if (!task) { ctx.toast('正在回复这条会话，稍等一下'); return; }

  chat.typing = true;
  ctx.rerender();
  scrollToBottom(ctx);

  const delay = kind === 'proactive' ? 1500 : 900 + Math.random() * 700;
  await sleep(delay);
  if (!generationValid(ctx, task, chat.id)) {
    finishGeneration(chat.id);
    chat.typing = false;
    return;
  }

  let bubbles = [];
  let sections = [];
  let kindOut = '';
  let error = '';
  try {
    if (kind === 'proactive') {
      const text = await ctx.ai.proactive(ctx, chat, contact, pick(poolFor(contact)));
      bubbles = text ? [{ kind: 'proactive', text, behavior: null }] : [];
    } else {
      const result = await ctx.ai.reply(ctx, chat, contact, pick(poolFor(contact)), { omitIds: replaceIds });
      bubbles = Array.isArray(result?.bubbles) && result.bubbles.length
        ? result.bubbles
        : (result?.text ? [{ kind: 'text', text: result.text, behavior: null }] : []);
      sections = Array.isArray(result?.sections) ? result.sections : [];
      kindOut = String(result?.kind || '');
    }
  } catch (err) {
    error = err?.message || '模型没接通，先在设置里选一个 API';
  }

  if (!generationValid(ctx, task, chat.id)) {
    finishGeneration(chat.id);
    chat.typing = false;
    return;
  }
  chat.typing = false;
  finishGeneration(chat.id);

  if (error) {
    /* 保留用户消息与草稿；失败轮记录下来，可原地重试，不重复追加用户原话。 */
    chat.failedTurn = { kind, replaceIds, reason: error, at: Date.now() };
    ctx.toast(error);
    ctx.save();
    ctx.rerender();
    scrollToBottom(ctx);
    return;
  }
  chat.failedTurn = null;

  if (!bubbles.length) {
    if (!replaceIds.length) ctx.toast('这次没生成出来，原来那条留着了');
    ctx.save();
    ctx.rerender();
    scrollToBottom(ctx);
    return;
  }

  const turnId = `t${Date.now().toString(36)}${generationSeq}`;
  let firstSaved = null;

  if (replaceIds.length) {
    /* 整轮替换：先回滚旧气泡的行为副作用，全部退不回就不改。 */
    const oldTurn = chat.messages.filter(item => replaceIds.includes(item.id));
    for (const old of oldTurn) {
      const rolled = rollbackBehavior(ctx, chat, old);
      if (!rolled.ok) {
        ctx.toast(rolled.reason || '原来这条关联的状态退不回去，先不重写');
        ctx.save();
        ctx.rerender();
        return;
      }
    }
    const firstIdx = chat.messages.findIndex(item => item.id === replaceIds[0]);
    /* 只保留旧首条用于原位替换，其余旧气泡先移除。 */
    chat.messages = chat.messages.filter(item => !replaceIds.includes(item.id) || item.id === replaceIds[0]);
    const idx = chat.messages.findIndex(item => item.id === replaceIds[0]);
    if (idx < 0) { ctx.save(); ctx.rerender(); return; }
    const first = bubbles[0];
    const old = chat.messages[idx];
    chat.messages[idx] = { ...old, ...bubbleEntry(first, turnId), at: Date.now() };
    firstSaved = chat.messages[idx];
    applyBehaviorMessage(ctx.state, firstSaved, { chatId: chat.id, contactId: chat.contactId, contact });

    let insertAt = idx + 1;
    for (const bubble of bubbles.slice(1)) {
      const extra = pushMessage(ctx.state, chat.id, bubbleEntry(bubble, turnId));
      if (!extra) continue;
      chat.messages.pop();
      chat.messages.splice(insertAt, 0, extra);
      insertAt += 1;
      applyBehaviorMessage(ctx.state, extra, { chatId: chat.id, contactId: chat.contactId, contact });
    }
    chat.updatedAt = firstSaved.at;
  } else {
    const first = bubbles[0];
    firstSaved = pushMessage(ctx.state, chat.id, bubbleEntry(first, turnId));
    if (firstSaved) applyBehaviorMessage(ctx.state, firstSaved, { chatId: chat.id, contactId: chat.contactId, contact });
    for (const bubble of bubbles.slice(1)) {
      const extra = pushMessage(ctx.state, chat.id, bubbleEntry(bubble, turnId));
      if (extra) applyBehaviorMessage(ctx.state, extra, { chatId: chat.id, contactId: chat.contactId, contact });
    }
  }

  if (firstSaved && sections.length) {
    addExtrasEntry(ctx.state, contact?.id || chat.contactId, sections, {
      chatId: chat.id,
      messageId: firstSaved.id,
      kind: kindOut || theaterKindFor(ctx.state),
    });
    ctx.toast('这轮的小剧场收进 App 了');
  }
  ctx.save();
  ctx.rerender();
  scrollToBottom(ctx);
}

/** 失败后原地重试同一轮：不再追加用户原话。 */
function retryFailedTurn(ctx, chat, contact) {
  const failed = chat.failedTurn;
  if (!failed) return;
  if (failed.kind === 'proactive') {
    runGeneration(ctx, chat, contact, { kind: 'proactive' });
  } else {
    runGeneration(ctx, chat, contact, { kind: 'reply', replaceIds: failed.replaceIds || [] });
  }
}

/* ------------------------------------------------------------ 导出 */

export const chatApp = {
  id: 'chat', name: '聊天', icon: 'chat',

  render(ctx) {
    activeThreadId = '';
    return listBody(ctx);
  },

  handle(ctx, act, data) {
    if (act === 'open-thread') {
      const chat = chatById(ctx.state, data.chat);
      if (chat) chat.unread = 0;
      ctx.save();
      ctx.shell.live = { inputValue: chat?.draft || '', focus: false };
      ctx.go('thread', { chatId: data.chat });
      setTimeout(() => scrollToBottom(ctx), 30);
      return true;
    }

    if (act === 'chat-new') {
      const contacts = contactsOf(ctx.state);
      ctx.openSheet({
        title: '和谁聊天',
        items: contacts.slice(0, 8).map(contact => ({ label: contact.name, value: contact.id, icon: 'contacts' })),
        onPick: (contactId) => {
          const contact = contactById(ctx.state, contactId);
          if (!contact) return;
          chatFor(ctx.state, contactId);
          ctx.save();
          ctx.go('thread', { chatId: chatFor(ctx.state, contactId).id });
        },
      });
      return true;
    }

    if (act === 'chat-menu') {
      const chat = chatById(ctx.state, data.chat);
      const contact = chat && contactById(ctx.state, chat.contactId);
      if (!chat) return true;
      ctx.openSheet({
        title: contact?.name || '',
        items: [
          { label: chat.pinned ? '取消置顶' : '置顶这个会话', value: 'pin', icon: 'pin' },
          { label: chat.muted ? '打开消息提醒' : '消息免打扰', value: 'mute', icon: 'bell' },
          { label: '删除这个会话', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'pin') chat.pinned = !chat.pinned;
          if (value === 'mute') chat.muted = !chat.muted;
          if (value === 'delete') {
            ctx.openSheet({
              title: `删除和「${contact?.name || 'TA'}」的会话？`,
              items: [{ label: '确认删除会话', value: 'delete', icon: 'trash', danger: true, note: '会删掉这段聊天记录和会话设置；联系人、角色卡和酒馆数据都不动。' }],
              onPick: (pick) => {
                if (pick !== 'delete') return;
                delete ctx.state.chats[chat.id];
                ctx.save();
                ctx.rerender();
                ctx.toast('会话已删除');
              },
            });
            return;
          }
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    return false;
  },
};

/* ------------------------------------------------- 单角色聊天导出 / 导入 */

function chatTransferFileName(contact) {
  const date = new Date().toISOString().slice(0, 10);
  const name = String(contact?.name || '角色')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 36) || '角色';
  return `meme-chat-${name}-${date}.json`;
}

function exportThreadChat(ctx, chat, contact) {
  if (!chat.messages?.length) {
    ctx.toast('这段聊天还没有消息');
    return;
  }
  try {
    const payload = createChatExport({ chat, contact });
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = chatTransferFileName(contact);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ctx.toast(`已导出 ${payload.messageCount} 条消息`);
  } catch (error) {
    ctx.toast(`导出失败：${error?.message || '聊天记录读不出来'}`);
  }
}

function applyThreadChatImport(ctx, chat, transfer) {
  const chatNow = chatById(ctx.state, chat.id);
  if (!chatNow) {
    ctx.toast('这个会话已经不在了');
    return;
  }
  if (!Array.isArray(chatNow.messages)) chatNow.messages = [];
  const merged = mergeChatHistory(chatNow.messages, transfer.messages);
  if (!merged.addedCount) {
    ctx.toast(`没有新增消息（${merged.skippedCount} 条重复）`);
    return;
  }

  chatNow.messages = merged.messages;
  const newestAt = merged.messages.reduce((latest, message) => (
    Number.isFinite(message?.at) ? Math.max(latest, message.at) : latest
  ), Number(chatNow.updatedAt) || 0);
  chatNow.updatedAt = Math.max(Number(chatNow.updatedAt) || 0, newestAt);

  ctx.save().then(saved => {
    if (!saved) return;
    ctx.rerender();
    ctx.toast(`已导入 ${merged.addedCount} 条消息${merged.skippedCount ? `，跳过 ${merged.skippedCount} 条重复` : ''}`);
  });
}

function reviewThreadChatImport(ctx, chat, contact, transfer) {
  const currentMessages = Array.isArray(chat.messages) ? chat.messages : [];
  const merged = mergeChatHistory(currentMessages, transfer.messages);
  if (!merged.addedCount) {
    ctx.toast(`没有新增消息（${merged.skippedCount} 条重复）`);
    return;
  }

  const sourceName = transfer.character?.name || contact?.name || 'TA';
  const currentName = contact?.name || '当前角色';
  const differentCharacter = transfer.character?.id && transfer.character.id !== chat.contactId;
  const title = differentCharacter
    ? `导入「${sourceName}」的 ${merged.addedCount} 条消息？`
    : `导入 ${merged.addedCount} 条消息？`;

  ctx.openSheet({
    title,
    items: [{
      label: `合并到「${currentName}」${merged.skippedCount ? `，跳过 ${merged.skippedCount} 条重复` : ''}`,
      value: 'import',
      icon: 'upload',
    }],
    onPick: (value) => {
      if (value !== 'import') return;
      applyThreadChatImport(ctx, chat, transfer);
    },
  });
}

function pickThreadChatImport(ctx, chat, contact) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  document.body.append(input);
  input.addEventListener('cancel', () => input.remove());
  input.onchange = async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > MAX_CHAT_TRANSFER_BYTES) {
      ctx.toast('导入失败：文件超过 32 MiB');
      return;
    }
    try {
      const transfer = parseChatTransferText(await file.text());
      if (!transfer.messages.length) {
        ctx.toast('文件里没有聊天消息');
        return;
      }
      reviewThreadChatImport(ctx, chat, contact, transfer);
    } catch (error) {
      ctx.toast(`导入失败：${error?.message || '文件格式不对'}`);
    }
  };
  input.click();
}

export const threadSettingsApp = {
  id: 'thread-settings', name: '聊天设置', icon: 'settings',

  render(ctx, params) {
    activeThreadId = '';
    return settingsBody(ctx, params.chatId);
  },

  handle(ctx, act, data) {
    const chatId = String(data?.chat || '');
    const chat = chatById(ctx.state, chatId);
    if (!chat) {
      if (act.startsWith('ts-')) { ctx.toast('这个会话已经不在了'); return true; }
      return false;
    }
    const contact = contactById(ctx.state, chat.contactId);

    if (act === 'ts-behavior-toggle') {
      const key = String(data.kind || '');
      if (!['transfer', 'redpacket', 'membership', 'plan', 'friend', 'signature'].includes(key)) return true;
      const current = behaviorSettings(ctx.state, chat);
      chat.behavior = { ...(chat.behavior || {}), [key]: !current[key] };
      ctx.save();
      ctx.rerender();
      ctx.toast(`${current[key] ? '已关闭' : '已打开'}${key === 'friend' ? '好友申请' : key === 'signature' ? '个签' : key === 'plan' ? '约定计划' : key === 'membership' ? '会员' : key === 'redpacket' ? '红包' : '转账'}`);
      return true;
    }

    if (act === 'ts-toggle-pin') {
      chat.pinned = !chat.pinned;
      ctx.save();
      ctx.rerender();
      ctx.toast(chat.pinned ? '已置顶这个会话' : '已取消置顶');
      return true;
    }

    if (act === 'ts-toggle-mute') {
      chat.muted = !chat.muted;
      ctx.save();
      ctx.rerender();
      ctx.toast(chat.muted ? '这个会话不再显示未读角标' : '恢复未读角标');
      return true;
    }

    if (act === 'ts-llm') {
      const presets = apiPresetsOf(ctx.state);
      const globalPreset = presets.find(item => item.id === ctx.state.settings.api?.activeChat) || presets[0] || null;
      ctx.openSheet({
        title: '这个聊天的 LLM',
        items: [
          { label: '跟随手机', value: 'follow', note: `现在用「${globalPreset?.name || '酒馆 API'}」` },
          ...presets.map(item => ({
            label: item.name || '未命名方案',
            value: item.id,
            note: [item.model, item.url].filter(Boolean).join(' · ') || '借酒馆自己的模型',
          })),
        ],
        onPick: (value) => {
          if (value === 'follow') {
            chat.llmPresetId = '';
            ctx.save();
            ctx.rerender();
            ctx.toast('已跟随手机的 LLM 方案');
            return;
          }
          const preset = presets.find(item => item.id === value);
          if (!preset) return;
          chat.llmPresetId = preset.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`这个会话改用「${preset.name || '未命名方案'}」`);
        },
      });
      return true;
    }

    if (act === 'ts-reply') {
      const presets = replyPresetsOf(ctx.state);
      const globalPreset = replyPresetFor(ctx.state, null);
      ctx.openSheet({
        title: '这个会话怎么回消息',
        items: [
          { label: '跟随手机', value: 'follow', note: `现在用「${globalPreset?.name || '默认'}」` },
          ...presets.map(item => ({
            label: item.name || '未命名预设',
            value: item.id,
            note: String(item.text || '').slice(0, 38) || '空指令',
          })),
          { label: '管理回复预设', value: 'manage', note: '新建、改指令、设为手机默认' },
        ],
        onPick: (value) => {
          if (value === 'follow') {
            chat.replyPresetId = '';
            ctx.save();
            ctx.rerender();
            ctx.toast('这个会话已跟随手机的回复预设');
            return;
          }
          if (value === 'manage') {
            ctx.go('app-presets');
            return;
          }
          const preset = presets.find(item => item.id === value);
          if (!preset) return;
          chat.replyPresetId = preset.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`这个会话改用「${preset.name || '未命名预设'}」`);
        },
      });
      return true;
    }

    if (act === 'ts-tavern-history') {
      const preset = memoryPresetFor(ctx.state, chat);
      const current = effectiveTavernHistory(ctx.state, chat, preset);
      const applyHistory = (patch, message) => {
        chat.history = { ...chatHistoryFor(chat), ...patch };
        ctx.ai?.clearPreview?.(chat.id);
        ctx.shell.debugPreview = null;
        ctx.save();
        ctx.rerender();
        ctx.toast(message);
      };
      ctx.openSheet({
        kind: 'pick',
        title: '历史酒馆消息',
        note: '层数不在这里选，回设置页直接填数字。',
        items: [
          { label: '跟随记忆方案', value: 'follow', icon: 'book', note: `现在 ${memoryPresetSummary(preset)}` },
          { label: '全部总结', value: 'summary', icon: 'book', note: current.mode === 'summary' ? '现在用的' : '没有总结时不会补原文' },
          { label: '最近原文', value: 'recent', icon: 'clock', note: current.mode === 'recent' ? `现在最近 ${current.floors} 层` : '层数回设置页填数字' },
          { label: '管理记忆方案', value: 'manage', icon: 'settings', note: '新建方案、改全局层数' },
        ],
        onPick: value => {
          if (value === 'follow') {
            applyHistory({ tavernMode: '', tavernFloors: 0 }, '历史酒馆消息已跟随记忆方案');
            return;
          }
          if (value === 'summary') {
            applyHistory({ tavernMode: 'summary' }, '历史酒馆消息改成全部总结');
            return;
          }
          if (value === 'manage') {
            ctx.go('memory-presets', { contactId: chat.contactId });
            return;
          }
          if (value === 'recent') {
            applyHistory({ tavernMode: 'recent', tavernFloors: current.floors }, `历史酒馆消息改成最近 ${current.floors} 层原文`);
          }
        },
      });
      return true;
    }

    if (act === 'ts-tavern-floors') {
      const raw = String(data.value || '').trim();
      if (!raw) {
        chat.history = { ...chatHistoryFor(chat), tavernFloors: 0 };
        ctx.ai?.clearPreview?.(chat.id);
        ctx.shell.debugPreview = null;
        ctx.save();
        ctx.rerender();
        ctx.toast('酒馆原文层数已跟随记忆方案');
        return true;
      }
      const floors = Number(raw);
      if (!Number.isInteger(floors) || floors < 1 || floors > 50) {
        ctx.toast('层数填 1–50 的整数');
        ctx.rerender();
        return true;
      }
      chat.history = { ...chatHistoryFor(chat), tavernMode: 'recent', tavernFloors: floors };
      ctx.ai?.clearPreview?.(chat.id);
      ctx.shell.debugPreview = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`酒馆原文改成最近 ${floors} 层`);
      return true;
    }

    if (act === 'ts-phone-history') {
      const raw = String(data.value || '').trim();
      if (!raw) {
        chat.history = { ...chatHistoryFor(chat), phoneLimit: 0 };
        ctx.ai?.clearPreview?.(chat.id);
        ctx.shell.debugPreview = null;
        ctx.save();
        ctx.rerender();
        ctx.toast('历史小手机消息已跟随回复预设');
        return true;
      }
      const count = Number(raw);
      if (!Number.isInteger(count) || count < 1) {
        ctx.toast('条数填正整数');
        ctx.rerender();
        return true;
      }
      chat.history = { ...chatHistoryFor(chat), phoneLimit: count };
      ctx.ai?.clearPreview?.(chat.id);
      ctx.shell.debugPreview = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`历史小手机消息改成最近 ${count} 条`);
      return true;
    }

    if (act === 'ts-memory') {
      const presets = memoryPresetsOf(ctx.state);
      const globalPreset = memoryPresetFor(ctx.state, null);
      ctx.openSheet({
        title: '酒馆记忆',
        items: [
          { label: '跟随手机', value: 'follow', note: `现在用「${globalPreset?.name || '默认'}」` },
          ...presets.map(item => ({
            label: item.name,
            value: item.id,
            note: memoryPresetSummary(item),
          })),
          { label: '管理记忆方案', value: 'manage', note: '新建、改名、改层数' },
        ],
        onPick: (value) => {
          if (value === 'follow') {
            chat.memoryPresetId = '';
            ctx.save();
            ctx.rerender();
            ctx.toast('已跟随手机的酒馆记忆');
            return;
          }
          if (value === 'manage') {
            ctx.go('memory-presets');
            return;
          }
          const preset = presets.find(item => item.id === value);
          if (!preset) return;
          chat.memoryPresetId = preset.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`这个会话改用「${preset.name}」`);
        },
      });
      return true;
    }

    if (act === 'ts-open-character') {
      const card = (ctx.state.characters || []).find(item => item.name === contact?.name);
      if (card) ctx.go('character-card', { name: card.name });
      else ctx.go('app-contacts', { tab: 'cards' });
      return true;
    }

    if (act === 'ts-open-characters') { ctx.go('app-contacts', { tab: 'cards' }); return true; }

    if (act === 'ts-diary') { ctx.go('thread-diary', { chatId: chat.id }); return true; }

    if (act === 'ts-extras') { ctx.go('app-extras', { contactId: chat.contactId }); return true; }

    if (act === 'ts-export-chat') {
      exportThreadChat(ctx, chat, contact);
      return true;
    }

    if (act === 'ts-import-chat') {
      pickThreadChatImport(ctx, chat, contact);
      return true;
    }

    if (act === 'ts-clear') {
      ctx.openSheet({
        title: '清空这个会话的消息？',
        items: [{ label: '清空聊天记录', value: 'clear', icon: 'trash', danger: true }],
        onPick: (value) => {
          if (value !== 'clear') return;
          cancelGeneration(chat.id, 'chat-cleared');
          chat.messages = [];
          chat.unread = 0;
          chat.typing = false;
          chat.failedTurn = null;
          ctx.save();
          ctx.toast('聊天记录已清空');
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'ts-delete') {
      ctx.openSheet({
        title: '删除这个会话？',
        items: [{ label: '连同会话设置一起删除', value: 'delete', icon: 'trash', danger: true }],
        onPick: (value) => {
          if (value !== 'delete') return;
          cancelGeneration(chat.id, 'chat-deleted');
          delete ctx.state.chats[chat.id];
          ctx.save();
          ctx.home();
          ctx.go('app-chat');
          ctx.toast('会话已删除');
        },
      });
      return true;
    }

    return false;
  },
};


export const threadApp = {
  id: 'thread', name: '会话', icon: 'chat',

  render(ctx, params) {
    return threadBody(ctx, params.chatId);
  },

  handle(ctx, act, data) {
    const chatId = data.chat;

    if (act === 'thread-settings') {
      if (chatById(ctx.state, chatId)) ctx.go('thread-settings', { chatId });
      return true;
    }

    if (act === 'load-older') {
      const chat = chatById(ctx.state, chatId);
      if (!chat) return true;
      const box = ctx.shell.root?.querySelector?.('.mp-messages');
      const prevTop = box?.scrollTop || 0;
      const prevHeight = box?.scrollHeight || 0;
      const PAGE = THREAD_PAGE;
      if (!ctx.shell.msgWindow) ctx.shell.msgWindow = {};
      ctx.shell.msgWindow[chatId] = Math.max(PAGE, Number(ctx.shell.msgWindow[chatId]) || PAGE) + PAGE;
      ctx.rerender();
      /* 加载更早的消息后把滚动位置锚在原来那条上，不跳回顶部也不跳到底部 */
      const next = ctx.shell.root?.querySelector?.('.mp-messages');
      if (next) next.scrollTop = prevTop + Math.max(0, next.scrollHeight - prevHeight);
      return true;
    }

    if (act === 'send') { doSend(ctx, chatId); return true; }

    if (act === 'say-first') {
      const chat = chatById(ctx.state, chatId);
      if (!chat) return true;
      const busy = activeGenerations.get(chatId);
      if (busy && !busy.done) { ctx.toast('正在回复这条会话，稍等一下'); return true; }
      runGeneration(ctx, chat, contactById(ctx.state, chat.contactId), { kind: 'proactive' });
      return true;
    }

    if (act === 'retry-turn') {
      const chat = chatById(ctx.state, chatId);
      if (!chat) return true;
      retryFailedTurn(ctx, chat, contactById(ctx.state, chat.contactId));
      return true;
    }

    if (act === 'debug-toggle') {
      ctx.shell.debugOpen = ctx.shell.debugOpen || {};
      ctx.shell.debugOpen[chatId] = !ctx.shell.debugOpen[chatId];
      ctx.rerender();
      return true;
    }

    if (act === 'debug-refresh') {
      ctx.ai.clearPreview?.(chatId);
      ctx.shell.debugPreview = null;
      ctx.rerender();
      return true;
    }

    if (act === 'clear-quote') {
      if (ctx.shell.quote) delete ctx.shell.quote[chatId];
      ctx.rerender();
      return true;
    }

    if (act === 'theater-kind') {
      const kind = theaterKindById(data.kind);
      ctx.state.settings.theater = { ...(ctx.state.settings.theater || {}), kind: kind.id };
      ctx.save();
      ctx.rerender();
      return true;
    }

    if (act === 'theater-toggle') {
      const on = (ctx.state.extrasOn = Array.isArray(ctx.state.extrasOn) ? ctx.state.extrasOn : []);
      const contact = contactById(ctx.state, data.contact);
      if (!contact) return true;
      const index = on.indexOf(contact.id);
      if (index >= 0) on.splice(index, 1);
      else on.push(contact.id);
      ctx.save();
      ctx.rerender();
      return true;
    }

    if (act === 'theater-app') {
      const chat = chatById(ctx.state, chatId);
      ctx.go('app-extras', chat?.contactId ? { contactId: chat.contactId } : {});
      return true;
    }

    if (act === 'behavior-form-cancel') {
      ctx.shell.behaviorForm = null;
      ctx.rerender();
      return true;
    }

    if (act === 'behavior-form-send') {
      const chat = chatById(ctx.state, chatId);
      const contact = chat ? contactById(ctx.state, chat.contactId) : null;
      if (!chat || !contact) return true;
      const root = ctx.shell.root;
      const kind = data.kind;
      let draft = null;
      if (kind === 'transfer' || kind === 'redpacket') {
        const amount = Number((root.querySelector('#mpBehaviorAmount')?.value || '').replace(/[^\d.]/g, ''));
        const note = root.querySelector('#mpBehaviorNote')?.value || '';
        if (!Number.isFinite(amount) || amount <= 0) { ctx.toast('先填一个金额'); return true; }
        if (amount > 10000) { ctx.toast('一次最多 ¥10000'); return true; }
        draft = {
          from: 'me', kind,
          text: `[${kind === 'redpacket' ? '红包' : '转账'}] ¥${amount.toFixed(2)}${note ? ` ${note}` : ''}`,
          behavior: { amount, note, status: 'pending', direction: 'sent' },
        };
      } else if (kind === 'plan') {
        const title = (root.querySelector('#mpBehaviorTitle')?.value || '').trim();
        if (!title) { ctx.toast('写一句想约什么'); return true; }
        draft = {
          from: 'me', kind: 'plan',
          text: `[约定计划] ${title}`,
          behavior: { title, planId: '', status: 'pending', initiator: 'me' },
        };
      } else if (kind === 'membership') {
        const membershipType = root.querySelector('#mpBehaviorMemberType')?.value === 'svip' ? 'svip' : 'vip';
        const months = Number(root.querySelector('#mpBehaviorMemberMonths')?.value) === 12 ? 12 : 1;
        const price = membershipType === 'svip' ? (months === 12 ? 216 : 20) : (months === 12 ? 108 : 10);
        if (walletBalance(ctx.state) < price) { ctx.toast(`余额不足，需要 ¥${price}`); return true; }
        draft = {
          from: 'me', kind: 'gift-membership',
          text: `[送会员] ${membershipType.toUpperCase()} ${months} 个月`,
          behavior: { membershipType, months, price, status: 'pending', target: 'contact' },
        };
      }
      if (!draft) return true;
      const saved = commitBehaviorMessage(ctx, chat, contact, draft);
      if (!saved) return true;
      ctx.shell.behaviorForm = null;
      ctx.save();
      ctx.rerender();
      scrollToBottom(ctx);
      ctx.toast('发出去了');
      runGeneration(ctx, chat, contact, { kind: 'reply' });
      return true;
    }

    if (act === 'behavior-plan-respond') {
      const chat = chatById(ctx.state, chatId);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const plan = appointmentByMessage(ctx.state, chat.contactId, message.id)
        || (message.behavior?.planId ? appointmentByMessage(ctx.state, chat.contactId, message.behavior.planId) : null);
      if (!plan) { ctx.toast('找不到这个约定'); return true; }
      const result = respondAppointment(ctx.state, { contactId: chat.contactId, planId: plan.id, accept: data.accept === '1' });
      if (!result.ok) { ctx.toast(result.reason || '处理失败'); return true; }
      message.behavior = { ...(message.behavior || {}), planId: plan.id, status: plan.status };
      ctx.save();
      ctx.rerender();
      ctx.toast(plan.status === 'accepted' ? '约定已接受' : '已经拒绝了');
      return true;
    }

    if (act === 'behavior-plan-complete') {
      const chat = chatById(ctx.state, chatId);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const plan = appointmentByMessage(ctx.state, chat.contactId, message.id)
        || (message.behavior?.planId ? appointmentByMessage(ctx.state, chat.contactId, message.behavior.planId) : null);
      if (!plan) { ctx.toast('找不到这个约定'); return true; }
      if (!['accepted', 'completed'].includes(plan.status)) { ctx.toast('先接受这个约定'); return true; }
      const story = pushMessage(ctx.state, chat.id, {
        from: 'them',
        kind: 'plan-story',
        text: `[计划故事] ${plan.title}`,
        behavior: { planId: plan.id, title: plan.title, story: `关于「${plan.title}」的那天，最后真的成行了。`, status: 'completed' },
      });
      if (story) applyBehaviorMessage(ctx.state, story, { chatId: chat.id, contactId: chat.contactId, contact: contactById(ctx.state, chat.contactId) });
      ctx.save();
      ctx.rerender();
      scrollToBottom(ctx);
      ctx.toast('计划完成，故事也记下了');
      return true;
    }

    if (act === 'behavior-friend-respond') {
      const chat = chatById(ctx.state, chatId);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const request = friendRequests(ctx.state).find(item => item.id === (message.behavior?.requestId || data.request))
        || friendRequests(ctx.state).find(item => item.messageId === message.id);
      if (!request) { ctx.toast('找不到这条好友申请'); return true; }
      const result = respondFriendRequest(ctx.state, { requestId: request.id, accept: data.accept === '1' });
      if (!result.ok) { ctx.toast(result.reason || '处理失败'); return true; }
      message.behavior = { ...(message.behavior || {}), requestId: request.id, status: request.status };
      ctx.save();
      ctx.rerender();
      ctx.toast(request.status === 'accepted' ? '已加为好友' : '已拒绝');
      return true;
    }

    if (act === 'behavior-plan-story') {
      const chat = chatById(ctx.state, chatId);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const plan = appointmentByMessage(ctx.state, chat.contactId, message.id)
        || (message.behavior?.planId ? appointmentByMessage(ctx.state, chat.contactId, message.behavior.planId) : null);
      if (!plan?.story) { ctx.toast('这个故事还没写出来'); return true; }
      ctx.openSheet({
        title: plan.story.title || '计划故事',
        items: [{ label: plan.story.text || '', value: 'read', icon: 'book', note: plan.story.outcome || '' }],
        onPick: () => {},
      });
      return true;
    }

    if (act === 'composer-plus') {
      ctx.openSheet({
        title: '加点什么',
        items: [
          { label: '照片', value: 'photo', icon: 'image', note: '从相册选一张，压小了再存进手机' },
          { label: '表情', value: 'emoji', icon: 'smile', note: '发一个大表情，不是文字里的贴图' },
          { label: '戳一戳', value: 'poke', icon: 'spark', note: '在聊天里留一行「你拍了拍 TA」' },
          { label: '转账', value: 'transfer', icon: 'transfer', note: `钱包余额 ¥${walletBalance(ctx.state).toFixed(2)}` },
          { label: '红包', value: 'redpacket', icon: 'transfer', note: '发一个红包，留言可以不写' },
          { label: '约定计划', value: 'plan', icon: 'plan', note: '发一条待 TA 接受的约定' },
          { label: '送会员', value: 'membership', icon: 'spark', note: '从余额扣，给 TA 送 VIP / SVIP' },
          { label: '小剧场', value: 'theater', icon: 'theater', note: '这轮带不带、写哪种；内容去小剧场 App 看' },
          { label: '引用最近一条', value: 'quote', icon: 'reply' },
          { label: '把这条存进小剧场', value: 'extra', icon: 'theater' },
        ],
        onPick: (value) => {
          const chat = chatById(ctx.state, chatId);
          if (!chat) return;
          if (value === 'photo') {
            const picker = ctx.shell.root.querySelector('#mpMsgPhoto');
            if (picker) {
              try { picker.click(); } catch (error) { ctx.toast('相册打不开，换一张试试'); }
            } else {
              ctx.toast('相册没准备好，再点一次');
            }
            return;
          }
          if (value === 'emoji') {
            const list = Array.isArray(ctx.state.emoji) ? ctx.state.emoji : [];
            ctx.openSheet({
              title: '发哪个表情',
              items: list.slice(0, 12).map(item => ({ label: `${item.char} ${item.name || ''}`.trim(), value: item.char, note: '点上就发出去' })),
              onPick: (char) => {
                if (!char) return;
                pushMessage(ctx.state, chat.id, { from: 'me', kind: 'emoji', emoji: char, text: char });
                chat.unread = 0;
                ctx.save();
                ctx.rerender();
                scrollToBottom(ctx);
                runGeneration(ctx, chat, contactById(ctx.state, chat.contactId), { kind: 'reply' });
              },
            });
          }
          if (value === 'poke') {
            pushMessage(ctx.state, chat.id, { from: 'me', kind: 'poke', text: '' });
            ctx.save();
            ctx.rerender();
            scrollToBottom(ctx);
          }
          if (value === 'transfer' || value === 'redpacket') {
            ctx.shell.behaviorForm = { chatId, kind: value };
            ctx.rerender();
            return;
          }
          if (value === 'plan') {
            ctx.shell.behaviorForm = { chatId, kind: 'plan' };
            ctx.rerender();
            return;
          }
          if (value === 'membership') {
            ctx.shell.behaviorForm = { chatId, kind: 'membership' };
            ctx.rerender();
            return;
          }
          if (value === 'theater') {
            openTheaterSheet(ctx, chat);
            return;
          }
          if (value === 'quote') {
            const last = lastMessage(chat);
            if (!last) { ctx.toast('还没有可引用的消息'); return; }
            ctx.shell.quote = ctx.shell.quote || {};
            ctx.shell.quote[chatId] = { text: messagePreview(last), from: last.from };
            ctx.rerender();
          }
          if (value === 'extra') {
            const last = lastMessage(chat);
            const contact = contactById(ctx.state, chat.contactId);
            if (!last || !contact) { ctx.toast('还没有内容'); return; }
            saveMessageExtra(ctx, chat, contact, last);
            ctx.toast('已存进小剧场');
          }
        },
      });
      return true;
    }

    if (act === 'avatar-extra') {
      const chat = chatById(ctx.state, chatId);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const contact = contactById(ctx.state, chat.contactId);
      openMessageExtra(ctx, chat, contact, message);
      return true;
    }

    if (act === 'thread-more') {
      const chat = chatById(ctx.state, chatId);
      if (!chat) return true;
      const contact = contactById(ctx.state, chat.contactId);
      ctx.openSheet({
        title: contact?.name || '',
        items: [
          { label: '看 TA 的小剧场', value: 'extras', icon: 'theater' },
          { label: '清空这个会话的消息', value: 'clear', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'extras') ctx.go('app-extras', { contactId: chat.contactId });
          if (value === 'clear') {
            ctx.openSheet({
              title: `清空「${contact?.name || 'TA'}」的聊天记录？`,
              items: [{ label: '确认清空消息', value: 'clear', icon: 'trash', danger: true, note: '聊天记录会全部删掉，会话设置和联系人保留，不能恢复。' }],
              onPick: (pick) => {
                if (pick !== 'clear') return;
                chat.messages = [];
                chat.unread = 0;
                ctx.save();
                ctx.rerender();
                ctx.toast('已清空');
              },
            });
          }
        },
      });
      return true;
    }

    if (act === 'message-menu') {
      const chat = chatById(ctx.state, data.chat);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const contact = contactById(ctx.state, chat.contactId);
      const mine = message.from === 'me';
      const recallable = mine && message.kind !== 'recalled' && Date.now() - message.at < 2 * 60 * 1000;
      ctx.openSheet({
        title: '',
        items: [
          { label: '引用这条回复', value: 'quote', icon: 'reply' },
          ...(message.text ? [{ label: '复制文字', value: 'copy', icon: 'copy' }] : []),
          { label: '收藏这条', value: 'favorite', icon: 'bookmark', note: '存进「收藏」，删了聊天也还在' },
          { label: '转发给…', value: 'forward', icon: 'forward' },
          ...(recallable ? [{ label: '撤回这条', value: 'recall', icon: 'refresh', note: '两分钟内可以撤回' }] : []),
          { label: '存成小剧场', value: 'extra', icon: 'theater' },
          ...(message.from === 'them' ? [{ label: '让 TA 重新说一次', value: 'regen', icon: 'refresh' }] : []),
          { label: '删除这条', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'quote') {
            ctx.shell.quote = ctx.shell.quote || {};
            ctx.shell.quote[chat.id] = { text: messagePreview(message), from: message.from };
            ctx.rerender();
          }
          if (value === 'copy') {
            navigator.clipboard?.writeText(message.text).then(() => ctx.toast('已复制'), () => ctx.toast('复制失败'));
          }
          if (value === 'favorite') {
            const favorites = (ctx.state.favorites = ctx.state.favorites || []);
            favorites.unshift({
              id: 'f' + Date.now().toString(36),
              chatId: chat.id,
              contactName: contact?.name || 'TA',
              from: message.from,
              text: messagePreview(message),
              image: message.image || '',
              at: message.at || Date.now(),
            });
            ctx.save();
            ctx.toast('已收进收藏');
          }
          if (value === 'forward') {
            const targets = contactsOf(ctx.state).filter(item => item.id !== chat.contactId);
            ctx.openSheet({
              title: '转发给谁',
              items: targets.slice(0, 10).map(item => ({ label: item.name, value: item.id, icon: 'contacts' })),
              onPick: (targetId) => {
                const target = contactsOf(ctx.state).find(item => item.id === targetId);
                if (!target) return;
                const targetChat = chatFor(ctx.state, target.id);
                pushMessage(ctx.state, targetChat.id, {
                  from: 'me',
                  kind: 'forwarded',
                  text: '',
                  forward: { text: messagePreview(message), from: contact?.name || 'TA' },
                });
                ctx.save();
                ctx.toast(`已转发给「${target.name}」`);
              },
            });
          }
          if (value === 'recall') {
            const rolled = rollbackBehavior(ctx, chat, message);
            if (!rolled.ok) { ctx.toast(rolled.reason || '这条消息关联的状态退不回去了'); return; }
            message.kind = 'recalled';
            message.text = '';
            message.image = '';
            message.emoji = '';
            message.forward = null;
            message.behavior = null;
            ctx.save();
            ctx.rerender();
            ctx.toast('已撤回');
          }
          if (value === 'extra') {
            saveMessageExtra(ctx, chat, contact, message);
            ctx.toast('已存进小剧场');
          }
          if (value === 'regen') {
            const turn = turnMessages(chat, message);
            if (!turn.length) { ctx.toast('这条没法判定是哪一轮，先不重写'); return; }
            const replaceIds = turn.map(entry => entry.item.id);
            const later = chat.messages.slice(turn[turn.length - 1].i + 1);
            if (later.some(item => item.from === 'me' || item.from === 'them')) {
              ctx.toast('这一轮不是最近的一轮，先不重写');
              return;
            }
            runGeneration(ctx, chat, contact, { kind: 'reply', replaceIds });
          }
          if (value === 'delete') {
            ctx.openSheet({
              title: '删除这一条消息？',
              items: [{ label: '确认删除这条', value: 'delete', icon: 'trash', danger: true, note: '只删这一条，不影响其他聊天记录；不能恢复。' }],
              onPick: (pick) => {
                if (pick !== 'delete') return;
                const rolled = rollbackBehavior(ctx, chat, message);
                if (!rolled.ok) { ctx.toast(rolled.reason || '这条消息关联的状态退不回去了'); return; }
                chat.messages = chat.messages.filter(item => item.id !== message.id);
                ctx.save();
                ctx.rerender();
                ctx.toast('已删除');
              },
            });
          }
        },
      });
      return true;
    }

    if (act === 'view-photo') {
      const chat = chatById(ctx.state, data.chat);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (message?.image) ctx.go('photo-view', { src: message.image });
      return true;
    }

    return false;
  },
};
