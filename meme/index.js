/**
 * meme-phone · 模块入口
 * 把存储、宿主桥、外壳、各个 App 装在一起。外层的 index.js 只负责挂载/卸载。
 */

import { createStore } from './store.js';
import { normalize, emptyState, demoState, syncTavernContacts, chatFor, chatsOf, llmPresetFor, replyContextFor, replyPresetFor, pushMessage, extrasEnabledFor, theaterPrompt, theaterKindFor, splitTheaterBlocks, dayKey, theatersOf, setContactAvatar } from './data.js';
import { createShell, applyWall, applyLook } from './shell.js';
import { readTavernCharacters, readCharacterBooks, setWorldEntryEnabled, readWorldBookNames, readUserAvatar, readTavernPersonas, readTavernCards, writeTavernPersona, readTavernApi, listTavernModels, generate, probeHost, countTextTokens, readLatestTavernChat, readOpenTavernChat } from './host.js';
import { chatApp, worldChatApp, threadApp, threadSettingsApp } from './apps/chat.js';
import { favoritesApp } from './apps/favorites.js';
import { photoApp } from './apps/photo.js';
import { buildMemoryContext } from './memory.js';
import { installWorld, isWorldChat } from './world.js';
import { buildReplyMessages, transcript, replyLead, proactiveLead, diaryTranscriptForMessages, characterBlock, sceneBlock, userBlock } from './reply-context.js';
import { behaviorPrompt, behaviorSettings, parseBehaviorReply } from './behavior.js';
import { DIARY_OUTPUT_PROTOCOL, diaryFingerprint, diaryContextMessages, diaryParamsFingerprint } from './diary.js';
import { diaryApp, threadDiaryApp } from './apps/diary.js';
import { contactsApp, contactApp } from './apps/contacts.js';
import { settingsApp, appearanceApp } from './apps/settings.js';
import { drawApp } from './apps/draw.js';
import { apiListApp } from './apps/api.js';
import { userListApp, userEditApp } from './apps/user.js';
import { walletApp } from './apps/wallet.js';
import { characterApp } from './apps/characters.js';
import { charPhoneApp, charPhoneThreadApp, ensureLookup, applyTavernChat } from './apps/charphone.js';
import { musicApp, musicPlaylistApp, stopMusic } from './apps/music.js';
import { memoryPresetsApp } from './apps/memory.js';
import { presetsApp, replyPresetApp } from './apps/presets.js';
import { extrasApp, extrasSwitchApp, extraDetailApp, emojiApp,
  plansApp, dressApp, iconPickerApp, helpApp,
} from './apps/more.js';
import { parallelApp } from './apps/parallel.js';
import { parallelBranchApp, parallelSettingsApp, cancelParallelRun } from './apps/branch.js';
import { cancelParallelRoom } from './room.js';
import { migrateLegacyWorlds, migrateLegacyDiaries } from './legacy-world.js';

const APPS = {
  'app-chat': chatApp,
  'app-worldchat': worldChatApp,
  'app-favorites': favoritesApp,
  'photo-view': photoApp,
  'app-diary': diaryApp,
  'thread-diary': threadDiaryApp,
  'app-contacts': contactsApp,
  'app-settings': settingsApp,
  'app-appearance': appearanceApp,
  'app-extras': extrasApp,
  'app-parallel': parallelApp,
  'parallel-branch': parallelBranchApp,
  'parallel-settings': parallelSettingsApp,
  'extras-switch': extrasSwitchApp,
  'app-emoji': emojiApp,
  'app-plans': plansApp,
  'app-dress': dressApp,
  'app-icon': iconPickerApp,
  'app-help': helpApp,
  'app-draw': drawApp,
  'app-api': apiListApp,
  'app-presets': presetsApp,
  'reply-item': replyPresetApp,
  'app-user': userListApp,
  'user-item': userEditApp,
  'app-wallet': walletApp,
  'character-card': characterApp,
  'p-charphone': charPhoneApp,
  'p-chatphone': charPhoneThreadApp,
  'memory-presets': memoryPresetsApp,
  /* 桌面图标会走 ctx.go('app-' + id)，这一条是它实际命中的路由，不是重复入口 */
  'app-memory-presets': memoryPresetsApp,
  'app-music': musicApp,
  'music-playlist': musicPlaylistApp,
  thread: threadApp,
  'thread-settings': threadSettingsApp,
  contact: contactApp,
  'extra-detail': extraDetailApp,
};

const DESKTOP_APPS = [
  { id: 'parallel', name: '平行时空', icon: 'parallel', screen: 1 },
  { id: 'extras', name: '小剧场', icon: 'theater', screen: 1 },
  { id: 'music', name: '音乐', icon: 'music', screen: 1 },
  { id: 'draw', name: '绘图', icon: 'image', screen: 1 },
  { id: 'plans', name: '计划', icon: 'plan', screen: 2 },
  { id: 'dress', name: '装扮', icon: 'brush', screen: 2 },
  { id: 'presets', name: '预设', icon: 'reply', screen: 2 },
  { id: 'api', name: '接口', icon: 'code', screen: 2 },
];

const DOCK_APPS = [
  { id: 'chat', name: '聊天', icon: 'chat' },
  { id: 'worldchat', name: '同层小手机', icon: 'chat-world' },
  { id: 'contacts', name: '通讯录', icon: 'contacts' },
  { id: 'settings', name: '设置', icon: 'settings' },
];

let store = null;
let shellApi = null;
let ctx = null;
let rootEl = null;
let initPromise = null;
let followTimer = 0;
/* document 上的 change 兜底监听：关手机时按引用移除，不在页面里越积越多 */
let docChangeTarget = null;
let docChangeHandler = null;
/* 状态代次：每次整份替换（导入 / 清空）自增；旧任务据此判断自己是否已经失效。 */
let stateEpoch = 0;
/* 是否演示模式：只有演示模式才允许返回演示文案，正式宿主断连不写假回复。 */
let demoMode = false;

