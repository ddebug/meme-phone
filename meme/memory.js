/**
 * meme-phone · 酒馆记忆
 *
 * 聊天 / 日记的上下文来源收成一套「记忆方案」：
 * - auto：这个角色当前酒馆聊天有柏宝书总结，就注入总结；没有就取最近几层酒馆原文。
 * - summary：只用柏宝书总结。
 * - recent：只取最近几层酒馆原文。
 * 手机默认一套方案，某个会话可以单独换一套。
 */

import { contactById, memoryPresetFor } from './data.js';
import { summaryText } from './book.js';
import { readLatestTavernChat, readTavernContext } from './host.js';

export const MEMORY_MODES = [
  { value: 'auto', label: '自动', hint: '有总结先用总结，没有就取最近几层原文' },
  { value: 'summary', label: '只用总结', hint: '只注入柏宝书总结' },
  { value: 'recent', label: '只看原文', hint: '只注入最近几层酒馆聊天' },
];

export function memoryModeLabel(mode) {
  return MEMORY_MODES.find(item => item.value === mode)?.label || '自动';
}

/** 一行说明，给聊天设置和预设页共用。 */
export function memoryPresetSummary(preset) {
  if (!preset) return '还没设记忆方案';
  const floors = Math.max(1, Math.min(50, Number(preset.floors) || 10));
  if (preset.mode === 'summary') return `${memoryModeLabel(preset.mode)} · 只读总结`;
  if (preset.mode === 'recent') return `${memoryModeLabel(preset.mode)} · 最近 ${floors} 层`;
  return `${memoryModeLabel(preset.mode)} · 有总结先用，否则 ${floors} 层`;
}

export function activeMemoryPreset(state, chat) {
  return memoryPresetFor(state, chat);
}

function clip(text, limit) {
  const value = String(text || '').trim();
  if (!value) return '';
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}\n…（后面还有 ${value.length - limit} 字）`;
}

function joinLines(lines) {
  return lines.map(line => `${line.isUser ? '你' : (line.name || 'TA')}：${line.text}`).join('\n');
}

/** 把最近几层裁到预算内：保留最新的部分，别把开头截掉。 */
function fitRecent(lines, limit) {
  let text = joinLines(lines);
  if (text.length <= limit) return text;
  const picked = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const piece = `${line.isUser ? '你' : (line.name || 'TA')}：${line.text}`;
    if (used + piece.length > limit && picked.length) break;
    picked.unshift(line);
    used += piece.length + 1;
  }
  text = joinLines(picked);
  if (picked.length < lines.length) text = `…（前面还有 ${lines.length - picked.length} 层）\n${text}`;
  return text;
}

function chatKey(file) {
  return String(file || '').replace(/\.jsonl$/i, '').trim();
}

/**
 * 读这个会话的酒馆记忆。
 * limit 是总字数预算，层数是方案里的 floors。
 */
export async function buildMemoryContext(state, chat, limit = 1200) {
  const preset = activeMemoryPreset(state, chat);
  const contact = contactById(state, chat?.contactId);
  const mode = preset?.mode || 'auto';
  const floors = Math.max(1, Math.min(50, Number(preset?.floors) || 10));
  const summaryLimit = Math.max(300, Math.floor(limit * 0.75));

  /* 先确认这个角色最新的酒馆聊天是哪一份；总结只读当前打开的那份，
     如果最新聊天不是当前这份，就不能把当前总结当成最新聊天的记忆。 */
  const latest = contact?.name && mode !== 'summary'
    ? await readLatestTavernChat({
      name: contact.name,
      avatar: contact.tavernAvatar || '',
      floors,
    })
    : null;

  let summary = null;
  if (mode !== 'recent') {
    const data = summaryText({ skipFirstFloor: false });
    const current = await readTavernContext();
    const currentNode = String(current?.characterName || '').trim();
    const sameCharacter = !contact?.name || !currentNode || currentNode === contact.name;
    const currentFile = chatKey(current?.chatFile);
    const latestFile = chatKey(latest?.file);
    const sameChat = !currentFile || !latestFile || currentFile === latestFile;
    if (data.nodes.length && sameCharacter && sameChat) {
      const text = clip(data.text, summaryLimit);
      if (text) summary = { text, count: data.nodes.length, demo: data.demo };
    }
  }

  if (summary && mode !== 'recent') {
    return {
      text: `【柏宝书总结】\n${summary.text}`,
      source: 'summary',
      preset,
      floors,
      summaryCount: summary.count,
      demo: summary.demo,
    };
  }

  if (mode === 'summary') {
    return {
      text: '',
      source: 'empty',
      preset,
      floors,
      summaryCount: 0,
      demo: false,
    };
  }

  if (!contact?.name) {
    return { text: '', source: 'empty', preset, floors, summaryCount: 0, demo: false };
  }

  const taverner = latest || await readLatestTavernChat({
    name: contact.name,
    avatar: contact.tavernAvatar || '',
    floors,
  });
  if (!taverner?.lines?.length) {
    return {
      text: summary ? `【柏宝书总结】\n${summary.text}` : '',
      source: summary ? 'summary' : 'empty',
      preset,
      floors,
      summaryCount: summary?.count || 0,
      demo: Boolean(summary?.demo),
    };
  }

  const text = fitRecent(taverner.lines, limit);
  const head = `【酒馆聊天 · 最近 ${taverner.lines.length} 层${taverner.file ? ` · ${taverner.file.replace(/\.jsonl$/i, '')}` : ''}】`;
  return {
    text: `${head}\n${text}`,
    source: 'recent',
    preset,
    floors,
    file: taverner.file,
    summaryCount: 0,
    demo: false,
  };
}
