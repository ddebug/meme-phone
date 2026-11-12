/**
 * meme-phone · 酒馆总结读取
 *
 * 只保留读接口：聊天 / 日记的记忆注入从这里拿总结，不再有独立的「酒馆总结」页面。
 * 柏宝书自己的界面、设置和落盘逻辑都不在这里，手机侧只读取，不写回。
 */

const DEMO_FIRST = '1988 年 9 月 28 日 傍晚，雨刚停。你拖着最后一箱书上到六楼，302 室的门半开着，屋里只有一盏没罩子的灯泡。';
const DEMO_NODES = [
  { id: 'd1', kind: 'leaf', level: 1, text: '雨夜搬家，沈砚敲门送伞与备用钥匙；他的手擦伤了，手表停在三点十七分。', timeLabel: '今天傍晚', floorStart: 84, floorEnd: 86 },
  { id: 'd2', kind: 'comp', level: 2, text: '搬家前后两天：打扫 302 室、借伞、拆箱；沈砚持续帮忙但话很少。', timeLabel: '最近两天', floorStart: 78, floorEnd: 86 },
];
const MEMORY_KEY = 'baibai_book';

export function bookApi() {
  try {
    return globalThis.STBaiBaiBook || null;
  } catch (error) {
    return null;
  }
}

function isFirstFloor(node) {
  return node && node.floorStart === 0 && (node.floorEnd == null || node.floorEnd === 0);
}

function memText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function memoryData(metadata) {
  if (!metadata || typeof metadata !== 'object') return null;
  const root = metadata.chat_metadata && typeof metadata.chat_metadata === 'object'
    ? metadata.chat_metadata
    : metadata;
  const data = root[MEMORY_KEY];
  if (data && typeof data === 'object' && Array.isArray(data.summaries)) return data;
  /* 兼容直接传柏宝书 memory 对象（tests / 旧调用） */
  if (Array.isArray(root.summaries)) return root;
  return null;
}

function chatMessages(messages) {
  return (Array.isArray(messages) ? messages : []).filter(item => (
    item && typeof item === 'object' && !item.chat_metadata
    && (typeof item.mes === 'string' || item.is_user === true || typeof item.name === 'string')
  ));
}

function floorRange(summary) {
  const covered = Array.isArray(summary?.coveredIndices)
    ? summary.coveredIndices.filter(value => Number.isInteger(value) && value >= 0)
    : [];
  if (!covered.length) return { floorStart: null, floorEnd: null, msgIndex: -1 };
  const sorted = [...covered].sort((a, b) => a - b);
  return {
    floorStart: sorted[0],
    floorEnd: sorted[sorted.length - 1],
    msgIndex: sorted[sorted.length - 1],
  };
}

function makeLeafFromSummary(summary) {
  const range = floorRange(summary);
  const text = memText(summary?.text);
  if (!text || !summary?.id) return null;
  return {
    id: String(summary.id),
    kind: 'leaf',
    level: 0,
    text,
    timeStart: summary.timeStart,
    timeEnd: summary.timeEnd,
    timeLabel: summary.timeLabel,
    createdAt: summary.createdAt,
    childIds: [],
    atomic: false,
    ...range,
  };
}

function makeSummaryNode(summary) {
  const text = memText(summary?.text);
  if (!text || !summary?.id) return null;
  const range = floorRange(summary);
  const imported = summary.imported === true;
  const childIds = Array.isArray(summary.childIds) ? summary.childIds.map(String) : [];
  return {
    id: String(summary.id),
    kind: 'comp',
    level: Math.max(1, Number(summary.level) || 1),
    text,
    timeStart: summary.timeStart,
    timeEnd: summary.timeEnd,
    timeLabel: summary.timeLabel,
    createdAt: summary.createdAt,
    childIds,
    atomic: imported || childIds.length === 0,
    floorStart: imported && Number.isInteger(summary.importedFloorStart)
      ? summary.importedFloorStart
      : range.floorStart,
    floorEnd: imported && Number.isInteger(summary.importedFloorEnd)
      ? summary.importedFloorEnd
      : range.floorEnd,
    msgIndex: imported && Number.isInteger(summary.importedFloorEnd) ? summary.importedFloorEnd : -1,
  };
}