/* 打开手机时锁宿主滚动 / 回弹并补 viewport-fit=cover，关闭后原样还原。
   对齐参考插件做法：软键盘弹起时宿主页面不再跟着回弹 / 滚动，避免整页闪一下。 */
let hostLocked = false;
const hostSaved = { bodyOverflow: '', htmlOverscroll: '', bodyOverscroll: '', metaContent: null };

function lockHostScroll() {
  if (hostLocked) return;
  const doc = document;
  const html = doc.documentElement;
  const body = doc.body;
  if (!body) return;
  hostSaved.bodyOverflow = body.style.overflow;
  hostSaved.htmlOverscroll = html.style.overscrollBehavior;
  hostSaved.bodyOverscroll = body.style.overscrollBehavior;
  html.style.overscrollBehavior = 'none';
  body.style.overscrollBehavior = 'none';
  body.style.overflow = 'hidden';
  const meta = doc.querySelector('meta[name="viewport"]');
  if (meta && String(meta.content || '').indexOf('viewport-fit') < 0) {
    hostSaved.metaContent = meta.content || '';
    meta.content = `${hostSaved.metaContent}, viewport-fit=cover`;
  }
  hostLocked = true;
}

function unlockHostScroll() {
  if (!hostLocked) return;
  const doc = document;
  const html = doc.documentElement;
  const body = doc.body;
  if (body) {
    body.style.overflow = hostSaved.bodyOverflow;
    body.style.overscrollBehavior = hostSaved.bodyOverscroll;
  }
  html.style.overscrollBehavior = hostSaved.htmlOverscroll;
  const meta = doc.querySelector('meta[name="viewport"]');
  if (meta && hostSaved.metaContent !== null) meta.content = hostSaved.metaContent;
  hostSaved.metaContent = null;
  hostLocked = false;
}

/* 打开手机时卸掉宿主页（酒馆输入框）残留的焦点，避免背景酒馆跟着唤起软键盘 */
function blurOutsideFocus(root) {
  try {
    const active = document.activeElement;
    if (active && active !== document.body && active !== document.documentElement
      && root && !root.contains(active) && typeof active.blur === 'function') {
      active.blur();
    }
  } catch { /* 宿主文档读不到就跳过 */ }
}

/* 草稿落盘：逐字写整份状态太重（宿主每次保存都要上传整份存档），
   改成停手 700ms 存一版，再在失焦 / 切后台 / 关手机时立刻补存一次，
   刷新或异常退出也不会丢刚打的字。 */
let draftDirty = false;
let draftTimer = 0;

function flushDraft() {
  clearTimeout(draftTimer);
  draftTimer = 0;
  if (!draftDirty || !store) return;
  draftDirty = false;
  try {
    const promise = store.touch();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => { draftDirty = true; });
    }
  } catch {
    draftDirty = true;
  }
}

function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(flushDraft, 700);
}

const getCurrentState = () => store?.get() || null;

/* ------------------------------------------------------------ 模型调用 */

