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
import { novelaiImage } from '../host.js';

const SIZES = [
  { key: '832x1216', w: 832, h: 1216, label: '竖版 832×1216' },
  { key: '1024x1024', w: 1024, h: 1024, label: '方图 1024×1024' },
  { key: '1216x832', w: 1216, h: 832, label: '横版 1216×832' },
  { key: '768x1344', w: 768, h: 1344, label: '长竖 768×1344' },
];

const SAMPLERS = ['k_euler_ancestral', 'k_euler', 'k_dpmpp_2m', 'k_dpmpp_2s_ancestral', 'k_heun'];
const NOISES = ['karras', 'native', 'exponential', 'polyexponential'];

const NAI_MODELS = [
  { value: 'nai-diffusion-4-curated-preview', label: 'V4 精选（默认）' },
  { value: 'nai-diffusion-4-full', label: 'V4 完整' },
  { value: 'nai-diffusion-3', label: 'V3 动漫' },
  { value: 'nai-diffusion-3-furry', label: 'V3 兽人' },
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
    lastPrompt: '',
    history: [],
  };
  if (!state.draw || typeof state.draw !== 'object') state.draw = base;
  state.draw.config = { ...base.config, ...(state.draw.config || {}) };
  if (!Array.isArray(state.draw.presets) || !state.draw.presets.length) state.draw.presets = base.presets;
  state.draw.presets = state.draw.presets.map((item, index) => ({
    id: item.id || `dp_${index}_${newId('x')}`,
    name: item.name || `预设 ${index + 1}`,
    pos: item.pos || '',
    neg: item.neg || '',
  }));
  if (typeof state.draw.presetIdx !== 'number' || state.draw.presetIdx >= state.draw.presets.length) state.draw.presetIdx = 0;
  if (!Array.isArray(state.draw.history)) state.draw.history = [];

  const img = state.settings.image;
  if (!img || typeof img !== 'object') state.settings.image = {};
  const image = state.settings.image;
  image.engine = ['custom', 'doubao'].includes(image.engine) ? image.engine : 'novelai';
  image.novelai = { url: 'https://image.novelai.net', key: '', model: 'nai-diffusion-4-curated-preview', ...(image.novelai || {}) };
  image.doubao = { url: 'https://ark.cn-beijing.volces.com/api/v3/images/generations', key: '', model: 'doubao-seedream-4-5-251128', ...(image.doubao || {}) };
  image.custom = { url: '', key: '', model: '', path: '/v1/images/generations', ...(image.custom || {}) };
  return state.draw;
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

/* 绘图接口只读 settings.image，跟聊天那套 API 预设没有关系 */
export function imageEndpoint(state) {
  const image = state.settings?.image || {};
  const engine = ['custom', 'doubao'].includes(image.engine) ? image.engine : 'novelai';
  const cfg = engine === 'novelai'
    ? (image.novelai || {})
    : engine === 'doubao' ? (image.doubao || {}) : (image.custom || {});
  const drawCfg = state.draw?.config || {};
  return {
    engine,
    name: engine === 'novelai' ? 'NovelAI 官方' : engine === 'doubao' ? '豆包 · 火山方舟' : '自定义接口',
    url: String(cfg.url || (engine === 'novelai' ? drawCfg.url : '') || '').trim(),
    path: engine === 'custom' ? String(cfg.path || '/v1/images/generations').trim() : '',
    key: String(cfg.key || (engine === 'novelai' ? drawCfg.key : '') || '').trim(),
    model: String(cfg.model || (engine === 'novelai' ? drawCfg.model : '') || '').trim(),
  };
}

function endpointReady(ep) {
  if (ep.engine === 'custom') return Boolean(ep.url);
  return Boolean(ep.url && ep.key);
}

