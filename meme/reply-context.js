/**
 * meme-phone · 回复预设的上下文拼装
 * 旧独立小手机的 QQ 预设除了回复指令，还会按开关注入角色档案、用户设定、
 * 酒馆记忆、当前时间和本机聊天记录；这里把这部分独立出来，聊天入口只负责取数据。
 */

export function transcript(state, chat, limit = 10) {
  const contact = state.contacts[chat.contactId];
  return chat.messages.slice(-limit).map(message => {
    const who = message.from === 'me'
      ? state.settings.user.name
      : (state.contacts[message.speaker]?.name || contact?.name || 'TA');
    return `${who}：${message.text}`;
  }).join('\n');
}

export function characterBlock(state, contact) {
  const card = (state.characters || []).find(item => item.name === contact?.name);
  if (!card) return '';
  return [
    `【角色档案 · ${contact?.name || card.name || 'TA'}】`,
    card.description ? String(card.description).slice(0, 400) : '',
    card.personality ? `性格：${String(card.personality).slice(0, 160)}` : '',
    card.scenario ? `场景：${String(card.scenario).slice(0, 160)}` : '',
  ].filter(Boolean).join('\n');
}

export function userBlock(state) {
  const me = (state.users || []).find(item => item.key === state.settings.user?.key) || (state.users || [])[0];
  if (!me) return '';
  return [
    '【我的设定】',
    `名字：${me.name || state.settings.user?.name || '我'}`,
    me.description ? String(me.description).slice(0, 300) : '',
  ].filter(Boolean).join('\n');
}

export function clockBlock(now = new Date()) {
  const text = now.toLocaleString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `【当前时间】\n${text}`;
}

export function replyContextBlock(state, chat, contact, context = {}, memoryText = '') {
  const blocks = [
    context.character ? characterBlock(state, contact) : '',
    context.user ? userBlock(state) : '',
    context.memory && memoryText ? `【酒馆记忆】\n${memoryText}` : '',
    context.time ? clockBlock() : '',
    context.history ? transcript(state, chat, Math.max(1, Number(context.historyLimit) || 10)) : '',
  ];
  return blocks.filter(Boolean).join('\n\n');
}
