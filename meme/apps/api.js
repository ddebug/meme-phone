/**
 * meme-phone · 接口与预设
 * 一个 preset 就是一套「地址 + Key + 模型」，聊天和绘图各挑一套用。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import { newId } from '../data.js';

const ENGINES = [
  { value: 'tavern', label: '酒馆默认', hint: '直接借酒馆自己的模型，不用填地址' },
  { value: 'openai', label: 'OpenAI 兼容', hint: '/v1/chat/completions 或 /images/generations' },
  { value: 'novelai', label: 'NovelAI', hint: 'image.novelai.net，Key 以 pst- 开头' },
  { value: 'custom', label: '自定义', hint: '自己填路径' },
];

const FIELDS = [
  { key: 'name', label: '名称', kind: 'text', placeholder: '比如 我的 NAI' },
  { key: 'engine', label: '引擎', kind: 'pick' },
  { key: 'url', label: '地址', kind: 'text', placeholder: 'https://image.novelai.net' },
  { key: 'path', label: '路径', kind: 'text', placeholder: '/ai/generate-image' },
  { key: 'model', label: '模型', kind: 'text', placeholder: 'nai-diffusion-4-curated-preview' },
  { key: 'key', label: 'Key', kind: 'text', placeholder: 'pst-...' },
  { key: 'temp', label: '温度', kind: 'text', placeholder: '0.8' },
];

let editingId = '';

function engineLabel(value) {
  return (ENGINES.find(item => item.value === value) || ENGINES[0]).label;
}

function mask(key) {
  const text = String(key || '');
  if (!text) return '没填';
  if (text.length <= 8) return text.slice(0, 2) + '···';
  return `${text.slice(0, 4)}···${text.slice(-4)}`;
}

function defaultPath(engine) {
  if (engine === 'novelai') return '/ai/generate-image';
  if (engine === 'openai') return '/v1/chat/completions';
  return '';
}

/* 复制一套做模板：地址 / Key / 模型 / 引擎整套带走，只换名字和 id */
export function clonePreset(source, suffix = ' 副本') {
  return {
    id: newId('api'),
    name: `${source?.name || '预设'}${suffix}`,
    engine: source?.engine || 'openai',
    url: source?.url || '',
    path: source?.path || defaultPath(source?.engine || 'openai'),
    model: source?.model || '',
    key: source?.key || '',
    temp: typeof source?.temp === 'number' ? source.temp : 0.8,
  };
}

function api(state) {
  const base = { activeChat: '', activeImage: '', presets: [] };
  if (!state.settings.api || typeof state.settings.api !== 'object') state.settings.api = base;
  const store = state.settings.api;
  if (!Array.isArray(store.presets)) store.presets = [];
  if (!store.presets.length) {
    store.presets.push({
      id: newId('api'), name: '酒馆默认', engine: 'tavern', url: '', path: '', model: '', key: '', temp: 0.8,
    });
  }
  const first = store.presets[0].id;
  if (!store.activeChat) store.activeChat = first;
  if (!store.activeImage) store.activeImage = first;
  return store;
}

function presetName(store, id) {
  const item = store.presets.find(preset => preset.id === id);
  return item ? item.name || '未命名' : '没选';
}

function findPreset(store) {
  return store.presets.find(preset => preset.id === editingId) || store.presets[0];
}

