/**
 * meme-phone · 宿主桥
 *
 * 只在酒馆里才存在的能力都收在这里：角色列表、当前聊天上下文、模型调用。
 * 每个入口都 try/catch，缺能力时降级，不把宿主异常带进界面。
 */

let hostScript = null;

import { estimateTokens } from './reply-context.js';
let hostScriptTried = false;

export async function loadHostScript() {
  if (hostScript) return hostScript;
  /* 先拿酒馆自己的上下文；窗口晚就绪时下次还能再试 */
  try {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (ctx && typeof ctx === 'object' && Object.keys(ctx).length) {
      hostScript = ctx;
      return hostScript;
    }
  } catch { hostScript = null; }
  if (hostScriptTried) return hostScript;
  hostScriptTried = true;
  /* 上下文拿不到才退回 import（桌面版里 import('/script.js') 可能拿到 HTML） */
  try {
    hostScript = await import('/script.js');
  } catch {
    hostScript = null;
  }
  return hostScript;
}

/** 仅供测试：清空模块级脚本缓存，隔离各用例。 */
export function __resetHostScriptForTests() {
  hostScript = null;
  hostScriptTried = false;
}

/**
 * 用酒馆当前分词器数一段正文；只计数，不请求模型。
 * 宿主没暴露分词器时返回 null，让调用方退回本地估算。
 */
export async function countTextTokens(text, timeoutMs = 3000) {
  const script = await loadHostScript();
  const hostCtx = globalThis.SillyTavern?.getContext?.() || script?.getContext?.() || {};
  const count = hostCtx?.getTokenCountAsync;
  if (typeof count !== 'function') return null;
  let timer = 0;
  try {
    const value = await Promise.race([
      Promise.resolve().then(() => count.call(hostCtx, String(text || ''), 0)),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('tokenizer timeout')), timeoutMs); }),
    ]);
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.ceil(number) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function isStandalone() {
  return Boolean(globalThis.__MEME_DEMO__) || !hostScript;
}

/** 角色列表 → 纯数据，供 data.syncTavernContacts 使用。 */
export async function readTavernCharacters() {
  const script = await loadHostScript();
  if (!script?.characters) return [];
  const thumbnail = script.getThumbnailUrl;
  return script.characters
    .filter(character => character && character.name)
    .map(character => ({
      name: character.name,
      tavernAvatar: character.avatar || character.name,
      avatarUrl: typeof thumbnail === 'function' && character.avatar && character.avatar !== 'none'
        ? thumbnail('avatar', character.avatar)
        : '',
    }));
}

/** 角色卡全文，供「查角色」用：描述、性格、场景、开场白都按卡片原样给。 */
export async function readTavernCards() {
  const script = await loadHostScript();
  if (!Array.isArray(script?.characters)) return [];
  const thumbnail = script.getThumbnailUrl;
  try {
    return script.characters
      .filter(character => character && character.name)
      .map(character => ({
        name: character.name,
        avatar: character.avatar || character.name,
        avatarUrl: typeof thumbnail === 'function' && character.avatar && character.avatar !== 'none'
          ? thumbnail('avatar', character.avatar)
          : '',
        description: character.description || '',
        personality: character.personality || '',
        scenario: character.scenario || '',
        firstMes: character.first_mes || '',
        example: character.mes_example || '',
        creatorNotes: character.creator_notes || '',
        creator: character.creator || '',
        version: character.character_version || '',
        tags: Array.isArray(character.tags) ? character.tags.map(String) : [],
      }));
  } catch {
    return [];
  }
}

/** 把酒馆世界书对象摊平成纯数据，条目按 order 排。 */
function normalizeBookEntries(data) {
  const entries = Object.entries(data?.entries || {}).map(([uid, entry]) => ({
    uid: String(entry?.uid ?? uid),
    title: String(entry?.comment || (Array.isArray(entry?.key) ? entry.key[0] : entry?.key) || `条目 ${uid}`),
    keys: Array.isArray(entry?.key) ? entry.key.map(String) : (entry?.key ? [String(entry.key)] : []),
    content: String(entry?.content || ''),
    disabled: Boolean(entry?.disable),
    constant: Boolean(entry?.constant),
    order: Number(entry?.order ?? 0),
  }));
  entries.sort((a, b) => a.order - b.order);
  return entries;
}

/**
 * 读一个角色关联的所有世界书（主书 + 附加书），把条目摊平成纯数据。
 * 角色书不是导出时那张卡里的副本，而是酒馆世界书里正在生效的那本。
 */
export async function readCharacterBooks(name) {
  const script = await loadHostScript();
  if (!script) return { available: false, books: [], reason: '没接上酒馆' };
  try {
    const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || {};
    const characters = Array.isArray(ctx.characters) ? ctx.characters : (script.characters || []);
    const character = characters.find(item => item?.name === String(name || '')) || null;
    if (!character) return { available: true, books: [], reason: '没找到这个角色' };

    const settings = ctx.getWorldInfoSettings?.() || script.getWorldInfoSettings?.() || {};
    let worldInfo = settings.world_info || script.world_info || {};
    /* 上下文没暴露 getWorldInfoSettings 时，charLore 只存在酒馆设置里 */
    if (!Array.isArray(worldInfo.charLore) && typeof fetch === 'function') {
      try {
        const headers = ctx.getRequestHeaders?.() || {};
        const response = await fetch('/api/settings/get', { method: 'POST', headers, body: '{}' });
        if (response.ok) {
          const saved = await response.json();
          const savedSettings = savedSettingsObject(saved);
          worldInfo = savedSettings.world_info_settings?.world_info || savedSettings.world_info || worldInfo;
        }
      } catch { /* 读不到附加书就只读主书 */ }
    }
    const file = String(character.avatar || '').replace(/\.[^/.]+$/, '');
    const primary = String(character.data?.extensions?.world || '').trim();
    const extra = (worldInfo.charLore || []).find(item => item?.name === file)?.extraBooks || [];

    const names = [...new Set([primary, ...extra.map(String)].filter(Boolean))];
    const load = ctx.loadWorldInfo || script.loadWorldInfo;
    if (typeof load !== 'function') return { available: true, books: [], reason: '酒馆没开放世界书读取' };

    const books = [];
    for (const bookName of names) {
      try {
        const data = await load(bookName);
        if (!data) { books.push({ name: bookName, entries: [], error: '这本没读到' }); continue; }
        books.push({ name: bookName, entries: normalizeBookEntries(data), error: '' });
      } catch (error) {
        books.push({ name: bookName, entries: [], error: error.message || '这本没读到' });
      }
    }
    return { available: true, books, reason: '' };
  } catch (error) {
    return { available: true, books: [], reason: error.message || String(error) };
  }
}

/**
 * 读一本指定的世界书（人设绑定用）。
 * 和 readCharacterBooks 共用摊平逻辑，读不到时给 available:false，让上层退回演示数据。
 */
export async function readWorldBook(bookName) {
  const name = String(bookName || '').trim();
  if (!name) return { available: false, name: '', entries: [], reason: '没填世界书名' };
  const script = await loadHostScript();
  if (!script) return { available: false, name, entries: [], reason: '没接上酒馆' };
  try {
    const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || {};
    const load = ctx.loadWorldInfo || script.loadWorldInfo;
    if (typeof load !== 'function') return { available: false, name, entries: [], reason: '酒馆没开放世界书读取' };
    const data = await load(name);
    if (!data) return { available: true, name, entries: [], reason: '这本世界书没读到' };
    return { available: true, name, entries: normalizeBookEntries(data), reason: '' };
  } catch (error) {
    return { available: false, name, entries: [], reason: error.message || String(error) };
  }
}

/** 开 / 关一条世界书条目，直接写回酒馆世界书。 */
export async function setWorldEntryEnabled(bookName, uid, disabled) {
  const script = await loadHostScript();
  if (!script) return { ok: false, reason: '没接上酒馆' };
  try {
    const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || {};
    const load = ctx.loadWorldInfo || script.loadWorldInfo;
    const save = ctx.saveWorldInfo || script.saveWorldInfo;
    if (typeof load !== 'function' || typeof save !== 'function') {
      return { ok: false, reason: '酒馆没开放世界书写入' };
    }
    const data = await load(bookName);
    if (!data?.entries) return { ok: false, reason: '这本世界书没读到' };
    const key = Object.keys(data.entries).find(item => String(data.entries[item]?.uid ?? item) === String(uid));
    if (!key) return { ok: false, reason: '这条目已经不在了' };
    data.entries[key].disable = Boolean(disabled);
    await save(bookName, data, true);
    return { ok: true, disabled: Boolean(disabled) };
  } catch (error) {
    return { ok: false, reason: error.message || String(error) };
  }
}

/** 当前打开的酒馆聊天，用来给日记、主动消息提供素材。 */
/** 酒馆在没选角色时 name2 就是个系统占位名，绝不能拿它当角色名显示。 */
const PLACEHOLDER_NAME = /^sillytavern(\s+system)?$/i;

function charactersList(script) {
  const raw = script?.characters;
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (raw && typeof raw === 'object') return Object.values(raw).filter(Boolean);
  return [];
}

