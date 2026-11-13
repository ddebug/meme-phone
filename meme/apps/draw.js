/**
 * meme-phone · 绘图 App
 *
 * 接口跟聊天的 API 预设分开：这里只认「绘图接口」自己的一套引擎 / 地址 / Key / 模型。
 * 引擎两选一：NovelAI 官方（官方端点自带 V4 参数）、自定义接口（OpenAI 风格的 images 接口）。
 * 提示词预设单独一套：名字 + 正向 + 反向，可以新建副本、改名、删掉。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import { newId } from '../data.js';
import { novelaiImage, probeImageApi } from '../host.js';

const SIZES = [
  { key: '832x1216', w: 832, h: 1216, label: '竖版 832×1216' },
  { key: '1024x1024', w: 1024, h: 1024, label: '方图 1024×1024' },
  { key: '1216x832', w: 1216, h: 832, label: '横版 1216×832' },
  { key: '768x1344', w: 768, h: 1344, label: '长竖 768×1344' },
];

const SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m', 'k_dpmpp_2s_ancestral', 'k_heun'];
const NOISES = ['karras', 'native', 'exponential', 'polyexponential'];

/* NovelAI 官方不给模型列表接口（/ai/models 一律 404），可选模型是固定的这几款。
   4.5 以下已基本下线，仍留着是为了让老存档能显示、能改回来。 */
const NAI_MODELS = [
  { value: 'nai-diffusion-5-full', label: 'NAI 5 Full（最新，无过滤）' },
  { value: 'nai-diffusion-5-curated', label: 'NAI 5 Curated（有内容过滤）' },
  { value: 'nai-diffusion-4-5-full', label: 'NAI 4.5 Full（无过滤）' },
  { value: 'nai-diffusion-4-5-curated', label: 'NAI 4.5 Curated（有内容过滤）' },
  { value: 'nai-diffusion-4-full', label: 'NAI 4 Full（旧版）' },
  { value: 'nai-diffusion-4-curated-preview', label: 'NAI 4 精选（旧版）' },
  { value: 'nai-diffusion-3', label: 'NAI 3 动漫（旧版）' },
  { value: 'nai-diffusion-3-furry', label: 'NAI 3 兽人（旧版）' },
];

const DOUBAO_MODELS = [
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' },
  { value: 'doubao-seedream-3-0-t2i-250415', label: 'Seedream 3.0 文生图' },
  { value: 'doubao-seededit-3-0-i2i-250628', label: 'SeedEdit 3.0 图生图' },
];

const ENGINES = [
  { value: 'novelai', label: 'NovelAI 官方', note: '官方端点，Key 以 pst- 开头' },
  { value: 'doubao', label: '豆包 · 火山方舟', note: 'ark.cn-beijing.volces.com，填 ARK_API_KEY' },
  { value: 'custom', label: '自定义接口', note: 'OpenAI 风格 images 接口，地址 + Key 自己填' },
];

const QUALITY = 'best quality, amazing quality, very aesthetic, absurdres';
const DEFAULT_NEG = 'lowres, bad anatomy, bad hands, bad feet, text, watermark, signature, worst quality, jpeg artifacts';

const TINTS = [
  'linear-gradient(150deg,#e6dcff,#c9bcf7 60%,#b3d6f2)',
  'linear-gradient(150deg,#ffe3ef,#f8c6dd 60%,#efe6ff)',
  'linear-gradient(150deg,#dff1ea,#bfe9d6 60%,#cfe0f8)',
  'linear-gradient(150deg,#fdf0dc,#fbd6ae 60%,#f4c8e6)',
];

