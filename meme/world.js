/**
 * meme-phone · 里世界聊天
 *
 * 不做整台手机翻面，也不是另一套通讯录：
 * 每一条里世界聊天就是一个普通会话，额外绑一个酒馆聊天文件。
 * - 打开它时读那一份酒馆聊天记忆；
 * - 时间显示剧情日期 + 现实钟点；
 * - 聊完写回原聊天文件的隐藏 system 楼层；
 * - 和「平行时空 / 番外」一样，一条聊天文件可以单独开一场，互不穿插。
 */

import { addChat, contactById, contactForTavernCharacter } from './data.js';
import { appendTavernHiddenFloor, readLatestTavernChat, readOpenTavernChat } from './host.js';

export function isWorldChat(chat) {
  return chat?.world?.kind === 'world';
}

export function worldMeta(chat) {
  return isWorldChat(chat) ? chat.world : null;
}

export function storyDateOf(chat) {
  return String(chat?.world?.storyDate || '第 1 天');
}

function storyDateFromMetadata(metadata) {
  const meta = metadata && typeof metadata === 'object' ? metadata : {};
  const own = meta.memePhone && typeof meta.memePhone === 'object'
    ? meta.memePhone
    : meta.meme_phone && typeof meta.meme_phone === 'object' ? meta.meme_phone : {};
  const value = own.storyDate || meta.meme_phone_story_date || meta.worldDate || '';
  return String(value || '').trim().slice(0, 30);
}

function findWorldChat(state, chatFile) {
  const file = String(chatFile || '').replace(/\.jsonl$/i, '');
  return Object.values(state.chats || {}).find(chat => (
    isWorldChat(chat)
    && String(chat.world.chatFile || '').replace(/\.jsonl$/i, '') === file
  )) || null;
}

function formatTurnText(chat, messages) {
  const owner = String(chat?.world?.ownerName || 'TA');
  const lines = (Array.isArray(messages) ? messages : [])
    .filter(item => item && !item.excluded)
    .map(item => {
      const who = item.from === 'me' ? (item.name || '我') : owner;
      const body = String(item.text || (item.image ? '［图片］' : '')).trim();
      return body ? `${who}：${body}` : '';
    })
    .filter(Boolean);
  return lines.slice(-8).join('\n');
}