/**
 * 找当前角色：不同版本 / 桌面端的 id 口径不一样（数字下标、avatar 串、名字），
 * 逐个试，最后按「当前打开的聊天文件」认领，别一失手就落到 name2 的占位名上。
 */
export function resolveTavernCharacter(script) {
  const list = charactersList(script);
  if (!list.length) return null;
  const ids = [script?.characterId, script?.this_chid, script?.chid]
    .filter(value => value !== undefined && value !== null && value !== '');
  for (const id of ids) {
    const numeric = typeof id === 'number' ? id : (/^\d+$/.test(String(id)) ? Number(id) : NaN);
    if (Number.isInteger(numeric) && list[numeric]) return list[numeric];
    const text = String(id);
    const bare = text.replace(/\.(png|jpe?g|webp)$/i, '');
    const hit = list.find(item => {
      const avatar = String(item?.avatar || '');
      return avatar === text || avatar.replace(/\.(png|jpe?g|webp)$/i, '') === bare || String(item?.name || '') === text;
    });
    if (hit) return hit;
  }
  const chatId = String(script?.getCurrentChatId?.() || script?.chatId || '').replace(/\.jsonl$/i, '');
  if (chatId) {
    const hit = list.find(item => String(item?.chat || '').replace(/\.jsonl$/i, '') === chatId);
    if (hit) return hit;
  }
  return null;
}

/** 聊天文件名 → 角色名：`沈砚 - 2026-11-10@22h10m.jsonl` → 沈砚。 */
export function tavernNameFromChatFile(file) {
  const bare = String(file || '').replace(/\.jsonl$/i, '').trim();
  if (!bare) return '';
  const dated = bare.match(/^(.*?)\s-\s\d{4}-\d{1,2}-\d{1,2}@/);
  if (dated) return dated[1].trim();
  const cut = bare.split(' - ')[0].trim();
  if (cut && cut !== bare) return cut;
  return '';
}

/** 角色名口径：角色卡 → 酒馆当前 name2（去掉系统占位名）→ 聊天文件名 → 最后一句角色发言。 */
export function resolveTavernName(script, character, chatFile = '', chat = []) {
  const name = String(character?.name || '').trim();
  if (name && !PLACEHOLDER_NAME.test(name)) return name;
  const fallback = String(script?.name2 || '').trim();
  if (fallback && !PLACEHOLDER_NAME.test(fallback) && fallback !== String(script?.name1 || '')) return fallback;
  const fromFile = tavernNameFromChatFile(chatFile);
  if (fromFile) return fromFile;
  const lines = Array.isArray(chat) ? chat : [];
  const last = [...lines].reverse().find(line => line && !line.is_user && line.name);
  return String(last?.name || 'TA');
}

export async function readTavernContext() {
  const script = await loadHostScript();
  if (!script) return {
    userName: '我', chat: [], characterName: '', characterAvatar: '',
    chatFile: '', chatId: '', metadata: null,
  };
  try {
    const userName = script.name1 || script.getContext?.()?.name1 || '我';
    const chat = Array.isArray(script.chat) ? script.chat.map(line => ({
      isUser: Boolean(line.is_user),
      name: line.name || (line.is_user ? userName : ''),
      text: line.mes || '',
      at: line.send_date || '',
    })) : [];
    const character = resolveTavernCharacter(script);
    const rawChat = Array.isArray(script.chat) ? script.chat : [];
    const chatFile = String(character?.chat || '');
    return {
      userName,
      chat,
      characterName: resolveTavernName(script, character, chatFile || String(script.getCurrentChatId?.() || ''), rawChat),
      characterAvatar: character?.avatar || '',
      chatFile,
      chatId: String(script.getCurrentChatId?.() || script.chatId || ''),
      metadata: script.chatMetadata || null,
    };
  } catch {
    return {
      userName: '我', chat: [], characterName: '', characterAvatar: '',
      chatFile: '', chatId: '', metadata: null,
    };
  }
}

async function hostRequestHeaders(script) {
  const ctx = globalThis.SillyTavern?.getContext?.() || script?.getContext?.() || {};
  const getHeaders = ctx.getRequestHeaders || script?.getRequestHeaders;
  const headers = typeof getHeaders === 'function' ? { ...getHeaders() } : {};
  if (!headers['X-CSRF-Token']) {
    const token = ctx.csrf_token || globalThis.csrf_token || '';
    if (token) headers['X-CSRF-Token'] = token;
  }
  headers['Content-Type'] = 'application/json';
  return headers;
}

function latestScore(item) {
  const raw = item?.last_mes ?? item?.lastMes ?? item?.mtime ?? item?.last_modified ?? item?.file_name ?? '';
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000;
  const text = String(raw);
  const time = Date.parse(text);
  if (Number.isFinite(time)) return time;
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})[^\d](\d{2})[^\d](\d{2})(?:[^\d](\d{2}))?/);
  if (match) {
    return Date.UTC(
      Number(match[1]), Number(match[2]) - 1, Number(match[3]),
      Number(match[4]), Number(match[5]), Number(match[6] || 0),
    );
  }
  return 0;
}

/**
 * 这个角色在酒馆里关联的最新聊天。
 * 先问酒馆的聊天文件列表，挑最近一条；列表读不到就退回角色卡上的当前聊天文件。
 */
