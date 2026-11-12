/**
 * meme-phone · 模块入口
 * 把存储、宿主桥、外壳、各个 App 装在一起。外层的 index.js 只负责挂载/卸载。
 */

import { createStore } from './store.js';
import { normalize, emptyState, demoState, syncTavernContacts, chatFor, llmPresetFor, replyContextFor, replySystemFor, replyItemsFor, fillPromptTokens } from './data.js';
import { createShell, applyWall, applyLook } from './shell.js';
import { readTavernCharacters, readCharacterBooks, setWorldEntryEnabled, readUserAvatar, readTavernPersonas, readTavernCards, writeTavernPersona, readTavernApi, listTavernModels, generate, probeHost } from './host.js';
import { chatApp, threadApp, threadSettingsApp } from './apps/chat.js';
import { buildMemoryContext } from './memory.js';
import { replyContextBlock, transcript } from './reply-context.js';
import { diaryApp, threadDiaryApp } from './apps/diary.js';
import { contactsApp, contactApp } from './apps/contacts.js';
import { settingsApp, appearanceApp } from './apps/settings.js';
import { drawApp } from './apps/draw.js';
import { apiListApp, apiPresetApp } from './apps/api.js';
import { userListApp, userEditApp } from './apps/user.js';
import { characterApp } from './apps/characters.js';
import { charPhoneApp, charPhoneThreadApp, ensureLookup } from './apps/charphone.js';
import { musicApp, musicPlaylistApp, stopMusic } from './apps/music.js';
import { memoryPresetsApp } from './apps/memory.js';
import { presetsApp, replyPresetApp } from './apps/presets.js';
import {
  extrasApp, extraDetailApp, emojiApp,
  plansApp, dressApp, iconPickerApp, helpApp,
} from './apps/more.js';

const APPS = {
  'app-chat': chatApp,
  'app-diary': diaryApp,
  'thread-diary': threadDiaryApp,
  'app-contacts': contactsApp,
  'app-settings': settingsApp,
  'app-appearance': appearanceApp,
  'app-extras': extrasApp,
  'app-emoji': emojiApp,
  'app-plans': plansApp,
  'app-dress': dressApp,
  'app-icon': iconPickerApp,
  'app-help': helpApp,
  'app-draw': drawApp,
  'app-api': apiListApp,
  'api-item': apiPresetApp,
  'app-presets': presetsApp,
  'reply-item': replyPresetApp,
  'app-user': userListApp,
  'user-item': userEditApp,
  'character-card': characterApp,
  'p-charphone': charPhoneApp,
  'p-chatphone': charPhoneThreadApp,
  'memory-presets': memoryPresetsApp,
  'app-memory-presets': memoryPresetsApp,
  'app-music': musicApp,
  'music-playlist': musicPlaylistApp,
  thread: threadApp,
  'thread-settings': threadSettingsApp,
  contact: contactApp,
  'extra-detail': extraDetailApp,
};

