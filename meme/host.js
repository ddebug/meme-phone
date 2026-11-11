/**
 * meme-phone · 宿主桥
 *
 * 只在酒馆里才存在的能力都收在这里：角色列表、当前聊天上下文、模型调用。
 * 每个入口都 try/catch，缺能力时降级，不把宿主异常带进界面。
 */

let hostScript = null;
let hostScriptTried = false;

export async function loadHostScript() {
  if (hostScriptTried) return hostScript;
  hostScriptTried = true;
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

/** 当前打开的酒馆聊天，用来给日记、主动消息提供素材。 */
export async function readTavernContext() {
  const script = await loadHostScript();
  if (!script) return { userName: '我', chat: [], characterName: '' };
  try {
    const userName = script.name1 || script.getContext?.()?.name1 || '我';
    const chat = Array.isArray(script.chat) ? script.chat.map(line => ({
      isUser: Boolean(line.is_user),
      name: line.name || (line.is_user ? userName : ''),
      text: line.mes || '',
      at: line.send_date || '',
    })) : [];
    const character = script.characters?.[script.this_chid];
    return { userName, chat, characterName: character?.name || '' };
  } catch {
    return { userName: '我', chat: [], characterName: '' };
  }
}

export async function readUserAvatar() {
  try {
    const personas = await import('/scripts/personas.js');
    const script = await loadHostScript();
    if (script?.user_avatar && typeof script.getThumbnailUrl === 'function') {
      return script.getThumbnailUrl('persona', script.user_avatar);
    }
    if (personas?.user_avatar && typeof personas.getUserAvatar === 'function') {
      return personas.getUserAvatar();
    }
  } catch { /* 没有头像就退回首字母色块 */ }
  return '';
}

/**
 * 生成一段文字。
 * 真机上走宿主 generateQuietPrompt；预览环境返回演示文案并标记 demo=true。
 */
export async function generate({ prompt, system = '', demoReply = '' }) {
  const script = await loadHostScript();
  if (script && typeof script.generateQuietPrompt === 'function') {
    const quiet = String(prompt || '');
    const text = await script.generateQuietPrompt({ quietPrompt: quiet, quietName: '' });
    if (typeof text === 'string' && text.trim()) return { text: text.trim(), demo: false };
    return { text: '', demo: false, error: '模型没有返回内容' };
  }
  return { text: demoReply, demo: true };
}

/**
 * NovelAI 出图。
 * 请求体按 NovelAI 官方 v4 格式：n_samples 固定 1，seed 由调用方给。
 * 返回 { url } 时是 data URI（图小，直接塞进内存够用）；失败抛错，由界面提示。
 */
export async function novelaiImage({
  url, key, model, width, height, steps = 28, scale = 5,
  sampler = 'k_euler_ancestral', noise = 'karras', seed, prompt = '', negative = '',
}) {
  const base = String(url || 'https://image.novelai.net').trim().replace(/\/+$/, '');
  const token = String(key || '').trim();
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

  const type = res.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const json = await res.json().catch(() => null);
    const b64 = json?.image || json?.data?.[0]?.b64_json || '';
    if (!b64) throw new Error('返回里没有图');
    return { url: b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}` };
  }
  if (type.includes('image/')) {
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob) };
  }
  // NovelAI 官方端点回的是 zip，浏览器里要解压才能拿到 png。
  throw new Error('NovelAI 返回了 zip，当前只支持直出图片的兼容接口');
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
    const ctx = script.getContext?.() || {};
    const pu = script.power_user || ctx.powerUser || globalThis.power_user || {};
    const names = pu.personas && typeof pu.personas === 'object' ? pu.personas : null;
    if (!names) return { available: false, list: [], current: '' };
    const descs = pu.persona_descriptions && typeof pu.persona_descriptions === 'object' ? pu.persona_descriptions : {};
    const thumb = script.getThumbnailUrl;
    const list = Object.entries(names)
      .filter(([, name]) => Boolean(name))
      .map(([key, name]) => ({
        key,
        name: String(name || '').trim(),
        description: String(descs[key]?.description || ''),
        avatarUrl: typeof thumb === 'function' ? thumb('persona', key) : '',
      }));
    const current = String(script.user_avatar || ctx.user_avatar || '');
    return { available: true, list, current };
  } catch {
    return { available: false, list: [], current: '' };
  }
}

/**
 * 把改过的名字 / 设定写回酒馆。
 * 只改内存里的 power_user，再让酒馆自己保存设置——不走私有接口，装进酒馆就能用。
 */
export async function writeTavernPersona({ key, name, description }) {
  const script = await loadHostScript();
  const ctx = script?.getContext?.() || {};
  const pu = script?.power_user || ctx.powerUser || globalThis.power_user;
  if (!pu || !pu.personas) throw new Error('没接上酒馆，改不了酒馆那一边');
  if (!key) throw new Error('这条没有对应的酒馆用户');

  const cleanName = String(name || '').trim();
  if (cleanName) pu.personas[key] = cleanName;

  if (typeof description === 'string') {
    const descs = pu.persona_descriptions || (pu.persona_descriptions = {});
    const prev = descs[key] || {};
    descs[key] = { ...prev, description };
  }

  if (String(script.user_avatar || ctx.user_avatar || '') === key) {
    if (cleanName) {
      script.name1 = cleanName;
      if (ctx.name1 !== undefined) ctx.name1 = cleanName;
    }
    const box = globalThis.document?.querySelector('#user_name');
    if (box && cleanName) box.value = cleanName;
  }

  const save = ctx.saveSettingsDebounced || script.saveSettingsDebounced;
  if (typeof save === 'function') await save();
  return { ok: true };
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