export async function readLatestTavernChat({
  name = '', avatar = '', floors = 10, includeMemory = false, file = '', chatId = '',
} = {}) {
  const script = await loadHostScript();
  const empty = {
    available: false, file: '', chatId: '', characterName: name,
    lines: [], total: 0, metadata: null, messages: [],
  };
  if (!script || !Array.isArray(script.characters)) return empty;
  const character = script.characters.find(item => item && avatar && item.avatar === avatar)
    || script.characters.find(item => item && item.name === name);
  if (!character) return empty;

  const headers = await hostRequestHeaders(script);
  let pickedFile = String(file || '').replace(/\.jsonl$/i, '').trim();
  let latestMeta = null;

  /* 指定了具体聊天文件（某条同层小手机）就不去猜“最新”：读的就是这一份。 */
  if (!pickedFile) {
    try {
      const response = await fetch('/api/characters/chats', {
        method: 'POST',
        headers,
        body: JSON.stringify({ avatar_url: character.avatar || character.name }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        const list = Array.isArray(data) ? data : Object.values(data && typeof data === 'object' ? data : {});
        const sorted = list
          .filter(item => item && typeof item === 'object' && (item.file_name || item.fileName))
          .map(item => ({ ...item, file_name: item.file_name || item.fileName }))
          .sort((a, b) => latestScore(b) - latestScore(a));
        if (sorted.length) {
          pickedFile = sorted[0].file_name;
          latestMeta = sorted[0];
        }
      }
    } catch { /* 列表接口不可用就继续用角色卡上的 chat */ }
  } else {
    pickedFile = String(pickedFile).replace(/\.jsonl$/i, '');
  }
  if (!pickedFile) pickedFile = String(character.chat || '').trim();

  let raw = [];
  let metadata = null;
  if (pickedFile) {
    try {
      const response = await fetch('/api/chats/get', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ch_name: character.name,
          file_name: String(pickedFile).replace(/\.jsonl$/i, ''),
          avatar_url: character.avatar || character.name,
        }),
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (response.ok) {
        const data = await response.json().catch(() => null);
        if (Array.isArray(data)) raw = data;
        else if (Array.isArray(data?.messages)) raw = data.messages;
        else if (Array.isArray(data?.chat)) raw = data.chat;
        metadata = data?.metadata || data?.chat_metadata || null;
      }
    } catch { raw = []; }
  }

  const currentKey = String(character.chat || '').replace(/\.jsonl$/i, '');
  if (!raw.length && script.characters?.[script.this_chid]?.avatar === character.avatar
    && Array.isArray(script.chat) && (!pickedFile || pickedFile === currentKey)) {
    raw = script.chat;
    pickedFile = String(character.chat || '当前聊天');
    metadata = script.chatMetadata || null;
  }

  /* 聊天文件第一行是 metadata header（含 chat_metadata）；接口会原样返回它。 */
  const header = raw.find(line => line && typeof line === 'object' && line.chat_metadata && typeof line.chat_metadata === 'object');
  if (header?.chat_metadata) metadata = header.chat_metadata;

  const floorCount = Number(floors);
  const floorLimit = Number.isFinite(floorCount) && floorCount > 0 ? Math.floor(floorCount) : 0;
  let lines = raw
    .filter(line => line && !line.is_system && typeof line.mes === 'string' && line.mes.trim())
    .map(line => ({
      isUser: Boolean(line.is_user),
      name: line.name || (line.is_user ? (script.name1 || '你') : character.name),
      text: line.mes.trim(),
    }));
  /* floors <= 0 表示这层不截断：把聊天文件里的全部楼层都带上。 */
  if (floorLimit > 0) lines = lines.slice(-floorLimit);

  return {
    available: Boolean(lines.length),
    file: pickedFile || '',
    chatId: String(chatId || pickedFile || ''),
    characterName: character.name,
    lines,
    total: raw.length,
    meta: latestMeta,
    metadata: includeMemory ? metadata : null,
    messages: includeMemory ? raw : [],
  };
}

/**
 * 把同层小手机的一轮对话写回原聊天文件。
 *
 * 写法是「隐藏 system 楼层 + message.extra.memePhone」：
 * - 不新增 user 楼层，聊天里不会多出一条“我”说的话；
 * - 不追加到上一条正文，避免把原聊天最后一段改脏；
 * - system 楼层在酒馆界面默认不显示，也不会被当成角色发言；
 * - extra 里带 worldPhoneId / turnId / 剧情日期，手机下次可以按 turnId 去重。
 *
 * 目标聊天没在酒馆里打开时返回 queued，由世界层留在队列里等下次。
 */
export async function appendTavernHiddenFloor({
  chatId = '', chatFile = '', text = '', extra = {},
} = {}) {
  const script = await loadHostScript();
  if (!script) return { ok: false, queued: false, reason: '不在酒馆里，写不回聊天文件' };
  const chat = Array.isArray(script.chat) ? script.chat : null;
  if (!chat) return { ok: false, queued: false, reason: '拿不到酒馆当前聊天' };
  const currentId = String(script.getCurrentChatId?.() || script.chatId || '');
  const currentCharacter = resolveTavernCharacter(script);
  const currentFile = String(currentCharacter?.chat || (currentId ? (/\.jsonl$/i.test(currentId) ? currentId : '') : ''));
  const expectedId = String(chatId || '');
  const expectedFile = String(chatFile || '').replace(/\.jsonl$/i, '');
  const currentFileKey = currentFile.replace(/\.jsonl$/i, '');
  if (expectedId && currentId && expectedId !== currentId && !expectedFile) {
    return { ok: false, queued: true, reason: '目标聊天没打开' };
  }
  if (expectedFile && currentFileKey && expectedFile !== currentFileKey) {
    return { ok: false, queued: true, reason: '目标聊天文件没打开' };
  }
  if (!expectedId && !expectedFile) return { ok: false, queued: true, reason: '没有绑定聊天文件' };

  const ctx = globalThis.SillyTavern?.getContext?.() || script;
  const save = typeof ctx.saveChat === 'function' ? ctx.saveChat.bind(ctx)
    : typeof script.saveChat === 'function' ? script.saveChat.bind(script)
      : null;
  if (!save) return { ok: false, queued: false, reason: '酒馆没有提供 saveChat' };

  const floor = {
    name: 'meme-phone',
    is_user: false,
    is_system: true,
    mes: String(text || ''),
    send_date: new Date().toISOString(),
    extra: {
      memePhone: {
        version: 1,
        ...extra,
        text: String(text || ''),
      },
    },
  };
  chat.push(floor);
  try {
    await save();
    return { ok: true, queued: false, floor };
  } catch (error) {
    /* 保存失败就把刚推入的楼层撤掉，别让内存和文件不一致。 */
    const index = chat.indexOf(floor);
    if (index >= 0) chat.splice(index, 1);
    return { ok: false, queued: false, reason: error?.message || '保存聊天失败' };
  }
}

export async function readUserAvatar() {
  try {
    const script = await loadHostScript();

    if (script?.user_avatar && typeof script.getThumbnailUrl === 'function') {
      return script.getThumbnailUrl('persona', script.user_avatar);
    }
    /* 不再 import('/scripts/personas.js')：那条路径在桌面版里会拿到 HTML，
       解析时抛 SyntaxError，改用上下文里的真人设头像 */
    const ctx = globalThis.SillyTavern?.getContext?.() || {};
    const name = ctx.name1 || script?.name1 || '';
    const avatars = ctx.power_user?.persona_avatars || {};
    const file = avatars?.[name];
    if (file && typeof script?.getThumbnailUrl === 'function') {
      return script.getThumbnailUrl('persona', file);
    }
  } catch { /* 没有头像就退回首字母色块 */ }
  return '';
}

/**
 * 生成一段文字。
 * 传了具体接口预设时先走那套地址 / Key / 模型；没传、是酒馆 API，或那套没填地址时走宿主。
 * 真机上走宿主 generateQuietPrompt；预览环境返回演示文案并标记 demo=true。
 */
/**
 * 酒馆的 generateQuietPrompt 只吃一段文本，这里统一把消息列表摊平。
 * 预览页也调这个函数，保证预览里「酒馆扁平文本」和真机发出的完全一致。
 */
export function tavernQuietPrompt(messages, system = '', prompt = '') {
  const messageText = Array.isArray(messages) && messages.length
    ? messages.map(message => {
      const role = message?.role === 'assistant' ? '[角色示例]' : '';
      return [role, String(message?.content || '')].filter(Boolean).join('\n');
    }).filter(Boolean).join('\n\n')
    : '';
  return [
    system ? `【回复要求】\n${String(system)}` : '',
    messageText || String(prompt || ''),
  ].filter(Boolean).join('\n\n');
}

function abortError() {
  const error = new Error('已停止这次生成');
  error.name = 'AbortError';
  return error;
}

/**
 * 借酒馆当前的模型 / 连接，但只发小手机自己组装好的 messages。
 * 走 `generateRaw`：酒馆侧不再组装角色卡 / 世界书 / 酒馆预设 / 聊天历史，
 * 跟 `generateQuietPrompt`（整段安静提示，酒馆自己拼全套上下文）严格分开——
 * 后者只留给平行时空分支那一条链路。
 */
async function tavernRawCompletion(script, { messages, system, prompt }) {
  const raw = script?.generateRaw || globalThis.SillyTavern?.getContext?.()?.generateRaw;
  if (typeof raw !== 'function') return '';
  const outgoing = (Array.isArray(messages) ? messages : [])
    .filter(message => message && String(message.content || '').trim())
    .map(message => ({
      role: ['system', 'user', 'assistant'].includes(message.role) ? message.role : 'system',
      content: String(message.content).trim(),
    }));
  if (!outgoing.length && system) outgoing.push({ role: 'system', content: String(system).trim() });
  if (!outgoing.length) outgoing.push({ role: 'user', content: String(prompt || '').trim() });
  const text = await raw({ prompt: outgoing, systemPrompt: '' });
  return typeof text === 'string' ? text : String(text ?? '');
}

export async function generate({ prompt, system = '', messages = null, demoReply = '', preset = null, demo = false, signal = null }) {
  if (signal?.aborted) throw abortError();
  const script = await loadHostScript();
  const isCustom = Boolean(preset && preset.engine !== 'tavern' && String(preset.url || '').trim());

  /* 自定义接口：失败 / 超时 / 空返回都把原错误抛出来，不静默退回酒馆模型。 */
  if (isCustom) {
    const text = await presetCompletion(preset, { prompt, system, messages, signal });
    if (signal?.aborted) throw abortError();
    if (!text) throw new Error('这套接口没有返回内容');
    return { text, demo: false, provider: preset.engine || 'custom' };
  }

  if (script) {
    const rawText = await tavernRawCompletion(script, { messages, system, prompt });
    if (signal?.aborted) throw abortError();
    if (typeof rawText === 'string' && rawText.trim()) return { text: rawText.trim(), demo: false, provider: 'tavern' };
    return { text: '', demo: false, error: '模型没有返回内容', provider: 'tavern' };
  }

  /* 演示模式才允许返回演示文案；正式宿主断连时不拿假回复冒充真实角色回复。 */
  if (demo) return { text: demoReply, demo: true, provider: 'demo' };
  return { text: '', demo: false, error: '宿主不可用，没有可用模型', provider: 'none' };
}

/**
 * 当前打开的那个酒馆聊天文件 —— 平行时空从这里分叉。
 *
 * 只记「分叉点」（chatId + 楼层数），**不复制整份 chat**：
 * 大聊天（几十 MB）深拷贝 + 落盘会把小手机撑爆（保存时结构化克隆/序列化直接闪退）。
 * 生成那一刻再从酒馆当前的 chat 里取前 forkFloor 层，楼层对象是酒馆原样（柏宝书的
 * bbs_leaf 就挂在消息的 extra 上），所以分支里读到的是同一套记忆。
 */
export async function readOpenTavernChat() {
  const script = await loadHostScript();
  const empty = {
    available: false, reason: '', characterName: '', characterAvatar: '', chatFile: '', chatId: '',
    presetName: '', forkFloor: 0, snapshot: 'live', base: [], memory: { engine: '', text: '', coverage: null },
    metadata: null,
  };
  if (!script) return { ...empty, reason: '不在酒馆里，读不到聊天文件' };
  const chat = Array.isArray(script.chat) ? script.chat : [];
  if (!chat.length) return { ...empty, reason: '酒馆里还没有打开聊天' };
  const character = resolveTavernCharacter(script);
  const currentId = String(script.getCurrentChatId?.() || script.chatId || '');
  const chatFile = String(character?.chat || (/\.jsonl$/i.test(currentId) ? currentId : ''));
  return {
    available: true,
    reason: '',
    characterName: resolveTavernName(script, character, chatFile, chat),
    characterAvatar: String(character?.avatar || ''),
    chatFile,
    chatId: currentId,
    presetName: String(script.chatCompletionSettings?.preset_settings_openai || ''),
    forkFloor: chat.length,
    snapshot: 'live',
    base: [],
    memory: readTavernMemory(),
    metadata: script.chatMetadata || null,
  };
}

/**
 * 酒馆记忆的注入口径：
 * 装了柏宝书就用它算出来的总结（只读），没装就是空 —— 那种情况按酒馆默认读原文。
 */
export function readTavernMemory() {
  try {
    const api = globalThis.STBaiBaiBook;
    if (!api || typeof api.getInjectedHistory !== 'function') return { engine: '', text: '', coverage: null };
    const result = api.getInjectedHistory();
    return {
      engine: 'baibai',
      text: String(result?.relativeText || '').trim(),
      coverage: result?.coverage || null,
    };
  } catch {
    return { engine: '', text: '', coverage: null };
  }
}

/** 分支里的一条消息 → 酒馆 floor 对象。 */
function toTavernFloor(message, fallbackName = '') {
  const floor = {
    is_user: Boolean(message?.is_user),
    name: String(message?.name || (message?.is_user ? '' : fallbackName)),
    mes: String(message?.mes ?? message?.text ?? ''),
    send_date: String(message?.send_date || ''),
  };
  /* 快照里带过来的 extra 原样保留（柏宝书的 leaf 在这里） */
  if (message?.extra && typeof message.extra === 'object') floor.extra = message.extra;
  if (!floor.send_date) floor.send_date = new Date().toISOString();
  return floor;
}

/**
 * 平行时空的一次生成：把酒馆的 chat 临时换成「背景楼层 + 这一场新说的话」，
 * 交给酒馆自己的 generateQuietPrompt 去组装（预设 / 角色卡 / 世界书 / 记忆都是酒馆那套），
 * 拿到回复后无论是在哪个分支点出错，都把真实聊天原样放回去，且一个字都不写进聊天文件。
 *
 * 背景有三种口径（theater.cfg.historyMode）：
 * - fork（默认）：分叉点之前的楼层。旧存档里有内联快照就直接用，没有就按 chatId + forkFloor 现取；
 * - recent：酒馆当前聊天的最后 N 层，适合「不想要开头、只要最近的上下文」；
 * - none：不给背景，只带这一场自己说的话。
 *
 * 记忆口径（theater.cfg.memoryMode）：
 * - tavern（默认）：酒馆自己注入它当下的记忆，分叉点之后酒馆继续聊的内容会影响这一场；
 * - fixed：额外把开这一场时柏宝书的总结固定塞进 quiet prompt，让这一场不再随酒馆漂移。
 *
 * 同一时间只允许一场生成：ctx.chat 是全局的那一份，两场一起换会互相踩踏。
 */
let branchBusyId = '';

/** 平行时空一轮生成的死线：酒馆 quiet 生成没有流式，卡住时只能靠这个兜底。 */
export const BRANCH_TIMEOUT_MS = 180000;

/**
 * 按酒馆的上下文窗口从最新往回裁背景楼层：酒馆自己也会裁，这里先裁掉能省下整段
 * 提示词组装和世界书扫描的时间（几百楼的聊天能差好几分钟）。
 * 返回 { floors, total, used, trimmed, budget }。
 */
export function trimFloorsToBudget(floors, ctx) {
  const list = Array.isArray(floors) ? floors : [];
  const maxContext = Number(ctx?.maxContext || 0) || 8192;
  const budget = Math.max(1500, Math.min(Math.round(maxContext * 0.55), 24000));
  let used = 0;
  let start = list.length;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const cost = estimateTokens(list[index]?.mes || '') + 8;
    if (used + cost > budget && start < list.length) break;
    used += cost;
    start = index;
  }
  return {
    floors: list.slice(start),
    total: list.length,
    used,
    budget,
    trimmed: start > 0,
  };
}

