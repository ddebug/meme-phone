/**
 * meme-phone · 数据模型
 *
 * 这里是唯一的真源：所有页面只读这一份对象，改动后调用 store.touch() 落盘。
 * 数据结构刻意保持扁平，避免旧版那种「十个模块共享一个巨型对象、谁都改它」的局面。
 */

import { FULL_REPLY_ITEM_DEFS } from './preset-defaults.js';
import { normalizeBehavior, behaviorPreview } from './behavior.js';

export const SCHEMA_VERSION = 2;

/* 回复预设除了「怎么说」，还要决定「给模型看哪些上下文」。
 * 这一组开关沿用旧独立小手机的 QQ 预设：角色档案、用户设定、聊天记录、记忆、时间。 */
export const DEFAULT_REPLY_CONTEXT = {
  character: true,
  user: true,
  signature: true,
  emoji: true,
  lorebook: true,
  memory: true,
  scene: true,
  history: true,
  historyLimit: 10,
  time: true,
  /* 世界书：扫最近几条聊天做关键词命中；单次注入字数上限；整套上下文的硬预算 */
  bookFloors: 10,
  bookBudget: 2000,
  charBudget: 8000,
};

/** 回复指令在条目列表里的固定 id：它是普通条目，不再单独置顶。 */
export const REPLY_INSTRUCTION_ID = 'reply_item_main';

export function replyInstructionItem(content, order = 2.5) {
  return {
    id: REPLY_INSTRUCTION_ID,
    label: '回复指令',
    role: 'system',
    kind: 'chat',
    auto: '',
    app: '',
    characters: [],
    content: String(content || '').trim().slice(0, 4000),
    enabled: true,
    editable: true,
    deletable: true,
    note: '',
    group: 'group_chat',
    order: Number.isFinite(Number(order)) ? Number(order) : 2.5,
  };
}

/** 把回复指令放进条目列表；已有同 id 条目时不重复。 */
export function withReplyInstruction(items, content, order = 2.5) {
  const text = String(content || '').trim().slice(0, 4000);
  const list = (Array.isArray(items) ? items : []).filter(item => item?.id !== REPLY_INSTRUCTION_ID).map(item => ({ ...item }));
  if (!text) return list;
  list.push(replyInstructionItem(text, order));
  return list
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
    .map((item, index) => ({ ...item, order: index }));
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, Math.round(num)));
}

/** 只保留下限、不设上限：历史小手机条数允许任意正整数，超长部分由整套字数预算裁剪。 */
function clampMin(value, min, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.round(num));
}

export function normalizeReplyContext(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    character: source.character !== false,
    user: source.user !== false,
    signature: source.signature !== false,
    emoji: source.emoji !== false,
    lorebook: source.lorebook !== false,
    memory: source.memory !== false,
    scene: source.scene !== false,
    history: source.history !== false,
    historyLimit: clampMin(source.historyLimit, 1, DEFAULT_REPLY_CONTEXT.historyLimit),
    time: source.time !== false,
    bookFloors: clampNumber(source.bookFloors, 1, 50, DEFAULT_REPLY_CONTEXT.bookFloors),
    bookBudget: clampNumber(source.bookBudget, 400, 6000, DEFAULT_REPLY_CONTEXT.bookBudget),
    charBudget: clampNumber(source.charBudget, 2000, 20000, DEFAULT_REPLY_CONTEXT.charBudget),
  };
}

/* 预设条目分组：默认把聊天行为、上下文注入、其他软件分成三组。
 * 分组只影响编辑页的归类和阅读顺序，不改变条目真正拼接时的 order。 */
export const DEFAULT_REPLY_GROUPS = [
  { id: 'group_chat', name: '聊天行为', kind: 'chat' },
  { id: 'group_context', name: '上下文注入', kind: 'context' },
  { id: 'group_app', name: '其他软件', kind: 'app' },
];

export function normalizeReplyGroups(raw) {
  const source = Array.isArray(raw) && raw.length ? raw : DEFAULT_REPLY_GROUPS;
  const groups = [];
  const seen = new Set();
  source.slice(0, 48).forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    let id = String(item.id || `group_${index + 1}`).trim().slice(0, 40);
    if (!id || seen.has(id)) id = `group_${index + 1}_${seen.size}`;
    seen.add(id);
    const name = String(item.name || '').trim().slice(0, 20);
    if (!name) return;
    const kind = item.kind === 'context' ? 'context' : item.kind === 'app' ? 'app' : 'chat';
    groups.push({ id, name, kind });
  });
  if (!groups.length) {
    return DEFAULT_REPLY_GROUPS.map(group => ({ ...group }));
  }
  return groups;
}

/** 条目落在哪一组：先看自己存的分组，再按类型找默认组，最后回退第一组。 */
export function replyGroupIdFor(item, groups) {
  const list = Array.isArray(groups) && groups.length ? groups : DEFAULT_REPLY_GROUPS;
  const ids = new Set(list.map(group => group.id));
  if (item?.group && ids.has(String(item.group))) return String(item.group);
  const kind = item?.kind === 'context' ? 'context' : item?.kind === 'app' ? 'app' : 'chat';
  const match = list.find(group => group.kind === kind);
  return (match || list[0]).id;
}

/** 按真正的上下文顺序，把同名分组切成一段段连续的位置块。
 *  同一组只能覆盖相邻条目；中间夹了别组条目，就拆成新的位置块，
 *  这样渲染时不会把不同位置的条目强行并到一个分组里。 */
export function positionalReplyGroups(items, rawGroups) {
  const base = normalizeReplyGroups(rawGroups);
  const list = (Array.isArray(items) ? items : [])
    .slice()
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  const groups = [];
  const used = new Set();
  let lastBase = '';
  let lastGroup = null;
  list.forEach(item => {
    const baseId = replyGroupIdFor(item, base);
    const baseGroup = base.find(group => group.id === baseId) || base[0];
    if (baseId !== lastBase || !lastGroup) {
      let id = baseGroup.id;
      let n = 0;
      while (used.has(id)) {
        n += 1;
        id = `${baseGroup.id}_p${n}`;
      }
      used.add(id);
      lastGroup = { id, name: baseGroup.name, kind: baseGroup.kind };
      groups.push(lastGroup);
      lastBase = baseId;
    }
    item.group = lastGroup.id;
  });
  /* 空的「其他软件」不在聊天上下文里，保留在列表底部，方便继续加 app 条目。 */
  base.forEach(group => {
    if (group.kind === 'app' && !groups.some(item => item.id === group.id)) groups.push({ ...group });
  });
  return groups;
}

/* 会话级历史读取覆盖：预设只放占位，具体读多少由角色聊天决定。
 * 0 / 空字符串 = 跟随预设或记忆方案，不写死默认值，旧会话保持原行为。 */
export const DEFAULT_CHAT_HISTORY = {
  phoneLimit: 0,       // 0 跟随回复预设的 historyLimit；任意正整数是这个小手机最近几条
  tavernMode: '',      // '' 跟随记忆方案；summary 全部总结；recent 最近 N 层原文
  tavernFloors: 0,     // 0 跟随记忆方案；1–50 是最近几层酒馆聊天
};

export function normalizeChatHistory(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    phoneLimit: clampMin(source.phoneLimit, 0, 0),
    tavernMode: ['summary', 'recent'].includes(source.tavernMode) ? source.tavernMode : '',
    tavernFloors: clampNumber(source.tavernFloors, 0, 50, 0),
  };
}