function ensure(state) {
  const base = {
    config: {
      url: '', key: '', model: 'nai-diffusion-4-curated-preview',
      size: '832x1216', steps: 28, scale: 5,
      sampler: 'k_euler_ancestral', noise: 'karras', seed: '',
    },
    presets: [{ id: 'dp_default', name: '默认', pos: '', neg: '' }],
    presetIdx: 0,
    schemes: [],
    schemeId: '',
    lastPrompt: '',
    history: [],
  };
  if (!state.draw || typeof state.draw !== 'object') state.draw = base;
  /* 保留原对象引用：弹层渲染会重跑 ensure，换成新对象会让回调改到旧对象上 */
  if (!state.draw.config || typeof state.draw.config !== 'object') state.draw.config = {};
  Object.keys(base.config).forEach(key => {
    if (state.draw.config[key] === undefined) state.draw.config[key] = base.config[key];
  });
  const drawPresets = Array.isArray(state.draw.presets)
    ? state.draw.presets.filter(item => item && typeof item === 'object')
    : [];
  if (!drawPresets.length) drawPresets.push(...base.presets.map(item => ({ ...item })));
  state.draw.presets = drawPresets;
  drawPresets.forEach((item, index) => {
    item.id = item.id || `dp_${index}`;
    item.name = item.name || `预设 ${index + 1}`;
    item.pos = item.pos || '';
    item.neg = item.neg || '';
  });
  if (typeof state.draw.presetIdx !== 'number' || state.draw.presetIdx >= state.draw.presets.length) state.draw.presetIdx = 0;
  if (!Array.isArray(state.draw.history)) state.draw.history = [];

  const img = state.settings.image;
  if (!img || typeof img !== 'object') state.settings.image = {};
  const image = state.settings.image;
  image.engine = ['custom', 'doubao'].includes(image.engine) ? image.engine : 'novelai';
  image.novelai = { url: 'https://image.novelai.net', key: '', model: 'nai-diffusion-4-curated-preview', ...(image.novelai || {}) };
  image.doubao = { url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', key: '', model: 'doubao-seedream-4-5-251128', ...(image.doubao || {}) };
  image.custom = { url: '', key: '', model: '', path: '/v1/images/generations', ...(image.custom || {}) };

  /* 把原来那套单一接口配置收成第一套「绘图接口预设」，老存档不用手动迁移 */
  const imagePresets = Array.isArray(image.presets)
    ? image.presets.filter(item => item && typeof item === 'object')
    : [];
  image.presets = imagePresets;
  if (!imagePresets.length) {
    const engine = image.engine;
    const legacy = engine === 'novelai' ? image.novelai : engine === 'doubao' ? image.doubao : image.custom;
    imagePresets.push({
      id: 'image_default',
      name: engine === 'novelai' ? 'NovelAI 官方' : engine === 'doubao' ? '豆包 Seedream' : '自定义接口',
      engine,
      url: legacy.url || '',
      path: legacy.path || '',
      key: legacy.key || '',
      model: legacy.model || '',
    });
  }
  imagePresets.forEach((item, index) => {
    item.id = item.id || `image_${index}`;
    item.name = item.name || `接口 ${index + 1}`;
    item.engine = ['custom', 'doubao'].includes(item.engine) ? item.engine : 'novelai';
    item.url = String(item.url || '');
    item.path = String(item.path || '');
    item.key = String(item.key || '');
    item.model = String(item.model || '');
  });
  if (!imagePresets.some(item => item.id === image.activeId)) image.activeId = imagePresets[0].id;

  /* 整体方案 = 一套接口预设 + 一套提示词预设 */
  if (!Array.isArray(state.draw.schemes)) state.draw.schemes = [];
  state.draw.schemes = state.draw.schemes.filter(item => item && typeof item === 'object');
  state.draw.schemes.forEach((item, index) => {
    item.id = item.id || `ds_${index}`;
    item.name = item.name || `方案 ${index + 1}`;
    item.apiId = item.apiId || image.activeId;
    item.promptId = item.promptId || state.draw.presets[0].id;
  });
  if (!state.draw.schemes.some(item => item.id === state.draw.schemeId)) {
    state.draw.schemeId = state.draw.schemes[0]?.id || '';
  }
  if (!state.draw.schemes.length) {
    const first = {
      id: 'ds_default',
      name: '默认方案',
      apiId: image.activeId,
      promptId: state.draw.presets[state.draw.presetIdx]?.id || state.draw.presets[0].id,
    };
    state.draw.schemes.push(first);
    state.draw.schemeId = first.id;
  }
  return state.draw;
}

function activeApi(state) {
  const image = state.settings?.image || {};
  return (image.presets || []).find(item => item.id === image.activeId) || (image.presets || [])[0] || null;
}

function activePrompt(state) {
  const draw = state.draw || {};
  return draw.presets?.[draw.presetIdx] || draw.presets?.[0] || { id: '', name: '默认', pos: '', neg: '' };
}

function applyScheme(state, scheme) {
  const image = state.settings.image;
  const draw = state.draw;
  if (scheme.apiId && image.presets.some(item => item.id === scheme.apiId)) {
    image.activeId = scheme.apiId;
    const picked = image.presets.find(item => item.id === scheme.apiId);
    if (picked) image.engine = picked.engine;
  }
  const index = draw.presets.findIndex(item => item.id === scheme.promptId);
  if (index >= 0) draw.presetIdx = index;
  draw.schemeId = scheme.id;
}

function sizeOf(key) {
  return SIZES.find(item => item.key === key) || SIZES[0];
}

function maskKey(key) {
  const text = String(key || '');
  if (!text) return '没填';
  if (text.length <= 8) return text.slice(0, 2) + '···';
  return `${text.slice(0, 4)}···${text.slice(-4)}`;
}

function joinUrl(base, path) {
  const clean = String(base || '').trim().replace(/\/+$/, '');
  if (!clean) return '';
  if (/\/v1\/|images\/generations|\/ai\/generate-image/.test(clean)) return clean;
  const route = String(path || '').trim();
  if (!route) return clean;
  return `${clean}${route.startsWith('/') ? '' : '/'}${route}`;
}

/* 绘图接口只读 settings.image 里当前选中的那套接口预设，跟聊天 API 分开 */
export function imageEndpoint(state) {
  const image = state.settings?.image || {};
  const preset = activeApi(state);
  if (!preset) {
    const legacyEngine = ['custom', 'doubao'].includes(image.engine) ? image.engine : 'novelai';
    const cfg = legacyEngine === 'novelai' ? (image.novelai || {}) : legacyEngine === 'doubao' ? (image.doubao || {}) : (image.custom || {});
    return {
      engine: legacyEngine,
      name: legacyEngine === 'novelai' ? 'NovelAI 官方' : legacyEngine === 'doubao' ? '豆包 · 火山方舟' : '自定义接口',
      url: String(cfg.url || '').trim(),
      path: legacyEngine === 'custom' ? String(cfg.path || '/v1/images/generations').trim() : '',
      key: String(cfg.key || '').trim(),
      model: String(cfg.model || '').trim(),
    };
  }
  const engine = ['custom', 'doubao'].includes(preset?.engine) ? preset.engine : 'novelai';
  const drawCfg = state.draw?.config || {};
  return {
    engine,
    name: String(preset?.name || (engine === 'novelai' ? 'NovelAI 官方' : engine === 'doubao' ? '豆包 · 火山方舟' : '自定义接口')),
    url: String(preset?.url || (engine === 'novelai' ? drawCfg.url : '') || '').trim(),
    path: engine === 'custom' ? String(preset?.path || '/v1/images/generations').trim() : '',
    key: String(preset?.key || (engine === 'novelai' ? drawCfg.key : '') || '').trim(),
    model: String(preset?.model || (engine === 'novelai' ? drawCfg.model : '') || '').trim(),
  };
}

function endpointReady(ep) {
  if (ep.engine === 'custom') return Boolean(ep.url);
  return Boolean(ep.url && ep.key);
}

/** 把当前绘图接口的地址 / Key / 模型同步回各引擎的默认配置，换引擎时不丢。 */
function setEngineField(image, engine, key, value) {
  const bucket = engine === 'novelai' ? image.novelai : engine === 'doubao' ? image.doubao : image.custom;
  if (bucket && key in bucket) bucket[key] = value;
}

function nameEditBlock(kind, value) {
  const inputId = kind === 'scheme' ? 'drawSchemeName' : kind === 'api' ? 'drawApiName' : 'drawPresetName';
  return `
    <div class="mp-api-name-edit">
      <input id="${inputId}" class="mp-api-input" type="text" maxlength="20" value="${esc(value || '')}" placeholder="起个名字">
      <button class="mp-draw-side is-primary" data-act="draw-${kind}-name-save" type="button">确定</button>
      <button class="mp-draw-side" data-act="draw-${kind}-name-cancel" type="button">取消</button>
    </div>`;
}

function deleteConfirmBlock(kind, note) {
  return `
    <div class="mp-api-note is-warn" style="margin-top:8px">
      ${esc(note)}
      <div class="mp-draw-actions">
        <button class="mp-draw-action is-danger" data-act="draw-${kind}-del-confirm" type="button">确认删除</button>
        <button class="mp-draw-action" data-act="draw-${kind}-del-cancel" type="button">取消</button>
      </div>
    </div>`;
}

/* 方案管理的页面内联状态：改名只开一个输入行，删除只开一条确认，不走弹层 */
let drawEdit = null;   // { kind: 'scheme' | 'api' | 'preset', value }
let drawDel = null;    // { kind: 'scheme' | 'api' | 'preset', id }

export const drawApp = {
  id: 'draw', name: '绘图', icon: 'image',

  render(ctx) {
    const draw = ensure(ctx.state);
    const cfg = draw.config;
    const preset = draw.presets[draw.presetIdx] || draw.presets[0];
    const size = sizeOf(cfg.size);
    const ep = imageEndpoint(ctx.state);
    const ready = endpointReady(ep);
    const apiPreset = activeApi(ctx.state);
    const apiStatus = apiPreset?.status || null;
    const statusText = apiStatus?.text || (ready ? '还没测试连接' : '先填地址和 Key，再测试连接 · 拉取模型');
    const busy = Boolean(draw.busy);
    const schemeIndex = draw.schemes.findIndex(item => item.id === draw.schemeId);
    const scheme = draw.schemes[schemeIndex] || null;
    const schemeApi = scheme ? (ctx.state.settings.image.presets || []).find(item => item.id === scheme.apiId) : null;
    const schemePrompt = scheme ? draw.presets.find(item => item.id === scheme.promptId) : null;
    const schemeDirty = Boolean(scheme && (scheme.apiId !== ctx.state.settings.image.activeId || scheme.promptId !== preset.id));

    const promptOptions = draw.presets.map((item, index) => `
      <option value="${index}"${index === draw.presetIdx ? ' selected' : ''}>${esc(item.name || `预设 ${index + 1}`)}</option>`).join('');

    const apiOptions = (ctx.state.settings.image.presets || []).map((item, index) => `
      <option value="${index}"${item.id === ctx.state.settings.image.activeId ? ' selected' : ''}>${esc(item.name || `接口 ${index + 1}`)}</option>`).join('');

    const schemeOptions = draw.schemes.map((item, index) => `
      <option value="${index}"${item.id === draw.schemeId ? ' selected' : ''}>${esc(item.name || `方案 ${index + 1}`)}</option>`).join('');

    const rows = [
      { act: 'draw-size', label: '尺寸', value: size.label },
      { act: 'draw-steps', label: '步数', value: `${cfg.steps} 步` },
      { act: 'draw-scale', label: '引导', value: `${cfg.scale}` },
      { act: 'draw-sampler', label: '采样器', value: cfg.sampler.replace('k_', '') },
      { act: 'draw-noise', label: '噪声', value: cfg.noise },
      { act: 'draw-seed', label: '种子', value: cfg.seed ? cfg.seed : '随机' },
    ];

    const history = draw.history.slice(0, 6).map((item, index) => `
      <div class="mp-draw-card">
        <div class="mp-draw-img" style="background:${item.tint || TINTS[index % TINTS.length]}"${item.url ? ` data-img="${esc(item.url)}"` : ''}>
          ${item.url ? `<img src="${esc(item.url)}" alt="">` : `<span class="mp-draw-ph">${icon('spark')}<span>演示</span></span>`}
        </div>
        <div class="mp-draw-meta">
          <span>${esc(item.prompt || '没有描述').slice(0, 26)}</span>
          <span class="mp-draw-seed">seed ${esc(String(item.seed))}</span>
        </div>
        <div class="mp-draw-acts">
          <button class="mp-action-btn" data-act="draw-again" data-i="${index}" type="button">${icon('refresh')}<span>再来一张</span></button>
          <button class="mp-action-btn" data-act="draw-del" data-i="${index}" type="button">${icon('trash')}<span>删掉</span></button>
        </div>
      </div>`).join('');

    return `
      <div class="mp-nav">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">绘图</div>
        <div class="mp-subtitle">${ep.engine === 'novelai' ? 'NovelAI 官方' : ep.engine === 'doubao' ? '豆包 Seedream · 火山方舟' : '自定义接口'} · 中文描述会先翻成 danbooru tag</div>

        <div class="mp-draw-state${ready ? ' is-on' : ''}">
          ${icon(ready ? 'spark' : 'help')}
          <span>${ready
            ? `已接「${esc(ep.name)}」${ep.model ? ` · ${esc(ep.model)}` : ''}`
            : (ep.engine === 'custom' ? '还没填自定义接口地址，现在是演示出图' : `${esc(ep.name)} 的 Key 还没填，现在是演示出图`)}</span>
          <button class="mp-draw-state-btn" data-act="${ep.engine === 'custom' ? 'draw-url' : 'draw-key'}" type="button">${ep.engine === 'custom' ? '改地址' : '填 Key'}</button>
        </div>

        <div class="mp-draw-group-head">
          <span class="mp-group-label">整体方案</span>
          <button class="mp-draw-icon" data-act="draw-scheme-new" type="button" aria-label="新建整体方案">${icon('plus')}</button>
        </div>
        <div class="mp-draw-switch-row">
          <div class="mp-select-wrap"><select data-act="draw-scheme">${schemeOptions}</select>${icon('chevron')}</div>
          <button class="mp-draw-side is-primary" data-act="draw-scheme-save" type="button">保存</button>
          <button class="mp-draw-icon" data-act="draw-scheme-rename" type="button" aria-label="改方案名">${icon('brush')}</button>
          <button class="mp-draw-icon is-danger" data-act="draw-scheme-del" type="button" aria-label="删除这套方案">${icon('trash')}</button>
        </div>
        ${drawEdit?.kind === 'scheme' ? nameEditBlock('scheme', drawEdit.value) : ''}
        ${drawDel?.kind === 'scheme' ? deleteConfirmBlock('scheme', `只会删「${scheme?.name || '当前方案'}」这套组合，接口预设和提示词预设都还在。`) : ''}
        <div class="mp-draw-hint">改完接口或提示词后点「保存」，把当前组合写进这套方案；切走再回来不会丢。${scheme
          ? `当前方案存的是「${esc(schemeApi?.name || '接口')}」 / 「${esc(schemePrompt?.name || '提示词')}」。${schemeDirty ? '当前选择还没保存。' : ''}`
          : ''}</div>

        <div class="mp-draw-group-head">
          <span class="mp-group-label">绘图接口预设</span>
          <button class="mp-draw-icon" data-act="draw-api-new" type="button" aria-label="新建接口预设">${icon('plus')}</button>
        </div>
        <div class="mp-draw-switch-row">
          <div class="mp-select-wrap"><select data-act="draw-api">${apiOptions}</select>${icon('chevron')}</div>
          <button class="mp-draw-side is-primary" data-act="draw-api-save" type="button">保存</button>
          <button class="mp-draw-icon" data-act="draw-api-rename" type="button" aria-label="改接口名">${icon('brush')}</button>
          <button class="mp-draw-icon is-danger" data-act="draw-api-del" type="button" aria-label="删除这套接口">${icon('trash')}</button>
        </div>
        ${drawEdit?.kind === 'api' ? nameEditBlock('api', drawEdit.value) : ''}
        ${drawDel?.kind === 'api' ? deleteConfirmBlock('api', `只会删「${ep.name || '当前接口'}」这套接口，用它的整体方案会换回第一套接口。`) : ''}
        <div class="mp-draw-hint">接口地址、Key、模型改完会存进这套接口预设；点「保存」再把当前接口记到整体方案里。</div>
        <div class="mp-group">
          <button class="mp-row" data-act="draw-engine" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">${esc(ep.name)}</span>
              <span class="mp-row-sub">${esc(ep.engine === 'novelai' ? '官方端点，只用 Key' : ep.engine === 'doubao' ? '火山方舟 images 接口，只用 Key' : '地址 + Key 自己填')}</span>
            </span>${icon('chevron')}
          </button>
          <button class="mp-row" data-act="draw-url" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">地址</span>
              <span class="mp-row-sub">${esc(ep.url || '没填')}</span>
            </span>${icon('chevron')}
          </button>
          <button class="mp-row" data-act="draw-key" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">Key</span>
              <span class="mp-row-sub">${esc(maskKey(ep.key))}</span>
            </span>${icon('chevron')}
          </button>
          <button class="mp-row" data-act="draw-model" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">模型</span>
              <span class="mp-row-sub">${esc(ep.model || '没选')}</span>
            </span>${icon('chevron')}
          </button>
        </div>
        <div class="mp-api-status-inline${apiStatus?.ok ? ' is-ok' : ''}">${esc(statusText)}</div>
        <button class="mp-api-test" data-act="draw-test" type="button">${icon('refresh')}<span>测试连接 · 拉取模型</span></button>

        <div class="mp-draw-group-head">
          <span class="mp-group-label">提示词预设</span>
          <button class="mp-draw-icon" data-act="draw-preset-new" type="button" aria-label="新建提示词预设">${icon('plus')}</button>
        </div>
        <div class="mp-draw-switch-row">
          <div class="mp-select-wrap"><select data-act="draw-preset">${promptOptions}</select>${icon('chevron')}</div>
          <button class="mp-draw-side is-primary" data-act="draw-prompt-save" type="button">保存</button>
          <button class="mp-draw-icon" data-act="draw-preset-rename" type="button" aria-label="改提示词名">${icon('brush')}</button>
          <button class="mp-draw-icon is-danger" data-act="draw-preset-del" type="button" aria-label="删除这套提示词">${icon('trash')}</button>
        </div>
        ${drawEdit?.kind === 'preset' ? nameEditBlock('preset', drawEdit.value) : ''}
        ${drawDel?.kind === 'preset' ? deleteConfirmBlock('preset', `只会删「${preset?.name || '当前提示词'}」这套提示词，用它的整体方案会换回第一套提示词。`) : ''}
        <div class="mp-draw-hint">正向、反向改完会存进这套提示词预设；点「保存」再把当前提示词记到整体方案里。</div>

        <div class="mp-group-label" style="margin-top:14px">画面</div>
        <button class="mp-draw-desc" data-act="draw-prompt" type="button">
          ${draw.lastPrompt
            ? `<span class="mp-draw-desc-text">${esc(draw.lastPrompt)}</span>`
            : `<span class="mp-draw-desc-empty">写一句中文画面，比如「沈砚坐在便利店门口的台阶上，夜里，侧脸，路灯下抽烟」</span>`}
          ${icon('brush')}
        </button>

        <button class="mp-draw-run${busy ? ' is-busy' : ''}" data-act="draw-run" type="button">
          ${icon('spark')}<span>${busy ? '生成中…' : '生成一张'}</span>
        </button>

        <div class="mp-group-label" style="margin-top:14px">这套预设的提示词</div>
        <button class="mp-row" data-act="draw-pos" type="button" style="padding:12px">
          <span class="mp-row-main">
            <span class="mp-row-name">正向 · 质量词</span>
            <span class="mp-row-sub" style="white-space:normal">${esc(preset.pos || QUALITY)}</span>
          </span>${icon('chevron')}
        </button>
        <button class="mp-row" data-act="draw-neg" type="button" style="padding:12px">
          <span class="mp-row-main">
            <span class="mp-row-name">反向 · 不要什么</span>
            <span class="mp-row-sub" style="white-space:normal">${esc(preset.neg || DEFAULT_NEG)}</span>
          </span>${icon('chevron')}
        </button>

        <div class="mp-group-label" style="margin-top:12px">参数</div>
        <div class="mp-draw-grid">
          ${rows.map(row => `
            <button class="mp-draw-param" data-act="${row.act}" type="button">
              <span>${esc(row.label)}</span>
              <span class="mp-draw-val">${esc(String(row.value))}</span>
            </button>`).join('')}
        </div>

        ${draw.history.length ? `
          <div class="mp-group-label" style="margin-top:16px">最近生成</div>
          <div class="mp-draw-list">${history}</div>` : ''}
      </div>`;
  },

  handle(ctx, act, data) {
    const draw = ensure(ctx.state);
    const cfg = draw.config;
    const image = ctx.state.settings.image;
    const apiPreset = activeApi(ctx.state);
    const engine = apiPreset?.engine || 'novelai';
    const target = apiPreset || {};
    const preset = draw.presets[draw.presetIdx] || draw.presets[0];
    const scheme = draw.schemes.find(item => item.id === draw.schemeId);

    if (act === 'draw-scheme') {
      const picked = draw.schemes[Number(data.i ?? data.value)];
      if (!picked) return true;
      applyScheme(ctx.state, picked);
      ctx.save();
      ctx.rerender();
      ctx.toast(`切到方案「${picked.name || '未命名'}」`);
      return true;
    }

    if (act === 'draw-scheme-new') {
      const copy = {
        id: newId('ds'),
        name: `${preset.name || '提示词'} · ${target.name || '接口'}`,
        apiId: image.activeId,
        promptId: preset.id,
      };
      draw.schemes.push(copy);
      draw.schemeId = copy.id;
      drawEdit = { kind: 'scheme', value: copy.name };
      drawDel = null;
      ctx.save();
      ctx.rerender();
      ctx.toast('按当前接口 + 提示词新建了一套方案，顺手改个名字');
      return true;
    }

    if (act === 'draw-scheme-save') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      scheme.apiId = image.activeId;
      scheme.promptId = preset.id;
      ctx.save();
      ctx.rerender();
      ctx.toast(`已保存到方案「${scheme.name || '未命名'}」`);
      return true;
    }

    if (act === 'draw-scheme-rename') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      drawEdit = { kind: 'scheme', value: scheme.name || '' };
      drawDel = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-scheme-name-save') {
      const input = globalThis.document?.getElementById('drawSchemeName');
      const name = String(input?.value || '').trim().slice(0, 20);
      if (scheme && name) scheme.name = name;
      drawEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(name ? `方案改名为「${name}」` : '名字没变');
      return true;
    }

    if (act === 'draw-scheme-name-cancel') {
      drawEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-scheme-del') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      if (draw.schemes.length <= 1) { ctx.toast('至少留一套整体方案'); return true; }
      drawDel = { kind: 'scheme', id: scheme.id };
      drawEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-scheme-del-confirm') {
      if (!scheme) return true;
      draw.schemes = draw.schemes.filter(item => item.id !== scheme.id);
      const next = draw.schemes[0] || null;
      if (next) applyScheme(ctx.state, next);
      else draw.schemeId = '';
      drawDel = null;
      ctx.save();
      ctx.rerender();
      ctx.toast('整体方案已删除');
      return true;
    }

    if (act === 'draw-scheme-del-cancel') {
      drawDel = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-api') {
      const picked = image.presets[Number(data.i ?? data.value)];
      if (!picked) return true;
      image.activeId = picked.id;
      image.engine = picked.engine;
      ctx.save();
      ctx.rerender();
      ctx.toast(`接口换成「${picked.name || '未命名'}」`);
      return true;
    }

    if (act === 'draw-api-save') {
      if (!target?.id) { ctx.toast('现在还没有接口预设'); return true; }
      if (scheme) scheme.apiId = target.id;
      image.activeId = target.id;
      image.engine = target.engine;
      ctx.save();
      ctx.rerender();
      ctx.toast(scheme ? `接口「${target.name || '未命名'}」已保存到当前方案` : `接口「${target.name || '未命名'}」已保存`);
      return true;
    }

    if (act === 'draw-api-rename') {
      if (!target?.id) { ctx.toast('现在还没有接口预设'); return true; }
      drawEdit = { kind: 'api', value: target.name || '' };
      drawDel = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-api-name-save') {
      const input = globalThis.document?.getElementById('drawApiName');
      const name = String(input?.value || '').trim().slice(0, 20);
      if (target?.id && name) target.name = name;
      drawEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(name ? `接口改名为「${name}」` : '名字没变');
      return true;
    }

    if (act === 'draw-api-name-cancel') {
      drawEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-api-del') {
      if (!target?.id) { ctx.toast('现在还没有接口预设'); return true; }
      if (image.presets.length <= 1) { ctx.toast('至少留一套接口预设'); return true; }
      drawDel = { kind: 'api', id: target.id };
      drawEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-api-del-confirm') {
      if (!target?.id) return true;
      const removedId = target.id;
      image.presets = image.presets.filter(item => item.id !== removedId);
      image.activeId = image.presets[0].id;
      image.engine = image.presets[0].engine;
      draw.schemes.forEach(item => { if (item.apiId === removedId) item.apiId = image.activeId; });
      const current = draw.schemes.find(item => item.id === draw.schemeId);
      if (current) applyScheme(ctx.state, current);
      drawDel = null;
      ctx.save();
      ctx.rerender();
      ctx.toast('接口预设已删除');
      return true;
    }

    if (act === 'draw-api-del-cancel') {
      drawDel = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-api-new') {
      const copy = { ...target, id: newId('image'), name: `${target.name || '接口'} 副本` };
      image.presets.push(copy);
      image.activeId = copy.id;
      image.engine = copy.engine;
      drawEdit = { kind: 'api', value: copy.name };
      drawDel = null;
      ctx.save();
      ctx.rerender();
      ctx.toast('复制出一套新接口，顺手改个名字');
      return true;
    }

    if (act === 'draw-engine') {
      ctx.openSheet({
        kind: 'pick', title: '绘图接口',
        items: ENGINES.map(item => ({ value: item.value, label: item.label, note: item.note })),
        onPick: value => {
          const defaults = value === 'novelai' ? (image.novelai || {}) : value === 'doubao' ? (image.doubao || {}) : (image.custom || {});
          target.engine = value;
          image.engine = value;
          target.name = value === 'novelai' ? 'NovelAI 官方' : value === 'doubao' ? '豆包 Seedream' : '自定义接口';
          target.url = String(defaults.url || '');
          target.path = value === 'custom' ? String(defaults.path || '/v1/images/generations') : '';
          target.key = String(defaults.key || '');
          target.model = String(defaults.model || '');
          ctx.save();
          ctx.rerender();
          const name = ENGINES.find(item => item.value === value)?.label || value;
          ctx.toast(`绘图接口换成「${name}」`);
        },
      });
      return true;
    }

    if (act === 'draw-url') {
      ctx.openSheet({
        kind: 'text', title: engine === 'novelai' ? 'NovelAI 地址' : engine === 'doubao' ? '火山方舟地址' : '接口地址',
        placeholder: engine === 'novelai'
          ? '默认 https://image.novelai.net'
          : engine === 'doubao' ? 'https://ark.cn-beijing.volces.com/api/v3/images/generations'
            : 'https://你的接口/v1/images/generations',
        value: String(target.url || ''),
        onText: value => {
          target.url = value.trim();
          setEngineField(image, target.engine, 'url', target.url);
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'draw-key') {
      ctx.openSheet({
        kind: 'text',
        title: engine === 'novelai' ? 'NovelAI Key' : engine === 'doubao' ? 'ARK API Key' : '接口 Key',
        placeholder: engine === 'novelai' ? 'pst- 开头的那串' : engine === 'doubao' ? '火山方舟控制台里的 ARK_API_KEY' : '没验证就留空',
        value: String(target.key || ''),
        onText: value => {
          target.key = value.trim();
          setEngineField(image, target.engine, 'key', target.key);
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'draw-model') {
      /* 内置候选 + 拉取到的模型 + 手填；拉不到列表时至少能手填，不让模型选死 */
      const builtin = engine === 'novelai' ? NAI_MODELS : engine === 'doubao' ? DOUBAO_MODELS : [];
      const fetched = (Array.isArray(target.models) ? target.models : [])
        .map(value => ({ value, label: String(value) }));
      const seen = new Set(builtin.map(item => item.value));
      const items = [...builtin, ...fetched.filter(item => !seen.has(item.value))];
      const pickManual = () => ctx.openSheet({
        kind: 'text', title: '模型',
        placeholder: '接口要的模型名，比如 flux-dev',
        value: String(target.model || ''),
        onText: value => { target.model = value.trim(); setEngineField(image, target.engine, 'model', target.model); ctx.save(); ctx.rerender(); },
      });
      items.push({ value: '__manual__', label: '手动填模型名…', note: '列表里没有就自己写' });
      ctx.openSheet({
        kind: 'pick',
        title: '模型',
        note: engine === 'novelai' ? '官方不给模型列表，下面是内置候选；也能手填' : '',
        items,
        onPick: value => {
          if (value === '__manual__') { setTimeout(pickManual, 0); return; }
          target.model = value;
          setEngineField(image, target.engine, 'model', value);
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'draw-test') {
      if (!target || !image.presets.includes(target)) return true;
      target.status = { ok: false, text: '正在连接…', at: Date.now() };
      ctx.save();
      ctx.rerender();
      probeImageApi({ engine: target.engine, url: target.url, key: target.key, path: target.path })
        .then(result => {
          target.status = { ok: Boolean(result?.ok), text: String(result?.text || ''), at: Date.now() };
          if (Array.isArray(result?.models) && result.models.length) target.models = result.models;
          ctx.save();
          ctx.rerender();
          ctx.toast(result?.ok ? '连接正常' : String(result?.text || '没连上'));
        })
        .catch(error => {
          target.status = { ok: false, text: error?.message || String(error), at: Date.now() };
          ctx.save();
          ctx.rerender();
          ctx.toast(error?.message || '没连上');
        });
      return true;
    }

    if (act === 'draw-prompt') {
      ctx.openSheet({
        kind: 'text', title: '画面', placeholder: '中文描述，越具体越好',
        value: draw.lastPrompt, onText: value => { draw.lastPrompt = value; ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-pos' || act === 'draw-neg') {
      const key = act === 'draw-pos' ? 'pos' : 'neg';
      ctx.openSheet({
        kind: 'text', title: act === 'draw-pos' ? '正向提示词' : '反向提示词',
        placeholder: key === 'pos' ? '质量词 + 想要的东西' : '不想要的东西',
        value: preset[key] || '',
        onText: value => {
          preset[key] = value;
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'draw-preset') {
      const pickedIndex = Number(data.i ?? data.value) || 0;
      draw.presetIdx = pickedIndex;
      ctx.save();
      ctx.rerender();
      return true;
    }

    if (act === 'draw-prompt-save') {
      if (!preset?.id) { ctx.toast('现在还没有提示词预设'); return true; }
      if (scheme) scheme.promptId = preset.id;
      ctx.save();
      ctx.rerender();
      ctx.toast(scheme ? `提示词「${preset.name || '未命名'}」已保存到当前方案` : `提示词「${preset.name || '未命名'}」已保存`);
      return true;
    }

    if (act === 'draw-preset-rename') {
      if (!preset?.id) { ctx.toast('现在还没有提示词预设'); return true; }
      drawEdit = { kind: 'preset', value: preset.name || '' };
      drawDel = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-preset-name-save') {
      const input = globalThis.document?.getElementById('drawPresetName');
      const name = String(input?.value || '').trim().slice(0, 20);
      if (preset?.id && name) preset.name = name;
      drawEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(name ? `提示词改名为「${name}」` : '名字没变');
      return true;
    }

    if (act === 'draw-preset-name-cancel') {
      drawEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-prompt-del') {
      if (!preset?.id) { ctx.toast('现在还没有提示词预设'); return true; }
      if (draw.presets.length <= 1) { ctx.toast('至少留一套提示词预设'); return true; }
      drawDel = { kind: 'preset', id: preset.id };
      drawEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-preset-del-confirm') {
      if (!preset?.id) return true;
      const removedId = preset.id;
      draw.presets.splice(draw.presetIdx, 1);
      draw.presetIdx = Math.max(0, draw.presetIdx - 1);
      draw.schemes.forEach(item => { if (item.promptId === removedId) item.promptId = draw.presets[0].id; });
      const current = draw.schemes.find(item => item.id === draw.schemeId);
      if (current) applyScheme(ctx.state, current);
      drawDel = null;
      ctx.save();
      ctx.rerender();
      ctx.toast('提示词预设已删除');
      return true;
    }

    if (act === 'draw-preset-del-cancel') {
      drawDel = null;
      ctx.rerender();
      return true;
    }

    if (act === 'draw-preset-new') {
      const copy = {
        id: newId('dp'),
        name: `${preset.name || '预设'} 副本`,
        pos: preset.pos || '',
        neg: preset.neg || '',
      };
      draw.presets.push(copy);
      draw.presetIdx = draw.presets.length - 1;
      drawEdit = { kind: 'preset', value: copy.name };
      drawDel = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`按「${preset.name || '预设'}」新建了一套，顺手改个名字`);
      return true;
    }

    if (act === 'draw-size') {
      ctx.openSheet({
        kind: 'pick', title: '尺寸',
        items: SIZES.map(item => ({ value: item.key, label: item.label })),
        onPick: value => { cfg.size = value; ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-steps') {
      ctx.openSheet({
        kind: 'pick', title: '步数',
        items: [20, 24, 28, 32, 40].map(value => ({ value: String(value), label: `${value} 步${value === 28 ? '（默认）' : ''}` })),
        onPick: value => { cfg.steps = Number(value); ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-scale') {
      ctx.openSheet({
        kind: 'pick', title: '引导强度',
        items: [3, 4, 5, 6, 7].map(value => ({ value: String(value), label: `${value}${value === 5 ? '（默认）' : ''}` })),
        onPick: value => { cfg.scale = Number(value); ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-sampler') {
      ctx.openSheet({
        kind: 'pick', title: '采样器',
        items: SAMPLERS.map(value => ({ value, label: value })),
        onPick: value => { cfg.sampler = value; ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-noise') {
      ctx.openSheet({
        kind: 'pick', title: '噪声调度',
        items: NOISES.map(value => ({ value, label: value })),
        onPick: value => { cfg.noise = value; ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-seed') {
      ctx.openSheet({
        kind: 'text', title: '种子', placeholder: '留空就是随机',
        value: String(cfg.seed || ''),
        onText: value => { cfg.seed = value.replace(/[^\d]/g, ''); ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-run' || act === 'draw-again') {
      const prompt = act === 'draw-again'
        ? (draw.history[Number(data.i)]?.prompt || draw.lastPrompt)
        : draw.lastPrompt;
      if (!prompt) {
        ctx.toast('先写一句画面描述');
        return true;
      }
      run(ctx, prompt).catch(error => ctx.toast(error.message || '生成失败'));
      return true;
    }

    if (act === 'draw-del') {
      draw.history.splice(Number(data.i), 1);
      ctx.save();
      ctx.rerender();
      return true;
    }

    return false;
  },
};

/* --------------------------------------------------------------- 出图 */

async function run(ctx, prompt) {
  const draw = ensure(ctx.state);
  const cfg = draw.config;
  const preset = draw.presets[draw.presetIdx] || draw.presets[0];
  const size = sizeOf(cfg.size);
  const seed = Number(cfg.seed) || Math.floor(Math.random() * 4294967295);
  const positive = [preset.pos || QUALITY, prompt].filter(Boolean).join(', ');
  const negative = [preset.neg || DEFAULT_NEG].join(', ');

  draw.busy = true;
  ctx.rerender();
  try {
    let entry = null;
    const ep = imageEndpoint(ctx.state);
    if (endpointReady(ep)) {
      const result = await novelaiImage({
        engine: ep.engine,
        url: joinUrl(ep.url, ep.path),
        key: ep.key,
        model: ep.model || cfg.model,
        width: size.w,
        height: size.h,
        steps: Number(cfg.steps) || 28,
        scale: Number(cfg.scale) || 5,
        sampler: cfg.sampler,
        noise: cfg.noise,
        seed,
        prompt: positive,
        negative,
      });
      if (result?.url) {
        entry = { id: newId('img'), prompt, seed, url: result.url, at: Date.now(), width: size.w, height: size.h };
      }
    }
    if (!entry) {
      entry = {
        id: newId('img'), prompt, seed, url: '', at: Date.now(),
        width: size.w, height: size.h,
        tint: TINTS[draw.history.length % TINTS.length],
      };
      ctx.toast(ep.engine === 'novelai'
        ? '演示出图：绘图接口填上 NovelAI 的 Key 才会真的画'
        : ep.engine === 'doubao' ? '演示出图：填上火山方舟的 ARK API Key 才会真的画'
          : '演示出图：绘图接口填上地址才会真的画');
    }
    draw.history.unshift(entry);
    draw.history = draw.history.slice(0, 18);
  } finally {
    draw.busy = false;
    ctx.save();
    ctx.rerender();
  }
}