/**
 * 生成期间临时摘掉这个角色绑的世界书（主书 extensions.world + charLore 附加书），
 * 结束后原样放回。只动内存里的引用，不写酒馆设置、不碰世界书文件。
 * 摘不掉（找不到角色或酒馆没暴露）时返回空还原函数，照常带书生成。
 */
function suspendCharacterBooks(ctx, script, characterName) {
  const restores = [];
  try {
    const characters = Array.isArray(ctx.characters) ? ctx.characters
      : Array.isArray(script.characters) ? script.characters : [];
    const name = String(characterName || '').trim();
    const character = name ? characters.find(item => String(item?.name || '') === name) || null : null;
    const ext = character?.data?.extensions;
    if (ext && String(ext.world || '').trim()) {
      const saved = ext.world;
      ext.world = '';
      restores.push(() => { ext.world = saved; });
    }
    const avatar = String(character?.avatar || '');
    const file = avatar.replace(/\.[^/.]+$/, '');
    if (file) {
      /* world_info 在酒馆里是同一个对象，试着从上下文和宿主脚本各拿一次 */
      const holders = [];
      try { holders.push(ctx.getWorldInfoSettings?.()?.world_info); } catch { /* 拿不到就跳过 */ }
      holders.push(script.world_info);
      for (const worldInfo of holders) {
        const lore = worldInfo?.charLore;
        if (!Array.isArray(lore)) continue;
        const entry = lore.find(item => item?.name === file || item?.name === avatar);
        if (entry && Array.isArray(entry.extraBooks) && entry.extraBooks.length) {
          const saved = entry.extraBooks;
          entry.extraBooks = [];
          restores.push(() => { entry.extraBooks = saved; });
        }
      }
    }
  } catch { /* 摘书失败就按原样带书生成 */ }
  return () => {
    for (const restore of restores) {
      try { restore(); } catch { /* 放回失败不阻塞本轮 */ }
    }
  };
}

export function branchGenerating() {
  return branchBusyId;
}

export async function branchReply({
  base = [], branch = [], characterName = '', chatId = '', chatFile = '', forkFloor = 0, cfg = null, memory = null,
} = {}) {
  const script = await loadHostScript();
  const ctx = globalThis.SillyTavern?.getContext?.() || script;
  if (!ctx || typeof ctx.generateQuietPrompt !== 'function') throw new Error('酒馆的生成接口不可用');
  const hostChat = ctx.chat;
  if (!Array.isArray(hostChat)) throw new Error('拿不到酒馆的当前聊天');

  const mode = cfg && typeof cfg === 'object' ? String(cfg.historyMode || 'fork') : 'fork';
  const historyFloors = Math.min(200, Math.max(1, Math.round(Number(cfg?.historyFloors) || 30)));
  const memoryMode = String(cfg?.memoryMode || 'tavern');
  const extraPrompt = String(cfg?.extraPrompt || '').trim();

  let baseFloors = [];
  if (mode === 'none') {
    baseFloors = [];
  } else if (mode === 'fork' && Array.isArray(base) && base.length) {
    /* 旧存档里的内联快照：只做浅拷贝，文本不复制 */
    baseFloors = base.map(item => ({ ...item }));
  } else {
    const expected = String(chatId || '');
    const current = String(ctx.getCurrentChatId?.() || ctx.chatId || '');
    if (expected && current && expected !== current) {
      throw new Error('这一场绑的是另一个聊天文件，先在酒馆打开它再发');
    }
    const wantFile = String(chatFile || '').replace(/\.jsonl$/i, '');
    const currentFile = String(resolveTavernCharacter(ctx)?.chat || current).replace(/\.jsonl$/i, '');
    if (wantFile && currentFile && wantFile !== currentFile) {
      throw new Error(`这一场接的是《${wantFile}》，酒馆现在开的是《${currentFile}》，先在酒馆打开原本那个聊天`);
    }
    if (mode === 'recent') {
      const count = Math.min(historyFloors, hostChat.length);
      if (!count) throw new Error('酒馆当前聊天是空的，这一场没有可以接着说的上下文');
      baseFloors = hostChat.slice(hostChat.length - count).map(item => ({ ...item }));
    } else {
      const count = Number(forkFloor) || 0;
      if (!count || count > hostChat.length) {
        throw new Error(`酒馆当前聊天只有 ${hostChat.length} 层，接不上这一场的第 ${count} 楼；可以在这一场的设置里跟到最新楼层`);
      }
      baseFloors = hostChat.slice(0, count).map(item => ({ ...item }));
    }
  }
  if (!baseFloors.length && !branch.length) throw new Error('这一场还没有可以接着说的上下文');

  /* 背景按酒馆的上下文窗口截一段：几百楼的聊天整包塞进去，酒馆光组装提示词就要好几分钟，
     手机端还会把整个界面卡住。酒馆自己也会从最新往回裁，这里先按同样口径裁掉，结果一样、快得多。 */
  const background = trimFloorsToBudget(baseFloors, ctx);

  /* quiet prompt：固定记忆 + 这一场自己的额外指令；都没有就保持空串，纯靠聊天历史 */
  const quietParts = [];
  if (memoryMode === 'fixed' && String(memory?.text || '').trim()) {
    quietParts.push(`[这一场分叉时的记忆]\n${String(memory.text).trim()}`);
  }
  if (extraPrompt) quietParts.push(extraPrompt);
  const quietPrompt = quietParts.join('\n\n');

  if (branchBusyId) throw new Error('另一场还在生成，等它写完再发');

  const backup = hostChat.slice();
  const temp = [...background.floors, ...branch.map(item => toTavernFloor(item, characterName))];
  const eventSource = ctx.eventSource;
  const promptEvent = ctx.eventTypes?.CHAT_COMPLETION_PROMPT_READY;
  let captured = null;
  const onPrompt = (data) => {
    if (!captured && Array.isArray(data?.chat)) captured = data.chat;
  };
  /* 逐条 push，不用 splice(...temp)：几万楼的聊天会把参数展开撑爆调用栈 */
  const replaceFloors = (next) => {
    hostChat.splice(0, hostChat.length);
    for (const floor of next) hostChat.push(floor);
  };
  branchBusyId = String(chatId || chatFile || 'branch');
  /* 这一场关掉了角色世界书：生成期间把主书和附加书摘掉，结束后放回 */
  const restoreBooks = cfg && typeof cfg === 'object' && cfg.showWorldBook === false
    ? suspendCharacterBooks(ctx, script, characterName)
    : null;
  const startedAt = Date.now();
  const timeoutMs = Math.min(600000, Math.max(1000, Number(cfg?.timeoutMs) || BRANCH_TIMEOUT_MS));
  let timer = null;
  /* 酒馆的 quiet 生成不走流式，界面上只有我们自己转的圈；接口真卡住时 Promise 会一直悬着。
     这里加一道死线：到点停掉酒馆这一轮、把聊天还原，再把原因交回界面，别让人对着圈发呆。 */
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { stopTavernGeneration(); } catch { /* 没有停止入口就等它自己断 */ }
      reject(new Error('酒馆 3 分钟没有回包，已经替你停了；可以重试，或把背景换成「最近一段」再试'));
    }, timeoutMs);
  });
  try {
    if (promptEvent && eventSource?.on) eventSource.on(promptEvent, onPrompt);
    replaceFloors(temp);
    const text = await Promise.race([
      ctx.generateQuietPrompt({ quietPrompt, quietName: null }),
      deadline,
    ]);
    console.debug(`[meme-phone] 平行时空生成完成：${Date.now() - startedAt}ms，背景 ${temp.length} 楼`);
    return { text: String(text ?? '').trim(), prompt: captured, quietPrompt, background };
  } finally {
    if (timer) clearTimeout(timer);
    restoreBooks?.();
    replaceFloors(backup);
    branchBusyId = '';
    if (promptEvent && eventSource?.removeListener) eventSource.removeListener(promptEvent, onPrompt);
    /* 生成期间界面看到的是临时聊天，还原后让酒馆按真实聊天重画一遍 */
    try { eventSource?.emit?.(ctx.eventTypes?.CHAT_CHANGED, ctx.chatId); } catch { /* 重画失败不影响数据 */ }
  }
}