export function chatHistoryFor(chat) {
  return normalizeChatHistory(chat?.history);
}

/** 这个小手机聊天注入最近几条：会话覆盖 > 回复预设；返回值至少 1。 */
export function effectivePhoneHistoryLimit(chat, context) {
  const own = chatHistoryFor(chat).phoneLimit;
  if (own > 0) return own;
  return clampMin(context?.historyLimit, 1, DEFAULT_REPLY_CONTEXT.historyLimit);
}

/** 这个角色读酒馆总结还是原文、读几层：会话覆盖 > 角色记忆开关 > 记忆方案。 */
export function effectiveTavernHistory(state, chat, preset) {
  const own = chatHistoryFor(chat);
  const wanted = own.tavernMode || memoryReadModeFor(state, chat?.contactId, preset);
  const mode = wanted === 'summary' ? 'summary' : wanted === 'recent' ? 'recent' : 'auto';
  const floors = own.tavernFloors > 0
    ? own.tavernFloors
    : clampNumber(preset?.floors, 1, 50, 10);
  return { mode, floors, fromChat: Boolean(own.tavernMode || own.tavernFloors) };
}

/* 旧 QQ 预设把上下文注入也做成列表里的条目，而不是列表下面的一组开关：
 * 用户设定、角色档案、聊天记录、时间信息各自有 role 和顺序，能单独开关、能排序。
 * 这里沿用同一套做法，新增 kind:'context' + auto 字段；内容是运行时从手机/酒馆读取的。 */
export const REPLY_CONTEXT_KEYS = ['user', 'signature', 'character', 'lorebook', 'memory', 'scene', 'emoji', 'history', 'time'];

export const REPLY_CONTEXT_SPECS = {
  user: {
    id: 'reply_context_user',
    label: '用户角色设定',
    role: 'system',
    content: '__AUTO_USER_PERSONA__',
    note: '我的名字和设定',
    hintOrder: 1.51,
  },
  signature: {
    id: 'reply_context_signature',
    label: '个签历史 - 用户个性签名',
    role: 'system',
    content: '__AUTO_SIGNATURE_HISTORY__',
    note: '当前签名；没有历史回退',
    hintOrder: 1.515,
  },
  character: {
    id: 'reply_context_character',
    label: '角色档案',
    role: 'system',
    content: '__AUTO_CHARACTERS__',
    note: '角色卡的人设和性格',
    hintOrder: 1.52,
  },
  lorebook: {
    id: 'reply_context_lorebook',
    label: '人设世界书',
    role: 'system',
    content: '__AUTO_LOREBOOK__',
    note: '只看当前人设绑定的那本，常驻 + 关键词命中',
    hintOrder: 1.53,
  },
  memory: {
    id: 'reply_context_memory',
    label: '历史酒馆消息',
    role: 'system',
    content: '__AUTO_MEMORY__',
    note: '全部总结或最近 N 层酒馆原文，角色聊天里可改',
    hintOrder: 1.54,
  },
  scene: {
    id: 'reply_context_scene',
    label: '场景信息',
    role: 'system',
    content: '__AUTO_SCENE__',
    note: '角色卡里的场景',
    hintOrder: 1.55,
  },
  emoji: {
    id: 'reply_context_emoji',
    label: '表情包库',
    role: 'system',
    content: '__AUTO_EMOJI_LIBRARY__',
    note: '当前表情面板里的表情',
    hintOrder: 1.565,
  },
  history: {
    id: 'reply_context_history',
    label: '历史小手机消息',
    role: 'system',
    content: '__AUTO_CHAT_HISTORY__',
    note: '这个会话最近几条，角色聊天里可改',
    hintOrder: 1.56,
  },
  time: {
    id: 'reply_context_time',
    label: '时间信息',
    role: 'system',
    content: '__AUTO_TIME__',
    note: '日期、星期和时间（天气未接入）',
    hintOrder: 1.57,
  },
};

function contextItem(key, overrides = {}) {
  const spec = REPLY_CONTEXT_SPECS[key];
  return {
    id: spec.id,
    label: spec.label,
    role: spec.role,
    kind: 'context',
    auto: key,
    app: '',
    characters: [],
    content: spec.content,
    enabled: true,
    editable: false,
    deletable: false,
    group: 'group_context',
    order: spec.hintOrder,
    ...overrides,
  };
}

/** 完整默认条目：acsus 24 条 + meme 的世界书/记忆/场景 + 一条本机格式兜底。 */
export function defaultReplyItems() {
  return FULL_REPLY_ITEM_DEFS.map((def, index) => {
    if (def.context) {
      return contextItem(def.context, {
        label: def.label,
        enabled: def.enabled !== false,
        order: index,
      });
    }
    return {
      id: def.id,
      label: def.label,
      role: def.role,
      kind: 'chat',
      auto: '',
      app: '',
      characters: [],
      content: String(def.content || ''),
      enabled: def.enabled !== false,
      editable: true,
      deletable: def.deletable !== false,
      note: String(def.note || ''),
      group: 'group_chat',
      order: index,
    };
  });
}

/** 旧版三套内置预设的 13 条默认条目；只用于一次性升级，用户自建预设不动。 */
const LEGACY_DEFAULT_ITEM_IDS = [
  'reply_item_phone_task',
  'reply_item_behavior',
  'reply_context_user',
  'reply_context_character',
  'reply_context_lorebook',
  'reply_context_memory',
  'reply_context_scene',
  'reply_context_history',
  'reply_context_time',
  'reply_item_detail',
  'reply_item_chinese',
  'reply_item_format',
  'reply_item_footer',
];

function isLegacyDefaultReplyItems(items) {
  if (!Array.isArray(items) || items.length !== LEGACY_DEFAULT_ITEM_IDS.length) return false;
  const ids = items.map(item => String(item?.id || ''));
  return ids.every(id => LEGACY_DEFAULT_ITEM_IDS.includes(id));
}

/** 条目适用的角色卡：空数组 = 全部角色；最多 12 个，去重。 */
export function normalizeCharacters(raw) {
  if (!Array.isArray(raw)) return [];
  const list = [];
  raw.forEach(value => {
    const name = String(value || '').trim().slice(0, 40);
    if (name && !list.includes(name)) list.push(name);
  });
  return list.slice(0, 12);
}