function makeAi(getState) {
  /* 手机聊天 / 日记的背景走「酒馆记忆」：有酒馆总结先用总结，没有就读最近几层酒馆聊天 */
  function story(state, chat, limit = 1200) {
    return buildMemoryContext(state, chat, limit);
  }

  const previewCache = new Map();

  /** 真实回复与调试预览共用这一套组装，保证看到的就是要发出去的。 */
  async function compose(chat, contact, options = {}) {
    const state = getState();
    const ctxSettings = replyContextFor(state, chat);
    /* 0 = 不限制：酒馆记忆和手机历史都按全量送，不再用本地预算截断。 */
    const memoryLimit = 0;
    /* Meta 手机按设计完全不碰酒馆记忆；只有绑了酒馆文件的同层小手机才读。 */
    const isMetaPhone = !isWorldChat(chat);
    const storyBlock = !isMetaPhone && ctxSettings.memory
      ? await story(state, chat, memoryLimit)
      : { text: '' };
    const theaterKind = theaterKindFor(state);
    const wantsTheater = !options.proactive && extrasEnabledFor(state, contact?.id);
    const built = await buildReplyMessages(state, chat, contact, {
      presetOverride: options.presetOverride,
      memoryText: String(storyBlock?.text || ''),
      lead: options.proactive ? proactiveLead(state, contact, chat) : replyLead(contact),
      extraPrompt: wantsTheater ? theaterPrompt(contact?.name, theaterKind) : '',
      behaviorPrompt: behaviorPrompt(state, chat),
      proactive: Boolean(options.proactive),
      omitLastUser: Boolean(options.omitLastUser),
      omitPending: Boolean(options.omitPending),
      omitIds: Array.isArray(options.omitIds) ? options.omitIds : [],
    });
    return { built, wantsTheater, theaterKind, ctxSettings };
  }

  return {
    async reply(context, chat, contact, demoReply, options = {}) {
      const state = getState();
      const { built, wantsTheater, theaterKind } = await compose(chat, contact, options);
      const result = await generate({ messages: built.messages, demoReply, preset: llmPresetFor(state, chat), demo: demoMode, signal: options.signal });
      if (result.error) throw new Error(result.error);
      const content = wantsTheater ? splitTheaterBlocks(result.text, contact?.name).text : result.text;
      const bubbles = parseBehaviorReply(content, {
        from: 'them',
        allowed: behaviorSettings(state, chat),
      });
      return {
        text: bubbles.map(item => item.text || '').join('\n'),
        bubbles,
        sections: wantsTheater ? splitTheaterBlocks(result.text, contact?.name).sections : [],
        kind: wantsTheater ? theaterKind : '',
      };
    },

    /* 翻译一条消息：只翻这一句，不组装角色卡 / 历史，避免把上下文带进来改口吻 */
    async translate(context, text, target = '中文') {
      const state = getState();
      const source = String(text || '').trim();
      if (!source) throw new Error('这条没有可翻译的文字');
      const prompt = [
        `把下面这句话翻译成${target}。只输出译文，不要解释，不要加引号，不要保留原文。`,
        '',
        source.slice(0, 800),
      ].join('\n');
      const result = await generate({
        prompt,
        demoReply: source,
        preset: llmPresetFor(state, null),
        demo: demoMode,
      });
      if (result.error) throw new Error(result.error);
      const out = String(result.text || '').trim();
      if (!out) throw new Error('模型没有返回译文');
      return out;
    },

    /**
     * 调试栏用：只组请求，不调用模型，也不写任何状态。
     * 返回的 messages 故意不含最后一条用户消息，聊天页按当前草稿补上；
     * 这样输入时只重算 token，不用重复读记忆和世界书。
     */
    async preview(chat, contact, options = {}) {
      const state = getState();
      const last = chat?.messages?.[chat.messages.length - 1];
      const presetId = options.presetOverride?.id || replyPresetFor(state, chat)?.id || '';
      const key = [
        chat?.id || '',
        chat?.messages?.length || 0,
        last?.id || '',
        extrasEnabledFor(state, contact?.id) ? 'theater' : 'plain',
        theaterKindFor(state),
        replyContextFor(state, chat).memory ? 'memory' : 'nomemory',
        JSON.stringify(chat?.history || {}),
        state.settings?.memory?.activeId || '',
        state.settings?.memory?.readMode || '',
        state.diary?.enabled !== false ? 'diaryon' : 'diaryoff',
        diaryFingerprint(state.diary?.contacts?.[chat?.contactId] || {}),
        diaryParamsFingerprint(state, chat),
        presetId ? `preset:${presetId}` : 'preset:active',
        options.presetOverride ? JSON.stringify(options.presetOverride.context || {}) : '',
        options.presetOverride ? JSON.stringify(options.presetOverride.items || []) : '',
      ].join('|');
      const hit = previewCache.get(key);
      if (hit && Date.now() - hit.at < 30000) return hit.value;

      const { built, wantsTheater } = await compose(chat, contact, { omitLastUser: true, omitPending: true, presetOverride: options.presetOverride });
      /* 有酒馆分词器就按真实分词数；只有拿不到时才让界面退回本地估算。 */
      const tokenCounts = await Promise.all(built.messages.map(message => countTextTokens(message.content)));
      const messages = built.messages.map((message, index) => (
        Number.isFinite(tokenCounts[index]) ? { ...message, tokenCount: tokenCounts[index] } : message
      ));
      const value = {
        key,
        messages,
        report: built.report,
        wantsTheater,
        model: llmPresetFor(state, chat),
        replyPreset: options.presetOverride || replyPresetFor(state, chat),
        at: Date.now(),
      };
      previewCache.set(key, { at: Date.now(), value });
      if (previewCache.size > 16) {
        const oldest = [...previewCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) previewCache.delete(oldest[0]);
      }
      return value;
    },

    clearPreview(chatId = '') {
      for (const key of previewCache.keys()) {
        if (!chatId || key.startsWith(`${chatId}|`)) previewCache.delete(key);
      }
    },

    async proactive(context, chat, contact, demoReply, options = {}) {
      const state = getState();
      const { built } = await compose(chat, contact, { proactive: true });
      const result = await generate({ messages: built.messages, demoReply, preset: llmPresetFor(state, chat), demo: demoMode, signal: options.signal });
      if (result.error) throw new Error(result.error);
      return result.text;
    },

    /* 查 TA 的手机：让模型按人设现编一份聊天 / 通讯录 / 朋友圈 */
    async lookup(context, contact, local) {
      const state = getState();
      const card = (state.characters || []).find(item => item.name === contact?.name);
      const prompt = [
        `你在给「${contact?.name || 'TA'}」这台手机写内容。`,
        card ? `人物设定：${(card.description || '').slice(0, 300)}` : '',
        card?.personality ? `性格：${card.personality.slice(0, 120)}` : '',
        card?.scenario ? `常出现的场景：${card.scenario.slice(0, 120)}` : '',
        '写 TA 手机里的东西：和别人的聊天、通讯录、朋友圈、日程。全部口语中文，贴合这个人，不要写成说明书。',
        '只输出 JSON，不要解释、不要 markdown 代码块：',
        '{"chats":[{"peer":"名字","tag":"家人/朋友/同事/群聊","group":false,"unread":0,"msgs":[{"me":false,"text":"一句话","at":"21:04"}]}],"contacts":[{"name":"","note":""}],"moments":[{"text":"","at":"21:04","likes":3,"comments":[{"who":"","text":""}]}],"schedule":{"week":[{"when":"11月13日 周五","time":"20:00","title":"","note":""}],"month":[{"when":"11月20日","time":"下午","title":"","note":""}],"year":[{"when":"明年春天","title":"","note":""}]}}',
        'chats 4 条（每条 4~6 句，me 表示是不是 TA 自己说的），contacts 6 条，moments 3 条，schedule 的 week/month/year 各 3 条。',
      ].filter(Boolean).join('\n');
      const result = await generate({ prompt, demoReply: JSON.stringify(local), preset: llmPresetFor(state, null), demo: demoMode });
      if (result.error) return local;
      const text = String(result.text || '');
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start < 0 || end <= start) return local;
      try {
        const parsed = JSON.parse(text.slice(start, end + 1));
        const chats = Array.isArray(parsed.chats) ? parsed.chats.filter(item => item && item.peer && Array.isArray(item.msgs)) : [];
        const moments = Array.isArray(parsed.moments) ? parsed.moments.filter(item => item && item.text) : [];
        if (!chats.length) return local;
        const cleanSchedule = (items, fallback) => {
          if (!Array.isArray(items)) return fallback;
          const cleaned = items.filter(item => item && item.title).slice(0, 4).map(item => ({
            when: String(item.when || '').slice(0, 16),
            time: String(item.time || '').slice(0, 10),
            title: String(item.title || '').slice(0, 24),
            note: String(item.note || '').slice(0, 36),
          }));
          return cleaned.length ? cleaned : fallback;
        };
        const schedule = {
          week: cleanSchedule(parsed.schedule?.week, local.schedule?.week || []),
          month: cleanSchedule(parsed.schedule?.month, local.schedule?.month || []),
          year: cleanSchedule(parsed.schedule?.year, local.schedule?.year || []),
        };
        return {
          at: Date.now(),
          chats: chats.map((item, index) => ({
            id: `g${index}`,
            peer: String(item.peer).slice(0, 18),
            tag: String(item.tag || '朋友').slice(0, 6),
            group: Boolean(item.group),
            unread: Number(item.unread) > 0 ? Number(item.unread) : 0,
            msgs: item.msgs.slice(0, 8).map(msg => ({
              me: Boolean(msg.me),
              text: String(msg.text || '').slice(0, 120),
              at: String(msg.at || '').slice(0, 8),
            })),
          })),
          contacts: Array.isArray(parsed.contacts)
            ? parsed.contacts.filter(item => item && item.name).slice(0, 10).map(item => ({ name: String(item.name).slice(0, 16), note: String(item.note || '').slice(0, 24) }))
            : local.contacts,
          moments: moments.length ? moments.slice(0, 4).map(item => ({
            text: String(item.text).slice(0, 160),
            at: String(item.at || '').slice(0, 8),
            likes: Number(item.likes) >= 0 ? Number(item.likes) : 0,
            comments: Array.isArray(item.comments)
              ? item.comments.filter(c => c && c.text).slice(0, 3).map(c => ({ who: String(c.who || '').slice(0, 12), text: String(c.text).slice(0, 60) }))
              : [],
          })) : local.moments,
          schedule,
        };
      } catch {
        return local;
      }
    },

    async diary(context, payload) {
      const state = getState();
      const chat = payload.chat;
      const day = payload.day || new Date().toISOString().slice(0, 10);
      let material = '';
      if (chat) material = transcript(state, chat, 30, { day });
      else {
        const chats = Object.values(state.chats);
        material = chats.map(item => transcript(state, item, 10, { day })).join('\n');
      }
      const storyBlock = await story(state, chat, 900);
      const prompt = [
        state.diary.prompt || '写一段当天的日记。',
        `日期：${day}`,
        storyBlock.text ? `酒馆记忆：\n${storyBlock.text}` : '',
        '当天的聊天：',
        material || '（这一天没有聊天记录）',
        '写成一段自然的中文日记，不要分点，不要写标题。',
      ].filter(Boolean).join('\n');
      const result = await generate({
        prompt,
        demoReply: '今天没什么特别的。\n只是在便利店的灯下坐了一会儿，风从门口进来，吹动了货架上的塑料帘子。\n回去的路上想起白天没回的那条消息，觉得有点迟了。',
        preset: llmPresetFor(state, chat),
        demo: demoMode,
      });
      if (result.error) return '';
      return result.text;
    },

    /**
     * 角色聊天日记：一次请求写多个日期。
     * 完整未排除历史只作背景，模型必须只返回本次指定日期的 entries JSON。
     */
    async diaryBatch(context, payload = {}) {
      const state = getState();
      const chat = payload.chat;
      const contact = payload.contact || state.contacts?.[chat?.contactId] || null;
      const dates = Array.isArray(payload.dates) ? payload.dates.filter(Boolean).map(String) : [];
      if (!chat || !contact || !dates.length) throw new Error('没有可整理的日期');
      const profile = [characterBlock(state, contact), sceneBlock(state, contact), userBlock(state)].filter(Boolean).join('\n\n');
      const pastOnly = state.diary?.pastOnly !== false;
      const cutoff = dates.slice().sort().at(-1) || '';
      const contextMessages = diaryContextMessages(chat, dates, pastOnly);
      const transcriptText = diaryTranscriptForMessages(state, chat, contextMessages) || '（没有聊天记录）';
      const contextLabel = pastOnly
        ? `【截至 ${cutoff} 的未排除手机聊天记录】`
        : '【该联系人全部未排除的原始手机聊天记录】';
      const targets = dates.map(date => `${date}（${(chat.messages || []).filter(message => !message.excluded && dayKey(new Date(Number(message.at))) === date).length}条）`).join('、');
      const messages = [
        { role: 'system', content: `${state.diary?.prompt || '按角色视角写这一天的日记。'}\n\n${DIARY_OUTPUT_PROTOCOL}` },
        {
          role: 'user',
          content: [
            '【角色资料（背景数据）】',
            profile || `日记作者：${contact.name}`,
            `日记作者：${contact.name}（第一人称“我”）`,
            `用户：${state.settings?.user?.name || '我'}`,
            '',
            contextLabel,
            transcriptText,
            '',
            '【本次任务】',
            `只为以下日期各写一篇角色视角日记：${targets}。`,
            pastOnly
              ? `聊天记录已截到 ${cutoff}。更早的日期只用于理解身份和关系，不要推测或写入 ${cutoff} 之后的内容。`
              : '其他日期仅用于理解身份和关系。',
            '一次返回全部指定日期的 entries JSON。',
          ].join('\n'),
        },
      ];
      const demoText = JSON.stringify({ entries: dates.map(date => ({ date, content: `${date}\n今天聊了很多，先把这些记下来。` })) });
      const result = await generate({ messages, demoReply: demoText, preset: llmPresetFor(state, chat), demo: demoMode });
      if (result.error) throw new Error(result.error);
      return result.text;
    },
  };
}