export const drawApp = {
  id: 'draw', name: '绘图', icon: 'image',

  render(ctx) {
    const draw = ensure(ctx.state);
    const cfg = draw.config;
    const preset = draw.presets[draw.presetIdx] || draw.presets[0];
    const size = sizeOf(cfg.size);
    const ep = imageEndpoint(ctx.state);
    const ready = endpointReady(ep);
    const busy = Boolean(draw.busy);

    const chips = draw.presets.map((item, index) => `
      <button class="mp-chip-btn${index === draw.presetIdx ? ' is-on' : ''}" data-act="draw-preset" data-i="${index}" type="button">
        <span style="font-size:12.5px">${esc(item.name || `预设 ${index + 1}`)}</span>
      </button>`).join('');

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
        <button class="mp-back" data-act="draw-preset-menu" type="button" title="提示词预设">${icon('settings')}</button>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">绘图</div>
        <div class="mp-subtitle">${ep.engine === 'novelai' ? 'NovelAI 官方' : ep.engine === 'doubao' ? '豆包 Seedream · 火山方舟' : '自定义接口'} · 中文描述会先翻成 danbooru tag</div>

        <div class="mp-draw-state${ready ? ' is-on' : ''}">
          ${icon(ready ? 'spark' : 'help')}
          <span>${ready
            ? `已接「${esc(ep.name)}」${ep.model ? ` · ${esc(ep.model)}` : ''}`
            : (ep.engine === 'custom' ? '还没填自定义接口地址，现在是演示出图' : `${esc(ep.name)} 的 Key 还没填，现在是演示出图`)}</span>
          <button class="mp-draw-state-btn" data-act="draw-key" type="button">填 Key</button>
        </div>

        <div class="mp-group-label" style="margin-top:12px">绘图接口 · 跟聊天 API 分开</div>
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

        <div class="mp-group-label" style="margin-top:12px">提示词预设</div>
        <div class="mp-draw-chips">${chips}<button class="mp-chip-btn" data-act="draw-preset-new" type="button"><span style="font-size:12.5px">＋ 新建</span></button></div>

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
    const engine = image.engine;
    const target = engine === 'novelai' ? image.novelai : engine === 'doubao' ? image.doubao : image.custom;
    const preset = draw.presets[draw.presetIdx] || draw.presets[0];

    if (act === 'draw-engine') {
      ctx.openSheet({
        kind: 'pick', title: '绘图接口',
        items: ENGINES.map(item => ({ value: item.value, label: item.label, note: item.note })),
        onPick: value => {
          image.engine = value;
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
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'draw-model') {
      if (engine === 'novelai' || engine === 'doubao') {
        const list = engine === 'novelai' ? NAI_MODELS : DOUBAO_MODELS;
        ctx.openSheet({
          kind: 'pick', title: '模型',
          items: list.map(item => ({ value: item.value, label: item.label })),
          onPick: value => { target.model = value; ctx.save(); ctx.rerender(); },
        });
      } else {
        ctx.openSheet({
          kind: 'text', title: '模型',
          placeholder: '接口要的模型名，比如 flux-dev',
          value: String(target.model || ''),
          onText: value => { target.model = value.trim(); ctx.save(); ctx.rerender(); },
        });
      }
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
      draw.presetIdx = Number(data.i) || 0;
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
      ctx.save();
      ctx.rerender();
      ctx.toast(`按「${preset.name || '预设'}」新建了一套`);
      return true;
    }

    if (act === 'draw-preset-menu') {
      ctx.openSheet({
        kind: 'pick', title: `提示词预设 · ${preset.name || ''}`,
        items: [
          { label: '新建一套（复制当前）', value: 'new', icon: 'plus' },
          { label: '给这套改名', value: 'rename', icon: 'brush' },
          { label: '删掉这套', value: 'del', icon: 'trash' },
        ],
        onPick: value => {
          if (value === 'new') {
            const copy = { id: newId('dp'), name: `${preset.name || '预设'} 副本`, pos: preset.pos || '', neg: preset.neg || '' };
            draw.presets.push(copy);
            draw.presetIdx = draw.presets.length - 1;
            ctx.save();
            ctx.rerender();
            ctx.toast('新建了一套，改名后就是你的模板');
          }
          if (value === 'rename') {
            ctx.openSheet({
              kind: 'text', title: '预设名字', value: preset.name || '',
              onText: text => {
                preset.name = String(text || '').trim() || preset.name;
                ctx.save();
                ctx.rerender();
              },
            });
          }
          if (value === 'del') {
            if (draw.presets.length <= 1) { ctx.toast('至少留一套'); return; }
            draw.presets.splice(draw.presetIdx, 1);
            draw.presetIdx = Math.max(0, draw.presetIdx - 1);
            ctx.save();
            ctx.rerender();
            ctx.toast('删掉了');
          }
        },
      });
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
