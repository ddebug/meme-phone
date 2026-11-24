/**
 * meme-phone · 双世界（Meta / 里世界）
 *
 * 这一层只做「这台手机现在是哪条世界线」和「切走时把哪份数据收好」。
 * 数据本身仍然住在 state 顶层：contacts / chats / theaters / diary ...
 * 每个里世界实例各自存一份快照；Meta 永只有一份。
 * 这样不用重写任何 App，切换时整块换掉即可。
 */

import { addContact } from './data.js';
import { appendTavernHiddenFloor, readLatestTavernChat, readOpenTavernChat } from './host.js';

/* 会跟着世界线走的数据。用户 / 角色卡 / 接口 Key 留在全局。 */
const DATA_KEYS = [
  'contacts', 'chats', 'theaters', 'lookups', 'diary', 'plans', 'extras',
  'extrasOn', 'favorites', 'wallet', 'membership', 'appointments',
  'friendRequests', 'signatures', 'music', 'dress',
];

/* 会跟着世界线走的外观 / 读法。 */
const SETTINGS_KEYS = [
  'theme', 'wallpaper', 'customWall', 'dress', 'desktop', 'profile', 'theater',
];

function clone(value) {
  if (value == null) return value;
  try {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function plain(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function captureData(state) {
  const out = {};
  DATA_KEYS.forEach(key => { out[key] = clone(state?.[key]); });
  return out;
}

export function restoreData(state, data) {
  if (!plain(data)) return;
  DATA_KEYS.forEach(key => {
    if (data[key] !== undefined) state[key] = clone(data[key]);
  });
}

export function captureLook(state) {
  const settings = {};
  SETTINGS_KEYS.forEach(key => {
    if (state?.settings?.[key] !== undefined) settings[key] = clone(state.settings[key]);
  });
  settings.memory = { byContact: clone(state?.settings?.memory?.byContact || {}) };
  return { settings };
}

export function restoreLook(state, look) {
  if (!plain(look?.settings) || !state.settings) return;
  SETTINGS_KEYS.forEach(key => {
    if (look.settings[key] !== undefined) state.settings[key] = clone(look.settings[key]);
  });
  if (plain(look.settings.memory)) {
    state.settings.memory = state.settings.memory || {};
    state.settings.memory.byContact = clone(look.settings.memory.byContact || {});
  }
}

/** 读一份旧存档时，把还没有双世界结构的状态补成「当前就是 Meta」。 */
export function ensurePhoneWorlds(state) {
  if (!state || typeof state !== 'object') return state;
  if (!plain(state.worldPhones)) state.worldPhones = {};
  if (!state.metaPhone || !plain(state.metaPhone.data)) {
    state.metaPhone = { data: captureData(state), look: captureLook(state), at: Date.now() };
  }
  if (!['meta', 'world'].includes(state.phoneSurface)) state.phoneSurface = 'meta';
  if (!String(state.activeWorldId || '')) state.activeWorldId = '';
  if (!String(state.lastWorldId || '')) state.lastWorldId = '';
  if (state.phoneSurface === 'world' && !state.worldPhones[state.activeWorldId]) {
    state.phoneSurface = 'meta';
    state.activeWorldId = '';
  }
  return state;
}

export function currentWorld(state) {
  const id = String(state?.activeWorldId || '');
  return id ? state?.worldPhones?.[id] || null : null;
}

export function worldDateText(state) {
  const world = currentWorld(state);
  return world ? String(world.storyDate || '第 1 天') : '';
}

export function worldLabel(state) {
  const world = currentWorld(state);
  return world ? String(world.ownerName || '里世界') : '';
}

function hashKey(key) {
  let hash = 0;
  const text = String(key || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function storyDateOf(metadata) {
  const meta = plain(metadata) ? metadata : {};
  const own = plain(meta.memePhone) ? meta.memePhone : plain(meta.meme_phone) ? meta.meme_phone : {};
  const value = own.storyDate || meta.meme_phone_story_date || meta.worldDate || '';
  return String(value || '').trim().slice(0, 30);
}

function emptyWorldData(state, contact, chatId, chatFile, chatChatId) {
  const now = Date.now();
  const contacts = {};
  let chats = {};
  if (contact) {
    const seeded = addContact({ contacts: {} }, clone(contact));
    contacts[seeded.id] = seeded;
    chats = {
      [chatId]: {
        id: chatId,
        contactId: seeded.id,
        kind: seeded.kind === 'group' ? 'group' : 'single',
        messages: [],
        unread: 0,
        draft: '',
        pinned: false,
        muted: false,
        createdAt: now,
        updatedAt: 0,
        tavernFile: String(chatFile || ''),
        tavernChatId: String(chatChatId || ''),
        worldPhoneId: '',
      },
    };
  }
  return {
    contacts,
    chats,
    theaters: {},
    lookups: {},
    diary: {
      ...clone(state.diary || {}),
      entries: {},
      contacts: {},
      lastGenerated: '',
    },
    plans: [],
    extras: {},
    extrasOn: [],
    favorites: [],
    wallet: { balance: 0, transactions: [] },
    membership: { user: { type: 'none', expireAt: 0, queue: [], history: [] }, byContact: {} },
    appointments: { byContact: {} },
    friendRequests: [],
    signatures: { byContact: {} },
    music: { playlists: [], activeId: '', current: null },
    dress: clone(state.dress || { accent: '#8e7bf2' }),
  };
}

function ensureInstance(state, options = {}) {
  const key = String(options.key || '').trim();
  if (!key) return null;
  const existing = Object.values(state.worldPhones || {}).find(item => item && item.key === key);
  if (existing) return existing;

  const id = `wp_${hashKey(key)}`;
  if (state.worldPhones[id]) return state.worldPhones[id];
  const contact = options.contact || null;
  const chatId = `ch_${id}`;
  const data = emptyWorldData(state, contact, chatId, options.chatFile, options.chatId);
  if (contact && data.chats[chatId]) data.chats[chatId].worldPhoneId = id;
  const instance = {
    id,
    key,
    ownerName: String(options.ownerName || contact?.name || '这段聊天'),
    ownerAvatar: String(options.ownerAvatar || contact?.avatar || ''),
    contactId: String(contact?.id || ''),
    sourceChatFile: String(options.chatFile || ''),
    sourceChatId: String(options.chatId || ''),
    storyDate: String(options.storyDate || '第 1 天').slice(0, 30),
    kind: String(options.kind || 'chat'),
    data,
    look: captureLook(state),
    syncQueue: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  state.worldPhones[id] = instance;
  return instance;
}

/** 当前这份内存状态属于哪台：切走前收进对应槽里。 */
export function syncActivePhone(state) {
  if (!state) return;
  if (state.phoneSurface === 'world') {
    const world = currentWorld(state);
    if (world) {
      world.data = captureData(state);
      world.look = captureLook(state);
      world.updatedAt = Date.now();
    }
  } else if (state.metaPhone) {
    state.metaPhone.data = captureData(state);
    state.metaPhone.look = captureLook(state);
    state.metaPhone.at = Date.now();
  }
}

function activateInstance(state, instance) {
  if (!instance) return false;
  syncActivePhone(state);
  restoreData(state, instance.data);
  restoreLook(state, instance.look);
  Object.values(state.chats || {}).forEach(chat => {
    if (chat && !chat.worldPhoneId) chat.worldPhoneId = instance.id;
  });
  state.phoneSurface = 'world';
  state.activeWorldId = instance.id;
  state.lastWorldId = instance.id;
  return true;
}

function activateMeta(state) {
  if (!state.metaPhone) return false;
  syncActivePhone(state);
  restoreData(state, state.metaPhone.data);
  restoreLook(state, state.metaPhone.look);
  state.phoneSurface = 'meta';
  state.activeWorldId = '';
  return true;
}

function formatTurnText(world, messages) {
  const lines = (Array.isArray(messages) ? messages : [])
    .filter(item => item && !item.excluded)
    .map(item => {
      const who = item.from === 'me' ? (item.name || '我') : (world.ownerName || 'TA');
      const body = String(item.text || (item.image ? '［图片］' : '')).trim();
      return body ? `${who}：${body}` : '';
    })
    .filter(Boolean);
  return lines.slice(-8).join('\n');
}

function worldStamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function installWorld(ctx) {
  const state = ctx.state;

  const api = {
    ensure: () => ensurePhoneWorlds(state),
    surface: () => (state.phoneSurface === 'world' && currentWorld(state) ? 'world' : 'meta'),
    current: () => currentWorld(state),
    dateText: () => worldDateText(state),
    label: () => worldLabel(state),
    meta: () => state.metaPhone,
    list: () => Object.values(state.worldPhones || {}).filter(Boolean),
    syncActive: () => syncActivePhone(state),

    /** 聊天里打开手机：认当前打开的酒馆聊天，同一份聊天永远回同一台里世界手机。 */
    async openCurrentChat(options = {}) {
      try {
        const live = await readOpenTavernChat();
        if (!live.available) {
          if (options.toast) ctx.toast(live.reason || '先在酒馆里打开一段聊天');
          return null;
        }
        const contact = { name: live.characterName || 'TA', avatar: live.characterAvatar || '', tavernAvatar: live.characterAvatar || '', kind: 'char' };
        const key = `chat:${live.chatFile || live.chatId}:${live.characterAvatar || live.characterName}:main`;
        const instance = ensureInstance(state, {
          key,
          contact,
          ownerName: live.characterName,
          ownerAvatar: live.characterAvatar,
          chatFile: live.chatFile,
          chatId: live.chatId,
          storyDate: storyDateOf(live.metadata) || '第 1 天',
          kind: 'current-chat',
        });
        if (!instance) return null;
        /* 已有实例沿用用户改过的剧情日期，不被旧聊天覆盖 */
        if (!instance.storyDate || instance.storyDate === '第 1 天') {
          const metaDate = storyDateOf(live.metadata);
          if (metaDate) instance.storyDate = metaDate;
        }
        if (!instance.contactId) {
          const seeded = Object.values(instance.data?.chats || {})[0];
          instance.contactId = String(seeded?.contactId || '');
        }
        activateInstance(state, instance);
        await api.flushPending(instance);
        if (options.save !== false) ctx.save();
        if (options.render !== false) ctx.rerender();
        return instance;
      } catch (error) {
        if (options.toast) ctx.toast(error?.message || '这台里世界手机没打开');
        return null;
      }
    },

    /** 从 Meta 的会话 / 联系人打开某角色的里世界手机：读这个角色最近一份聊天。 */
    async openForContact(contact, options = {}) {
      if (!contact) return null;
      try {
        const latest = await readLatestTavernChat({
          name: contact.name,
          avatar: contact.tavernAvatar || contact.avatar || '',
          floors: 0,
          includeMemory: true,
        });
        const file = latest?.available ? latest.file : '';
        const key = `char:${contact.tavernAvatar || contact.avatar || contact.name}:${file || 'latest'}`;
        const instance = ensureInstance(state, {
          key,
          contact: {
            get id() { return contact.id; },
            name: contact.name,
            avatar: contact.avatar,
            tavernAvatar: contact.tavernAvatar,
            kind: contact.kind,
          },
          ownerName: contact.name,
          ownerAvatar: contact.avatar,
          chatFile: file,
          chatId: latest?.file || '',
          storyDate: storyDateOf(latest?.metadata) || '第 1 天',
          kind: 'contact',
        });
        if (!instance) return null;
        instance.sourceChatFile = file || instance.sourceChatFile;
        activateInstance(state, instance);
        await api.flushPending(instance);
        ctx.save();
        if (typeof ctx.home === 'function') ctx.home(); else ctx.rerender();
        if (!latest?.available) ctx.toast('没找到 TA 最近的酒馆聊天，先当成一条新世界线');
        return instance;
      } catch (error) {
        ctx.toast(error?.message || '这台里世界手机没打开');
        return null;
      }
    },

    activate(id) {
      const instance = state.worldPhones?.[id];
      if (!instance) return false;
      const ok = activateInstance(state, instance);
      if (ok) {
        ctx.save();
        ctx.rerender();
      }
      return ok;
    },

    /** 翻面：里世界 ⇄ Meta。 */
    flip() {
      if (state.phoneSurface === 'world') {
        activateMeta(state);
      } else {
        const last = state.worldPhones?.[state.lastWorldId] || currentWorld(state);
        if (last) activateInstance(state, last);
        else {
          ctx.toast('先在聊天里打开一台里世界手机');
          return false;
        }
      }
      ctx.save();
      ctx.rerender();
      return true;
    },

    editStoryDate() {
      const world = currentWorld(state);
      if (!world) return;
      ctx.openSheet({
        kind: 'form',
        title: '这条世界线的剧情日期',
        note: '只改这台里世界手机显示的日期；状态栏右边的钟点仍然跟着现实走。',
        fields: [{
          name: 'storyDate',
          label: '剧情日期',
          value: world.storyDate || '第 1 天',
          placeholder: '例如 第 3 天 / 霜月十二日',
          maxLength: 30,
        }],
        confirm: '保存',
        onForm: values => {
          const next = String(values.storyDate || '').trim().slice(0, 30);
          world.storyDate = next || '第 1 天';
          ctx.save();
          ctx.rerender();
          ctx.toast('剧情日期改好了');
        },
      });
    },

    /** 把一个生成轮次写回原聊天文件：隐藏 system 楼层 + extra + 待写队列。 */
    async syncTurn(chat, turnId, messages) {
      const world = currentWorld(state);
      if (!world || state.phoneSurface !== 'world' || !chat || !turnId) return;
      if (!world.sourceChatFile && !world.sourceChatId) return;
      if (Array.isArray(chat.syncedTurnIds) && chat.syncedTurnIds.includes(turnId)) return;
      const text = formatTurnText(world, messages);
      if (!text) return;
      const payload = {
        turnId,
        chatId: chat.id,
        text,
        stamp: worldStamp(),
        storyDate: world.storyDate || '',
        at: Date.now(),
      };
      world.syncQueue = Array.isArray(world.syncQueue) ? world.syncQueue : [];
      world.syncQueue.push(payload);
      await api.flushPending(world, chat);
    },

    async flushPending(instance = currentWorld(state), chat = null) {
      const world = instance;
      if (!world || !Array.isArray(world.syncQueue) || !world.syncQueue.length) return;
      for (const item of world.syncQueue.slice()) {
        try {
          const result = await appendTavernHiddenFloor({
            chatId: world.sourceChatId,
            chatFile: world.sourceChatFile,
            text: item.text,
            extra: {
              worldPhoneId: world.id,
              worldKey: world.key,
              turnId: item.turnId,
              storyDate: item.storyDate,
              clock: item.stamp,
            },
          });
          if (!result?.ok) {
            if (result?.queued) break;
            throw new Error(result?.reason || '写回失败');
          }
          world.syncQueue = world.syncQueue.filter(entry => entry.turnId !== item.turnId);
          const target = chat || Object.values(state.chats || {}).find(entry => entry && entry.id === item.chatId);
          if (target) {
            if (!Array.isArray(target.syncedTurnIds)) target.syncedTurnIds = [];
            if (!target.syncedTurnIds.includes(item.turnId)) target.syncedTurnIds.push(item.turnId);
          }
          world.lastSyncAt = Date.now();
        } catch (error) {
          /* 目标聊天没在酒馆里打开时先留在队列，等下次激活这台手机再写。 */
          world.lastSyncError = error?.message || '写回失败';
          break;
        }
      }
      ctx.save();
    },
  };

  ctx.world = api;
  ensurePhoneWorlds(state);
  return api;
}

export function createWorldPhoneForTests(state, options) {
  ensurePhoneWorlds(state);
  return ensureInstance(state, options);
}

export function activateWorldForTests(state, id) {
  return activateInstance(state, state.worldPhones?.[id]);
}

export function activateMetaForTests(state) {
  return activateMeta(state);
}
