/**
 * meme-phone · 酒馆记忆
 *
 * 聊天 / 日记的上下文来源收成一套「记忆方案」：
 * - auto：这个角色最新聊天文件里有柏宝书记忆，就注入记忆；没有就取最近几层酒馆原文。
 * - summary：只用柏宝书记忆。
 * - recent：只取最近几层酒馆原文。
 * 手机默认一套方案，某个会话可以单独换一套。
 */

import { contactById, memoryPresetFor, memoryReadModeFor } from './data.js';
import { chatMemorySummary, summaryText } from './book.js';
import { readLatestTavernChat, readTavernContext } from './host.js';

export const MEMORY_MODES = [
  { value: 'auto', label: '自动', hint: '有总结先用总结，没有就取最近几层原文' },
  { value: 'summary', label: '只用总结', hint: '只注入酒馆总结' },
  { value: 'recent', label: '只看原文', hint: '只注入最近几层酒馆聊天' },
];

export function memoryModeLabel(mode) {
  return MEMORY_MODES.find(item => item.value === mode)?.label || '自动';
}

/** 一行说明，给聊天设置和预设页共用。 */
export function memoryPresetSummary(preset) {
  if (!preset) return '还没设记忆方案';
  const floors = Math.max(1, Math.min(50, Number(preset.floors) || 10));
  const first = preset.skipFirstFloor ? ' · 首楼用原文' : '';
  if (preset.mode === 'summary') return `${memoryModeLabel(preset.mode)}${first}`;
  if (preset.mode === 'recent') return `${memoryModeLabel(preset.mode)} · 最近 ${floors} 层${first}`;
  return `${memoryModeLabel(preset.mode)} · 有总结先用，否则 ${floors} 层${first}`;
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

/** 总结有几段、几层、多少字；页面顶部只报数字，不铺正文。 */
function summaryMetrics(data) {
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const chars = nodes.reduce((sum, node) => sum + String(node.text || '').length, 0)
    + String(data?.firstText || '').length;
  const depth = nodes.reduce((max, node) => Math.max(max, Number(node.level) || 1), 0);
  return { segments: nodes.length, depth, chars };
}

function emptyResult(preset, floors, extra = {}) {
  return {
    text: '',
    source: 'empty',
    preset,
    floors,
    summaryCount: 0,
    demo: false,
    mode: 'recent',
    hasSummary: false,
    metrics: { chars: 0, segments: 0, depth: 0, lines: 0, floors },
    ...extra,
  };
}

/**
 * 读这个会话的酒馆记忆。
 * limit 是总字数预算，层数是方案里的 floors。
 * 实际读总结还是原文由 memoryReadModeFor 决定（角色开关 > 方案 > 手机默认）。
 */
export async function buildMemoryContext(state, chat, limit = 1200) {
  const preset = activeMemoryPreset(state, chat);
  const contact = contactById(state, chat?.contactId);
  const wanted = memoryReadModeFor(state, chat?.contactId, preset);
  const floors = Math.max(1, Math.min(50, Number(preset?.floors) || 10));
  const summaryLimit = Math.max(300, Math.floor(limit * 0.75));

  /* 先找到这个角色最新的一份酒馆聊天。柏宝书只按这份聊天文件读：
     文件里有 chat_metadata[baibai_book] / 消息 extra.bbs_leaf 就直接用；
     没有才回退到当前打开聊天的只读接口。
     不管这次读不读总结，都先把总结摸一遍——顶部要报「有没有总结、能不能切」。 */
  const latest = contact?.name
    ? await readLatestTavernChat({
      name: contact.name,
      avatar: contact.tavernAvatar || '',
      floors,
      includeMemory: true,
    })
    : null;

  let summary = null;
  {
    const fileData = latest?.messages?.length
      ? chatMemorySummary({
        metadata: latest.metadata,
        messages: latest.messages,
        skipFirstFloor: Boolean(preset?.skipFirstFloor),
      })
      : null;
    let data = fileData;
    let demo = false;

    /* 文件里没有真实柏宝书记忆时，只在“最新聊天 == 当前打开聊天”时读宿主接口，
       避免把当前聊天的总结串到另一份聊天上。 */
    if (!data?.nodes?.length) {
      const current = await readTavernContext();
      const currentNode = String(current?.characterName || '').trim();
      const sameCharacter = !contact?.name || !currentNode || currentNode === contact.name;
      const currentFile = chatKey(current?.chatFile);
      const latestFile = chatKey(latest?.file);
      const sameChat = !currentFile || !latestFile || currentFile === latestFile;
      if (sameCharacter && sameChat) {
        const legacy = summaryText({ skipFirstFloor: Boolean(preset?.skipFirstFloor), name: contact?.name });
        if (legacy.nodes.length) {
          data = legacy;
          demo = Boolean(legacy.demo);
        }
      }
    }

    if (data?.nodes?.length) {
      const parts = [];
      if (data.firstText) parts.push(`【首楼原文】\n${data.firstText}`);
      data.nodes.forEach(node => {
        const label = node.timeLabel || (node.floorStart != null ? `第 ${node.floorStart}–${node.floorEnd} 楼` : '');
        parts.push(label ? `【${label}】\n${node.text}` : node.text);
      });
      const text = clip(parts.join('\n\n'), summaryLimit);
      if (text) {
        summary = {
          text,
          count: data.nodes.length,
          demo,
          metrics: summaryMetrics(data),
        };
      }
    }
  }

  const hasSummary = Boolean(summary);
  const numbers = summary?.metrics || { chars: 0, segments: 0, depth: 0 };

  if (summary && wanted !== 'recent') {
    return {
      text: `【酒馆总结】\n${summary.text}`,
      source: 'summary',
      preset,
      floors,
      summaryCount: summary.count,
      demo: summary.demo,
      mode: wanted,
      hasSummary,
      metrics: { chars: numbers.chars, segments: numbers.segments, depth: numbers.depth, lines: 0, floors },
    };
  }

  /* 方案/默认写明「只用总结」时保持原样：没有总结就是空的，不擅自换成原文 */
  if (wanted === 'summary') {
    return emptyResult(preset, floors, {
      mode: 'summary',
      hasSummary,
      metrics: { chars: numbers.chars, segments: numbers.segments, depth: numbers.depth, lines: 0, floors },
    });
  }

  if (!contact?.name) {
    return emptyResult(preset, floors, { mode: wanted === 'recent' ? 'recent' : 'auto', hasSummary });
  }

  const taverner = latest?.lines?.length ? latest : await readLatestTavernChat({
    name: contact.name,
    avatar: contact.tavernAvatar || '',
    floors,
  });
  if (!taverner?.lines?.length) {
    /* 明确选了读原文、但聊天文件里没有楼层：就是空的，不偷偷换成总结 */
    return emptyResult(preset, floors, { mode: wanted === 'recent' ? 'recent' : 'auto', hasSummary });
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
    mode: wanted === 'recent' ? 'recent' : 'auto',
    hasSummary,
    metrics: { chars: text.length, segments: 0, depth: 0, lines: taverner.lines.length, floors },
  };
}