function clockNow() {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function createWorldChat(state, { contact, ownerName, ownerAvatar, chatFile, chatId, storyDate, origin }) {
  if (!contact) return null;
  const existing = findWorldChat(state, chatFile);
  if (existing) return existing;
  const chat = addChat(state, contact.id, { messages: [] });
  chat.world = {
    kind: 'world',
    chatFile: String(chatFile || '').replace(/\.jsonl$/i, ''),
    chatId: String(chatId || ''),
    ownerName: String(ownerName || contact.name || 'TA'),
    ownerAvatar: String(ownerAvatar || contact.avatar || ''),
    storyDate: String(storyDate || '第 1 天').slice(0, 30),
    origin: String(origin || 'tavern'),
    createdAt: Date.now(),
    queue: [],
  };
  chat.updatedAt = Date.now();
  return chat;
}

function markDirty(ctx, chat) {
  chat.updatedAt = Date.now();
  ctx.save();
}

/* 同一个里世界会话同时只跑一个写回，避免同一轮被并发保存两次。 */
const flushingChats = new WeakSet();

export function installWorld(ctx) {
  const state = ctx.state;

  const api = {
    isWorldChat,
    meta: worldMeta,
    dateText(chat) { return isWorldChat(chat) ? storyDateOf(chat) : ''; },
    label(chat) {
      if (!isWorldChat(chat)) return '';
      return `里世界 · ${storyDateOf(chat)}`;
    },

    /** 当前停在哪条里世界聊天：状态栏的小标签用这个。 */
    active() {
      const stack = ctx.shell?.stack || [];
      const entry = stack[stack.length - 1];
      if (!entry || entry.view !== 'thread') return null;
      const chat = state.chats?.[entry.params?.chatId];
      return isWorldChat(chat) ? chat : null;
    },

    list() {
      return Object.values(state.chats || {})
        .filter(isWorldChat)
        .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    },

    /**
     * 只找当前酒馆聊天对应的里世界，不新建。
     * 打开手机时用这个：有就落进里世界；没有就回普通聊天列表，别凭空造一条空的把历史盖住。
     */
    async locateCurrent() {
      try {
        const host = await readOpenTavernChat();
        if (!host.available) return { available: false, chat: null, host: null };
        return { available: true, chat: findWorldChat(state, host.chatFile), host };
      } catch {
        return { available: false, chat: null, host: null };
      }
    },

    /** 在酒馆当前打开的那份聊天上开一条里世界聊天；同一份文件不会重复开。 */
    async createFromCurrent(options = {}) {
      const say = options.silent ? () => {} : message => ctx.toast(message);
      try {
        const host = await readOpenTavernChat();
        if (!host.available) {
          say(host.reason || '先在酒馆里打开一段聊天');
          return null;
        }
        const contactId = contactForTavernCharacter(state, {
          name: host.characterName || 'TA',
          tavernAvatar: host.characterAvatar || '',
        });
        const contact = contactById(state, contactId);
        if (!contact) {
          say('这个酒馆角色还没进通讯录');
          return null;
        }
        let chat = findWorldChat(state, host.chatFile);
        if (!chat) {
          chat = createWorldChat(state, {
            contact,
            ownerName: host.characterName,
            ownerAvatar: host.characterAvatar,
            chatFile: host.chatFile,
            chatId: host.chatId,
            storyDate: storyDateFromMetadata(host.metadata) || '第 1 天',
            origin: 'current-chat',
          });
          say(`里世界聊天已绑定《${host.chatFile || '当前聊天'}》`);
        } else if (!options.silent) {
          say('这条聊天已经有一场里世界了');
        }
        markDirty(ctx, chat);
        if (options.open !== false) {
          api.open(chat.id);
        }
        return chat;
      } catch (error) {
        say(error?.message || '里世界聊天没开成');
        return null;
      }
    },

    /** 从某个角色的资料 / Meta 会话行进：读 TA 最近一份酒馆聊天来开。 */
    async openForContact(contact, options = {}) {
      if (!contact) return null;
      try {
        const latest = await readLatestTavernChat({
          name: contact.name,
          avatar: contact.tavernAvatar || contact.avatar || '',
          floors: 0,
          includeMemory: true,
        });
        if (!latest?.available) {
          ctx.toast('没找到 TA 最近的酒馆聊天；先在酒馆打开一段');
          return null;
        }
        let chat = findWorldChat(state, latest.file);
        if (!chat) {
          chat = createWorldChat(state, {
            contact,
            ownerName: contact.name,
            ownerAvatar: contact.avatar,
            chatFile: latest.file,
            chatId: latest.chatId || latest.file,
            storyDate: storyDateFromMetadata(latest.metadata) || '第 1 天',
            origin: 'contact',
          });
          ctx.toast(`用 TA 最近的《${latest.file}》开了一场里世界聊天`);
        }
        markDirty(ctx, chat);
        if (options.open !== false) {
          api.open(chat.id);
        }
        return chat;
      } catch (error) {
        ctx.toast(error?.message || '里世界聊天没开成');
        return null;
      }
    },

    open(chatId) {
      const chat = state.chats?.[chatId];
      if (!isWorldChat(chat)) return false;
      if (ctx.shell) {
        ctx.shell.stack.length = 0;
        ctx.shell.sheet = null;
        ctx.shell.stack.push({ view: 'app-worldchat', params: {} });
        ctx.shell.stack.push({ view: 'thread', params: { chatId: chat.id } });
        ctx.rerender?.();
      } else {
        ctx.go('app-worldchat', {});
        ctx.go('thread', { chatId: chat.id });
      }
      return true;
    },

    editStoryDate(chatId) {
      const chat = state.chats?.[chatId] || api.active();
      if (!isWorldChat(chat)) return;
      ctx.openSheet({
        kind: 'form',
        title: '这条里世界聊天的剧情日期',
        note: '只影响这条聊天显示的日期；状态栏右边的钟点仍然跟现实走。',
        fields: [{
          name: 'storyDate',
          label: '剧情日期',
          value: storyDateOf(chat),
          placeholder: '例如 第 3 天 / 霜月十二日',
          maxLength: 30,
        }],
        confirm: '保存',
        onForm: values => {
          const next = String(values.storyDate || '').trim().slice(0, 30);
          chat.world.storyDate = next || '第 1 天';
          ctx.save();
          ctx.rerender();
          ctx.toast('剧情日期改好了');
        },
      });
    },

    /** 这一轮手机聊天写完，写回原聊天文件。 */
    async syncTurn(chat, turnId, messages) {
      if (!isWorldChat(chat) || !turnId) return;
      if (!chat.world.chatFile && !chat.world.chatId) return;
      if (Array.isArray(chat.syncedTurnIds) && chat.syncedTurnIds.includes(turnId)) return;
      const text = formatTurnText(chat, messages);
      if (!text) return;
      chat.world.queue = Array.isArray(chat.world.queue) ? chat.world.queue : [];
      if (chat.world.queue.some(item => item.turnId === turnId)) return;
      chat.world.queue.push({
        turnId,
        text,
        clock: clockNow(),
        storyDate: storyDateOf(chat),
        at: Date.now(),
      });
      await api.flush(chat);
    },

    async flush(chat) {
      if (!isWorldChat(chat)) return;
      if (flushingChats.has(chat)) return;
      flushingChats.add(chat);
      try {
        while (Array.isArray(chat.world.queue) && chat.world.queue.length) {
          const item = chat.world.queue[0];
          if (!item?.turnId) { chat.world.queue.shift(); continue; }
          const result = await appendTavernHiddenFloor({
            chatId: chat.world.chatId,
            chatFile: chat.world.chatFile,
            text: item.text,
            extra: {
              worldChatId: chat.id,
              worldPhoneKey: `world-chat:${chat.world.chatFile}:${chat.contactId}`,
              turnId: item.turnId,
              storyDate: item.storyDate,
              clock: item.clock,
            },
          });
          if (!result?.ok) {
            chat.world.lastSyncError = result?.reason || '写回失败';
            ctx.save();
            return;
          }
          chat.world.queue.shift();
          if (!Array.isArray(chat.syncedTurnIds)) chat.syncedTurnIds = [];
          if (!chat.syncedTurnIds.includes(item.turnId)) chat.syncedTurnIds.push(item.turnId);
          chat.world.lastSyncAt = Date.now();
          chat.world.lastSyncError = '';
        }
        ctx.save();
      } finally {
        flushingChats.delete(chat);
      }
    },
  };

  ctx.world = api;
  return api;
}

/** 测试用：不依赖酒馆宿主，直接在某个联系人上开一条里世界聊天。 */
export function createWorldChatForTests(state, { contact, ...info }) {
  return createWorldChat(state, {
    contact,
    ownerName: contact?.name,
    ownerAvatar: contact?.avatar,
    ...info,
  });
}