const DESKTOP_APPS = [
  { id: 'extras', name: '小剧场', icon: 'theater' },
  { id: 'music', name: '音乐', icon: 'music' },
  { id: 'draw', name: '绘图', icon: 'image' },
  { id: 'plans', name: '计划', icon: 'plan' },
  { id: 'dress', name: '装扮', icon: 'brush' },
  { id: 'memory-presets', name: '记忆', icon: 'book' },
  { id: 'presets', name: '预设', icon: 'reply' },
  { id: 'api', name: '接口', icon: 'code' },
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
let followTimer = 0;

/* ------------------------------------------------------------ 模型调用 */

function roleNote(items, role, title, state, chat) {
  const lines = items
    .filter(item => item.kind !== 'app' && item.enabled && item.role === role && item.content)
    .map(item => fillPromptTokens(item.content, state, chat));
  return lines.length ? `【${title}】\n${lines.join('\n')}` : '';
}

function makeAi(state) {
  /* 手机聊天 / 日记的背景走「酒馆记忆」：有酒馆总结先用总结，没有就读最近几层酒馆聊天 */
  function story(chat, limit = 1200) {
    return buildMemoryContext(state, chat, limit);
  }

  return {
    async reply(context, chat, contact, demoReply) {
      const ctxSettings = replyContextFor(state, chat);
      const storyBlock = ctxSettings.memory ? await story(chat, 1200) : { text: '' };
      const replySystem = replySystemFor(state, chat);
      const items = replyItemsFor(state, chat);
      const contextText = replyContextBlock(state, chat, contact, ctxSettings, storyBlock.text);
      const prompt = [
        `你在扮演「${contact?.name || '对方'}」，用手机聊天，只说一条消息。`,
        replySystem ? '' : '要求：口语、短、不超过 40 字，不要旁白、不要括号动作。',
        roleNote(items, 'user', '用户补充', state, chat),
        roleNote(items, 'assistant', '角色示例', state, chat),
        contextText,
        `${state.settings.user.name}：${chat.messages[chat.messages.length - 1]?.text || ''}`,
        `${contact?.name || '对方'}：`,
      ].filter(Boolean).join('\n');
      const result = await generate({ prompt, system: replySystem, demoReply, preset: llmPresetFor(state, chat) });
      return result.text;
    },

    async proactive(context, chat, contact, demoReply) {
      const ctxSettings = replyContextFor(state, chat);
      const storyBlock = ctxSettings.memory ? await story(chat, 900) : { text: '' };
      const replySystem = replySystemFor(state, chat);
      const items = replyItemsFor(state, chat);
      const contextText = replyContextBlock(state, chat, contact, ctxSettings, storyBlock.text);
      const prompt = [
        `你在扮演「${contact?.name || '对方'}」，现在是手机聊天。`,
        `距离上次说话已经过去 ${state.settings.proactive.idleMinutes} 分钟，你要主动发一条消息。`,
        replySystem ? '' : '要求：口语、短、不超过 30 字，像是忽然想起什么，不要提问过多。',
        roleNote(items, 'user', '用户补充', state, chat),
        roleNote(items, 'assistant', '角色示例', state, chat),
        contextText,
        `${contact?.name || '对方'}：`,
      ].filter(Boolean).join('\n');
      const result = await generate({ prompt, system: replySystem, demoReply, preset: llmPresetFor(state, chat) });
      return result.text;
    },

    /* 查 TA 的手机：让模型按人设现编一份聊天 / 通讯录 / 朋友圈 */
    async lookup(context, contact, local) {
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
      const result = await generate({ prompt, demoReply: JSON.stringify(local), preset: llmPresetFor(state, null) });
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
      const chat = payload.chat;
      const day = payload.day || new Date().toISOString().slice(0, 10);
      let material = '';
      if (chat) material = transcript(state, chat, 30);
      else {
        const chats = Object.values(state.chats);
        material = chats.map(item => transcript(state, item, 10)).join('\n');
      }
      const storyBlock = await story(chat, 900);
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
        ? { ...item, name: local.name, description: local.description, dirty: true }
        : item;
    });
    state.usersFromTavern = true;

    const useUser = (user) => {
      if (!user) return;
      state.settings.user.name = user.name || '我';
      state.settings.user.key = user.key || '';
      if (user.avatarUrl) state.settings.user.avatar = user.avatarUrl;
    };

    if (state.settings.userMode === 'pin') {
      const pinned = state.users.find(user => user.key === state.settings.pinnedUser);
      if (pinned) useUser(pinned);
      else if (state.users[0]) {
        state.settings.pinnedUser = state.users[0].key;
        useUser(state.users[0]);
      }
    } else {
      useUser(state.users.find(user => user.key === result.current) || null);
    }
    return result;
  };

  const ai = makeAi(state);
  const host = {
    probe: probeHost,
    readCharacters: readTavernCharacters,
    readCards: readTavernCards,
    readBooks: readCharacterBooks,
    toggleBookEntry: setWorldEntryEnabled,
    readUserAvatar,
    syncUsers,
    writeUser: writeTavernPersona,
    readApi: readTavernApi,
    listModels: listTavernModels,
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
      ctx.rerender?.();
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

  rootEl.addEventListener('change', event => {
    const id = event.target?.id;
    const file = event.target?.files?.[0];
    if (id === 'mpWallFile') {
      event.target.value = '';
      if (file) useCustomWall(file).catch(error => ctx.toast(error.message || '换壁纸失败'));
      return;
    }
    if (id === 'mpIconFile') {
      const appId = event.target?.dataset?.app;
      event.target.value = '';
      if (file && appId) useCustomIcon(file, appId).catch(error => ctx.toast(error.message || '换图标失败'));
    }
  });

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
    if (!rootEl || state.settings.userMode === 'pin') return;
    try {
      const result = await readTavernPersonas();
      if (!result.available) return;
      const current = result.list.find(user => user.key === result.current);
      if (!current || current.key === state.settings.user.key) return;
      state.users = result.list;
      state.usersFromTavern = true;
      state.settings.user.name = current.name || '我';
      state.settings.user.key = current.key;
      if (current.avatarUrl) state.settings.user.avatar = current.avatarUrl;
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
  clearInterval(followTimer);
  followTimer = 0;
  shellApi?.destroy();
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
    const first = Object.values(ctx.state.chats)[0];
    if (!first) return;
    payload = { chatId: first.id };
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
