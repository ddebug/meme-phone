/**
 * meme-phone · 酒馆总结（原柏宝书）
 *
 * 把柏宝书的只读接口收成一层：手机里的「酒馆总结」页、聊天和日记都用这里的口径。
 * 关键口径：聊天背景用「所有酒馆总结」，不读酒馆原文；首楼可以被设置成不总结、直接显示原文。
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

/** 手机「接口」里能拿来当总结接口的预设（酒馆 API 那条没有地址，跳过）。 */
export function summaryApiPresets(state) {
  const list = state?.settings?.api?.presets || [];
  return list.filter(preset => preset && preset.url && preset.engine !== 'tavern');
}

/**
 * 把手机的一套预设交给酒馆总结当副 API。
 * 桥由 baibai-book/dist 暴露；没装/没加载时返回 false，调用方提示即可。
 */
export function applySummaryApi(preset) {
  if (!preset) return false;
  try {
    const bridge = globalThis.__STBaiBaiBookPhoneApi;
    if (!bridge || typeof bridge.useChannel !== 'function') return false;
    return Boolean(bridge.useChannel({
      id: preset.id,
      name: preset.name || '手机接口',
      url: preset.url,
      key: preset.key || '',
      model: preset.model || '',
      temperature: typeof preset.temp === 'number' ? preset.temp : 0.8,
    }));
  } catch (error) {
    return false;
  }
}

export function clearSummaryApi() {
  try {
    const bridge = globalThis.__STBaiBaiBookPhoneApi;
    if (bridge && typeof bridge.reset === 'function') {
      bridge.reset();
      return true;
    }
  } catch (error) { /* 没桥就当已经跟随自带 */ }
  return false;
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

/** 聊天 / 日记用的截断版本，别把整本总结全塞进 prompt。 */
export function summaryContext(limit = 1800, options = {}) {
  const data = summaryText(options);
  let text = data.text || '';
  if (text.length > limit) text = `${text.slice(0, limit)}\n…（后面还有 ${data.nodes.length} 条总结）`;
  return { ...data, text };
}
