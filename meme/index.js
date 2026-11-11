/**
 * meme-phone · 模块入口
 * 把存储、宿主桥、外壳、各个 App 装在一起。外层的 index.js 只负责挂载/卸载。
 */

import { createStore } from './store.js';
import { normalize, emptyState, demoState, syncTavernContacts, chatFor } from './data.js';
import { createShell } from './shell.js';
import { readTavernCharacters, readUserAvatar, generate, probeHost } from './host.js';
import { chatApp, threadApp } from './apps/chat.js';
import { diaryApp } from './apps/diary.js';
import { contactsApp, contactApp } from './apps/contacts.js';
import { settingsApp, appearanceApp } from './apps/settings.js';
import {
  extrasApp, extraDetailApp, walletApp, favoritesApp, emojiApp,
  membershipApp, plansApp, dressApp, helpApp,
} from './apps/more.js';

const APPS = {
  'app-chat': chatApp,
  'app-diary': diaryApp,
  'app-contacts': contactsApp,
  'app-settings': settingsApp,
  'app-appearance': appearanceApp,
  'app-extras': extrasApp,
  'app-wallet': walletApp,
  'app-favorites': favoritesApp,
  'app-emoji': emojiApp,
  'app-membership': membershipApp,
  'app-plans': plansApp,
  'app-dress': dressApp,
  'app-help': helpApp,
  thread: threadApp,
  contact: contactApp,
  'extra-detail': extraDetailApp,
};

const DESKTOP_APPS = [
  { id: 'extras', name: '小剧场', icon: 'theater' },
  { id: 'wallet', name: '钱包', icon: 'wallet' },
  { id: 'favorites', name: '收藏', icon: 'bookmark' },
  { id: 'emoji', name: '表情', icon: 'smile' },
  { id: 'membership', name: '会员', icon: 'crown' },
  { id: 'plans', name: '计划', icon: 'plan' },
  { id: 'dress', name: '装扮', icon: 'brush' },
  { id: 'help', name: '帮助', icon: 'help' },
];

const DOCK_APPS = [
  { id: 'chat', name: '聊天', icon: 'chat' },
  { id: 'contacts', name: '通讯录', icon: 'contacts' },
  { id: 'diary', name: '日记', icon: 'diary' },
  { id: 'settings', name: '设置', icon: 'settings' },
];

let store = null;
let shellApi = null;
let ctx = null;
let rootEl = null;
let initPromise = null;

/* ------------------------------------------------------------ 模型调用 */

function transcript(state, chat, limit = 10) {
  const contact = state.contacts[chat.contactId];
  return chat.messages.slice(-limit).map(message => {
    const who = message.from === 'me' ? state.settings.user.name : (state.contacts[message.speaker]?.name || contact?.name || 'TA');
    return `${who}：${message.text}`;
  }).join('\n');
}

function makeAi(state) {
  return {
    async reply(context, chat, contact, demoReply) {
      const prompt = [
        `你在扮演「${contact?.name || '对方'}」，用手机聊天，只说一条消息。`,
        '要求：口语、短、不超过 40 字，不要旁白、不要括号动作。',
        transcript(state, chat),
        `${state.settings.user.name}：${chat.messages[chat.messages.length - 1]?.text || ''}`,
        `${contact?.name || '对方'}：`,
      ].join('\n');
      const result = await generate({ prompt, demoReply });
      return result.text;
    },

    async proactive(context, chat, contact, demoReply) {
      const prompt = [
        `你在扮演「${contact?.name || '对方'}」，现在是手机聊天。`,
        `距离上次说话已经过去 ${state.settings.proactive.idleMinutes} 分钟，你要主动发一条消息。`,
        '要求：口语、短、不超过 30 字，像是忽然想起什么，不要提问过多。',
        transcript(state, chat, 6),
        `${contact?.name || '对方'}：`,
      ].join('\n');
      const result = await generate({ prompt, demoReply });
      return result.text;
    },

    async diary(context, payload) {
      const chat = payload.chat;
      const day = payload.day || new Date().toISOString().slice(0, 10);
      let material = '';
      if (chat) material = transcript(state, chat, 30);
      else {
        const chats = Object.values(state.chats);
        material = chats.map(item => transcript(state, item, 10)).join('\n');
      }
      const prompt = [
        state.diary.prompt || '写一段当天的日记。',
        `日期：${day}`,
        '当天的聊天：',
        material || '（这一天没有聊天记录）',
        '写成一段自然的中文日记，不要分点，不要写标题。',
      ].join('\n');
      const result = await generate({
        prompt,
        demoReply: '今天没什么特别的。\n只是在便利店的灯下坐了一会儿，风从门口进来，吹动了货架上的塑料帘子。\n回去的路上想起白天没回的那条消息，觉得有点迟了。',
      });
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
    store = createStore({
      getHeaders: options.getHeaders || (async () => ({})),
      useLocalStorage: demo,
      fileName: 'meme-phone.json',
      onStatus: status => globalThis.dispatchEvent(new CustomEvent('meme-phone-storage-status', { detail: status })),
    });
    const raw = await store.init();
    const state = normalize(raw || (demo ? demoState() : emptyState()));
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
    return state;
  })().catch(error => { initPromise = null; throw error; });
  return initPromise;
}