function selectHistoryNodes(byId, skipFirstFloor) {
  const leafCache = new Map();
  const leafList = (node, seen = new Set()) => {
    if (!node || seen.has(node.id)) return [];
    if (node.kind === 'leaf' || node.atomic) return [node];
    const cached = leafCache.get(node.id);
    if (cached) return cached;
    seen.add(node.id);
    const out = [];
    for (const childId of node.childIds || []) {
      const child = byId.get(childId);
      if (child) out.push(...leafList(child, seen));
    }
    leafCache.set(node.id, out);
    return out;
  };

  const eligible = node => {
    if (!node) return false;
    if (!skipFirstFloor) return true;
    if (node.kind === 'leaf' || node.atomic) {
      return node.floorStart !== 0 && node.msgIndex !== 0;
    }
    const leaves = leafList(node);
    return leaves.length > 0 && leaves.every(item => (item.floorStart !== 0 && item.msgIndex !== 0));
  };

  /* 压缩节点本身不带楼层时，用后代叶子补出覆盖范围，时间标签和排序才有依据。 */
  for (const node of byId.values()) {
    if (node.kind !== 'comp') continue;
    const leaves = leafList(node);
    if (!leaves.length) continue;
    const floors = leaves.map(item => item.floorStart ?? item.msgIndex).filter(Number.isInteger);
    if (!floors.length) continue;
    if (node.floorStart == null) node.floorStart = Math.min(...floors);
    if (node.floorEnd == null) node.floorEnd = Math.max(...floors);
    if (node.msgIndex < 0) node.msgIndex = node.floorEnd;
  }

  const intactCache = new Map();
  const intact = node => {
    if (!node) return false;
    if (node.kind === 'leaf' || node.atomic) return true;
    if (intactCache.has(node.id)) return intactCache.get(node.id);
    intactCache.set(node.id, false);
    const ok = node.childIds.length > 0 && node.childIds.every(childId => {
      const child = byId.get(childId);
      return Boolean(child) && intact(child);
    });
    intactCache.set(node.id, ok);
    return ok;
  };

  const canRepresent = node => {
    if (!intact(node)) return false;
    if (node.kind === 'leaf' || node.atomic) return eligible(node);
    const leaves = leafList(node);
    return leaves.length > 0 && leaves.every(eligible);
  };

  const referenced = new Set();
  for (const node of byId.values()) {
    for (const childId of node.childIds || []) referenced.add(childId);
  }
  const roots = [...byId.values()].filter(node => !referenced.has(node.id));
  const chosen = [];
  const visited = new Set();
  const visit = node => {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    if (node.kind === 'leaf' || node.atomic) {
      if (eligible(node)) chosen.push(node);
      return;
    }
    if (canRepresent(node)) {
      chosen.push(node);
      return;
    }
    for (const childId of node.childIds || []) visit(byId.get(childId));
  };
  roots.forEach(visit);
  /* 病态环或整片被引用时兜底，保证仍能读到可用节点 */
  if (!chosen.length) {
    for (const node of byId.values()) {
      if (!visited.has(node.id)) visit(node);
    }
  }
  /* 只有压缩森林、叶子已经丢失时，退到根节点正文，别把整份记忆读空。 */
  if (!chosen.length) {
    const fallback = [...byId.values()]
      .filter(node => node.kind === 'comp' && node.text && !referenced.has(node.id))
      .filter(node => !skipFirstFloor || node.floorStart !== 0);
    if (fallback.length) chosen.push(...fallback);
  }

  const sortKey = node => {
    if (node.floorStart != null) return node.floorStart;
    const leaves = leafList(node);
    return leaves.length ? Math.min(...leaves.map(item => item.floorStart ?? item.msgIndex).filter(Number.isInteger)) : Number.MAX_SAFE_INTEGER;
  };
  return chosen.sort((a, b) => sortKey(a) - sortKey(b));
}