/** 让酒馆自己停下这一轮生成（和点酒馆的停止按钮同一条路径）。 */
export function stopTavernGeneration() {
  try {
    const ctx = globalThis.SillyTavern?.getContext?.();
    if (typeof ctx?.stopGeneration === 'function') {
      ctx.stopGeneration();
      return true;
    }
  } catch { /* 没有停止入口就交给超时 */ }
  return false;
}

/**
 * 酒馆 custom 源会在 custom_url 后面自己补 /chat/completions，
 * 这里统一把用户填的 Base URL / Path 收成“只到 /v1”的根，避免拼成
 * .../v1/chat/completions/chat/completions。
 */
export function chatCompletionsRoot(url, path = '') {
  let base = String(url || '').trim().replace(/\/+$/, '');
  let route = String(path || '').trim();
  if (/^https?:\/\//i.test(route)) {
    base = route.replace(/\/+$/, '');
    route = '';
  }
  base = base
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
  route = route
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/models$/i, '');
  if (!base) return route || '/v1';
  if (!route) route = '/v1';
  if (base.endsWith(route)) return base;
  if (route.startsWith('/v1') && /\/v1$/i.test(base)) return base;
  return `${base}${route.startsWith('/') ? route : `/${route}`}`;
}

/** 借酒馆后端请求一套自定义 OpenAI 兼容接口，避开浏览器 CORS。 */
async function presetCompletion(preset, { prompt, system, messages, signal = null }) {
  if (signal?.aborted) throw abortError();
  const script = await loadHostScript();
  if (!script) return '';
  const root = chatCompletionsRoot(preset.url, preset.path);
  const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || {};
  const getHeaders = ctx.getRequestHeaders || script.getRequestHeaders;
  const headers = typeof getHeaders === 'function' ? { ...getHeaders() } : {};
  if (!headers['X-CSRF-Token']) {
    const token = ctx.csrf_token || globalThis.csrf_token || '';
    if (token) headers['X-CSRF-Token'] = token;
  }
  headers['Content-Type'] = 'application/json';

  /* 全量发送：组装阶段已经决定哪些内容进上下文，出站时不再按条数二次裁剪。 */
  const outgoing = Array.isArray(messages) && messages.length
    ? messages
      .filter(message => message && String(message.content || '').trim())
      .map(message => ({
        role: ['system', 'user', 'assistant'].includes(message.role) ? message.role : 'system',
        content: String(message.content).trim(),
      }))
    : [];
  if (!outgoing.length) {
    if (system) outgoing.push({ role: 'system', content: String(system) });
    outgoing.push({ role: 'user', content: String(prompt || '') });
  }
  const body = {
    chat_completion_source: 'custom',
    custom_url: root,
    custom_include_headers: preset.key ? JSON.stringify({ Authorization: `Bearer ${preset.key}` }) : '',
    reverse_proxy: root,
    proxy_password: String(preset.key || ''),
    model: String(preset.model || ''),
    messages: outgoing,
    temperature: typeof preset.temp === 'number' ? preset.temp : 0.8,
    stream: false,
  };
  const response = await fetch('/api/backends/chat-completions/generate', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store',
    signal,
  });
  if (signal?.aborted) throw abortError();
  if (!response.ok) throw new Error(`接口返回 ${response.status}`);
  const data = await response.json().catch(() => null);
  if (!data || data.error) throw new Error(data?.message || '接口没有返回内容');
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.content ?? data?.text;
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('').trim();
  return typeof content === 'string' ? content.trim() : '';
}


const NAI_MAX_ATTEMPTS = 4;
const NAI_MAX_WAIT_MS = 60_000;

/**
 * NovelAI 出图。
 * 请求包裹结构与官方前端 / 参考扩展一致：{ input, model, action, parameters }；
 * 返回是 msgpack zip，需要解出第一张图，不能按普通 JSON images 接口解析。
 */