export function getState() {
  return store?.get() || null;
}

/* ------------------------------------------------------------ 打开界面 */

export async function openMemePhone(options = {}) {
  await initMemePhone(options);
  if (isOpen()) return rootEl;

  const state = store.get();
  const ai = makeAi(state);
  const host = {
    probe: probeHost,
    readCharacters: readTavernCharacters,
    readUserAvatar,
  };

  rootEl = document.createElement('div');
  rootEl.id = 'meme-phone';
  document.body.append(rootEl);

  ctx = {
    state,
    store,
    ai,
    host,
    save: () => {
      store.touch().catch(error => {
        ctx.toast?.(error.message || '保存失败，先去设置里导出备份');
      });
    },
    reset: () => {
      const next = emptyState();
      store.replace(next);
      ctx.state = next;
      ctx.shell?.rerender();
    },
    setWallpaper: (value) => {
      rootEl.style.setProperty('--wallpaper', value);
    },
    onDraft: (entry, value) => {
      if (entry.view !== 'thread') return;
      const chat = state.chats[entry.params?.chatId];
      if (chat) chat.draft = value;
    },
    onClose: () => closeMemePhone(),
  };

  shellApi = createShell({ root: rootEl, ctx, apps: APPS, desktopApps: DESKTOP_APPS, dockApps: DOCK_APPS });

  /* 主题与壁纸 */
  applyTheme(state, rootEl);

  /* 用户头像（酒馆里有 persona 头像） */
  try {
    const avatar = await readUserAvatar();
    if (avatar) state.settings.user.avatar = avatar;
  } catch { /* 没头像就不显示 */ }

  /* 宿主能力探针，设置页会读 */
  shellApi.shell.hostInfo = await probeHost().catch(() => ({}));

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
  shellApi?.destroy();
  rootEl.remove();
  rootEl = null;
  shellApi = null;
}

export function applyTheme(state, root = rootEl) {
  if (!root) return;
  const theme = state.settings.theme === 'night' ? 'night' : 'day';
  root.dataset.mpTheme = theme;
  const dress = state.settings.dress?.wallpaper;
  if (dress === 'plain') {
    root.style.setProperty('--wallpaper', 'linear-gradient(160deg,#fdf1f7,#eef7fb 55%,#eafaf3)');
  } else {
    /* 图片壁纸由 CSS 按主题给出，避免把相对路径写死在 JS 里 */
    root.style.removeProperty('--wallpaper');
  }
  root.dataset.mpDress = dress || 'photo';
}

export { chatFor };

/** 预览页 / 调试用：直接跳到某个页面。 */
export function goView(view, params = {}) {
  if (!ctx?.shell) return;
  let payload = params;
  if (view === 'thread' && !params.chatId) {
    const first = Object.values(ctx.state.chats)[0];
    if (!first) return;
    payload = { chatId: first.id };
  }
  if (view === 'app-extras' && !params.contactId) {
    const withExtras = Object.keys(ctx.state.extras).find(key => (ctx.state.extras[key] || []).length);
    if (withExtras) payload = { contactId: withExtras };
  }
  ctx.go(view, payload);
}

/** 导入一份备份（设置面板用）：只替换 meme-phone 自己的数据。 */
export async function importState(raw) {
  await initMemePhone();
  const next = normalize(raw);
  store.replace(next);
  if (ctx) ctx.state = next;
  await store.flush();
  shellApi?.render();
  return next;
}
