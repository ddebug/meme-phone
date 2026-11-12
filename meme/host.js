/**
 * meme-phone · 宿主桥
 *
 * 只在酒馆里才存在的能力都收在这里：角色列表、当前聊天上下文、模型调用。
 * 每个入口都 try/catch，缺能力时降级，不把宿主异常带进界面。
 */

let hostScript = null;
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
      avatarUrl: typeof thumbnail === 'function' && character.avatar
        ? thumbnail('avatar', `characters/${character.avatar}`)
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
        avatarUrl: typeof thumbnail === 'function' && character.avatar
          ? thumbnail('avatar', `characters/${character.avatar}`)
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
          worldInfo = saved.world_info_settings?.world_info || saved.world_info || worldInfo;
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
export async function readTavernContext() {
  const script = await loadHostScript();
  if (!script) return { userName: '我', chat: [], characterName: '', characterAvatar: '', chatFile: '' };
  try {
    const userName = script.name1 || script.getContext?.()?.name1 || '我';
    const chat = Array.isArray(script.chat) ? script.chat.map(line => ({
      isUser: Boolean(line.is_user),
      name: line.name || (line.is_user ? userName : ''),
      text: line.mes || '',
      at: line.send_date || '',
    })) : [];
    const character = script.characters?.[script.this_chid];
    return {
      userName,
      chat,
      characterName: character?.name || '',
      characterAvatar: character?.avatar || '',
      chatFile: character?.chat || '',
    };
  } catch {
    return { userName: '我', chat: [], characterName: '', characterAvatar: '', chatFile: '' };
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
export async function readLatestTavernChat({ name = '', avatar = '', floors = 10, includeMemory = false } = {}) {
  const script = await loadHostScript();
  const empty = { available: false, file: '', characterName: name, lines: [], total: 0, metadata: null, messages: [] };
  if (!script || !Array.isArray(script.characters)) return empty;
  const character = script.characters.find(item => item && avatar && item.avatar === avatar)
    || script.characters.find(item => item && item.name === name);
  if (!character) return empty;

  const headers = await hostRequestHeaders(script);
  let file = String(character.chat || '').trim();
  let latestMeta = null;

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
        file = sorted[0].file_name;
        latestMeta = sorted[0];
      }
    }
  } catch { /* 列表接口不可用就继续用角色卡上的 chat */ }

  let raw = [];
  let metadata = null;
  if (file) {
    try {
      const response = await fetch('/api/chats/get', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ch_name: character.name,
          file_name: String(file).replace(/\.jsonl$/i, ''),
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

  if (!raw.length && script.characters?.[script.this_chid]?.avatar === character.avatar && Array.isArray(script.chat)) {
    raw = script.chat;
    file = String(character.chat || '当前聊天');
    metadata = script.chatMetadata || null;
  }

  /* 聊天文件第一行是 metadata header（含 chat_metadata）；接口会原样返回它。 */
  const header = raw.find(line => line && typeof line === 'object' && line.chat_metadata && typeof line.chat_metadata === 'object');
  if (header?.chat_metadata) metadata = header.chat_metadata;

  const lines = raw
    .filter(line => line && !line.is_system && typeof line.mes === 'string' && line.mes.trim())
    .map(line => ({
      isUser: Boolean(line.is_user),
      name: line.name || (line.is_user ? (script.name1 || '你') : character.name),
      text: line.mes.trim(),
    }))
    .slice(-Math.max(1, Math.min(50, Number(floors) || 10)));

  return {
    available: Boolean(lines.length),
    file: file || '',
    characterName: character.name,
    lines,
    total: raw.length,
    meta: latestMeta,
    metadata: includeMemory ? metadata : null,
    messages: includeMemory ? raw : [],
  };
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

export async function generate({ prompt, system = '', messages = null, demoReply = '', preset = null }) {
  const script = await loadHostScript();
  if (script && preset && preset.engine !== 'tavern' && String(preset.url || '').trim()) {
    try {
      const text = await presetCompletion(preset, { prompt, system, messages });
      if (text) return { text, demo: false };
    } catch { /* 这套接口没接通就退回酒馆自己的模型，别让聊天卡死 */ }
  }
  if (script && typeof script.generateQuietPrompt === 'function') {
    const quiet = tavernQuietPrompt(messages, system, prompt);
    const text = await script.generateQuietPrompt({ quietPrompt: quiet, quietName: '' });
    if (typeof text === 'string' && text.trim()) return { text: text.trim(), demo: false };
    return { text: '', demo: false, error: '模型没有返回内容' };
  }
  return { text: demoReply, demo: true };
}

/** 借酒馆后端请求一套自定义 OpenAI 兼容接口，避开浏览器 CORS。 */
async function presetCompletion(preset, { prompt, system, messages }) {
  const script = await loadHostScript();
  if (!script) return '';
  const base = String(preset.url || '').trim().replace(/\/+$/, '');
  const path = String(preset.path || '').trim() || '/v1/chat/completions';
  const joined = path.startsWith('/v1') && /\/v1$/i.test(base)
    ? `${base}${path.replace(/^\/v1/, '')}`
    : (/\/chat\/completions$/i.test(base) ? base : `${base}${path.startsWith('/') ? path : `/${path}`}`);
  const url = /^https?:/i.test(path) ? path : joined;
  const ctx = globalThis.SillyTavern?.getContext?.() || script.getContext?.() || {};
  const getHeaders = ctx.getRequestHeaders || script.getRequestHeaders;
  const headers = typeof getHeaders === 'function' ? { ...getHeaders() } : {};
  if (!headers['X-CSRF-Token']) {
    const token = ctx.csrf_token || globalThis.csrf_token || '';
    if (token) headers['X-CSRF-Token'] = token;
  }
  headers['Content-Type'] = 'application/json';

  const outgoing = Array.isArray(messages) && messages.length
    ? messages
      .filter(message => message && String(message.content || '').trim())
      .slice(-40)
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
    custom_url: url,
    custom_include_headers: '',
    reverse_proxy: base,
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
  });
  if (!response.ok) throw new Error(`接口返回 ${response.status}`);
  const data = await response.json().catch(() => null);
  if (!data || data.error) throw new Error(data?.message || '接口没有返回内容');
  const content = data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? data?.content ?? data?.text;
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('').trim();
  return typeof content === 'string' ? content.trim() : '';
}


/**
 * NovelAI 出图。
 * 请求体按 NovelAI 官方 v4 格式：n_samples 固定 1，seed 由调用方给。
 * 返回 { url } 时是 data URI（图小，直接塞进内存够用）；失败抛错，由界面提示。
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

  const payload = {
    width, height, n_samples: 1, steps, scale,
    sampler, noise_schedule: noise, cfg_rescale: 0,
    seed: Number(seed) || Math.floor(Math.random() * 4294967295),
    qualityToggle: true, sm: false, sm_dyn: false,
    negative_prompt: negative || '',
    v4_prompt: { caption: { base_caption: prompt, char_captions: [] }, use_coords: false, use_order: false },
  };
  if (model) payload.model = model;

  let res;
  try {
    res = await fetch(`${base}/ai/generate-image`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`连不上 ${base}：${error.message}`);
  }
  if (!res.ok) throw new Error(`NovelAI 返回 ${res.status}（Key 或额度不对）`);

  return imageFromResponse(res, 'NovelAI');
}

/** 豆包 Seedream（火山方舟）：images/generations，字段比 OpenAI 多一个 watermark / 组图开关。 */
async function doubaoImage({ base, token, model, width, height, seed, prompt }) {
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
  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const json = await res.json().catch(() => null);
    const b64 = json?.image || json?.data?.[0]?.b64_json || json?.data?.[0]?.image || json?.b64_json || '';
    if (b64) return { url: b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}` };
    const remote = json?.data?.[0]?.url || json?.url || json?.image_url || '';
    if (remote) return { url: remote };
    throw new Error(`${label} 返回里没有图`);
  }
  if (type.includes('image/')) {
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob) };
  }
  throw new Error(`${label} 返回了压缩包，当前只支持直出图片的接口`);
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
  if (!script) return { available: false, list: [], current: '' };
  try {
    const ctx = script.getContext?.() || script;
    const pu = script.power_user || script.powerUser || ctx.powerUser || ctx.powerUserSettings || globalThis.power_user || {};
    const names = pu.personas && typeof pu.personas === 'object' ? pu.personas : null;
    if (!names) return { available: false, list: [], current: '' };
    const descs = pu.persona_descriptions && typeof pu.persona_descriptions === 'object' ? pu.persona_descriptions : {};
    const thumb = script.getThumbnailUrl;
    const current = String(script.user_avatar || ctx.user_avatar || '');
    const list = Object.entries(names)
      .filter(([, name]) => Boolean(name))
      .map(([key, name]) => ({
        key,
        name: String(name || '').trim(),
        description: String(descs[key]?.description || ''),
        lorebook: String(descs[key]?.lorebook || (key === current ? pu.persona_description_lorebook : '') || ''),
        avatarUrl: typeof thumb === 'function' ? thumb('persona', key) : '',
      }));
    return { available: true, list, current };
  } catch {
    return { available: false, list: [], current: '' };
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
          settings = saved.oai_settings || saved.settings?.oai_settings || null;
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
    const getHeaders = ctx.getRequestHeaders || script.getRequestHeaders;
    const headers = typeof getHeaders === 'function' ? { ...getHeaders() } : {};
    if (!headers['X-CSRF-Token']) {
      const token = ctx.csrf_token || globalThis.csrf_token || '';
      if (token) headers['X-CSRF-Token'] = token;
    }
    headers['Content-Type'] = 'application/json';

    const body = {
      chat_completion_source: source,
      reverse_proxy: url,
      proxy_password: key,
    };
    if (source === 'custom') {
      body.custom_url = url;
      body.custom_include_headers = String(settings.custom_include_headers || '');
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
