/**
 * meme-phone · 柏宝书总结读取
 *
 * 只保留读接口：聊天 / 日记的记忆注入从这里拿总结，不再有独立的「酒馆总结」页面。
 */

const DEMO_FIRST = '1988 年 9 月 28 日 傍晚，雨刚停。你拖着最后一箱书上到六楼，302 室的门半开着，屋里只有一盏没罩子的灯泡。';
const DEMO_NODES = [
  { id: 'd1', kind: 'leaf', level: 1, text: '雨夜搬家，沈砚敲门送伞与备用钥匙；他的手擦伤了，手表停在三点十七分。', timeLabel: '今天傍晚', floorStart: 84, floorEnd: 86 },
  { id: 'd2', kind: 'comp', level: 2, text: '搬家前后两天：打扫 302 室、借伞、拆箱；沈砚持续帮忙但话很少。', timeLabel: '最近两天', floorStart: 78, floorEnd: 86 },
];

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
  } else {
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