export function normalizeReplyItems(raw, rawContext) {
  const context = normalizeReplyContext(rawContext);
  const source = Array.isArray(raw) ? raw : defaultReplyItems();
  const seenAuto = new Set();
  const items = source.slice(0, 32).map((item, index) => {
    const order = Number(item?.order);
    const auto = REPLY_CONTEXT_KEYS.includes(item?.auto) ? item.auto : '';
    if (auto) {
      if (seenAuto.has(auto)) return null;
      seenAuto.add(auto);
      const spec = REPLY_CONTEXT_SPECS[auto];
      return {
        ...contextItem(auto),
        id: spec.id,
        label: spec.label,
        enabled: item?.enabled !== undefined ? item.enabled !== false : context[auto] !== false,
        characters: normalizeCharacters(item?.characters),
        group: String(item?.group || 'group_context').trim().slice(0, 40),
        order: Number.isFinite(order) ? order : spec.hintOrder,
      };
    }
    const role = ['system', 'user', 'assistant'].includes(item?.role) ? item.role : 'system';
    const kind = item?.kind === 'app' ? 'app' : 'chat';
    return {
      id: String(item?.id || newId('item')),
      label: String(item?.label || '').trim().slice(0, 30) || `条目 ${index + 1}`,
      role,
      kind,
      auto: '',
      app: kind === 'app' ? String(item?.app || '').trim().slice(0, 20) : '',
      characters: normalizeCharacters(item?.characters),
      content: String(item?.content || '').trim().slice(0, 4000),
      enabled: item?.enabled !== false,
      editable: item?.editable !== false,
      deletable: item?.deletable !== false,
      note: String(item?.note || '').trim().slice(0, 60),
      group: String(item?.group || '').trim().slice(0, 40),
      order: Number.isFinite(order) ? order : index,
    };
  }).filter(Boolean);
  /* 老预设里没有上下文条目时补进列表；用 hintOrder 插到聊天条目之间，保持旧 QQ 的同一列表形态。 */
  REPLY_CONTEXT_KEYS.forEach(key => {
    if (seenAuto.has(key)) return;
    items.push(contextItem(key, { enabled: context[key] !== false }));
  });
  /* 旧版本创建的预设没有「回复格式要求 / 尾部」，补上这两条固定条目；
   * 其他聊天条目可能被用户删过，不强行加回来。 */
  ['reply_item_format', 'reply_item_footer'].forEach(id => {
    if (items.some(item => item.id === id)) return;
    const fixed = defaultReplyItems().find(item => item.id === id);
    if (fixed) items.push({ ...fixed });
  });
  return items.sort((a, b) => a.order - b.order).map((item, index) => ({ ...item, order: index }));
}

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    createdAt: Date.now(),
    settings: {
      theme: 'day',              // day | night
      wallpaper: 'day',          // day | night | none | custom（默认是素色渐变，不透出酒馆背景；不再铺照片）
      customWall: '',            // 自定义壁纸的 data URL
      /* 装扮：字体、字号、行距、灵动岛、每个 App 的自定义图标 */
      dress: {
        font: 'system',          // system | rounded | serif | kai
        fontSize: 1,             // 0.85–1.3，只影响文字，不放大手机壳
        lineHeight: 1,           // 0.9–1.3
        fontWeight: 400,         // 400 | 500 | 600
        theme: 'default',        // default | frost 白色磨砂气泡 | pixel 像素小兔桌面
        island: 'show',          // show | hide
        icons: {},               // appId -> { shape?: iconName, image?: dataURL }
      },
      user: { name: '我', avatar: '', key: '' },
      /* 主界面顶栏：签名自己写，横幅图自己挑；空着就用酒馆里那份 */
      profile: { bio: '', banner: '' },
      /* 小剧场：类型影响这一轮写什么；按角色开关仍走 extrasOn */
      theater: { kind: 'daily' },
      userMode: 'follow',        // follow 跟随酒馆 | pin 固定一个
      pinnedUser: '',            // pin 时用哪个酒馆用户（persona 头像文件名）
      proactive: { enabled: true, idleMinutes: 120, dailyCount: 5 },
      chat: {
        showTime: true, enterToSend: false, remind: true, wake: true, debugBar: false,
        /* 行为标签：默认只放开约定计划和个签，转账/会员/好友申请要自己开 */
        behavior: { transfer: false, redpacket: false, membership: false, plan: true, friend: false, signature: true },
      },
      /* 酒馆记忆方案：默认有酒馆总结就用总结，没有就取最近 10 层酒馆聊天 */
      memory: {
        activeId: 'mem_auto',
        presets: [
          { id: 'mem_auto', name: '默认', mode: 'auto', floors: 10, skipFirstFloor: false },
          { id: 'mem_summary', name: '只看总结', mode: 'summary', floors: 10, skipFirstFloor: false },
          { id: 'mem_recent', name: '最近原文', mode: 'recent', floors: 20, skipFirstFloor: false },
        ],
        /* 手机默认读总结还是原文；按角色单独设过的，写在 byContact 里 */
        readMode: 'summary',
        byContact: {},
      },
      /* 回复预设：真正告诉模型「这通聊天该怎么说话」的一段指令 */
      reply: {
        activeId: 'reply_natural',
        presets: [
          {
            id: 'reply_natural', name: '自然发消息',
            text: '',
            context: { ...DEFAULT_REPLY_CONTEXT },
            groups: DEFAULT_REPLY_GROUPS.map(group => ({ ...group })),
            items: withReplyInstruction(defaultReplyItems(), '像平时发微信一样回消息：口语、短句，一次只回一两句。不要写旁白、括号里的动作，也不要写成小说段落。', 2.5),
          },
        ],
      },
      api: {
        activeChat: '', activeImage: '', presets: [
          { id: 'api_default', name: '酒馆 API', engine: 'tavern', url: '', path: '', model: '', key: '', temp: 0.8 },
        ],
        /* LLM 整体方案 = 一套聊天 API + 一套回复预设，不关联酒馆记忆 */
        chatSchemes: [
          { id: 'lsch_default', name: '默认', apiId: 'api_default', replyId: 'reply_natural' },
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
    diary: { enabled: true, entries: {}, contacts: {}, prompt: DEFAULT_DIARY_PROMPT, lastGenerated: '' },
    emoji: DEFAULT_EMOJI.map((item, index) => ({ id: `e${index + 1}`, ...item })),
    plans: [],
    music: {
      playlists: [],
      activeId: '',
      current: null,
    },
    extras: {},
    extrasOn: [],
    favorites: [],
    /* 行为功能：钱包、会员、约定计划、好友申请、个签历史 */
    wallet: { balance: 0, transactions: [] },
    membership: { user: { type: 'none', expireAt: 0, queue: [], history: [] }, byContact: {} },
    appointments: { byContact: {} },
    friendRequests: [],
    signatures: { byContact: {} },
    dress: { accent: '#8e7bf2' },
  };
}

export const DEFAULT_DIARY_PROMPT = `站在角色自己的视角写日记，第一人称“我”指日记作者，而不是用户。
根据角色资料和完整聊天历史保持角色的身份、语气及与用户的关系。
按指定日期分别写，每篇按时间顺序，标出大概几点。适度压缩重要事件、互动、感受和关系变化，不要逐句复述。
不强制保留用户原话；确有必要时可择要引用，但引用必须与原文一致，不伪造原话。
只记录聊天中能确认的事情。隔天转述的旧事要说明是当日回顾；不编造线下行动、关系或动机，不把猜测当成事实。
保持角色平时的语感，不要写成说明书。`;
export const DIARY_SKIP_THRESHOLD = 20;

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
    /* 卡片自己的名字单独记一份：用户改备注时不动它，同步时才知道该不该跟着卡片改名 */
    cardName: contact.cardName || '',
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
  const lastAt = messages.length ? Number(messages[messages.length - 1]?.at) : 0;
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
    replyPresetId: options.replyPresetId || '',
    history: normalizeChatHistory(options.history),
    updatedAt: Number.isFinite(lastAt) && lastAt > 0 ? lastAt : Date.now(),
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

/** 手机全局默认：读总结（有总结就用，没有退原文）还是只读原文。 */
export function memoryGlobalReadMode(state) {
  return state?.settings?.memory?.readMode === 'recent' ? 'recent' : 'summary';
}

/**
 * 这位角色读总结还是原文。三层兜底：角色单独设过 > 方案里固定的来源 > 手机默认。
 * 返回 'auto'（有总结读总结，没有退原文）/ 'summary'（只用总结）/ 'recent'（只读原文）。
 */
export function memoryReadModeFor(state, contactId, preset) {
  const store = state?.settings?.memory || {};
  const own = contactId ? store.byContact?.[contactId] : '';
  if (own === 'auto' || own === 'recent') return own;
  if (preset?.mode === 'summary' || preset?.mode === 'recent') return preset.mode;
  return memoryGlobalReadMode(state) === 'recent' ? 'recent' : 'auto';
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
  const main = normalizeReplyItems(preset?.items, recomputeContext(preset)).find(item => item.id === REPLY_INSTRUCTION_ID);
  return String(main?.content || preset?.text || '').trim();
}

/** 配置页更新条目后，算上下文开关时用最新条目状态。 */
function recomputeContext(preset) {
  const context = normalizeReplyContext(preset?.context);
  normalizeReplyItems(preset?.items, context).forEach(item => {
    if (item.kind === 'context' && item.auto) context[item.auto] = item.enabled !== false;
  });
  return context;
}

/** 这套回复预设要注入哪些上下文：以列表里的固定上下文条目为准，historyLimit 仍存在 context。 */
export function replyContextFor(state, chat) {
  const preset = replyPresetFor(state, chat);
  const context = normalizeReplyContext(preset?.context);
  normalizeReplyItems(preset?.items, context).forEach(item => {
    if (item.kind === 'context' && item.auto) context[item.auto] = item.enabled !== false;
  });
  return context;
}

/** 这套预设的全部提示词条目（包含关闭的，给设置页用）。 */
export function replyItemsFor(state, chat) {
  const preset = replyPresetFor(state, chat);
  return normalizeReplyItems(preset?.items, normalizeReplyContext(preset?.context));
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

/** 找到这个联系人对应的角色卡：优先头像文件名，名字兜底。 */
export function characterCardFor(state, contact) {
  const cards = Array.isArray(state?.characters) ? state.characters : [];
  if (!cards.length || !contact) return null;
  if (contact.tavernAvatar) {
    const byAvatar = cards.find(card => card.avatar && card.avatar === contact.tavernAvatar);
    if (byAvatar) return byAvatar;
  }
  /* 旧存档只有名字：仅在同名唯一时认，避免同名卡片绑错 */
  const names = [contact.cardName, contact.name].map(value => String(value || '').trim()).filter(Boolean);
  for (const name of names) {
    const same = cards.filter(card => card.name === name);
    if (same.length === 1) return same[0];
  }
  return null;
}

/** 同名角色卡不止一张：页面提示让用户自己选，不替用户绑第一张。 */
export function cardNameAmbiguous(state, contact) {
  const cards = Array.isArray(state?.characters) ? state.characters : [];
  if (!cards.length || !contact || contact.tavernAvatar) return false;
  const names = [contact.cardName, contact.name].map(value => String(value || '').trim()).filter(Boolean);
  return names.some(name => cards.filter(card => card.name === name).length > 1);
}

/** 一个联系人能被哪些写法匹配到：头像文件名、卡名、联系人名。 */
export function characterRefsFor(state, contact) {
  const card = characterCardFor(state, contact);
  return new Set([
    contact?.tavernAvatar,
    contact?.name,
    card?.avatar,
    card?.name,
  ].map(value => String(value || '').trim()).filter(Boolean));
}

/**
 * 条目是否适用于这个会话/联系人。
 * characters 为空 = 全部角色；群聊按约定只吃公共条目，具体角色条目只在一对一生效。
 */
export function itemAppliesToChat(state, item, chat, contact) {
  const targets = normalizeCharacters(item?.characters);
  if (!targets.length) return true;
  if (!chat || chat.kind === 'group') return false;
  const refs = characterRefsFor(state, contact);
  return targets.some(name => refs.has(name));
}

/** 手机里保存的 LLM 整体方案：只保存一套聊天 API + 一套回复预设，不碰酒馆记忆。 */
export function chatSchemesOf(state) {
  const store = state?.settings?.api;
  return Array.isArray(store?.chatSchemes) ? store.chatSchemes : [];
}

export function activeChatScheme(state) {
  const store = state?.settings?.api;
  const list = chatSchemesOf(state);
  return list.find(item => item.id === store?.chatSchemeId) || list[0] || null;
}

/** 切一套整体方案：只换聊天 API 和回复预设，记忆留在原处，不跟着方案走。 */
export function applyChatScheme(state, scheme) {
  if (!scheme) return false;
  const store = state.settings.api;
  if (apiPresetsOf(state).some(item => item.id === scheme.apiId)) store.activeChat = scheme.apiId;
  if (replyPresetsOf(state).some(item => item.id === scheme.replyId)) state.settings.reply.activeId = scheme.replyId;
  store.chatSchemeId = scheme.id;
  return true;
}

export function lastMessage(chat) {
  const list = chat?.messages || [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index];
    if (!message || message.kind === 'recalled') continue;
    if (message.text || message.image || message.emoji || message.forward) return message;
  }
  return null;
}

/** 会话列表/收藏页共用的一句话摘要：图片、表情、转发、行为消息都别显示成空白 */
export function messagePreview(message) {
  if (!message) return '';
  if (message.kind === 'recalled') return '[已撤回]';
  const behaviorText = behaviorPreview(message);
  if (behaviorText) return behaviorText;
  if (message.kind === 'image' || message.image) return '[图片]';
  if (message.kind === 'emoji' || message.emoji) return message.emoji || '[表情]';
  if (message.forward) return `[转发] ${message.forward.text || ''}`.trim();
  return message.text || '';
}

export function pushMessage(state, chatId, message) {
  const chat = state.chats[chatId];
  if (!chat) return null;
  const kind = message.kind || 'text';
  const entry = {
    id: message.id || newId('m'),
    from: message.from || 'them',      // me | them | system
    text: message.text || '',
    at: message.at || Date.now(),
    kind,                              // text | system | extra | proactive | image | emoji | poke | recalled | forwarded | 行为类型
    turnId: message.turnId || '',      // 同一轮回复的多气泡共用一个轮次 id
    quote: message.quote || null,
    proactive: Boolean(message.proactive),
    pending: Boolean(message.pending),
    speaker: message.speaker || '',
    image: message.image || '',
    emoji: message.emoji || '',
    forward: message.forward || null,
    behavior: normalizeBehavior(kind, message.behavior),
  };
  chat.messages.push(entry);
  chat.updatedAt = entry.at;
  if (entry.from === 'them') chat.unread = (chat.unread || 0) + 1;
  return entry;
}

export function unreadTotal(state) {
  if (state.settings?.chat?.remind === false) return 0;
  return Object.values(state.chats).reduce((sum, chat) => sum + (chat.muted ? 0 : (chat.unread || 0)), 0);
}

/* 空发送永远触发主动开口：这是固定行为，不再提供全局、会话级开关 */
export function wakeAllowed(/* state, chat */) {
  return true;
}


/* ----------------------------------------------------------------- 日记 */

export function dayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 导出备份前剔除接口凭据；默认导出不含 Key，只有显式要求时才带上。 */
export function stripSecrets(state) {
  const clone = JSON.parse(JSON.stringify(state || {}));
  const blank = (obj) => {
    if (obj && typeof obj === 'object') {
      obj.key = '';
      if ('proxy_password' in obj) obj.proxy_password = '';
    }
  };
  const api = clone.settings?.api;
  if (Array.isArray(api?.presets)) api.presets.forEach(blank);
  const image = clone.settings?.image;
  if (image) {
    ['novelai', 'doubao', 'custom'].forEach(kind => blank(image[kind]));
    if (Array.isArray(image.presets)) image.presets.forEach(blank);
  }
  return clone;
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

/**
 * 小剧场类型：决定这一轮请模型写什么，以及详情页用哪套美化模板。
 * 当前先内置四种；后续类型只需要在这里加一项，页面和存储不用复制。
 */
export const THEATER_KINDS = [
  {
    id: 'daily',
    label: '日常',
    badge: '日常',
    sub: '聊天之外的小片段',
    icon: 'theater',
    page: 'paper',
    titles: ['心理活动', '小彩蛋'],
    prompt: '写一小段贴合角色和当下情境的小剧场：可以写没说出口的情绪、动作或一个生活切片；不替用户决定言行。',
  },
  {
    id: 'meta',
    label: 'Meta',
    badge: 'META',
    sub: '跳出剧情吐个槽',
    icon: 'code',
    page: 'console',
    titles: ['吐槽', '幕后注'],
    prompt: '写一段 Meta 小剧场：角色可以跳出剧情，吐槽叙事、设定或和“作者/读者”对话；不要把模型的真实推理说成角色的想法，也不要冒充系统提示。',
  },
  {
    id: 'dream',
    label: '幻想',
    badge: '梦境',
    sub: '另一种可能',
    icon: 'spark',
    page: 'dream',
    titles: ['梦境', '醒来'],
    prompt: '写一段幻想或梦境小剧场：允许意象跳跃、场景变形，但保持角色性格和关系；不替用户决定言行。',
  },
  {
    id: 'nsfw',
    label: 'NSFW',
    badge: '18+',
    sub: '克制的私密片段',
    icon: 'heart',
    page: 'velvet',
    gate: true,
    titles: ['靠近', '余温'],
    prompt: '写一段成年角色之间克制的私密小剧场：只写情绪、气氛、关系张力和留白，不写露骨性行为、身体细节或具体动作，也不替用户决定言行。',
  },
];

export function normalizeTheaterKind(value) {
  return THEATER_KINDS.some(kind => kind.id === value) ? value : 'daily';
}

export function theaterKindById(value) {
  const id = normalizeTheaterKind(value);
  return THEATER_KINDS.find(kind => kind.id === id) || THEATER_KINDS[0];
}

/** 当前手机选中的小剧场类型；页面和请求共用这一处。 */
export function theaterKindFor(state) {
  return normalizeTheaterKind(state?.settings?.theater?.kind);
}

export function extrasOf(state, contactId) {
  state.extras[contactId] = state.extras[contactId] || [];
  return state.extras[contactId];
}

/** 这一轮要不要请模型附一段小剧场：按联系人单独开。 */
export function extrasEnabledFor(state, contactId) {
  return (state.extrasOn || []).includes(String(contactId));
}

/** 小剧场的返回协议：正常聊天在前，<phone-extras>JSON</phone-extras> 在后。 */
export function theaterPrompt(contactName, kind = 'daily') {
  const name = String(contactName || '对方').trim() || '对方';
  const genre = theaterKindById(kind);
  const shape = JSON.stringify({
    role: name,
    sections: genre.titles.map(title => ({ title, content: '……' })),
  });
  return [
    `这一轮正常聊天之外，再给「${name}」写一小段「${genre.label}」小剧场。`,
    genre.prompt,
    '先完整输出 TA 要发的聊天消息，然后在消息之后另起一行，追加且只追加一个块：',
    `<phone-extras>${shape}</phone-extras>`,
    '这个块不会显示在聊天里，只存进小剧场 App；不要写进聊天正文，不要用代码围栏，也不要为它另发一次请求。',
    '每节 1–3 句，贴合人设和当下情境；不要为小剧场写 HTML，也不要在字符串里再放 <phone-extras> 标签。',
  ].join('\n');
}

/**
 * 从模型回复里摘掉小剧场块，聊天只留正文；块要能解析成 sections 才存。
 * 标签写坏或没闭合时也从标签处截掉，保证聊天里永远看不到小剧场。
 */
export function splitTheaterBlocks(text, contactName = '') {
  const raw = String(text || '');
  const blocks = [];
  let cleaned = raw.replace(/<phone-extras\b[^>]*>([\s\S]*?)<\/phone-extras>/gi, (_, body) => {
    blocks.push(body);
    return '';
  });
  cleaned = cleaned.replace(/<phone-extras\b[\s\S]*$/i, '');
  cleaned = cleaned.replace(/```[a-zA-Z]*\s*```/g, '');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim();

  const wanted = String(contactName || '').trim();
  const sections = [];
  for (const body of blocks) {
    let data;
    try { data = JSON.parse(String(body).trim()); } catch { continue; }
    const list = Array.isArray(data) ? data : (Array.isArray(data?.sections) ? data.sections : []);
    const role = Array.isArray(data) ? '' : String(data?.role || '').trim();
    if (wanted && role && role !== wanted) continue;
    for (const section of list.slice(0, 6)) {
      if (!section || typeof section !== 'object') continue;
      const title = String(section.title || '').trim().slice(0, 80);
      const content = String(section.content || '').trim().slice(0, 4000);
      if (title && content) sections.push({ title, content });
    }
  }
  return { text: cleaned, sections };
}

/** 把一段小剧场并进该联系人的 App 列表；不新增聊天气泡。 */
export function addExtrasEntry(state, contactId, sections, meta = {}) {
  if (!Array.isArray(sections) || !sections.length) return null;
  const cleanSections = sections
    .map(section => ({
      title: String(section?.title || '').trim().slice(0, 80),
      content: String(section?.content || '').trim().slice(0, 4000),
    }))
    .filter(section => section.title && section.content);
  if (!cleanSections.length) return null;
  const kind = normalizeTheaterKind(meta.kind);
  const title = cleanSections.map(section => section.title).slice(0, 2).join(' · ') || '小剧场';
  const entry = {
    id: newId('x'),
    title,
    kind,
    sections: cleanSections,
    date: dayKey(),
    lines: cleanSections.map(section => `${section.title}：${section.content}`),
    messageId: meta.messageId || '',
    chatId: meta.chatId || '',
    at: Date.now(),
  };
  state.extras[contactId] = state.extras[contactId] || [];
  state.extras[contactId].unshift(entry);
  return entry;
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
    /* 关联用头像文件名（宿主里唯一），没有才退回名字。旧存档里存的是名字，也要能认领并升级。 */
    const key = character.tavernAvatar || character.avatar || character.name;
    const legacyKey = character.name;
    const sameNameCount = tavernCharacters.filter(other => other?.name === character.name).length;
    const existing = Object.values(state.contacts).find(item => item.tavernAvatar === key)
      /* 旧存档绑的是名字而不是文件名 */
      || Object.values(state.contacts).find(item => item.tavernAvatar === legacyKey)
      /* 老联系人只有名字时，同名唯一才认领，别把名字相同的另一张卡接过来 */
      || Object.values(state.contacts).find(item => !item.tavernAvatar
        && (item.cardName === character.name || item.name === character.name)
        && sameNameCount === 1);
    if (existing) {
      /* 用户改过备注的，名字留原样；没改过的跟着卡片走 */
      const renamed = existing.cardName && existing.name !== existing.cardName;
      if (!existing.cardName) existing.cardName = character.name;
      if (!renamed) existing.name = character.name;
      existing.tavernAvatar = key;
      existing.avatar = character.avatarUrl || existing.avatar;
      continue;
    }
    addContact(state, {
      name: character.name,
      cardName: character.name,
      avatar: character.avatarUrl || '',
      tavernAvatar: key,
      kind: 'char',
    });
    created += 1;
  }
  return created;
}

/**
 * 旧存档迁移：联系人只有名字、没有头像文件名时，补上卡片关联。
 * 只在同名唯一时绑定；重名就留空，让用户在页面里自己选，不替用户猜。
 */
export function linkContactCards(state) {
  const cards = Array.isArray(state?.characters) ? state.characters : [];
  if (!cards.length) return 0;
  let linked = 0;
  for (const contact of Object.values(state.contacts || {})) {
    if (!contact || contact.kind === 'group') continue;
    if (contact.tavernAvatar) {
      const card = cards.find(item => item.avatar && item.avatar === contact.tavernAvatar);
      if (card && !contact.cardName) contact.cardName = card.name;
      continue;
    }
    const same = cards.filter(item => item.name === contact.name);
    if (same.length !== 1) continue;
    const card = same[0];
    if (card.avatar) contact.tavernAvatar = card.avatar;
    contact.cardName = card.name;
    linked += 1;
  }
  return linked;
}

/* --------------------------------------------------------------- 演示数据 */

/** 预览环境用的虚构数据，未引用任何真实聊天内容。 */
export function demoState() {
  const state = emptyState();
  state.settings.user = { name: '颜', avatar: '', key: 'persona_yan.png' };
  state.settings.user.name = '颜';
  state.users = [
    {
      key: 'persona_yan.png', name: '颜', description: '在便利店上夜班，说话很短，习惯先把事做完再说。', avatarUrl: '',
      lorebook: '夜班人物',
      demoBook: {
        name: '夜班人物',
        entries: [
          { uid: '0', title: '店长', keys: ['店长', '老赵'], content: '便利店店长，五十多岁，总把「早点回去」挂在嘴边，但从不真的赶人。', disabled: false, constant: true, order: 1 },
          { uid: '1', title: '夜班', keys: ['夜班', '便利店', '牛奶'], content: '你上的夜班从十点到早上六点，冰柜第二层会留两瓶温过的牛奶给常客。', disabled: false, constant: false, order: 2 },
          { uid: '2', title: '旧毛衣', keys: ['毛衣'], content: '一件洗得起球的旧毛衣，只在最冷的几天穿。', disabled: true, constant: false, order: 3 },
        ],
      },
    },
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
    { id: 'lsch_auto', name: '默认方案', apiId: 'api_default', replyId: 'reply_natural' },
    { id: 'lsch_local', name: '本地方案', apiId: 'api_local', replyId: 'reply_natural' },
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
    {
      id: 'x1', title: '楼下的便利店', kind: 'daily', date: '2026-11-10', messageId: 'ch_demo_shen_m0', chatId: 'ch_demo_shen',
      sections: [
        { title: '心理活动', content: '他把外套领子立起来，靠在电动车上抬头看我的窗户。灯管太白，照得人有点狼狈。' },
        { title: '小彩蛋', content: '他把剩下半个饭团吃掉了，说味道还行。' },
      ],
      lines: ['他把外套领子立起来，靠在电动车上抬头看我的窗户。', '灯管太白，照得人有点狼狈。'],
    },
    {
      id: 'x2', title: '第 41 分钟', kind: 'meta', date: '2026-11-06',
      sections: [
        { title: '吐槽', content: '他说等 41 分钟就走。这个数字后来被反复引用，像某种只有我们知道的暗号。' },
        { title: '幕后注', content: '叙事到这里其实已经偏心了，但当事人显然不打算承认。' },
      ],
      lines: ['他说等 41 分钟就走。', '结果等到第 58 分钟。'],
    },
  ];
  state.extras[jiang.id] = [
    {
      id: 'x3', title: '车里那首歌', kind: 'dream', date: '2026-11-02',
      sections: [
        { title: '梦境', content: '车窗外是一条没有尽头的路，副歌进来的时候他跟着哼了一句。' },
        { title: '醒来', content: '醒来以后旋律还在，但已经不记得他哼的是哪一句。' },
      ],
      lines: ['副歌进来的时候他跟着哼了一句。'],
    },
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

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function limitNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}

function normalizeWalletState(raw) {
  const source = isPlainRecord(raw) ? raw : {};
  const transactions = Array.isArray(source.transactions)
    ? source.transactions.filter(item => isPlainRecord(item) && Number.isFinite(Number(item.amount))).slice(0, 5000).map(item => ({
      id: String(item.id || '').slice(0, 48),
      contactId: String(item.contactId || '').slice(0, 60),
      type: ['transfer', 'redpacket', 'gift'].includes(item.type) ? item.type : 'transfer',
      direction: item.direction === 'received' ? 'received' : 'sent',
      amount: Math.max(0, Math.min(10000, Number(item.amount) || 0)),
      note: String(item.note || item.message || '').slice(0, 80),
      messageId: String(item.messageId || '').slice(0, 60),
      status: item.status === 'reversed' ? 'reversed' : 'completed',
      at: Number(item.at) || Date.now(),
    }))
    : [];
  return { balance: Math.max(0, Math.min(10000, Number(source.balance) || 0)), transactions };
}

function normalizeMembershipRecord(raw) {
  const source = isPlainRecord(raw) ? raw : {};
  const expire = Number(source.expireAt) || 0;
  return {
    type: ['vip', 'svip'].includes(source.type) ? source.type : 'none',
    expireAt: expire && expire < 1e12 ? expire * 1000 : expire,
    queue: Array.isArray(source.queue)
      ? source.queue.filter(item => isPlainRecord(item)).slice(-20).map(item => ({
        type: item.type === 'svip' ? 'svip' : 'vip',
        duration: limitNumber(item.duration, 1, 3650, 30),
        messageId: String(item.messageId || '').slice(0, 60),
      }))
      : [],
    history: Array.isArray(source.history)
      ? source.history.filter(item => isPlainRecord(item)).slice(-200).map(item => ({
        id: String(item.id || '').slice(0, 48),
        type: item.type === 'svip' ? 'svip' : 'vip',
        months: item.months === 12 ? 12 : 1,
        duration: limitNumber(item.duration, 1, 3650, 30),
        price: Math.max(0, Number(item.price) || 0),
        from: String(item.from || '').slice(0, 60),
        messageId: String(item.messageId || '').slice(0, 60),
        at: Number(item.at) || Date.now(),
        reversed: Boolean(item.reversed),
      }))
      : [],
  };
}

function normalizeMembershipState(raw) {
  const source = isPlainRecord(raw) ? raw : {};
  const byContact = {};
  for (const [contactId, value] of Object.entries(isPlainRecord(source.byContact) ? source.byContact : {})) {
    if (!contactId) continue;
    byContact[String(contactId).slice(0, 60)] = normalizeMembershipRecord(value);
  }
  return { user: normalizeMembershipRecord(source.user), byContact };
}

function normalizeAppointment(raw, contactId) {
  const source = isPlainRecord(raw) ? raw : {};
  const status = ['pending', 'accepted', 'rejected', 'completed', 'cancelled'].includes(source.status)
    ? source.status : 'pending';
  return {
    id: String(source.id || `plan_${contactId}_${Date.now().toString(36)}`).slice(0, 60),
    contactId: String(contactId || '').slice(0, 60),
    messageId: String(source.messageId || '').slice(0, 60),
    title: String(source.title || '').slice(0, 80),
    initiator: source.initiator === 'me' ? 'me' : 'them',
    status,
    createdAt: Number(source.createdAt) || Date.now(),
    respondedAt: Number(source.respondedAt) || 0,
    completedAt: Number(source.completedAt) || 0,
    story: isPlainRecord(source.story) ? {
      id: String(source.story.id || '').slice(0, 48),
      title: String(source.story.title || '').slice(0, 80),
      text: String(source.story.text || '').slice(0, 4000),
      outcome: String(source.story.outcome || '').slice(0, 20),
      at: Number(source.story.at) || 0,
    } : null,
  };
}

function normalizeAppointmentsState(raw) {
  const source = isPlainRecord(raw) ? raw : {};
  const byContact = {};
  for (const [contactId, value] of Object.entries(isPlainRecord(source.byContact) ? source.byContact : {})) {
    if (!contactId) continue;
    byContact[String(contactId).slice(0, 60)] = Array.isArray(value)
      ? value.filter(isPlainRecord).slice(-200).map(item => normalizeAppointment(item, contactId))
      : [];
  }
  return { byContact };
}

function normalizeFriendRequestsState(raw) {
  return Array.isArray(raw)
    ? raw.filter(isPlainRecord).slice(-200).map(item => ({
      id: String(item.id || '').slice(0, 48),
      contactId: String(item.contactId || '').slice(0, 60),
      name: String(item.name || '').slice(0, 40),
      text: String(item.text || '').slice(0, 400),
      status: ['pending', 'accepted', 'rejected'].includes(item.status) ? item.status : 'pending',
      messageId: String(item.messageId || '').slice(0, 60),
      at: Number(item.at) || Date.now(),
    }))
    : [];
}

function normalizeSignaturesState(raw) {
  const source = isPlainRecord(raw) ? raw : {};
  const byContact = {};
  for (const [contactId, value] of Object.entries(isPlainRecord(source.byContact) ? source.byContact : {})) {
    if (!contactId) continue;
    byContact[String(contactId).slice(0, 60)] = Array.isArray(value)
      ? value.filter(isPlainRecord).slice(0, 50).map(item => ({
        id: String(item.id || '').slice(0, 48),
        text: String(item.text || '').slice(0, 80),
        actionType: item.actionType === 'like' ? 'like' : 'update',
        at: Number(item.at) || Date.now(),
      }))
      : [];
  }
  return { byContact };
}

/** 收藏：只剔除确实无效的条目（没 id、且既无文字也无图片），合法收藏原样保留、缺字段补齐。 */
function normalizeFavorites(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isPlainRecord).map((item, index) => {
    const id = String(item.id || `f_${index + 1}`).slice(0, 48);
    const text = String(item.text || '');
    const image = String(item.image || '');
    return {
      id,
      chatId: String(item.chatId || '').slice(0, 60),
      contactName: String(item.contactName || 'TA').slice(0, 40),
      from: item.from === 'me' ? 'me' : 'them',
      text: text.slice(0, 4000),
      image,
      at: Number(item.at) || Date.now(),
    };
  }).filter(item => item.id && (item.text || item.image));
}

/** 读取旧文件时补齐缺失字段，永远不因为缺字段白屏。 */
export function normalize(raw) {
  const base = emptyState();
  if (!raw || typeof raw !== 'object') return base;
  const merged = {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    diary: {
      ...base.diary,
      ...(raw.diary || {}),
      enabled: raw.diary?.enabled !== false,
      prompt: String(raw.diary?.prompt || '').trim() ? raw.diary.prompt : base.diary.prompt,
      entries: { ...(raw.diary?.entries || {}) },
      contacts: {},
    },
    dress: { ...base.dress, ...(raw.dress || {}) },
    draw: {
      ...base.draw,
      ...(raw.draw || {}),
      config: { ...base.draw.config, ...(raw.draw?.config || {}) },
      presets: Array.isArray(raw.draw?.presets) && raw.draw.presets.length ? raw.draw.presets : base.draw.presets,
      history: Array.isArray(raw.draw?.history) ? raw.draw.history : [],
    },
  };
  /* 旧存档的 settings.chat 可能没有新字段，这里按默认补一次，避免被浅合并冲掉 */
  merged.settings.chat = { ...base.settings.chat, ...(merged.settings.chat || {}) };
  merged.settings.chat.behavior = {
    ...base.settings.chat.behavior,
    ...(merged.settings.chat.behavior && typeof merged.settings.chat.behavior === 'object' ? merged.settings.chat.behavior : {}),
  };
  for (const [contactId, entries] of Object.entries(raw.diary?.contacts || {})) {
    if (!contactId || !entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    merged.diary.contacts[contactId] = {};
    for (const [key, entry] of Object.entries(entries)) {
      if (!entry || typeof entry !== 'object' || typeof entry.text !== 'string') continue;
      const date = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || key)) ? String(entry.date || key) : key;
      merged.diary.contacts[contactId][key] = {
        ...entry,
        key,
        date,
        text: entry.text,
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        auto: Boolean(entry.auto),
        contactId,
        useOriginal: entry.useOriginal === true,
        sourceFingerprint: String(entry.sourceFingerprint || ''),
        paramsFingerprint: String(entry.paramsFingerprint || ''),
        fromTime: Number.isFinite(Number(entry.fromTime)) ? Number(entry.fromTime) : null,
        toTime: Number.isFinite(Number(entry.toTime)) ? Number(entry.toTime) : null,
        messageCount: Number.isFinite(Number(entry.messageCount)) ? Number(entry.messageCount) : null,
      };
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
    readMode: memoryRaw?.readMode === 'recent' ? 'recent' : 'summary',
    byContact: (() => {
      const raw2 = memoryRaw?.byContact;
      const clean = {};
      if (!raw2 || typeof raw2 !== 'object' || Array.isArray(raw2)) return clean;
      for (const [contactId, mode] of Object.entries(raw2)) {
        if (!contactId) continue;
        if (mode !== 'auto' && mode !== 'recent') continue;
        clean[String(contactId).slice(0, 60)] = mode;
      }
      return clean;
    })(),
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
    /* 旧版内置的“再短一点 / 带点情绪”不再保留；只留“自然发消息”。 */
    if (id === 'reply_short' || id === 'reply_soft') return;
    seenReplyIds.add(id);
    const builtInId = id === 'reply_natural';
    const upgrade = builtInId && isLegacyDefaultReplyItems(item.items);
    let presetItems = upgrade ? defaultReplyItems() : normalizeReplyItems(item.items, item.context);
    const mainText = String(item.text || '').trim().slice(0, 4000);
    if (mainText) {
      const mainItem = presetItems.find(entry => entry.id === REPLY_INSTRUCTION_ID);
      if (mainItem) {
        if (!mainItem.content) mainItem.content = mainText;
      } else {
        const behavior = presetItems.find(entry => entry.id === 'reply_item_behavior');
        const anchor = Number.isFinite(Number(behavior?.order)) ? Number(behavior.order) : 2;
        presetItems = withReplyInstruction(presetItems, mainText, anchor + 0.5);
      }
    }
    replyPresets.push({
      id,
      name: String(item.name || '').trim().slice(0, 20) || `预设 ${index + 1}`,
      text: '',
      context: normalizeReplyContext(item.context),
      groups: normalizeReplyGroups(item.groups),
      items: presetItems,
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
  const profileRaw = raw.settings?.profile && typeof raw.settings.profile === 'object' && !Array.isArray(raw.settings.profile)
    ? raw.settings.profile
    : {};
  merged.settings.profile = {
    bio: typeof profileRaw.bio === 'string' ? profileRaw.bio.trim().slice(0, 30) : '',
    banner: typeof profileRaw.banner === 'string' && profileRaw.banner.startsWith('data:image/') && profileRaw.banner.length < 400000
      ? profileRaw.banner
      : '',
  };
  merged.settings.theater = {
    ...(merged.settings.theater && typeof merged.settings.theater === 'object' ? merged.settings.theater : {}),
    kind: normalizeTheaterKind(raw.settings?.theater?.kind ?? raw.settings?.theaterKind),
  };
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
    theme: ['default', 'frost', 'pixel'].includes(dressRaw.theme) ? dressRaw.theme : 'default',
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
  for (const [id, contact] of Object.entries(merged.contacts && typeof merged.contacts === 'object' ? merged.contacts : {})) {
    if (!contact || typeof contact !== 'object') continue;
    merged.contacts[id] = {
      ...contact,
      tavernAvatar: String(contact.tavernAvatar || ''),
      cardName: String(contact.cardName || ''),
    };
  }
  /* 只有名字的旧联系人按同名唯一补卡片关联；重名不绑，等用户自己选 */
  linkContactCards(merged);
  merged.lookups = (raw.lookups && typeof raw.lookups === 'object' && !Array.isArray(raw.lookups)) ? raw.lookups : {};
  merged.usersFromTavern = Boolean(raw.usersFromTavern);
  merged.settings.api.presets = Array.isArray(merged.settings.api.presets) && merged.settings.api.presets.length
    ? merged.settings.api.presets
    : base.settings.api.presets;

  /* 不含 Key 的备份恢复时，按预设 id 保留本机现有连接凭据，不把本地 Key 擦成空。 */
  const baseApiById = new Map((base.settings.api.presets || []).map(item => [item.id, item]));
  merged.settings.api.presets = merged.settings.api.presets.map(item => {
    const old = baseApiById.get(item.id);
    if (old) {
      if (!item.key && old.key) item.key = old.key;
      if (!item.proxy_password && old.proxy_password) item.proxy_password = old.proxy_password;
    }
    return item;
  });
  const baseImageById = new Map((base.settings.image?.presets || []).map(item => [item.id, item]));
  if (Array.isArray(merged.settings.image?.presets)) {
    merged.settings.image.presets = merged.settings.image.presets.map(item => {
      const old = baseImageById.get(item.id);
      if (old && !item.key && old.key) item.key = old.key;
      return item;
    });
  }
  const baseImg = base.settings.image || {};
  for (const kind of ['novelai', 'doubao', 'custom']) {
    const target = merged.settings.image?.[kind];
    const old = baseImg[kind];
    if (target && old && !target.key && old.key) target.key = old.key;
  }

  /* LLM 整体方案：旧存档没有就按当前 API + 当前回复预设补一套默认方案，不掺记忆 */
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
      replyId: replyIds.has(item.replyId) ? item.replyId : merged.settings.reply.activeId,
    });
  });
  if (!chatSchemes.length) {
    chatSchemes.push({
      id: 'lsch_default', name: '默认', apiId: fallbackApiId,
      replyId: merged.settings.reply.activeId,
    });
  }
  const wantedScheme = String(merged.settings.api.chatSchemeId || '');
  const chatScheme = chatSchemes.find(item => item.id === wantedScheme) || chatSchemes[0];
  merged.settings.api.chatSchemes = chatSchemes;
  merged.settings.api.chatSchemeId = chatScheme.id;
  if (!apiIds.has(merged.settings.api.activeChat)) merged.settings.api.activeChat = chatScheme.apiId;
  if (!memoryIds.has(merged.settings.memory.activeId)) merged.settings.memory.activeId = fallbackMemoryId;
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
  merged.extras = merged.extras && typeof merged.extras === 'object' && !Array.isArray(merged.extras)
    ? Object.fromEntries(Object.entries(merged.extras).map(([contactId, list]) => [
      contactId,
      (Array.isArray(list) ? list : []).slice(0, 1000).map((entry, index) => {
        const lines = Array.isArray(entry?.lines)
          ? entry.lines.map(line => String(line || '').trim()).filter(Boolean).slice(0, 12)
          : [];
        const sections = Array.isArray(entry?.sections)
          ? entry.sections.map(section => ({
            title: String(section?.title || '').trim().slice(0, 80),
            content: String(section?.content || '').trim().slice(0, 4000),
          })).filter(section => section.title && section.content).slice(0, 6)
          : [];
        if (!sections.length) {
          lines.forEach(line => {
            const at = line.indexOf('：');
            const title = at > 0 ? line.slice(0, at).trim().slice(0, 80) : '片段';
            const content = (at > 0 ? line.slice(at + 1) : line).trim().slice(0, 4000);
            if (title && content) sections.push({ title, content });
          });
        }
        return {
          ...entry,
          id: String(entry?.id || `x_${contactId}_${index}`),
          kind: normalizeTheaterKind(entry?.kind),
          lines,
          sections: sections.slice(0, 6),
        };
      }).filter(entry => entry.id),
    ]))
    : {};
  merged.extrasOn = Array.isArray(merged.extrasOn) ? merged.extrasOn.map(String) : [];
  merged.favorites = normalizeFavorites(raw.favorites);
  merged.wallet = normalizeWalletState(raw.wallet);
  merged.membership = normalizeMembershipState(raw.membership);
  merged.appointments = normalizeAppointmentsState(raw.appointments);
  merged.friendRequests = normalizeFriendRequestsState(raw.friendRequests);
  merged.signatures = normalizeSignaturesState(raw.signatures);
  merged.emoji = Array.isArray(merged.emoji) && merged.emoji.length ? merged.emoji : base.emoji;
  for (const [chatId, chat] of Object.entries(merged.chats)) {
    chat.messages = Array.isArray(chat.messages)
      ? chat.messages.map((message, index) => ({
        ...message,
        id: message.id || `${chatId}_m${index}`,
        behavior: normalizeBehavior(message.kind, message.behavior),
      }))
      : [];
    chat.history = normalizeChatHistory(chat.history);
    if (chat.replyPresetId && !replyIds.has(String(chat.replyPresetId))) chat.replyPresetId = '';
    chat.unread = chat.unread || 0;
  }
  return merged;
}