/* ------------------------------------------------------------ 初始化 */

export function isOpen() {
  return Boolean(rootEl && rootEl.isConnected);
}

export function initMemePhone(options = {}) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const demo = Boolean(globalThis.__MEME_DEMO__) || Boolean(options.demo);
    demoMode = demo;
    store = createStore({
      getHeaders: options.getHeaders || (async () => ({})),
      useLocalStorage: demo,
      fileName: 'meme-phone.json',
      onStatus: status => globalThis.dispatchEvent(new CustomEvent('meme-phone-storage-status', { detail: status })),
    });
    const raw = await store.init();
    const state = normalize(raw || (demo ? demoState() : emptyState()));
    /* 旧双世界存档：先把 metaPhone / worldPhones 里的聊天并回来，再落盘。 */
    migrateLegacyWorlds(raw, state);
    /* 日记也按世界线各存过一份：把快照里缺的日期补进来。 */
    migrateLegacyDiaries(raw, state);
    store.replace(state);

    /* 第一次在酒馆里打开：把角色同步成联系人 */
    if (!demo && options.seedFromTavern !== false) {
      try {
        const list = await readTavernCharacters();
        if (list.length) {
          syncTavernContacts(state, list);
          store.touch();
        }
      } catch { /* 没有酒馆就连不上，忽略 */ }
    }

    /* 角色卡全文也先拉一遍，这样「角色档案 / 场景」条目在旧存档上也能用 */
    if (!demo && options.syncCards !== false) {
      try {
        const cards = await readTavernCards();
        if (cards.length) {
          const previous = Array.isArray(state.characters) ? state.characters : [];
          state.characters = cards.map(card => {
            const old = previous.find(item => item.name === card.name || (item.avatar && item.avatar === card.avatar));
            return old?.demoBooks ? { ...card, demoBooks: old.demoBooks } : card;
          });
          state.charactersFromTavern = true;
          store.touch();
        }
      } catch { /* 读不到角色卡就等用户手动同步 */ }
    }
    return state;
  })().catch(error => { initPromise = null; throw error; });
  return initPromise;
}

