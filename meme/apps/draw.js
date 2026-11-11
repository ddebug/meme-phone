/**
 * meme-phone · 绘图 App
 * NovelAI 那一套：中文描述 → danbooru tag → 尺寸/步数/引导/采样/种子 → 出图。
 * 没有 Key 的时候不出网，只留下一条演示记录，并告诉你缺什么。
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
    presets: [{ name: '默认', pos: '', neg: '' }],
    presetIdx: 0,
    lastPrompt: '',
    history: [],
  };
  if (!state.draw || typeof state.draw !== 'object') state.draw = base;
  state.draw.config = { ...base.config, ...(state.draw.config || {}) };
  if (!Array.isArray(state.draw.presets) || !state.draw.presets.length) state.draw.presets = base.presets;
  if (typeof state.draw.presetIdx !== 'number') state.draw.presetIdx = 0;
  if (!Array.isArray(state.draw.history)) state.draw.history = [];
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

/* 绘图不自己存一套地址 Key 模型：一律读「接口」里当前绘图那套预设 */
export function imageEndpoint(state) {
  const api = state.settings?.api || {};
  const list = Array.isArray(api.presets) ? api.presets : [];
  const preset = list.find(item => item.id === api.activeImage)
    || list.find(item => item.engine === 'novelai')
    || list[0] || null;
  const cfg = state.draw?.config || {};
  return {
    preset,
    id: preset?.id || '',
    name: preset?.name || '',
    engine: preset?.engine || '',
    url: String((preset?.url ?? cfg.url) || '').trim(),
    path: String(preset?.path || '/ai/generate-image').trim(),
    key: String((preset?.key ?? cfg.key) || '').trim(),
    model: String((preset?.model ?? cfg.model) || '').trim(),
  };
}

export const drawApp = {
  id: 'draw', name: '绘图', icon: 'image',

  render(ctx) {
    const draw = ensure(ctx.state);
    const cfg = draw.config;
    const preset = draw.presets[draw.presetIdx] || draw.presets[0];
    const size = sizeOf(cfg.size);
    const ep = imageEndpoint(ctx.state);
    const ready = Boolean(ep.key && ep.url);
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

    const apiRow = `
      <button class="mp-row" data-act="open-app" data-app="api" type="button">
        <span class="mp-row-main">
          <span class="mp-row-name">${esc(ep.name || '还没选绘图预设')}</span>
          <span class="mp-row-sub">${esc(ep.model || '模型没填')} · Key ${esc(maskKey(ep.key))}</span>
        </span>${icon('chevron')}
      </button>`;

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
        <button class="mp-back" data-act="open-app" data-app="api" type="button" title="接口与预设">${icon('code')}</button>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">绘图</div>
        <div class="mp-subtitle">NovelAI · 中文描述会先翻成 danbooru tag</div>

        <div class="mp-draw-state${ready ? ' is-on' : ''}">
          ${icon(ready ? 'spark' : 'help')}
          <span>${ready
            ? `已接「${esc(ep.name || '绘图预设')}」${ep.model ? ` · ${esc(ep.model)}` : ''}`
            : '还没接上绘图预设，现在是演示出图'}</span>
          <button class="mp-draw-state-btn" data-act="open-app" data-app="api" type="button">去设置</button>
        </div>

        <div class="mp-group-label" style="margin-top:12px">接口 · 预设带模型</div>
        <div class="mp-group">${apiRow}</div>

        <div class="mp-group-label" style="margin-top:12px">画风预设</div>
        <div class="mp-draw-chips">${chips}</div>

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

        <div class="mp-group-label" style="margin-top:14px">提示词</div>
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

    if (act === 'draw-prompt') {
      ctx.openSheet({
        kind: 'text', title: '画面', placeholder: '中文描述，越具体越好',
        value: draw.lastPrompt, onText: value => { draw.lastPrompt = value; ctx.save(); ctx.rerender(); },
      });
      return true;
    }

    if (act === 'draw-pos' || act === 'draw-neg') {
      const preset = draw.presets[draw.presetIdx] || draw.presets[0];
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
    if (ep.key && ep.url) {
      const result = await novelaiImage({
        url: ep.url,
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
      ctx.toast('演示出图：去接口页给绘图选一套带地址和 Key 的预设才会真的画');
    }
    draw.history.unshift(entry);
    draw.history = draw.history.slice(0, 18);
  } finally {
    draw.busy = false;
    ctx.save();
    ctx.rerender();
  }
}
