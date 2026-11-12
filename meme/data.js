/**
 * meme-phone · 数据模型
 *
 * 这里是唯一的真源：所有页面只读这一份对象，改动后调用 store.touch() 落盘。
 * 数据结构刻意保持扁平，避免旧版那种「十个模块共享一个巨型对象、谁都改它」的局面。
 */

export const SCHEMA_VERSION = 1;

/* 回复预设除了「怎么说」，还要决定「给模型看哪些上下文」。
 * 这一组开关沿用旧独立小手机的 QQ 预设：角色档案、用户设定、聊天记录、记忆、时间。 */
export const DEFAULT_REPLY_CONTEXT = {
  character: true,
  user: true,
  memory: true,
  history: true,
  historyLimit: 10,
  time: true,
};

export function normalizeReplyContext(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const limit = Number(source.historyLimit ?? DEFAULT_REPLY_CONTEXT.historyLimit);
  return {
    character: source.character !== false,
    user: source.user !== false,
    memory: source.memory !== false,
    history: source.history !== false,
    historyLimit: Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.round(limit))) : DEFAULT_REPLY_CONTEXT.historyLimit,
    time: source.time !== false,
  };
}

/** 旧 QQ 预设里的固定提示词条目；这些是「怎么说」的补充，不替代聊天气泡本身。 */
export function defaultReplyItems() {
  return [
    {
      id: 'reply_item_phone_task',
      label: '手机聊天任务',
      role: 'system',
      content: '[手机聊天任务]\n这是手机上的即时聊天，不是小说。消息要短，像随手打出来的，可以分成几条。\n不要描写动作、场景和心理活动，也不要用括号、旁白或角色名前缀。\n[/手机聊天任务]',
      enabled: true, editable: true, deletable: true, order: 0,
    },
    {
      id: 'reply_item_behavior',
      label: '聊天行为要求',
      role: 'system',
      content: '[聊天行为要求]\n在符合角色性格的前提下，回复后可以自然延伸一点：追问一句、分享一件小事，或者停一下等对方。\n不要每次都追问，也不要在不合适的时候强行主动。\n[/聊天行为要求]',
      enabled: true, editable: true, deletable: true, order: 1,
    },
    {
      id: 'reply_item_detail',
      label: '关注消息细节',
      role: 'system',
      content: '[关注消息细节]\n留意对方消息里的停顿、标点和长短变化，判断对方的状态。\n不要直接点破，用语气和关心程度自然回应。\n[/关注消息细节]',
      enabled: true, editable: true, deletable: true, order: 2,
    },
    {
      id: 'reply_item_chinese',
      label: '中文回复',
      role: 'system',
      content: '角色必须用中文回复。',
      enabled: true, editable: true, deletable: true, order: 3,
    },
  ];
}

