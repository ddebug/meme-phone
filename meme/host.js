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

/** 宿主可用性，用于设置页展示「已接入 / 未接入」。 */
export async function probeHost() {
  const script = await loadHostScript();
  return {
    inTavern: Boolean(script),
    hasCharacters: Boolean(script?.characters),
    hasGenerate: Boolean(script?.generateQuietPrompt),
  };
}