export async function novelaiImage({
  engine = 'novelai',
  url, key, model, width, height, steps = 28, scale = 5,
  sampler = 'k_euler_ancestral', noise = 'karras', seed, prompt = '', negative = '',
}) {
  const base = String(url || 'https://image.novelai.net').trim().replace(/\/+$/, '');
  const token = String(key || '').trim();

  if (engine === 'custom') {
    if (!base) throw new Error('先填自定义接口的地址');
    return customImage({ base, token, model, width, height, seed, prompt });
  }

  if (engine === 'doubao') {
    if (!base) throw new Error('先填火山方舟的地址');
    if (!token) throw new Error('先填火山方舟的 ARK API Key');
    return doubaoImage({ base, token, model, width, height, seed, prompt });
  }

  if (!token) throw new Error('先填 NovelAI 的 Key');

  const payload = buildNaiPayload({ model, width, height, steps, scale, sampler, noise, seed, prompt, negative });

  let result;
  for (let attempt = 1; ; attempt += 1) {
    try {
      let res;
      try {
        res = await fetch(naiEndpoint(base, 'generate-image'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (error) {
        const wrapped = new Error(`连不上 ${base}：${error.message}`);
        wrapped.network = true;
        throw wrapped;
      }
      if (!res.ok) throw await naiHttpError(res);

      const decoded = await decodeImagePayload(
        await res.arrayBuffer(),
        res.headers.get('content-type') || '',
        'NovelAI',
      );
      result = { url: decoded.url };
      break;
    } catch (error) {
      if (!naiShouldRetry(error, attempt)) throw error;
      const retryAfterMs = typeof error?.retryAfterMs === 'number' ? error.retryAfterMs : null;
      const waitMs = Math.min(Math.max(
        Math.round(2000 * 2 ** (attempt - 1) * (0.5 + 0.5 * Math.random())),
        retryAfterMs ?? 0,
      ), NAI_MAX_WAIT_MS);
      console.warn(`[meme-phone] NAI 请求失败，${Math.round(waitMs / 1000)}s 后重试（第 ${attempt}/${NAI_MAX_ATTEMPTS - 1} 次）`, error);
      await naiDelay(waitMs);
    }
  }

  return result;
}

function naiEndpoint(base, path = 'generate-image') {
  const clean = String(base || '').trim().replace(/\/+$/, '');
  if (!clean) throw new Error('先填 NovelAI 接口地址');
  const seg = String(path || '').replace(/^\/+/, '');
  if (clean.endsWith(`/ai/${seg}`) || clean.endsWith(`/${seg}`)) return clean;
  return `${clean}/ai/${seg}`;
}

function parseRetryAfter(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1000;
    return Number.isFinite(ms) ? Math.min(ms, NAI_MAX_WAIT_MS) : null;
  }
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.min(Math.max(0, at - Date.now()), NAI_MAX_WAIT_MS);
}

function naiShouldRetry(error, attempt) {
  if (attempt >= NAI_MAX_ATTEMPTS) return false;
  const status = typeof error?.status === 'number' ? error.status : undefined;
  if (status !== undefined) {
    return status === 408 || status === 429 || (status >= 500 && status !== 501);
  }
  return Boolean(error?.network);
}

function naiDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isNai3Model(model) {
  return String(model || '').includes('diffusion-3');
}

/* NAI 5 只认这几种采样器，别的会被官方判参数错；选错了退回默认那个 */
const NAI_V5_SAMPLERS = new Set([
  'k_euler_ancestral', 'k_euler', 'k_dpmpp_2s_ancestral', 'k_dpmpp_2m_sde', 'k_dpmpp_2m', 'k_dpmpp_sde',
]);

function buildNaiPayload({ model, width, height, steps, scale, sampler, noise, seed, prompt, negative }) {
  const n3 = isNai3Model(model);
  const isV5 = /nai-diffusion-5/.test(String(model || ''));
  const safeSampler = isV5 && !NAI_V5_SAMPLERS.has(sampler) ? 'k_euler_ancestral' : sampler;
  const paramsVersion = isV5 ? 4 : 3;
  const params = {
    params_version: paramsVersion,
    width,
    height,
    scale,
    sampler: safeSampler,
    steps,
    n_samples: 1,
    ucPreset: 3,
    qualityToggle: true,
    dynamic_thresholding: false,
    controlnet_strength: 1,
    legacy: false,
    legacy_uc: false,
    add_original_image: true,
    cfg_rescale: 0,
    noise_schedule: noise,
    skip_cfg_above_sigma: null,
    legacy_v3_extend: false,
    stream: 'msgpack',
    seed: Number(seed) > 0 ? Number(seed) : Math.floor(Math.random() * 2 ** 32),
    negative_prompt: negative || '',
    reference_strength_multiple: [],
    normalize_reference_strength_multiple: true,
    use_coords: false,
  };

  if (n3) {
    params.sm = false;
    params.sm_dyn = false;
    params.reference_image_multiple = [];
    params.reference_information_extracted_multiple = [];
  } else {
    params.reference_image_multiple_cached = [];
    params.characterPrompts = [];
    params.v4_prompt = {
      caption: { base_caption: prompt, char_captions: [] },
      use_coords: false,
      use_order: true,
    };
    params.v4_negative_prompt = {
      caption: {
        base_caption: negative || '',
        char_captions: [],
      },
      legacy_uc: false,
    };
  }

  if (safeSampler === 'k_euler_ancestral') {
    params.deliberate_euler_ancestral_bug = false;
    params.prefer_brownian = true;
  }

  const body = {
    input: prompt,
    action: 'generate',
    parameters: params,
    use_new_shared_trial: true,
  };
  if (model) body.model = model;
  return body;
}

async function naiHttpError(resp) {
  const text = (await resp.text().catch(() => '')).trim();
  let detail = text;
  try {
    const json = JSON.parse(text);
    if (typeof json?.message === 'string') detail = json.message;
  } catch {
    /* 非 JSON 错误体直接用原文 */
  }
  const retryAfterMs = parseRetryAfter(resp.headers?.get('Retry-After'));
  let message;
  switch (resp.status) {
    case 400:
      message = `NovelAI 请求校验失败：${detail.slice(0, 300) || '参数不对'}`;
      break;
    case 401:
      message = 'NovelAI API Key 错误或无效';
      break;
    case 402:
      message = 'NovelAI 需要有效订阅';
      break;
    case 429:
      message = 'NovelAI 请求过于频繁，稍后再试';
      break;
    default:
      message = `NovelAI 返回 ${resp.status}${detail ? `：${detail.slice(0, 300)}` : ''}`;
  }
  const error = new Error(message);
  error.status = resp.status;
  error.retryAfterMs = retryAfterMs;
  return error;
}

/**
 * 解析 /api/settings/get 的返回：酒馆把 settings.json 原文塞在 settings 字符串里
 * （顶层只有 settings、world_names 这些），要 JSON.parse 一次才拿得到 oai_settings / world_info_settings。
 * 旧版本或注入式的实现在这里直接给对象，所以两种形状都认。
 */
export function savedSettingsObject(saved) {
  const payload = saved && typeof saved === 'object' && 'settings' in saved ? saved.settings : saved;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return payload && typeof payload === 'object' ? payload : {};
}

function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(bin);
}

/** 从 content-type 或文件头判断直出图片的类型；不是图片返回空。 */
function imageMimeFromResponse(bytes, contentType = '') {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'gif';
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp';
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  /* 文件头认不出时才信 content-type；但 JSON/HTML 错误页常常也带错类型，先排除文本。 */
  const type = String(contentType || '').toLowerCase();
  if (type.startsWith('image/')) {
    const textHead = new TextDecoder().decode(bytes.subarray(0, 32)).trimStart();
    if (textHead.startsWith('{') || textHead.startsWith('[') || textHead.startsWith('<')) return '';
    const subtype = type.split(';')[0].slice(6).replace('jpg', 'jpeg');
    if (/^[a-z0-9.+-]+$/.test(subtype)) return subtype;
  }
  return '';
}

function zipSignature(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06));
}

function imageDataUrl(bytes, mime) {
  return `data:${mime.startsWith('image/') ? mime : `image/${mime}`};base64,${bytesToBase64(bytes)}`;
}

/**
 * 统一解包出图接口返回：官方 NovelAI 是 zip，兼容代理可能直出图片或返回 JSON。
 * 这样错误信息能显示服务端真正的报错，而不是一律说“不是 zip”。
 */
export async function decodeImagePayload(buffer, contentType = '', label = '接口') {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) throw new Error(`${label} 返回了空响应`);
  const type = String(contentType || '').toLowerCase();
  const rawMime = imageMimeFromResponse(bytes, type);
  if (rawMime) return { url: imageDataUrl(bytes, rawMime) };

  if (zipSignature(bytes)) {
    const { base64, filename } = await unzipNaiImage(buffer);
    const format = (filename.split('.').pop() || 'png').toLowerCase();
    return { url: `data:image/${format === 'jpg' ? 'jpeg' : format};base64,${base64}` };
  }

  const text = new TextDecoder().decode(bytes).trim();
  if (text.startsWith('{') || text.startsWith('[') || type.includes('json')) {
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`${label} 返回了无法解析的内容（${type || '未知类型'}，${bytes.length} 字节）：${text.slice(0, 180) || '空响应'}`);
    }
    const b64 = json?.image || json?.data?.[0]?.b64_json || json?.data?.[0]?.image || json?.b64_json || '';
    if (b64) return { url: String(b64).startsWith('data:') ? String(b64) : `data:image/png;base64,${b64}` };
    const remote = json?.data?.[0]?.url || json?.url || json?.image_url || '';
    if (remote) return { url: String(remote) };
    const detail = json?.error?.message || json?.message || json?.detail || json?.error || '';
    throw new Error(`${label} 返回错误：${detail ? String(detail).slice(0, 220) : '响应里没有图片'}`);
  }

  const preview = text.replace(/\s+/g, ' ').slice(0, 180);
  throw new Error(`${label} 返回了无法识别的内容（${type || '未知类型'}，${bytes.length} 字节）${preview ? `：${preview}` : ''}`);
}


async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前环境不支持解压 NovelAI 返回的 zip 包');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function readZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const entries = {};
  let centralOffset = -1;
  let centralCount = 0;

  for (let i = Math.max(0, bytes.length - 22); i >= 0; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06 && i + 22 <= bytes.length) {
      const eocd = new DataView(bytes.buffer, bytes.byteOffset + i);
      centralCount = eocd.getUint16(10, true);
      centralOffset = eocd.getUint32(16, true);
      break;
    }
  }

  if (centralOffset >= 0 && centralOffset + 46 <= bytes.length) {
    let cursor = centralOffset;
    for (let index = 0; index < centralCount; index += 1) {
      if (cursor + 46 > bytes.length) break;
      if (bytes[cursor] !== 0x50 || bytes[cursor + 1] !== 0x4b || bytes[cursor + 2] !== 0x02 || bytes[cursor + 3] !== 0x03) break;
      const central = new DataView(bytes.buffer, bytes.byteOffset + cursor);
      const method = central.getUint16(10, true);
      const compressedSize = central.getUint32(20, true);
      const nameLength = central.getUint16(28, true);
      const extraLength = central.getUint16(30, true);
      const commentLength = central.getUint16(32, true);
      const localOffset = central.getUint32(42, true);
      const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLength));

      if (localOffset + 30 > bytes.length) break;
      const local = new DataView(bytes.buffer, bytes.byteOffset + localOffset);
      const localNameLength = local.getUint16(26, true);
      const localExtraLength = local.getUint16(28, true);
      const localCompressedSize = local.getUint32(18, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart > bytes.length) break;
      const size = compressedSize || localCompressedSize;
      const raw = bytes.subarray(dataStart, Math.min(bytes.length, dataStart + size));
      entries[name] = method === 8 ? await inflateRaw(raw) : raw;
      cursor += 46 + nameLength + extraLength + commentLength;
    }
  }

  if (!Object.keys(entries).length) {
    let offset = 0;
    while (offset + 30 <= bytes.length) {
      if (bytes[offset] !== 0x50 || bytes[offset + 1] !== 0x4b || bytes[offset + 2] !== 0x03 || bytes[offset + 3] !== 0x04) break;
      const local = new DataView(bytes.buffer, bytes.byteOffset + offset);
      const method = local.getUint16(8, true);
      const compressedSize = local.getUint32(18, true);
      const nameLength = local.getUint16(26, true);
      const extraLength = local.getUint16(28, true);
      if (offset + 30 + nameLength + extraLength > bytes.length) break;
      const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
      const dataStart = offset + 30 + nameLength + extraLength;
      const raw = bytes.subarray(dataStart, Math.min(bytes.length, dataStart + compressedSize));
      entries[name] = method === 8 ? await inflateRaw(raw) : raw;
      offset = dataStart + compressedSize;
    }
  }

  return entries;
}