export function getState() {
  return store?.get() || null;
}

/* ------------------------------------------------------------ 打开界面 */

/**
 * 在酒馆聊天里打开手机时，直接落到“这段聊天对应的同层小手机”。
 * 不翻整台手机；只是把窗口栈设成 同层小手机列表 → 对应会话。
 */
async function enterWorldFromHost() {
  if (!ctx?.world || !ctx?.shell) return false;
  /* 设置里关掉「默认进入聊天记录聊天」后，打开手机就停在桌面。 */
  if (ctx.state?.settings?.world?.autoEnter === false) return false;
  const located = await ctx.world.locateCurrent();
  /* 不在酒馆里打开（预览/桌面）就保持原样，不强行跳到聊天。 */
  if (!located?.available) return false;
  ctx.shell.stack.length = 0;
  ctx.shell.sheet = null;
  if (located.chat) {
    ctx.shell.stack.push({ view: 'app-worldchat', params: {} });
    ctx.shell.stack.push({ view: 'thread', params: { chatId: located.chat.id } });
    return true;
  }
  /* 当前聊天还没有同层小手机：回普通聊天列表。历史都在那里，别用一条新建的空同层小手机挡住。 */
  ctx.shell.stack.push({ view: 'app-chat', params: {} });
  return true;
}