/**
 * 从一份酒馆聊天文件里读柏宝书记忆。
 * 只读 chat_metadata[baibai_book] 和消息 extra.bbs_leaf，不碰全局 STBaiBaiBook，也不写回。
 */
export function chatMemorySummary({ metadata = null, messages = [], skipFirstFloor = false } = {}) {
  const data = memoryData(metadata);
  const chat = chatMessages(messages);
  if (!data || !Array.isArray(data.summaries)) {
    return { nodes: [], coverage: { complete: true, missingAiFloors: [] }, demo: false, firstText: '', skipFirstFloor };
  }

  const byId = new Map();
  for (let index = 0; index < chat.length; index += 1) {
    const message = chat[index];
    if (message.extra?.bbs_omit) continue;
    const leaf = message.extra?.bbs_leaf;
    const text = memText(leaf?.text);
    if (!text || !leaf?.id) continue;
    const id = String(leaf.id);
    byId.set(id, {
      id,
      kind: 'leaf',
      level: 0,
      text,
      timeStart: leaf.timeStart,
      timeEnd: leaf.timeEnd,
      timeLabel: leaf.timeLabel,
      createdAt: leaf.createdAt,
      childIds: [],
      atomic: false,
      floorStart: index,
      floorEnd: index,
      msgIndex: index,
    });
  }

  for (const summary of data.summaries) {
    if (!summary || typeof summary !== 'object') continue;
    if (Number(summary.level) === 0 && summary.imported !== true) {
      const node = makeLeafFromSummary(summary);
      if (node && !byId.has(node.id)) byId.set(node.id, node);
    } else {
      const node = makeSummaryNode(summary);
      if (node) byId.set(node.id, node);
    }
  }

  const nodes = selectHistoryNodes(byId, Boolean(skipFirstFloor));
  const firstText = skipFirstFloor ? memText(chat[0]?.mes) : '';
  return {
    nodes: nodes.map(node => ({ ...node })),
    coverage: { complete: true, missingAiFloors: [] },
    demo: false,
    firstText,
    skipFirstFloor,
  };
}

/**
 * 读取当前聊天全部总结。
 * skipFirstFloor=true 时：首楼的总结不参与，改成给首楼原文。
 */
export function readSummaries({ skipFirstFloor = false } = {}) {
  const api = bookApi();
  let nodes = [];
  let coverage = { complete: true, missingAiFloors: [] };
  let firstText = '';
  let demo = false;

  if (api && typeof api.getHistory === 'function') {
    try {
      const history = api.getHistory() || {};
      nodes = Array.isArray(history.nodes) ? history.nodes.map(node => ({ ...node })) : [];
      coverage = history.coverage || coverage;
      if (typeof api.getFloor === 'function') {
        try { firstText = String(api.getFloor(0)?.body || ''); } catch (error) { firstText = ''; }
      }
    } catch (error) {
      nodes = [];
    }
  } else if (globalThis.__MEME_DEMO__) {
    /* 只有预览环境才用演示数据；真机没接上柏宝书时宁可没有记忆，也不注入假总结 */
    demo = true;
    nodes = DEMO_NODES.map(node => ({ ...node }));
    firstText = DEMO_FIRST;
  }

  if (skipFirstFloor) nodes = nodes.filter(node => !isFirstFloor(node));

  return {
    nodes,
    coverage,
    demo,
    firstText: skipFirstFloor ? (firstText || (demo ? DEMO_FIRST : '')) : '',
    skipFirstFloor,
  };
}

/** 拼成给模型看的背景：首楼原文（如果选了）+ 每条总结。 */
export function summaryText(options = {}) {
  const data = readSummaries(options);
  const parts = [];
  if (data.firstText) parts.push(`【首楼原文】\n${data.firstText}`);
  data.nodes.forEach(node => {
    const label = node.timeLabel || (node.floorStart != null ? `第 ${node.floorStart}–${node.floorEnd} 楼` : '');
    parts.push(label ? `【${label}】\n${node.text}` : node.text);
  });
  return { ...data, text: parts.join('\n\n') };
}