export const apiListApp = {
  id: 'api', name: '接口', icon: 'code',

  render(ctx) {
    const store = api(ctx.state);
    const rows = store.presets.map(preset => {
      const active = preset.id === store.activeChat ? '聊天' : '';
      const image = preset.id === store.activeImage ? '绘图' : '';
      const use = [active, image].filter(Boolean).join(' · ');
      const sub = preset.engine === 'tavern' && !preset.model
        ? '借酒馆自己的模型，不用填地址'
        : `${engineLabel(preset.engine)}${preset.model ? ` · ${preset.model}` : ''} · Key ${mask(preset.key)}`;
      return `
        <button class="mp-row mp-api-row" data-act="api-open" data-id="${preset.id}" type="button">
          ${ctx.icon ? ctx.icon('code') : icon('code')}
          <span class="mp-row-main">
            <span class="mp-row-name">${esc(preset.name || '未命名')}${use ? `<span class="mp-api-tag">${esc(use)}</span>` : ''}</span>
            <span class="mp-row-sub">${esc(sub)}</span>
          </span>
          ${icon('chevron')}
        </button>`;
    }).join('');

    return `
      <div class="mp-nav">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
        <button class="mp-back" data-act="api-new" type="button" title="新建预设">${icon('plus')}</button>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">接口</div>
        <div class="mp-subtitle">一套预设 = 地址 + Key + 模型，聊天和绘图各挑一套</div>

        <div class="mp-api-cards">
          <div class="mp-api-card">
            <span class="mp-api-card-label">${icon('chat')}<span>聊天用</span></span>
            <span class="mp-api-card-value">${esc(presetName(store, store.activeChat))}</span>
          </div>
          <div class="mp-api-card">
            <span class="mp-api-card-label">${icon('image')}<span>绘图用</span></span>
            <span class="mp-api-card-value">${esc(presetName(store, store.activeImage))}</span>
          </div>
        </div>

        <div class="mp-group-label" style="margin-top:16px">全部预设</div>
        <div class="mp-group">${rows}</div>

        <div class="mp-api-note">
          右上角 ＋ 会拿当前聊天这套复制一份当模板；地址、Key、模型都在这一套里，不会串到别套。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const store = api(ctx.state);

    if (act === 'api-open') {
      editingId = String(data.id || '');
      ctx.go('api-item');
      return true;
    }

    if (act === 'api-new') {
      /* 新建 = 拿当前这套做模板复制一份，不用从空白重填 */
      const source = store.presets.find(item => item.id === store.activeChat)
        || store.presets.find(item => item.id === store.activeImage)
        || store.presets[0];
      const preset = clonePreset(source, ' 副本');
      store.presets.push(preset);
      editingId = preset.id;
      ctx.save();
      ctx.go('api-item');
      ctx.toast(`基于「${source?.name || '未命名'}」复制了一份`);
      return true;
    }

    if (act === 'api-clone') {
      const source = store.presets.find(item => item.id === editingId) || store.presets[0];
      const preset = clonePreset(source, ' 2');
      store.presets.push(preset);
      editingId = preset.id;
      ctx.save();
      ctx.shell.rerender();
      ctx.toast(`复制成「${preset.name}」`);
      return true;
    }

    return false;
  },
};

export const apiPresetApp = {
  id: 'api-item', name: '预设', icon: 'code',

  render(ctx) {
    const store = api(ctx.state);
    const preset = findPreset(store);
    if (!preset) return '<div class="mp-page-body"><div class="mp-empty">没有这个预设</div></div>';

    const rows = FIELDS.map(field => {
      const raw = String(preset[field.key] ?? '');
      const shown = field.key === 'engine'
        ? engineLabel(preset.engine)
        : field.key === 'key' ? mask(preset.key) : raw;
      const empty = !shown && field.key !== 'engine';
      return `
        <button class="mp-row" data-act="api-field" data-key="${field.key}" type="button">
          <span class="mp-row-name" style="flex:none">${esc(field.label)}</span>
          <span class="mp-api-value${empty ? ' is-empty' : ''}">${esc(empty ? '没填' : shown)}</span>
          ${icon('chevron')}
        </button>`;
    }).join('');

    const asChat = preset.id === store.activeChat;
    const asImage = preset.id === store.activeImage;
    const sub = preset.model
      ? `${engineLabel(preset.engine)} · ${preset.model}`
      : (preset.engine === 'tavern' ? '借酒馆自己的模型，不用填地址' : `${engineLabel(preset.engine)} · 模型没填`);

    return `
      <div class="mp-nav">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
        <button class="mp-back" data-act="api-del" type="button" title="删除">${icon('trash')}</button>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">${esc(preset.name || '未命名')}</div>
        <div class="mp-subtitle">${esc(sub)}</div>

        <div class="mp-group">${rows}</div>

        <div class="mp-group-label" style="margin-top:16px">用它</div>
        <div class="mp-api-use">
          <button class="mp-api-use-btn${asChat ? ' is-on' : ''}" data-act="api-use-chat" type="button">
            ${icon('chat')}<span>${asChat ? '聊天正在用' : '设为聊天'}</span>
          </button>
          <button class="mp-api-use-btn${asImage ? ' is-on' : ''}" data-act="api-use-image" type="button">
            ${icon('image')}<span>${asImage ? '绘图正在用' : '设为绘图'}</span>
          </button>
        </div>

        <button class="mp-btn mp-api-clone" data-act="api-clone" type="button">${icon('copy')}<span>复制成新的一套</span></button>

        <div class="mp-api-note">
          地址 + Key + 模型是一整套，换模型就是换一套接口；要试新的，先复制这一套再改，原来的不动。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const store = api(ctx.state);
    const preset = findPreset(store);
    if (!preset) return true;

    if (act === 'api-field') {
      const field = FIELDS.find(item => item.key === String(data.key));
      if (!field) return true;
      if (field.kind === 'pick') {
        ctx.openSheet({
          kind: 'pick', title: '引擎', note: field.hint || '',
          items: ENGINES.map(item => ({ value: item.value, label: item.label, note: item.hint })),
          onPick: value => {
            preset.engine = value;
            preset.path = defaultPath(value);
            if (value === 'novelai' && !preset.url) preset.url = 'https://image.novelai.net';
            ctx.save();
            ctx.shell.rerender();
          },
        });
        return true;
      }
      ctx.openSheet({
        kind: 'text', title: field.label, placeholder: field.placeholder || '',
        value: String(preset[field.key] ?? ''),
        onText: value => {
          if (field.key === 'temp') {
            const num = Number(value);
            preset.temp = Number.isFinite(num) ? Math.min(2, Math.max(0, num)) : 0.8;
          } else {
            preset[field.key] = value.trim();
          }
          ctx.save();
          ctx.shell.rerender();
        },
      });
      return true;
    }

    if (act === 'api-use-chat') {
      store.activeChat = preset.id;
      ctx.save();
      ctx.shell.rerender();
      ctx.toast(`聊天换成「${preset.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-use-image') {
      store.activeImage = preset.id;
      /* 绘图页不自己存地址 Key 模型，但把这一套同步进 cfg 兜底，老数据也能直接画 */
      if (!ctx.state.draw || typeof ctx.state.draw !== 'object') ctx.state.draw = {};
      const cfg = ctx.state.draw.config || {};
      ctx.state.draw.config = {
        ...cfg,
        url: preset.url || cfg.url || '',
        key: preset.key || cfg.key || '',
        model: preset.model || cfg.model || '',
      };
      ctx.save();
      ctx.shell.rerender();
      ctx.toast(`绘图换成「${preset.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-del') {
      if (store.presets.length <= 1) {
        ctx.toast('至少留一套');
        return true;
      }
      store.presets = store.presets.filter(item => item.id !== preset.id);
      if (store.activeChat === preset.id) store.activeChat = store.presets[0].id;
      if (store.activeImage === preset.id) store.activeImage = store.presets[0].id;
      editingId = '';
      ctx.save();
      ctx.back();
      return true;
    }

    return false;
  },
};