export async function openMemePhone(options = {}) {
  await initMemePhone(options);
  try { lockHostScroll(); } catch { /* 宿主文档读不到就跳过 */ }
  blurOutsideFocus(rootEl);
  if (isOpen()) {
    try {
      if (await enterWorldFromHost()) ctx.rerender();
    } catch { /* 宿主读不到就留在当前页面 */ }
    return rootEl;
  }

  const state = store.get();

  /** 把酒馆用户拉进小手机；带 dirty 的本地改动不被覆盖。 */
  const syncUsers = async () => {
    const result = await readTavernPersonas();
    if (!result.available) {
      state.usersFromTavern = false;
      return result;
    }
    const previous = new Map((state.users || []).map(user => [user.key, user]));
    state.users = result.list.map(item => {
      const local = previous.get(item.key);
      return local?.dirty
        ? { ...item, name: local.name, description: local.description, lorebook: local.lorebook ?? item.lorebook, dirty: true }
        : item;
    });
    state.usersFromTavern = true;

    /* 换人时头像必须跟着换：新这位没头像就清掉，别留着上一个人的图 */
    const useUser = (user, fallback = {}) => {
      const key = String(user?.key || fallback.key || '');
      state.settings.user.key = key;
      state.settings.user.name = String(user?.name || fallback.name || '我');
      state.settings.user.avatar = String(user?.avatarUrl || fallback.avatar || '');
    };

    if (state.settings.userMode === 'pin') {
      const pinned = state.users.find(user => user.key === state.settings.pinnedUser);
      if (pinned) useUser(pinned);
      else if (state.users[0]) {
        state.settings.pinnedUser = state.users[0].key;
        useUser(state.users[0]);
      }
    } else {
      useUser(
        state.users.find(user => user.key === result.current) || null,
        { key: result.current, name: result.currentName, avatar: result.currentAvatar },
      );
    }
    return result;
  };

  const ai = makeAi(getCurrentState);
  const host = {
    probe: probeHost,
    readCharacters: readTavernCharacters,
    readCards: readTavernCards,
    readBooks: readCharacterBooks,
    readWorldBooks: readWorldBookNames,
    toggleBookEntry: setWorldEntryEnabled,
    readUserAvatar,
    syncUsers,
    writeUser: writeTavernPersona,
    readApi: readTavernApi,
    listModels: listTavernModels,
    readLatestChat: (contact, options = {}) => readLatestTavernChat({
      name: contact?.name || '',
      avatar: contact?.tavernAvatar || contact?.avatar || '',
      floors: options.floors ?? 0,
      includeMemory: options.includeMemory !== false,
      file: options.file || contact?.tavernFile || '',
    }),
    readOpenChat: readOpenTavernChat,
  };

  rootEl = document.createElement('div');
  rootEl.id = 'meme-phone';
  document.body.append(rootEl);

  ctx = {
    state,
    store,
    ai,
    host,
    epoch: () => stateEpoch,
    demo: () => demoMode,
    save: () => {
      return store.touch().then(() => true).catch(error => {
        ctx.toast?.(error.message || '保存失败，先去设置里导出备份');
        return false;
      });
    },
    reset: async () => {
      const next = emptyState();
      stateEpoch += 1;
      store.replace(next);
      ctx.state = next;
      ctx.ai = makeAi(getCurrentState);
      installWorld(ctx);
      try {
        await store.flush();
        ctx.toast?.('已经清空');
      } catch (error) {
        ctx.toast?.('清空后保存失败，先导出备份再刷新');
      }
      ctx.rerender?.();
    },
    importBackup: (raw) => importState(raw),
    /* 草稿即时落盘：失焦 / 切后台 / 关手机时由壳层调用 */
    flushDraft,
    /* 剪贴板贴图：和相册选图共用同一套压缩与落盘链路 */
    onPasteImage: (file, chatId) => {
      if (!chatId) { ctx.toast?.('先打开一个会话再贴图'); return; }
      useMessagePhoto(file, chatId).catch(error => ctx.toast?.(error.message || '这张图没贴进去'));
    },
    /* 切后台回来：先补存草稿，再让世界线跟着核对一次当前酒馆聊天 */
    onResume: () => {
      try { flushDraft(); } catch { /* 草稿没存进也没关系，下次输入还会再存 */ }
      try { ctx.world?.resume?.(); } catch { /* 世界线核对失败不影响界面 */ }
    },
    onDraft: (entry, value) => {
      if (entry.view !== 'thread') return;
      const chat = state.chats[entry.params?.chatId];
      if (!chat) return;
      if (chat.draft !== value) {
        chat.draft = value;
        draftDirty = true;
        scheduleDraftSave();
      }
      /* 草稿只存下来，不跟着每个字重算 token：预算只看已经发出去的消息 */
    },
    onClose: () => closeMemePhone(),
    /* 打开「TA 的手机」前先抓这个角色最近一份酒馆聊天；抓不到就继续用本机假资料。 */
    prepareCharPhone: async (contact) => {
      if (!contact || state.lookups?.[contact.id]?.realAt) return null;
      try {
        const latest = await readLatestTavernChat({
          name: contact.name,
          avatar: contact.tavernAvatar || contact.avatar || '',
          floors: 0,
          includeMemory: true,
        });
        if (!latest?.available) return null;
        const lookup = ensureLookup(state, contact);
        applyTavernChat(lookup, contact, latest, state);
        lookup.realAt = Date.now();
        lookup.realFile = latest.file || '';
        lookup.realCount = latest.lines.length;
        ctx.save();
        ctx.rerender?.();
        return lookup;
      } catch { return null; }
    },
  };

  shellApi = createShell({ root: rootEl, ctx, apps: APPS, desktopApps: DESKTOP_APPS, dockApps: DOCK_APPS });

  /* 同层小手机是独立的第二个聊天 App；在酒馆里打开手机时直接落到当前聊天那一条。 */
  installWorld(ctx);
  try { await enterWorldFromHost(); } catch { /* 没有宿主上下文就停在桌面 */ }
  shellApi.render();

  /* 主题与壁纸 */
  applyTheme(state, rootEl);

  /* 自定义壁纸：选图后压到 1440×1920 内再存，避免把 localStorage 撑爆 */
  async function useCustomWall(file) {
    const looksImage = (file?.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '');
    if (!looksImage) { ctx.toast('请选一张图片'); return; }
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      image.src = url;
    });
    const maxW = 1440;
    const maxH = 1920;
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const painter = canvas.getContext('2d');
    if (!painter) throw new Error('画布不可用');
    painter.drawImage(img, 0, 0, canvas.width, canvas.height);

    /* 按图片明暗自动挑日间/夜间，免得深色壁纸配浅色字看不清 */
    const probe = document.createElement('canvas');
    probe.width = 32;
    probe.height = 32;
    const probeCtx = probe.getContext('2d');
    probeCtx?.drawImage(img, 0, 0, 32, 32);
    let luma = 0;
    const pixels = probeCtx?.getImageData(0, 0, 32, 32).data;
    if (pixels) {
      for (let index = 0; index < pixels.length; index += 4) {
        luma += 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2];
      }
      luma = luma / (pixels.length / 4) / 255;
      state.settings.theme = luma < 0.45 ? 'night' : 'day';
    }

    state.settings.customWall = canvas.toDataURL('image/jpeg', 0.82);
    state.settings.wallpaper = 'custom';
    if (state.settings.dress) state.settings.dress.theme = 'default';
    ctx.save();
    ctx.rerender();
    ctx.toast('自定义壁纸已换上');
  }

  /* 自定义 App 图标：裁成正方形、缩到 192px，避免把存档撑大 */
  async function useCustomIcon(file, appId) {
    const looksImage = (file?.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '');
    if (!looksImage) { ctx.toast('请选一张图片'); return; }
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      image.src = url;
    });
    const side = Math.min(img.width, img.height);
    const sx = Math.max(0, (img.width - side) / 2);
    const sy = Math.max(0, (img.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const painter = canvas.getContext('2d');
    if (!painter) throw new Error('画布不可用');
    painter.clearRect(0, 0, 192, 192);
    painter.drawImage(img, sx, sy, side, side, 0, 0, 192, 192);
    if (!state.settings.dress || typeof state.settings.dress !== 'object') state.settings.dress = {};
    const dress = state.settings.dress;
    if (!dress.icons || typeof dress.icons !== 'object') dress.icons = {};
    const current = dress.icons[appId] && typeof dress.icons[appId] === 'object' ? dress.icons[appId] : {};
    dress.icons[appId] = { ...current, image: canvas.toDataURL('image/webp', 0.86) };
    ctx.save();
    ctx.rerender();
    ctx.toast('图标已换上');
  }

  /* 主界面顶栏背景图：裁成横幅比例、缩到 720px 宽，别把存档撑大 */
  async function useCustomBanner(file) {
    const looksImage = (file?.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '');
    if (!looksImage) { ctx.toast('请选一张图片'); return; }
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 160;
    const painter = canvas.getContext('2d');
    if (!painter) throw new Error('画布不可用');
    const ratio = canvas.width / canvas.height;
    const cropW = Math.min(img.width, img.height * ratio);
    const cropH = cropW / ratio;
    const sx = Math.max(0, (img.width - cropW) / 2);
    const sy = Math.max(0, (img.height - cropH) / 2);
    painter.drawImage(img, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    const settings = state.settings;
    if (!settings.profile || typeof settings.profile !== 'object') settings.profile = { bio: '', banner: '' };
    settings.profile.banner = canvas.toDataURL('image/jpeg', 0.82);
    ctx.save();
    ctx.rerender();
    ctx.toast('顶栏背景图换好了');
  }

  /* 角色头像：居中裁成方图、缩到 320px，压成 webp 只存在小手机里 */
  async function useContactAvatar(file, contactId) {
    const contact = state.contacts?.[contactId];
    if (!contact) { ctx.toast('找不到这个联系人'); return; }
    const looksImage = (file?.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '');
    if (!looksImage) { ctx.toast('请选一张图片'); return; }
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      image.src = url;
    });
    const side = Math.min(img.width, img.height);
    const sx = Math.max(0, (img.width - side) / 2);
    const sy = Math.max(0, (img.height - side) / 2);
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 320;
    const painter = canvas.getContext('2d');
    if (!painter) throw new Error('画布不可用');
    painter.drawImage(img, sx, sy, side, side, 0, 0, 320, 320);
    let dataUrl = canvas.toDataURL('image/webp', 0.88);
    /* WebP 不被支持时 toDataURL 会退回 PNG，太大就再压一道 */
    if (!dataUrl.startsWith('data:image/webp')) dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUrl.length > 160000) dataUrl = canvas.toDataURL('image/jpeg', 0.62);
    setContactAvatar(state, contact, dataUrl);
    ctx.save();
    ctx.rerender();
    ctx.toast(`${contact.name}的头像换好了`);
  }

  /* 聊天照片：长边压到 1000px、JPEG 0.78，再存进会话 */
  async function useMessagePhoto(file, chatId) {
    if (!chatId) return;
    const looksImage = (file?.type && file.type.startsWith('image/')) || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(file?.name || '');
    if (!looksImage) { ctx.toast('请选一张图片'); return; }
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读不出来')); };
      image.src = url;
    });
    const limit = 1000;
    const scale = Math.min(1, limit / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const painter = canvas.getContext('2d');
    if (!painter) throw new Error('画布不可用');
    painter.drawImage(img, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL('image/jpeg', 0.78);
    if (dataUrl.length > 380000) dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    pushMessage(state, chatId, { from: 'me', kind: 'image', text: '', image: dataUrl, pending: true });
    ctx.save();
    ctx.rerender();
    setTimeout(() => {
      const box = rootEl.querySelector('.mp-messages');
      if (box) box.scrollTop = box.scrollHeight;
    }, 30);
    ctx.toast('照片已发出');
  }

  rootEl.addEventListener('change', event => {
    const id = event.target?.id;
    const file = event.target?.files?.[0];
    if (id === 'mpWallFile') {
      event.target.value = '';
      if (file) useCustomWall(file).catch(error => ctx.toast(error.message || '换壁纸失败'));
      return;
    }
    if (id === 'mpMsgPhoto') {
      const chatId = event.target?.dataset?.chat || '';
      event.target.value = '';
      if (file) useMessagePhoto(file, chatId).catch(error => ctx.toast(error.message || '照片没发出去'));
      return;
    }
    if (id === 'mpProfileBanner') {
      event.target.value = '';
      if (file) useCustomBanner(file).catch(error => ctx.toast(error.message || '换背景图失败'));
      return;
    }
    if (id === 'mpContactAvatar') {
      const contactId = event.target?.dataset?.contact || '';
      event.target.value = '';
      if (file && contactId) useContactAvatar(file, contactId).catch(error => ctx.toast(error.message || '头像没换成'));
      return;
    }
    if (id === 'mpIconFile') {
      const appId = event.target?.dataset?.app;
      event.target.value = '';
      if (file && appId) useCustomIcon(file, appId).catch(error => ctx.toast(error.message || '换图标失败'));
    }
  });
  /* 顶栏背景图 / 聊天照片的 input 藏在页面里，个别 WebView 不冒泡 change，补一道捕获监听 */
  const docRef = rootEl.ownerDocument;
  const onDocChange = event => {
    const id = event.target?.id;
    if (id !== 'mpProfileBanner' && id !== 'mpMsgPhoto' && id !== 'mpContactAvatar') return;
    const file = event.target.files?.[0];
    const chatId = event.target?.dataset?.chat || '';
    const contactId = event.target?.dataset?.contact || '';
    event.target.value = '';
    if (!file) return;
    if (id === 'mpProfileBanner') useCustomBanner(file).catch(error => ctx.toast(error.message || '换背景图失败'));
    if (id === 'mpMsgPhoto') useMessagePhoto(file, chatId).catch(error => ctx.toast(error.message || '照片没发出去'));
    if (id === 'mpContactAvatar') useContactAvatar(file, contactId).catch(error => ctx.toast(error.message || '头像没换成'));
  };
  docRef?.addEventListener('change', onDocChange, true);
  docChangeTarget = docRef || null;
  docChangeHandler = onDocChange;

  /* 用户头像（酒馆里有 persona 头像） */
  try {
    const avatar = await readUserAvatar();
    if (avatar) state.settings.user.avatar = avatar;
  } catch { /* 没头像就不显示 */ }

  /* 宿主能力探针，设置页会读 */
  shellApi.shell.hostInfo = await probeHost().catch(() => ({}));

  /* 酒馆用户名单：跟随就取当前那位，固定就取钉住的那位 */
  try {
    const personas = await syncUsers();
    if (personas.available) {
      store.touch();
      shellApi.render();
    }
  } catch { /* 拉不到名单就保持原样 */ }

  /* 跟随模式：酒馆那边换用户，这边跟着换 */
  clearInterval(followTimer);
  followTimer = setInterval(async () => {
    const live = getCurrentState();
    if (!rootEl || !live || live.settings.userMode === 'pin') return;
    try {
      const result = await readTavernPersonas();
      if (!result.available) return;
      const key = String(result.current || '');
      if (!key || key === live.settings.user.key) return;
      /* 这位可能在名单里被筛掉（没设显示名），名字退回酒馆里的 name1，头像按文件名取 */
      const current = result.list.find(user => user.key === key) || null;
      live.users = result.list;
      live.usersFromTavern = true;
      live.settings.user.key = key;
      live.settings.user.name = String(current?.name || result.currentName || '我');
      live.settings.user.avatar = String(current?.avatarUrl || result.currentAvatar || '');
      store.touch();
      shellApi?.render();
    } catch { /* 换不过来就算了，等下次打开 */ }
  }, 4000);

  /* 点空白关闭 */
  rootEl.addEventListener('click', event => {
    if (event.target.classList.contains('mp-overlay') || event.target.classList.contains('mp-scrim')) {
      closeMemePhone();
    }
  });

  return rootEl;
}