export function normalizeReplyItems(raw) {
  const source = Array.isArray(raw) ? raw : defaultReplyItems();
  return source.slice(0, 24).map((item, index) => {
    const role = ['system', 'user', 'assistant'].includes(item?.role) ? item.role : 'system';
    const kind = item?.kind === 'app' ? 'app' : 'chat';
    const order = Number(item?.order);
    return {
      id: String(item?.id || newId('item')),
      label: String(item?.label || '').trim().slice(0, 30) || `条目 ${index + 1}`,
      role,
      kind,
      app: kind === 'app' ? String(item?.app || '').trim().slice(0, 20) : '',
      content: String(item?.content || '').trim().slice(0, 4000),
      enabled: item?.enabled !== false,
      editable: item?.editable !== false,
      deletable: item?.deletable !== false,
      order: Number.isFinite(order) ? order : index,
    };
  }).sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, order: index }));
}

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    createdAt: Date.now(),
    settings: {
      theme: 'day',              // day | night
      wallpaper: 'day',          // day | night | none | custom（默认铺壁纸，不透出酒馆背景）
      customWall: '',            // 自定义壁纸的 data URL
      /* 装扮：字体、字号、行距、灵动岛、每个 App 的自定义图标 */
      dress: {
        font: 'system',          // system | rounded | serif | kai
        fontSize: 1,             // 0.85–1.3，只影响文字，不放大手机壳
        lineHeight: 1,           // 0.9–1.3
        fontWeight: 400,         // 400 | 500 | 600
        island: 'show',          // show | hide
        icons: {},               // appId -> { shape?: iconName, image?: dataURL }
      },
      user: { name: '我', avatar: '', key: '' },
      userMode: 'follow',        // follow 跟随酒馆 | pin 固定一个
      pinnedUser: '',            // pin 时用哪个酒馆用户（persona 头像文件名）
      proactive: { enabled: true, idleMinutes: 120, dailyCount: 5 },
      chat: { showTime: true, enterToSend: false, remind: true, wake: true },
      /* 酒馆记忆方案：默认有酒馆总结就用总结，没有就取最近 10 层酒馆聊天 */
      memory: {
        activeId: 'mem_auto',
        presets: [
          { id: 'mem_auto', name: '默认', mode: 'auto', floors: 10, skipFirstFloor: false },
          { id: 'mem_summary', name: '只看总结', mode: 'summary', floors: 10, skipFirstFloor: false },
          { id: 'mem_recent', name: '最近原文', mode: 'recent', floors: 20, skipFirstFloor: false },
        ],
      },
      /* 回复预设：真正告诉模型「这通聊天该怎么说话」的一段指令 */
      reply: {
        activeId: 'reply_natural',
        presets: [
          {
            id: 'reply_natural', name: '自然发消息',
            text: '像平时发微信一样回消息：口语、短句，一次只回一两句。不要写旁白、括号里的动作，也不要写成小说段落。',
            context: { ...DEFAULT_REPLY_CONTEXT },
            items: defaultReplyItems(),
          },
          {
            id: 'reply_short', name: '再短一点',
            text: '回复尽量短，通常不超过 20 个字，像随手回一条消息。不要解释、不要总结、不要用括号写动作。',
            context: { ...DEFAULT_REPLY_CONTEXT },
            items: defaultReplyItems(),
          },
          {
            id: 'reply_soft', name: '带点情绪',
            text: '像平时发微信一样回消息，口语、短句，可以带一点情绪和停顿，但不要写成小说，也不要用括号写旁白动作。',
            context: { ...DEFAULT_REPLY_CONTEXT },
            items: defaultReplyItems(),
          },
        ],
      },
      api: {
        activeChat: '', activeImage: '', presets: [
          { id: 'api_default', name: '酒馆 API', engine: 'tavern', url: '', path: '', model: '', key: '', temp: 0.8 },
        ],
        /* LLM 整体方案 = 一套聊天 API + 一套酒馆记忆 */
        chatSchemes: [
          { id: 'lsch_default', name: '默认', apiId: 'api_default', memoryId: 'mem_auto', replyId: 'reply_natural' },
        ],
        chatSchemeId: 'lsch_default',
      },
      /* 绘图接口跟聊天的 API 预设完全分开：自己一套引擎 / 地址 / Key / 模型 */
      image: {
        engine: 'novelai',        // novelai 官方 | doubao 火山方舟 | custom 自定义接口
        novelai: { url: 'https://image.novelai.net', key: '', model: 'nai-diffusion-4-curated-preview' },
        doubao: { url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', key: '', model: 'doubao-seedream-4-5-251128' },
        custom: { url: '', key: '', model: '', path: '/v1/images/generations' },
      },
    },
    draw: {
      config: {
        url: '', key: '', model: 'nai-diffusion-4-curated-preview',
        size: '832x1216', steps: 28, scale: 5,
        sampler: 'k_euler_ancestral', noise: 'karras', seed: '',
      },
      presets: [{ name: '默认', pos: '', neg: '' }],
      presetIdx: 0,
      lastPrompt: '',
      history: [],
    },
    contacts: {},
    users: [],
    usersFromTavern: false,
    characters: [],
    charactersFromTavern: false,
    lookups: {},
    chats: {},
    diary: { entries: {}, contacts: {}, prompt: DEFAULT_DIARY_PROMPT, lastGenerated: '' },
    emoji: DEFAULT_EMOJI.map((item, index) => ({ id: `e${index + 1}`, ...item })),
    plans: [],
    music: {
      playlists: [],
      activeId: '',
      current: null,
    },
    extras: {},
    dress: { wallpaperDay: 'assets/wallpaper-day.jpg', wallpaperNight: 'assets/wallpaper-night.jpg', accent: '#8e7bf2' },
  };
}

export const DEFAULT_DIARY_PROMPT = `站在角色的第一人称写这一天的日记。按时间顺序，标上大概几点。保留有意思的原话，用引号引出来，不改字、不润色，错别字和语气词也保留。一天不超过 20 条聊天就不用总结。`;

const DEFAULT_EMOJI = [
  { name: '抱抱', char: '🫂' }, { name: '贴贴', char: '🥰' }, { name: '无语', char: '🫠' },
  { name: '猫猫', char: '🐈' }, { name: '下雨', char: '🌧️' }, { name: '困', char: '😴' },
  { name: '爆炸', char: '💥' }, { name: '星星', char: '✨' },
];

/* ------------------------------------------------------------------ ids */

