/**
 * meme-phone · 数据模型
 *
 * 这里是唯一的真源：所有页面只读这一份对象，改动后调用 store.touch() 落盘。
 * 数据结构刻意保持扁平，避免旧版那种「十个模块共享一个巨型对象、谁都改它」的局面。
 */

export const SCHEMA_VERSION = 1;

export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    createdAt: Date.now(),
    settings: {
      theme: 'day',              // day | night
      wallpaper: 'day',          // day | night
      user: { name: '我', avatar: '' },
      proactive: { enabled: true, idleMinutes: 120, dailyCount: 5 },
      chat: { showTime: true, enterToSend: false, remind: true, wake: true },
      api: { source: 'default', model: '', preset: 'default' },
    },
    contacts: {},
    chats: {},
    diary: { entries: {}, prompt: DEFAULT_DIARY_PROMPT, lastGenerated: '' },
    favorites: [],
    emoji: DEFAULT_EMOJI.map((item, index) => ({ id: `e${index + 1}`, ...item })),
    wallet: { balance: 4520, ledger: [] },
    membership: { plan: '', until: '' },
    plans: [],
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
  state.chats[id] = {
    id,
    contactId,
    kind: options.kind || (state.contacts[contactId]?.kind === 'group' ? 'group' : 'single'),
    messages: options.messages || [],
    unread: 0,
    draft: '',
    pinned: false,
    muted: false,
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
  return Object.values(state.chats).reduce((sum, chat) => sum + (chat.unread || 0), 0);
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

/* ----------------------------------------------------- 收藏 / 小剧场等 */

export function addFavorite(state, payload) {
  const item = {
    id: newId('f'),
    chatId: payload.chatId || '',
    contactId: payload.contactId || '',
    text: payload.text || '',
    from: payload.from || 'them',
    at: Date.now(),
  };
  state.favorites.unshift(item);
  return item;
}

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
  state.settings.user = { name: '颜', avatar: '' };
  state.settings.user.name = '颜';
  state.settings.api = { source: 'demo', model: '', preset: 'default' };

  const shen = addContact(state, { name: '沈砚', signature: '加班别等我了', status: 'online' });
  const jiang = addContact(state, { name: '江迟', signature: '在听老歌', status: 'busy' });
  const lin = addContact(state, { name: '林小满', signature: '今天有雨', status: 'online' });
  const gu = addContact(state, { name: '顾南风', signature: '路过书店', status: 'away' });
  const group = addContact(state, { name: '周末局', kind: 'group', members: [shen.id, jiang.id, lin.id], signature: '5 人' });

  const chatShen = addChat(state, shen.id, {
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

  addFavorite(state, { text: '我到了，路上小心。', chatId: chatShen.id, contactId: shen.id, from: 'them' });
  addFavorite(state, { text: '就你上次在车上放的那首。', chatId: chatJiang.id, contactId: jiang.id, from: 'them' });

  state.extras[shen.id] = [
    { id: 'x1', title: '楼下的便利店', date: '2026-11-10', lines: ['他把外套领子立起来，靠在电动车上抬头看我的窗户。', '灯管太白，照得人有点狼狈。'] },
    { id: 'x2', title: '第 41 分钟', date: '2026-11-06', lines: ['他说等 41 分钟就走。', '结果等到第 58 分钟。'] },
  ];
  state.extras[jiang.id] = [
    { id: 'x3', title: '车里那首歌', date: '2026-11-02', lines: ['副歌进来的时候他跟着哼了一句。'] },
  ];

  state.wallet = {
    balance: 4520,
    ledger: [
      { id: 'l1', title: '夜宵 · 便利店', amount: -32, date: '2026-11-10' },
      { id: 'l2', title: '生日礼物 · 沈砚', amount: -260, date: '2026-11-03' },
      { id: 'l3', title: '零花钱到账', amount: 3000, date: '2026-11-01' },
    ],
  };

  state.plans = [
    { id: 'p1', title: '把周三晚上空出来', detail: '晚上九点以后不排任何事，等他下班。', done: false, date: '2026-11-12' },
    { id: 'p2', title: '读完那本书的第三部分', detail: '地铁上读，不要刷手机。', done: true, date: '2026-11-09' },
  ];

  state.membership = { plan: '月卡', until: '2026-12-10' };
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
    diary: { ...base.diary, ...(raw.diary || {}), entries: { ...(raw.diary?.entries || {}) } },
    wallet: { ...base.wallet, ...(raw.wallet || {}) },
    membership: { ...base.membership, ...(raw.membership || {}) },
    dress: { ...base.dress, ...(raw.dress || {}) },
  };
  merged.version = SCHEMA_VERSION;
  merged.contacts = merged.contacts || {};
  merged.chats = merged.chats || {};
  merged.favorites = Array.isArray(merged.favorites) ? merged.favorites : [];
  merged.plans = Array.isArray(merged.plans) ? merged.plans : [];
  merged.extras = merged.extras || {};
  merged.emoji = Array.isArray(merged.emoji) && merged.emoji.length ? merged.emoji : base.emoji;
  for (const chat of Object.values(merged.chats)) {
    chat.messages = Array.isArray(chat.messages) ? chat.messages : [];
    chat.unread = chat.unread || 0;
  }
  return merged;
}