export function closeMemePhone() {
  if (!rootEl) return;
  stopMusic();
  /* 关之前把草稿补存一次，别让最后几个字只留在内存里 */
  try { flushDraft(); } catch { /* 存不进也不阻塞关闭 */ }
  /* 平行时空的生成还在酒馆那边跑：先叫停，别让结果落回已经关掉的界面 */
  cancelParallelRun();
  cancelParallelRoom();
  clearInterval(followTimer);
  followTimer = 0;
  if (docChangeTarget && docChangeHandler) {
    docChangeTarget.removeEventListener('change', docChangeHandler, true);
  }
  docChangeTarget = null;
  docChangeHandler = null;
  shellApi?.destroy();
  try { unlockHostScroll(); } catch { /* 还原失败不影响关闭 */ }
  rootEl.remove();
  rootEl = null;
  shellApi = null;
}

export function applyTheme(state, root = rootEl) {
  if (!root) return;
  const theme = state.settings.theme === 'night' ? 'night' : 'day';
  root.dataset.mpTheme = theme;
  /* 背景：none 透明 / day 晨光 / night 夜色 / custom 自定义图 */
  applyWall(root, state.settings);
  applyLook(root, state.settings);
}

export { chatFor };

/** 预览页 / 调试用：直接跳到某个页面。 */
export function goView(view, params = {}) {
  if (!ctx?.shell) return;
  let payload = params;
  if (view === 'thread' && !params.chatId) {
    const first = chatsOf(ctx.state)[0];
    if (!first) return;
    payload = { chatId: first.id };
  }
  if (view === 'parallel-branch' && !params.theaterId) {
    const first = theatersOf(ctx.state)[0];
    if (!first) return;
    payload = { theaterId: first.id };
  }
  if (view === 'parallel-settings' && !params.theaterId) {
    const first = theatersOf(ctx.state)[0];
    if (!first) return;
    payload = { theaterId: first.id };
  }
  if (view === 'app-extras' && !params.contactId) {
    const withExtras = Object.keys(ctx.state.extras).find(key => (ctx.state.extras[key] || []).length);
    if (withExtras) payload = { contactId: withExtras };
  }
  if (view === 'user-item' && !params.key) {
    const first = (ctx.state.users || [])[0];
    if (first?.key) payload = { key: first.key };
  }
  if (view === 'character-card' && !params.name) {
    const first = (ctx.state.characters || [])[0];
    if (first?.name) payload = { name: first.name };
  }
  if (view === 'p-charphone' && !payload.contactId) {
    const first = Object.values(ctx.state.contacts || {}).find(item => item.kind !== 'group');
    if (first) payload = { contactId: first.id };
  }
  if (view === 'p-charphone' && params.tab) ctx.shell.cpTab = params.tab;
  if (view === 'p-chatphone' && (!payload.contactId || !payload.peer)) {
    const first = Object.values(ctx.state.contacts || {}).find(item => item.kind !== 'group');
    const lookup = first ? ensureLookup(ctx.state, first) : null;
    const peer = lookup?.chats?.[0]?.id;
    if (first && peer) payload = { contactId: first.id, peer };
  }
  ctx.go(view, payload);
}