export async function unzipNaiImage(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) throw new Error('NovelAI 返回了空响应');
  let entries;
  try {
    entries = await readZipEntries(buffer);
  } catch (error) {
    throw new Error(`NovelAI 返回的 ZIP 解不开（${bytes.length} 字节）：${error.message}`);
  }
  const names = Object.keys(entries);
  const name = names.find(item => /\.(png|jpe?g|webp)$/i.test(item)) || names[0];
  if (!name) throw new Error(`NovelAI 返回的 ZIP 包里没有图片（${names.length} 个条目）`);
  if (!entries[name]?.length) throw new Error(`NovelAI 返回的图片是空文件：${name}`);
  return { base64: bytesToBase64(entries[name]), filename: name };
}

/**
 * 把绘图接口地址剥成根地址，用来拼探测路径。
 * 用户可能把整条生图地址粘进来（/ai/generate-image、/api/v3/images/generations），
 * 也可能只填站点（127.0.0.1:7860），这里都收成同一种口径。
 */
function imageApiRoot(engine, url, path = '') {
  let base = String(url || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (engine === 'novelai') {
    base = base
      .replace(/\/ai\/generate-image-stream$/i, '')
      .replace(/\/ai\/generate-image$/i, '')
      .replace(/\/generate-image$/i, '');
    return base.replace(/\/+$/, '');
  }
  base = base.replace(/\/images\/generations$/i, '');
  if (/\/(api\/)?v\d+$/.test(base)) return base;
  const route = String(path || '').trim();
  const version = route.match(/\/v\d+/);
  if (version) base = `${base}${version[0]}`;
  else if (!/\/(api\/)?v\d+$/.test(base)) base = `${base}/v1`;
  return base.replace(/\/+$/, '');
}

/** 各家 /models 返回结构不一样，统一抓成模型名列表。 */
function modelNamesOf(payload) {
  const list = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
      : Array.isArray(payload) ? payload : [];
  const names = list.map(item => {
    if (typeof item === 'string') return item;
    return item?.id || item?.name || item?.model || '';
  }).map(item => String(item || '').trim()).filter(Boolean);
  return [...new Set(names)].sort();
}

function naiTierLabel(data) {
  if (!data || typeof data !== 'object') return '';
  if (data.active === false) return '没有生效的订阅';
  const tier = Number(data.tier);
  if (!Number.isFinite(tier) || tier <= 0) return data.active ? '订阅有效' : '';
  return ['', 'Tablet', 'Scroll', 'Opus', 'Opus 年付'][tier] || `档位 ${tier}`;
}

/**
 * 绘图接口的「测试连接 / 拉取模型」。
 * NovelAI 官方没有模型列表接口（/ai/models 一律 404），只能拿 /user/subscription 验 Key，
 * 所以这里回的是内置候选；豆包和自定义是 OpenAI 风格，可以直接 GET /models。
 */
export async function probeImageApi({ engine = 'novelai', url = '', key = '', path = '' } = {}) {
  const base = imageApiRoot(engine, url, path);
  if (!base) throw new Error('先填接口地址');
  const token = String(key || '').trim();

  if (engine === 'novelai') {
    if (!token) throw new Error('先填 NovelAI Key');
    let res;
    try {
      res = await fetch(`${base}/user/subscription`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch (error) {
      throw new Error(`连不上 ${base}：${error.message}`);
    }
    if (res.status === 401 || res.status === 403) throw new Error('NovelAI Key 不对，或没权限');
    if (res.status === 404) {
      return { ok: false, models: [], text: `${base} 没有订阅接口，Key 没验成；模型只能从内置候选里选或手动填` };
    }
    if (!res.ok) throw new Error(`NovelAI 返回 ${res.status}`);
    const data = await res.json().catch(() => null);
    const tier = naiTierLabel(data);
    return {
      ok: Boolean(tier) && tier !== '没有生效的订阅',
      models: [],
      text: `Key 有效${tier ? ` · ${tier}` : ''} · 官方不给模型列表，模型从内置候选里选`,
    };
  }

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${base}/models`, { method: 'GET', headers, cache: 'no-store', credentials: 'omit' });
  } catch (error) {
    throw new Error(`连不上 ${base}：${error.message}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('Key 不对，或没有拉模型的权限');
  if (res.status === 404 || res.status === 405) {
    return { ok: false, models: [], text: `${base} 没有模型列表接口，模型只能手动填` };
  }
  if (!res.ok) throw new Error(`接口返回 ${res.status}`);
  const text = await res.text().catch(() => '');
  let payload = null;
  try { payload = JSON.parse(text); } catch { throw new Error('模型列表不是 JSON，可能地址填到了网页首页'); }
  const models = modelNamesOf(payload);
  if (!models.length) return { ok: false, models: [], text: `${base} 连上了，但没返回模型名` };
  return { ok: true, models, text: `连接正常 · ${models.length} 个模型 · ${base}` };
}

/** 豆包 Seedream（火山方舟）：images/generations，字段比 OpenAI 多一个 watermark / 组图开关。 */async function doubaoImage({ base, token, model, width, height, seed, prompt }) {
  const payload = {
    model,
    prompt,
    size: `${width}x${height}`,
    response_format: 'b64_json',
    watermark: false,
  };
  /* 4.x 才有组图开关；3.0 不认这个字段 */
  if (/seedream-4/.test(model || '')) payload.sequential_image_generation = 'disabled';
  if (Number(seed) > 0) payload.seed = Number(seed);

  let res;
  try {
    res = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`连不上 ${base}：${error.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const short = detail ? `：${detail.slice(0, 160)}` : '';
    throw new Error(`火山方舟返回 ${res.status}${short}`);
  }
  return imageFromResponse(res, '豆包');
}

/** 自定义接口：OpenAI 风格 images 接口；只发最通用的字段，避免严格端点的多余参数报错。 */
async function customImage({ base, token, model, width, height, seed, prompt }) {
  const payload = {
    prompt,
    size: `${width}x${height}`,
    n: 1,
    response_format: 'b64_json',
  };
  if (model) payload.model = model;
  if (Number(seed) > 0) payload.seed = Number(seed);

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (error) {
    throw new Error(`连不上 ${base}：${error.message}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`接口返回 ${res.status}${detail ? `：${detail.slice(0, 160)}` : ''}`);
  }
  return imageFromResponse(res, '接口');
}

async function imageFromResponse(res, label) {
  return decodeImagePayload(
    await res.arrayBuffer(),
    res.headers.get('content-type') || '',
    label,
  );
}

/**
 * 酒馆里可以绑给人的世界书名单。
 * 人设的 lorebook 只存书名，真正的世界书还是酒馆自己那份。
 */
export async function readWorldBookNames() {
  const script = await loadHostScript();
  if (!script) return { available: false, list: [], current: '' };
  try {
    const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || {};
    let names = script.world_names || ctx.world_names || [];
    if (!Array.isArray(names) || !names.length) {
      try {
        const headers = ctx.getRequestHeaders?.() || script.getRequestHeaders?.() || {};
        const response = await fetch('/api/settings/get', { method: 'POST', headers, body: '{}' });
        if (response.ok) {
          const saved = await response.json();
          if (Array.isArray(saved.world_names)) names = saved.world_names;
        }
      } catch { /* 读不到名单就只显示已绑定的那本 */ }
    }
    const current = typeof script.world_info === 'string' ? script.world_info : '';
    const list = [...new Set([...names, current].map(String).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh'));
    return { available: true, list, current };
  } catch {
    return { available: false, list: [], current: '' };
  }
}

/**
 * 酒馆的用户（persona）名单。
 * 名字与设定都住在酒馆设置里：power_user.personas 存「头像文件名 → 显示名」，
 * power_user.persona_descriptions 存每个头像对应的设定文本。读不到就返回 available:false。
 */
export async function readTavernPersonas() {
  const script = await loadHostScript();
  if (!script) return { available: false, list: [], current: '', currentName: '', currentAvatar: '' };
  try {
    const ctx = script.getContext?.() || script;
    const pu = script.power_user || script.powerUser || ctx.powerUser || ctx.powerUserSettings || globalThis.power_user || {};
    const names = pu.personas && typeof pu.personas === 'object' ? pu.personas : null;
    if (!names) return { available: false, list: [], current: '', currentName: '', currentAvatar: '' };
    const descs = pu.persona_descriptions && typeof pu.persona_descriptions === 'object' ? pu.persona_descriptions : {};
    const thumb = script.getThumbnailUrl;
    const current = String(script.user_avatar || ctx.user_avatar || '');
    const currentName = String(script.name1 || ctx.name1 || '');
    const list = Object.entries(names)
      .filter(([, name]) => Boolean(name))
      .map(([key, name]) => ({
        key,
        name: String(name || '').trim(),
        description: String(descs[key]?.description || ''),
        lorebook: String(descs[key]?.lorebook || (key === current ? pu.persona_description_lorebook : '') || ''),
        avatarUrl: typeof thumb === 'function' ? thumb('persona', key) : '',
      }));
    return {
      available: true,
      list,
      current,
      currentName,
      /* 当前这人可能没设显示名、被上面的过滤筛掉，头像仍按文件名取 */
      currentAvatar: typeof thumb === 'function' && current ? thumb('persona', current) : '',
    };
  } catch {
    return { available: false, list: [], current: '', currentName: '', currentAvatar: '' };
  }
}

/**
 * 把改过的名字 / 设定 / 人设世界书写回酒馆。
 * 只改内存里的 power_user，再让酒馆自己保存设置——不走私有接口，装进酒馆就能用。
 */
export async function writeTavernPersona({ key, name, description, lorebook }) {
  const script = await loadHostScript();
  const ctx = script?.getContext?.() || script || {};
  const pu = script?.power_user || script?.powerUser || ctx.powerUser || ctx.powerUserSettings || globalThis.power_user;
  if (!pu || !pu.personas) throw new Error('没接上酒馆，改不了酒馆那一边');
  if (!key) throw new Error('这条没有对应的酒馆用户');

  const cleanName = String(name || '').trim();
  if (cleanName) pu.personas[key] = cleanName;

  if (typeof description === 'string' || typeof lorebook === 'string') {
    const descs = pu.persona_descriptions || (pu.persona_descriptions = {});
    const next = { ...(descs[key] || {}) };
    if (typeof description === 'string') next.description = description;
    if (typeof lorebook === 'string') next.lorebook = String(lorebook || '').trim();
    descs[key] = next;
  }

  if (String(script.user_avatar || ctx.user_avatar || '') === key) {
    if (cleanName) {
      script.name1 = cleanName;
      if (ctx.name1 !== undefined) ctx.name1 = cleanName;
    }
    if (typeof lorebook === 'string') {
      pu.persona_description_lorebook = String(lorebook || '').trim();
      if (ctx.powerUser) ctx.powerUser.persona_description_lorebook = pu.persona_description_lorebook;
    }
    const box = globalThis.document?.querySelector('#user_name');
    if (box && cleanName) box.value = cleanName;
  }

  const save = ctx.saveSettingsDebounced || script.saveSettingsDebounced;
  if (typeof save === 'function') await save();
  return { ok: true };
}

/**
 * 酒馆当前在用的 API 配置（只读，不写）。
 * 酒馆把连接参数放在 oai_settings：反向代理地址在 reverse_proxy，
 * 代理密码（也就是 Key）在 proxy_password，来源与模型各有字段。
 * 只在用户点「从酒馆导入」时调用，读不到就返回 available:false。
 */
export async function readTavernApi() {
  const script = await loadHostScript();
  if (!script) return { available: false, reason: '没接上酒馆，先打开酒馆再试' };
  try {
    const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || script;
    const direct = script.oai_settings
      || script.chatCompletionSettings
      || ctx.oai_settings
      || ctx.oaiSettings
      || ctx.chatCompletionSettings
      || script.settings?.oai_settings
      || globalThis.oai_settings
      || null;
    let settings = direct;

    /* getContext() 通常不暴露 oai_settings；用酒馆自己的设置接口兜底 */
    if (!settings || typeof settings !== 'object' || !Object.keys(settings).length) {
      try {
        const headers = ctx.getRequestHeaders?.() || script.getRequestHeaders?.() || {};
        const response = await fetch('/api/settings/get', {
          method: 'POST',
          headers,
          body: '{}',
        });
        if (response.ok) {
          const saved = await response.json();
          const savedSettings = savedSettingsObject(saved);
          settings = saved.oai_settings || savedSettings.oai_settings || null;
        }
      } catch { /* 读不到就继续走下面的失败提示 */ }
    }

    if (!settings) {
      return { available: false, reason: '酒馆没把这版接口设置暴露出来' };
    }

    const source = String(settings.chat_completion_source || 'openai');
    const model = String(
      settings.custom_model
      || settings.openai_model
      || settings.claude_model
      || settings.google_model
      || settings.openrouter_model
      || settings.mistralai_model
      || settings.cohere_model
      || '',
    ).trim();
    const proxy = String(settings.reverse_proxy || '').trim();
    const customUrl = String(settings.custom_url || '').trim();
    const key = String(
      settings.custom_key
      || settings.proxy_password
      || settings.openai_key
      || settings.openrouter_key
      || settings.claude_key
      || settings.google_key
      || settings.mistralai_key
      || settings.cohere_key
      || '',
    ).trim();
    let url = (proxy || customUrl).replace(/\/+$/, '');
    if (!url && source === 'openai') url = 'https://api.openai.com';
    if (!url && source === 'openrouter') url = 'https://openrouter.ai/api';

    /* 酒馆新版把「接口名字」放在连接配置里；有选中项就带上名字，导入时直接用它命名 */
    const manager = script.extensionSettings?.connectionManager
      || ctx.extensionSettings?.connectionManager
      || {};
    const profiles = Array.isArray(manager.profiles) ? manager.profiles : [];
    const selected = typeof manager.selectedProfile === 'object' && manager.selectedProfile
      ? manager.selectedProfile
      : profiles.find(item => item && item.id === manager.selectedProfile) || null;
    const profile = selected
      || profiles.find(item => String(item?.['api-url'] || '').trim().replace(/\/+$/, '') === url)
      || null;
    const profileName = String(profile?.name || '').trim();

    return {
      available: true,
      source,
      url,
      key,
      model,
      name: profileName,
      profileId: profile?.id || '',
      direct: Boolean(proxy || customUrl),
      reason: url ? '' : '酒馆这套走内部转发，没有可直连的地址',
    };
  } catch (error) {
    return { available: false, reason: `读酒馆设置时出错：${error.message || error}` };
  }
}

/**
 * 借酒馆后端拉一次模型列表。
 * 小手机在酒馆窗口里跑，直接 fetch 外部接口会被 CORS 拦；
 * 酒馆自己的 /api/backends/chat-completions/status 就是干这个的，还带着酒馆存的 Key。
 * 传进来的 preset 有地址 / Key 时优先用它，没有就用酒馆当前设置。
 */
export async function listTavernModels(preset = {}) {
  const script = await loadHostScript();
  if (!script) return { available: false, models: [], reason: '没接上酒馆' };
  try {
    const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || {};
    const settings = script.oai_settings
      || script.chatCompletionSettings
      || ctx.oai_settings
      || ctx.oaiSettings
      || ctx.chatCompletionSettings
      || script.settings?.oai_settings
      || globalThis.oai_settings
      || {};
    const source = String(preset.tavernSource || settings.chat_completion_source || 'openai');
    const url = String(preset.url || settings.reverse_proxy || settings.custom_url || '').trim();
    const key = String(
      preset.key
      || settings.custom_key
      || settings.proxy_password
      || settings.openai_key
      || settings.openrouter_key
      || '',
    ).trim();
    const customRoot = source === 'custom' ? chatCompletionsRoot(url, preset.path) : url;
    const getHeaders = ctx.getRequestHeaders || script.getRequestHeaders;
    const headers = typeof getHeaders === 'function' ? { ...getHeaders() } : {};
    if (!headers['X-CSRF-Token']) {
      const token = ctx.csrf_token || globalThis.csrf_token || '';
      if (token) headers['X-CSRF-Token'] = token;
    }
    headers['Content-Type'] = 'application/json';

    const body = {
      chat_completion_source: source,
      reverse_proxy: customRoot,
      proxy_password: key,
    };
    if (source === 'custom') {
      body.custom_url = customRoot;
      body.custom_include_headers = key
        ? JSON.stringify({ Authorization: `Bearer ${key}` })
        : String(settings.custom_include_headers || '');
    }
    const response = await fetch('/api/backends/chat-completions/status', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      return { available: true, models: [], reason: `酒馆后端返回 ${response.status}` };
    }
    const data = await response.json().catch(() => null);
    if (!data || data.error) {
      return { available: true, models: [], reason: data?.message || '酒馆后端没连上这个接口' };
    }
    const list = (Array.isArray(data.data) ? data.data : [])
      .map(item => (typeof item === 'string' ? item : item?.id || item?.name || ''))
      .map(item => String(item || '').trim())
      .filter(Boolean);
    return { available: true, models: [...new Set(list)].sort(), reason: list.length ? '' : '酒馆后端没返回模型' };
  } catch (error) {
    return { available: true, models: [], reason: error.message || String(error) };
  }
}

/** 宿主可用性，用于设置页展示「已接入 / 未接入」。 */
export async function probeHost() {
  const script = await loadHostScript();
  return {
    inTavern: Boolean(script),
    hasCharacters: Boolean(script?.characters),
    hasGenerate: Boolean(script?.generateQuietPrompt),
  };
}