let seq = 0;
export function newId(prefix = 'id') {
  seq += 1;
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${rand}`;
}

/* -------------------------------------------------------------- 联系人 */

export function addContact(state, contact) {
  const id = contact.id || newId('c');
  state.contacts[id] = {
    id,
    name: contact.name || '未命名',
    avatar: contact.avatar || '',
    kind: contact.kind || 'char',       // char | group | custom
    tavernAvatar: contact.tavernAvatar || '',
    note: contact.note || '',
    signature: contact.signature || '',
    status: contact.status || 'online',  // online | busy | away
    members: contact.members || [],
    createdAt: Date.now(),
  };
  return state.contacts[id];
}

export function contactsOf(state) {
  return Object.values(state.contacts);
}

export function contactById(state, id) {
  return state.contacts[id] || null;
}

/* ----------------------------------------------------------------- 会话 */

export function addChat(state, contactId, options = {}) {
  const id = options.id || newId('ch');
  const messages = (options.messages || []).map((message, index) => ({ id: `${id}_m${index}`, ...message }));
  state.chats[id] = {
    id,
    contactId,
    kind: options.kind || (state.contacts[contactId]?.kind === 'group' ? 'group' : 'single'),
    messages,
    unread: 0,
    draft: '',
    pinned: false,
    muted: false,
    llmPresetId: '',
    memoryPresetId: '',
    updatedAt: Date.now(),
  };
  return state.chats[id];
}

/** 一个联系人只保留一个一对一会话；群聊各自一条。 */
export function chatFor(state, contactId) {
  const existing = Object.values(state.chats).find(chat => chat.contactId === contactId && chat.kind !== 'group');
  return existing || addChat(state, contactId);
}

export function chatsOf(state) {
  return Object.values(state.chats).sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}

export function chatById(state, id) {
  return state.chats[id] || null;
}

/** 手机里保存的聊天接口预设。 */
export function apiPresetsOf(state) {
  const store = state?.settings?.api;
  return Array.isArray(store?.presets) ? store.presets : [];
}

/** 这个会话实际用哪套 LLM：自己选了就用自己那套，没选就跟随手机。 */
export function llmPresetFor(state, chat) {
  const list = apiPresetsOf(state);
  const own = list.find(preset => preset.id === chat?.llmPresetId);
  if (own) return own;
  return list.find(preset => preset.id === state?.settings?.api?.activeChat) || list[0] || null;
}

/** 手机里保存的酒馆记忆方案。 */
export function memoryPresetsOf(state) {
  const store = state?.settings?.memory;
  return Array.isArray(store?.presets) ? store.presets : [];
}

/** 这个会话实际用哪套记忆：自己选了就用自己那套，没选就跟随手机。 */
export function memoryPresetFor(state, chat) {
  const list = memoryPresetsOf(state);
  const own = list.find(preset => preset.id === chat?.memoryPresetId);
  if (own) return own;
  return list.find(preset => preset.id === state?.settings?.memory?.activeId) || list[0] || null;
}

/** 手机里保存的回复预设：每套由主回复指令、提示词条目和上下文配置组成。 */
export function replyPresetsOf(state) {
  const store = state?.settings?.reply;
  return Array.isArray(store?.presets) ? store.presets : [];
}

/** 这个会话实际用哪套回复预设：自己选了就用自己那套，没选就跟随手机。 */
export function replyPresetFor(state, chat) {
  const list = replyPresetsOf(state);
  const own = list.find(preset => preset.id === chat?.replyPresetId);
  if (own) return own;
  return list.find(preset => preset.id === state?.settings?.reply?.activeId) || list[0] || null;
}

/** 注入模型的回复要求；预设没写内容时返回空，不额外加约束。 */
export function replyPromptFor(state, chat) {
  const preset = replyPresetFor(state, chat);
  return String(preset?.text || '').trim();
}

/** 这套回复预设要注入哪些上下文。 */
export function replyContextFor(state, chat) {
  const preset = replyPresetFor(state, chat);
  return normalizeReplyContext(preset?.context);
}

/** 这套预设的全部提示词条目（包含关闭的，给设置页用）。 */
export function replyItemsFor(state, chat) {
  const preset = replyPresetFor(state, chat);
  return normalizeReplyItems(preset?.items);
}

/** 把条目里的旧版变量换成当前数据；不认识的占位符保留，方便用户自己排查。 */
export function fillPromptTokens(text, state, chat) {
  const contact = chat ? state?.contacts?.[chat.contactId] : null;
  const user = state?.settings?.user?.name || '我';
  const now = new Date().toLocaleString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return String(text || '')
    .replace(/\{\{user\}\}/g, user)
    .replace(/\{\{char\}\}/g, contact?.name || '对方')
    .replace(/\{\{当前时间\}\}/g, now);
}

/** 真正发给模型的 system 文本：主回复指令 + 开启的聊天 system 条目。 */
export function replySystemFor(state, chat) {
  const preset = replyPresetFor(state, chat);
  const items = normalizeReplyItems(preset?.items)
    .filter(item => item.kind !== 'app' && item.enabled && item.role === 'system' && item.content)
    .map(item => fillPromptTokens(item.content, state, chat));
  return [fillPromptTokens(preset?.text, state, chat), ...items].filter(Boolean).join('\n\n');
}

/** 聊天软件用的条目：过滤掉「其他软件」条目。 */
export function replyChatItemsFor(state, chat) {
  return replyItemsFor(state, chat).filter(item => item.kind !== 'app');
}

/** 某个其他软件用的条目；不传软件名时返回全部其他软件条目。 */
export function appReplyItemsFor(state, chat, app = '') {
  const items = replyItemsFor(state, chat).filter(item => item.kind === 'app');
  const target = String(app || '').trim();
  if (!target) return items;
  return items.filter(item => !item.app || item.app === target);
}

/** 其他软件的 system 提示词；这些条目不会混进聊天回复。 */
export function appSystemFor(state, chat, app = '') {
  return appReplyItemsFor(state, chat, app)
    .filter(item => item.enabled && item.role === 'system' && item.content)
    .map(item => fillPromptTokens(item.content, state, chat))
    .join('\n\n');
}

/** 手机里保存的 LLM 整体方案：一套聊天 API + 一套酒馆记忆 + 一套回复预设。 */
export function chatSchemesOf(state) {
  const store = state?.settings?.api;
  return Array.isArray(store?.chatSchemes) ? store.chatSchemes : [];
}

export function activeChatScheme(state) {
  const store = state?.settings?.api;
  const list = chatSchemesOf(state);
  return list.find(item => item.id === store?.chatSchemeId) || list[0] || null;
}

/** 切一套整体方案：API、记忆和回复预设一起换。 */
export function applyChatScheme(state, scheme) {
  if (!scheme) return false;
  const store = state.settings.api;
  if (apiPresetsOf(state).some(item => item.id === scheme.apiId)) store.activeChat = scheme.apiId;
  if (memoryPresetsOf(state).some(item => item.id === scheme.memoryId)) state.settings.memory.activeId = scheme.memoryId;
  if (replyPresetsOf(state).some(item => item.id === scheme.replyId)) state.settings.reply.activeId = scheme.replyId;
  store.chatSchemeId = scheme.id;
  return true;
}

export function lastMessage(chat) {
  const list = chat?.messages || [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (message && message.text) return message;
  }
  return null;
}

export function pushMessage(state, chatId, message) {
  const chat = state.chats[chatId];
  if (!chat) return null;
  const entry = {
    id: message.id || newId('m'),
    from: message.from || 'them',      // me | them | system
    text: message.text || '',
    at: message.at || Date.now(),
    kind: message.kind || 'text',      // text | system | extra | proactive
    quote: message.quote || null,
    proactive: Boolean(message.proactive),
    pending: Boolean(message.pending),
    speaker: message.speaker || '',
  };
  chat.messages.push(entry);
  chat.updatedAt = entry.at;
  if (entry.from === 'them') chat.unread = (chat.unread || 0) + 1;
  return entry;
}

export function unreadTotal(state) {
  return Object.values(state.chats).reduce((sum, chat) => sum + (chat.muted ? 0 : (chat.unread || 0)), 0);
}

/* ----------------------------------------------------------------- 日记 */

export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function diaryEntry(state, key) {
  return state.diary.entries[key] || null;
}

export function writeDiary(state, key, text, extra = {}) {
  state.diary.entries[key] = {
    key,
    text: String(text || '').trim(),
    tags: extra.tags || [],
    auto: Boolean(extra.auto),
    contactId: extra.contactId || '',
    createdAt: Date.now(),
  };
  return state.diary.entries[key];
}

/** 最近一条日记：桌面小组件和日记 App 都用它。 */
export function latestDiary(state) {
  const keys = Object.keys(state.diary.entries).sort().reverse();
  for (const key of keys) {
    const entry = state.diary.entries[key];
    if (entry && entry.text) return entry;
  }
  return null;
}

/* ---------------------------------------------------------- 小剧场等 */

export function extrasOf(state, contactId) {
  state.extras[contactId] = state.extras[contactId] || [];
  return state.extras[contactId];
}

/* ------------------------------------------------------------- 从酒馆同步 */

/**
 * 把酒馆角色同步成联系人。host 只提供纯数据（id/名字/头像引用），
 * 这里不碰宿主 API，方便单测与预览环境复用。
 */
export function syncTavernContacts(state, tavernCharacters = []) {
  let created = 0;
  for (const character of tavernCharacters) {
    if (!character || !character.name) continue;
    const key = character.tavernAvatar || character.name;
    const existing = Object.values(state.contacts).find(item => item.tavernAvatar === key);
    if (existing) {
      existing.name = character.name;
      existing.avatar = character.avatarUrl || existing.avatar;
      continue;
    }
    addContact(state, {
      name: character.name,
      avatar: character.avatarUrl || '',
      tavernAvatar: key,
      kind: 'char',
    });
    created += 1;
  }
  return created;
}

/* --------------------------------------------------------------- 演示数据 */

/** 预览环境用的虚构数据，未引用任何真实聊天内容。 */
export function demoState() {
  const state = emptyState();
  state.settings.user = { name: '颜', avatar: '', key: 'persona_yan.png' };
  state.settings.user.name = '颜';
  state.users = [
    { key: 'persona_yan.png', name: '颜', description: '在便利店上夜班，说话很短，习惯先把事做完再说。', avatarUrl: '' },
    { key: 'persona_lan.png', name: '阿蓝', description: '自由插画师，回消息慢，句子里爱用破折号。', avatarUrl: '' },
    { key: 'persona_gu.png', name: '顾青', description: '白天在书店，晚上写东西，不太主动开口。', avatarUrl: '' },
  ];
  state.settings.api.activeChat = 'api_default';
  state.settings.image = {
    engine: 'novelai',
    novelai: { url: 'https://image.novelai.net', key: 'pst-demo', model: 'nai-diffusion-4-curated-preview' },
    doubao: { url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', key: '', model: 'doubao-seedream-4-5-251128' },
    custom: { url: '', key: '', model: '', path: '/v1/images/generations' },
    presets: [
      { id: 'image_default', name: 'NovelAI 官方', engine: 'novelai', url: 'https://image.novelai.net', path: '', key: 'pst-demo', model: 'nai-diffusion-4-curated-preview' },
    ],
    activeId: 'image_default',
  };
  state.settings.api.presets = [
    { id: 'api_default', name: '酒馆 API', engine: 'tavern', url: '', path: '', model: '', key: '', temp: 0.8 },
    { id: 'api_local', name: '本地 OpenAI', engine: 'openai', url: 'http://127.0.0.1:8080', path: '/v1/chat/completions', model: 'gpt-4o-mini', key: 'sk-demo', temp: 0.9 },
  ];
  state.settings.api.chatSchemes = [
    { id: 'lsch_auto', name: '默认 · 自动记忆', apiId: 'api_default', memoryId: 'mem_auto' },
    { id: 'lsch_local', name: '本地 · 最近原文', apiId: 'api_local', memoryId: 'mem_recent' },
  ];
  state.settings.api.chatSchemeId = 'lsch_auto';
  state.draw.lastPrompt = '沈砚坐在便利店门口的台阶上，夜里，侧脸，路灯下点了一支烟';
  state.draw.presets = [
    { id: 'dp_default', name: '默认', pos: '', neg: '' },
    { id: 'dp_film', name: '胶片人像', pos: 'film grain, kodak portra, natural light, 50mm', neg: 'oversaturated, plastic skin' },
    { id: 'dp_night', name: '夜街', pos: 'night street, neon reflection, wet asphalt, cinematic', neg: 'flat lighting, blurry' },
  ];
  state.draw.presetIdx = 1;
  state.settings.image.presets.push({
    id: 'image_local', name: '本地 SD WebUI', engine: 'custom',
    url: 'http://127.0.0.1:7860', path: '/v1/images/generations',
    key: '', model: 'sd_xl_base_1.0',
  });
  state.draw.schemes = [
    { id: 'ds_film', name: '胶片人像 · NovelAI', apiId: 'image_default', promptId: 'dp_film' },
    { id: 'ds_night', name: '夜街 · 本地 SD', apiId: 'image_local', promptId: 'dp_night' },
  ];
  state.draw.schemeId = 'ds_film';
  state.draw.history = [
    { id: 'img_demo1', prompt: '便利店台阶上的夜，侧脸，路灯', seed: 20261111, url: '', tint: 'linear-gradient(150deg,#e6dcff,#c9bcf7 60%,#b3d6f2)', at: Date.now() },
    { id: 'img_demo2', prompt: '雨夜车窗上的水痕', seed: 88421337, url: '', tint: 'linear-gradient(150deg,#ffe3ef,#f8c6dd 60%,#efe6ff)', at: Date.now() - 60000 },
  ];
  state.music.playlists = [
    {
      id: 'pl_demo_late',
      source: 'netease',
      remoteId: 'demo-night',
      name: '夜班耳机',
      cover: '',
      link: '',
      importedAt: Date.now(),
      tracks: [
        { id: 'tr_demo_1', title: '晚风从便利店门口吹过', artist: '颜 · 私人歌单', album: '', url: 'https://music.163.com/song/media/outer/url?id=1973665667.mp3', pic: '', lrc: '', via: 'netease' },
        { id: 'tr_demo_2', title: '凌晨两点的最后一班车', artist: '颜 · 私人歌单', album: '', url: '', pic: '', lrc: '', via: 'netease' },
        { id: 'tr_demo_3', title: '把外套借给你', artist: '颜 · 私人歌单', album: '', url: '', pic: '', lrc: '', via: 'netease' },
        { id: 'tr_demo_4', title: '雨停之前不回家', artist: '颜 · 私人歌单', album: '', url: '', pic: '', lrc: '', via: 'netease' },
        { id: 'tr_demo_5', title: '明早还要上班', artist: '颜 · 私人歌单', album: '', url: '', pic: '', lrc: '', via: 'netease' },
      ],
    },
    {
      id: 'pl_demo_qishui',
      source: 'qishui',
      remoteId: 'demo-qishui',
      name: '算了挺没意思喜欢的音乐',
      cover: '',
      link: '',
      importedAt: Date.now() - 3600000,
      tracks: [
        { id: 'tr_demo_q1', title: 'APT.', artist: 'ROSÉ, Bruno Mars', album: 'APT.', url: '', pic: '', lrc: '', via: 'qishui' },
        { id: 'tr_demo_q2', title: 'golden hour', artist: 'JVKE', album: 'golden hour', url: '', pic: '', lrc: '', via: 'qishui' },
        { id: 'tr_demo_q3', title: 'Believer', artist: 'Imagine Dragons', album: 'Evolve', url: '', pic: '', lrc: '', via: 'qishui' },
        { id: 'tr_demo_q4', title: 'Count on me', artist: 'Bruno Mars', album: 'Doo-Wops & Hooligans', url: '', pic: '', lrc: '', via: 'qishui' },
      ],
    },
  ];
  state.music.activeId = 'pl_demo_late';
  state.music.current = { playlistId: 'pl_demo_late', trackId: 'tr_demo_1' };

  const shen = addContact(state, { name: '沈砚', signature: '加班别等我了', status: 'online' });
  const jiang = addContact(state, { name: '江迟', signature: '在听老歌', status: 'busy' });
  const lin = addContact(state, { name: '林小满', signature: '今天有雨', status: 'online' });
  const gu = addContact(state, { name: '顾南风', signature: '路过书店', status: 'away' });
  const group = addContact(state, { name: '周末局', kind: 'group', members: [shen.id, jiang.id, lin.id], signature: '5 人' });

  state.characters = [
    {
      name: '沈砚', avatar: 'shen.png', avatarUrl: '', tags: ['都市', '加班', '夜宵'],
      description: '做工程的男人，二十八岁。白天在工地，晚上回办公室改图纸。说话短，习惯先把事情做完再解释。',
      personality: '克制、话少、记性好。不会追问，但会记得你上次说过的事。',
      scenario: '夜里十点，他靠在便利店门口的电动车上，等你下班。',
      firstMes: '到楼下了，今天风有点大。',
      creator: 'meme-phone', version: '1.0',
      demoBooks: [
        {
          name: '沈砚的世界',
          entries: [
            { uid: '0', title: '工地', keys: ['工地', '项目'], content: '城西的旧改项目，沈砚盯了三年的地方。塔吊下面总有一家凌晨还开着的面馆。', disabled: false, constant: false, order: 1 },
            { uid: '1', title: '便利店', keys: ['便利店', '夜班'], content: '你上夜班的那家便利店，冰柜第二层永远放着两瓶温过的牛奶。', disabled: false, constant: false, order: 2 },
            { uid: '2', title: '旧电动车', keys: ['电动车', '后座'], content: '沈砚那辆骑了五年的电动车，后座绑着一块洗得发白的垫子。', disabled: true, constant: false, order: 3 },
          ],
        },
        {
          name: '夜班人物',
          entries: [
            { uid: '0', title: '老赵', keys: ['老赵', '店长'], content: '便利店店长，五十多岁，总把「早点回去」挂在嘴边，但从不真的赶人。', disabled: false, constant: true, order: 1 },
            { uid: '1', title: '小满的早饭', keys: ['小满', '早饭'], content: '林小满每天早上会多带一份早饭，放在你桌角，不问你要不要。', disabled: false, constant: false, order: 2 },
          ],
        },
      ],
    },
    {
      name: '江迟', avatar: 'jiang.png', avatarUrl: '', tags: ['音乐', '夜里', '旧歌'],
      description: '在唱片店做店员，喜欢把整张专辑听完再换。手机里存着一堆演唱会现场录音。',
      personality: '慢热，聊到喜欢的东西会突然话多。',
      scenario: '车里，副歌刚进来的时候。',
      firstMes: '那首歌我循环了一下午。',
      creator: 'meme-phone', version: '1.0',
    },
    {
      name: '林小满', avatar: 'lin.png', avatarUrl: '', tags: ['雨天', '同事', '碎嘴'],
      description: '同层的同事，工位在你斜对面。每天带两份早饭，一份给自己，一份放在你桌上。',
      personality: '话多、爱打听、其实很会看人脸色。',
      scenario: '下班前十分钟，外面开始下雨。',
      firstMes: '下班了吗，雨好大。',
      creator: 'meme-phone', version: '1.0',
    },
    {
      name: '顾南风', avatar: 'gu.png', avatarUrl: '', tags: ['书店', '安静', '旧友'],
      description: '在旧书店做事，认得每本书放在哪一格。你们认识很久了，见面也不一定说话。',
      personality: '安静，慢，记得住别人随口提过的小事。',
      scenario: '书店快打烊，他把最后一批书搬回架子。',
      firstMes: '你上次找的那本，到了。',
      creator: 'meme-phone', version: '1.0',
    },
  ];

  const chatShen = addChat(state, shen.id, {
    id: 'ch_demo_shen',
    messages: [
      { from: 'them', text: '到楼下了，今天风有点大。', at: at(21, 2) },
      { from: 'me', text: '我还在加班，别等我了。', at: at(21, 10) },
      { from: 'them', text: '那就等你到八点，便利店坐会儿。', at: at(21, 24) },
      { from: 'me', text: '八点真不一定能走。', at: at(21, 41) },
      { from: 'me', text: '你先回去。', at: at(22, 6) },
      { from: 'them', text: '我到了，路上小心。', at: at(22, 40), quote: { text: '你先回去。', from: 'me' } },
      { from: 'them', text: '我的意思是，你要是坚持加班，我就只好把你那份夜宵先吃了。', at: at(22, 44), proactive: true, kind: 'proactive' },
    ],
  });
  chatShen.unread = 2;

  const chatJiang = addChat(state, jiang.id, {
    messages: [
      { from: 'them', text: '那首歌我循环了一下午。', at: at(18, 30) },
      { from: 'me', text: '哪首？', at: at(19, 2) },
      { from: 'them', text: '就你上次在车上放的那首。', at: at(19, 20) },
    ],
  });

  const chatLin = addChat(state, lin.id, {
    messages: [
      { from: 'them', text: '下班了吗，雨好大。', at: at(20, 5) },
      { from: 'me', text: '还在公司。', at: at(20, 21) },
    ],
  });

  const chatGu = addChat(state, gu.id, {
    messages: [
      { from: 'them', text: '我在书店看到一本你可能会喜欢的。', at: at(17, 40) },
    ],
  });
  chatGu.unread = 1;

  const chatGroup = addChat(state, group.id, {
    kind: 'group',
    messages: [
      { from: 'system', text: '你把「沈砚」拉进了群聊', at: at(15, 12), kind: 'system' },
      { from: 'them', text: '周六老地方？', at: at(15, 20) },
      { from: 'them', text: '我带吉他。', at: at(16, 2) },
    ],
  });

  writeDiary(state, '2026-11-10', '十点半他才到楼下，外套领子立着，靠在电动车上抬头看我的窗。\n「你今天又没吃饭吧。」他说得像是早就知道。\n便利店的灯太白，我坐在台阶上啃了半个饭团，他把剩下半个吃了，说味道还行。', { tags: ['沈砚', '夜宵'] });
  writeDiary(state, '2026-11-08', '雨。伞在办公室，走回去的时候鞋全湿了。\n林小满发来一张窗外的照片，说「你那边也下吗」。\n我说下。她说那我们算看见同一场雨。', { tags: ['林小满', '雨'] });

  state.diary.entries['2026-11-09'] = { key: '2026-11-09', text: '', tags: [], auto: false, createdAt: 0 };


  state.extras[shen.id] = [
    { id: 'x1', title: '楼下的便利店', date: '2026-11-10', messageId: 'ch_demo_shen_m0', chatId: 'ch_demo_shen', lines: ['他把外套领子立起来，靠在电动车上抬头看我的窗户。', '灯管太白，照得人有点狼狈。'] },
    { id: 'x2', title: '第 41 分钟', date: '2026-11-06', lines: ['他说等 41 分钟就走。', '结果等到第 58 分钟。'] },
  ];
  state.extras[jiang.id] = [
    { id: 'x3', title: '车里那首歌', date: '2026-11-02', lines: ['副歌进来的时候他跟着哼了一句。'] },
  ];

  state.plans = [
    { id: 'p1', title: '把周三晚上空出来', detail: '晚上九点以后不排任何事，等他下班。', done: false, date: '2026-11-12' },
    { id: 'p2', title: '读完那本书的第三部分', detail: '地铁上读，不要刷手机。', done: true, date: '2026-11-09' },
  ];

  return state;
}

function at(hour, minute) {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

/* ---------------------------------------------------------------- 迁移 */

/** 读取旧文件时补齐缺失字段，永远不因为缺字段白屏。 */
export function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const merged = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    diary: { ...base.diary, ...(raw.diary || {}), entries: { ...(raw.diary?.entries || {}) }, contacts: {} },
    dress: { ...base.dress, ...(raw.dress || {}) },
    draw: {
      ...base.draw,
      ...(raw.draw || {}),
      config: { ...base.draw.config, ...(raw.draw?.config || {}) },
      presets: Array.isArray(raw.draw?.presets) && raw.draw.presets.length ? raw.draw.presets : base.draw.presets,
      history: Array.isArray(raw.draw?.history) ? raw.draw.history : [],
    },
  };
  delete merged.membership;
  delete merged.favorites;
  delete merged.wallet;
  for (const [contactId, entries] of Object.entries(raw.diary?.contacts || {})) {
    if (!contactId || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    merged.diary.contacts[contactId] = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (entry && typeof entry === 'object' && typeof entry.text === 'string') {
        merged.diary.contacts[contactId][key] = entry;
      }
    }
  }
  merged.settings.api = { ...base.settings.api, ...(raw.settings?.api || {}) };
  merged.settings.user = { ...base.settings.user, ...(raw.settings?.user || {}) };
  delete merged.settings.summary;
  const memoryRaw = raw.settings?.memory;
  const memoryList = Array.isArray(memoryRaw?.presets) ? memoryRaw.presets : [];
  const memoryPresets = memoryList
    .filter(item => item && typeof item === 'object' && String(item.name || '').trim())
    .map((item, index) => ({
      id: String(item.id || `mem_${index + 1}`),
      name: String(item.name).trim().slice(0, 20),
      mode: ['auto', 'summary', 'recent'].includes(item.mode) ? item.mode : 'auto',
      floors: Math.max(1, Math.min(50, Number(item.floors) || 10)),
      skipFirstFloor: Boolean(item.skipFirstFloor),
    }));
  merged.settings.memory = {
    ...base.settings.memory,
    ...(memoryRaw && typeof memoryRaw === 'object' ? memoryRaw : {}),
    presets: memoryPresets.length ? memoryPresets : base.settings.memory.presets,
  };
  if (!merged.settings.memory.presets.some(item => item.id === merged.settings.memory.activeId)) {
    merged.settings.memory.activeId = merged.settings.memory.presets[0].id;
  }
  const replyRaw = raw.settings?.reply;
  const replyList = Array.isArray(replyRaw?.presets) ? replyRaw.presets : [];
  const replyPresets = [];
  const seenReplyIds = new Set();
  replyList.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    let id = String(item.id || `reply_${index + 1}`).trim().slice(0, 40);
    if (!id || seenReplyIds.has(id)) id = `reply_${index + 1}_${seenReplyIds.size}`;
    seenReplyIds.add(id);
    replyPresets.push({
      id,
      name: String(item.name || '').trim().slice(0, 20) || `预设 ${index + 1}`,
      text: String(item.text || '').trim().slice(0, 3000),
      context: normalizeReplyContext(item.context),
      items: normalizeReplyItems(item.items),
    });
  });
  merged.settings.reply = {
    ...base.settings.reply,
    ...(replyRaw && typeof replyRaw === 'object' ? replyRaw : {}),
    presets: replyPresets.length ? replyPresets : base.settings.reply.presets,
  };
  if (!merged.settings.reply.presets.some(item => item.id === merged.settings.reply.activeId)) {
    merged.settings.reply.activeId = merged.settings.reply.presets[0].id;
  }
  merged.settings.customWall = typeof raw.settings?.customWall === 'string' ? raw.settings.customWall : '';
  const dressRaw = raw.settings?.dress && typeof raw.settings.dress === 'object' && !Array.isArray(raw.settings.dress)
    ? raw.settings.dress
    : {};
  const iconsRaw = dressRaw.icons && typeof dressRaw.icons === 'object' && !Array.isArray(dressRaw.icons)
    ? dressRaw.icons
    : {};
  const icons = {};
  for (const [appId, value] of Object.entries(iconsRaw)) {
    if (!appId || !value || typeof value !== 'object') continue;
    const shape = typeof value.shape === 'string' ? value.shape.trim().slice(0, 40) : '';
    const image = typeof value.image === 'string' && value.image.startsWith('data:image/') && value.image.length < 400000
      ? value.image
      : '';
    if (shape || image) icons[String(appId).slice(0, 40)] = { ...(shape ? { shape } : {}), ...(image ? { image } : {}) };
  }
  merged.settings.dress = {
    ...base.settings.dress,
    ...dressRaw,
    font: ['system', 'rounded', 'serif', 'kai'].includes(dressRaw.font) ? dressRaw.font : base.settings.dress.font,
    fontSize: Math.max(0.85, Math.min(1.3, Number(dressRaw.fontSize) || 1)),
    lineHeight: Math.max(0.9, Math.min(1.3, Number(dressRaw.lineHeight) || 1)),
    fontWeight: [400, 500, 600].includes(Number(dressRaw.fontWeight)) ? Number(dressRaw.fontWeight) : 400,
    island: dressRaw.island === 'hide' ? 'hide' : 'show',
    icons,
  };
  if (merged.settings.wallpaper === 'custom' && !merged.settings.customWall) merged.settings.wallpaper = 'day';
  merged.settings.image = {
    ...base.settings.image,
    ...(raw.settings?.image || {}),
    novelai: { ...base.settings.image.novelai, ...(raw.settings?.image?.novelai || {}) },
    doubao: { ...base.settings.image.doubao, ...(raw.settings?.image?.doubao || {}) },
    custom: { ...base.settings.image.custom, ...(raw.settings?.image?.custom || {}) },
  };
  /* 一次性迁移：以前绘图是借聊天 API 预设里那套，现在搬进独立的 settings.image */
  if (!raw.settings?.image) {
    const legacy = (raw.settings?.api?.presets || []);
    const old = legacy.find(item => item.id === raw.settings?.api?.activeImage)
      || legacy.find(item => item.engine === 'novelai');
    if (old?.url || old?.key) {
      merged.settings.image.novelai = {
        url: old.url || merged.settings.image.novelai.url,
        key: old.key || '',
        model: old.model || merged.settings.image.novelai.model,
      };
    }
    const cfg = raw.draw?.config || {};
    if (!old && cfg.url) {
      merged.settings.image.engine = 'custom';
      merged.settings.image.custom = { url: cfg.url, key: cfg.key || '', model: cfg.model || '', path: '/v1/images/generations' };
    }
  }
  /* 旧存档默认是「透明」，一次性改回铺壁纸；之后自己选了透明不再覆盖 */
  if (!merged.settings.wallMigrated) {
    merged.settings.wallMigrated = true;
    if (merged.settings.wallpaper === 'none') merged.settings.wallpaper = 'day';
  }
  merged.settings.userMode = raw.settings?.userMode === 'pin' ? 'pin' : 'follow';
  merged.users = Array.isArray(raw.users) ? raw.users.filter(item => item && (item.key || item.name)) : [];
  merged.characters = Array.isArray(raw.characters) ? raw.characters.filter(item => item && item.name) : [];
  merged.charactersFromTavern = Boolean(raw.charactersFromTavern);
  merged.lookups = (raw.lookups && typeof raw.lookups === 'object' && !Array.isArray(raw.lookups)) ? raw.lookups : {};
  merged.usersFromTavern = Boolean(raw.usersFromTavern);
  merged.settings.api.presets = Array.isArray(merged.settings.api.presets) && merged.settings.api.presets.length
    ? merged.settings.api.presets
    : base.settings.api.presets;

  /* LLM 整体方案：旧存档没有就按当前 API + 当前记忆补一套默认方案 */
  const apiIds = new Set(merged.settings.api.presets.map(item => item.id));
  const memoryIds = new Set(merged.settings.memory.presets.map(item => item.id));
  const replyIds = new Set(merged.settings.reply.presets.map(item => item.id));
  const fallbackApiId = apiIds.has(merged.settings.api.activeChat)
    ? merged.settings.api.activeChat
    : merged.settings.api.presets[0].id;
  const fallbackMemoryId = memoryIds.has(merged.settings.memory.activeId)
    ? merged.settings.memory.activeId
    : merged.settings.memory.presets[0].id;
  const rawSchemes = Array.isArray(raw.settings?.api?.chatSchemes) ? raw.settings.api.chatSchemes : [];
  const seenSchemeIds = new Set();
  const chatSchemes = [];
  rawSchemes.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    let id = String(item.id || `lsch_${index + 1}`);
    if (seenSchemeIds.has(id)) id = `lsch_${index + 1}_${seenSchemeIds.size}`;
    seenSchemeIds.add(id);
    chatSchemes.push({
      id,
      name: String(item.name || `方案 ${index + 1}`).trim().slice(0, 20) || `方案 ${index + 1}`,
      apiId: apiIds.has(item.apiId) ? item.apiId : fallbackApiId,
      memoryId: memoryIds.has(item.memoryId) ? item.memoryId : fallbackMemoryId,
      replyId: replyIds.has(item.replyId) ? item.replyId : merged.settings.reply.activeId,
    });
  });
  if (!chatSchemes.length) {
    chatSchemes.push({
      id: 'lsch_default', name: '默认', apiId: fallbackApiId, memoryId: fallbackMemoryId,
      replyId: merged.settings.reply.activeId,
    });
  }
  const wantedScheme = String(merged.settings.api.chatSchemeId || '');
  const chatScheme = chatSchemes.find(item => item.id === wantedScheme) || chatSchemes[0];
  merged.settings.api.chatSchemes = chatSchemes;
  merged.settings.api.chatSchemeId = chatScheme.id;
  if (!apiIds.has(merged.settings.api.activeChat)) merged.settings.api.activeChat = chatScheme.apiId;
  if (!memoryIds.has(merged.settings.memory.activeId)) merged.settings.memory.activeId = chatScheme.memoryId;
  if (!replyIds.has(merged.settings.reply.activeId)) merged.settings.reply.activeId = chatScheme.replyId;
  merged.version = SCHEMA_VERSION;
  merged.contacts = merged.contacts || {};
  merged.chats = merged.chats || {};
  merged.plans = Array.isArray(merged.plans) ? merged.plans : [];
  merged.music = {
    ...base.music,
    ...(raw.music && typeof raw.music === 'object' ? raw.music : {}),
  };
  merged.music.playlists = Array.isArray(merged.music.playlists)
    ? merged.music.playlists.filter(item => item && Array.isArray(item.tracks))
    : [];
  merged.music.current = merged.music.current && typeof merged.music.current === 'object'
    ? merged.music.current
    : null;
  merged.extras = merged.extras || {};
  merged.emoji = Array.isArray(merged.emoji) && merged.emoji.length ? merged.emoji : base.emoji;
  for (const [chatId, chat] of Object.entries(merged.chats)) {
    chat.messages = Array.isArray(chat.messages)
      ? chat.messages.map((message, index) => ({ id: message.id || `${chatId}_m${index}`, ...message }))
      : [];
    chat.unread = chat.unread || 0;
  }
  return merged;
}