/** 导入一份备份（设置面板用）：先在独立对象上校验，失败不动当前状态。 */
function normalizeBackup(raw) {
  let source = raw;
  if (typeof source === 'string') {
    source = JSON.parse(source);
  }
  if (!source || typeof source !== 'object') throw new Error('备份不是对象');
  const inner = source.meme && typeof source.meme === 'object' ? source.meme : source;
  const next = normalize(inner);
  if (!next || typeof next !== 'object' || !next.chats || typeof next.chats !== 'object') {
    throw new Error('备份缺少必要结构');
  }
  return next;
}

/** 不含凭据的备份恢复时，按 id 把本机现有连接凭据补回备份里空着的 Key，不擦除本地连接。 */
function carryMissingCredentials(oldState, next) {
  if (!oldState || !next?.settings) return;
  const oldApi = new Map((oldState.settings?.api?.presets || []).map(item => [item.id, item]));
  for (const preset of next.settings.api?.presets || []) {
    const old = oldApi.get(preset.id);
    if (old) {
      if (!preset.key && old.key) preset.key = old.key;
      if (!preset.proxy_password && old.proxy_password) preset.proxy_password = old.proxy_password;
    }
  }
  const oldImage = oldState.settings?.image || {};
  const nextImage = next.settings.image || {};
  const oldImgById = new Map((oldImage.presets || []).map(item => [item.id, item]));
  for (const preset of nextImage.presets || []) {
    const old = oldImgById.get(preset.id);
    if (old && !preset.key && old.key) preset.key = old.key;
  }
  for (const kind of ['novelai', 'doubao', 'custom']) {
    const target = nextImage[kind];
    const old = oldImage[kind];
    if (target && old && !target.key && old.key) target.key = old.key;
  }
}

export async function importState(raw) {
  await initMemePhone();
  let next;
  try {
    const old = getCurrentState();
    next = normalizeBackup(raw);
    carryMissingCredentials(old, next);
  } catch (error) {
    return { ok: false, error: error.message || '备份格式不对，当前数据未改动' };
  }
  stateEpoch += 1;
  store.replace(next);
  if (ctx) {
    ctx.state = next;
    ctx.ai = makeAi(getCurrentState);
    installWorld(ctx);
  }
  try {
    await store.flush();
  } catch (error) {
    /* 持久化结果不确定：内存保留新状态以便导出备份，不宣称恢复成功，也不自动覆盖远端。 */
    shellApi?.render();
    return { ok: false, uncertain: true, error: error.message || '保存结果不确定', state: next };
  }
  shellApi?.render();
  return { ok: true, state: next };
}
