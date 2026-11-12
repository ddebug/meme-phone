/**
 * meme-phone · 接口与预设（只给聊天用）
 * 一个 preset 就是一套「地址 + Key + 模型」；绘图接口在绘图页里单独一套，互不相干。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import {
  newId, chatSchemesOf, activeChatScheme, applyChatScheme,
  memoryPresetsOf, replyPresetFor, replyPresetsOf,
} from '../data.js';
import { memoryPresetSummary } from '../memory.js';

const ENGINES = [
  { value: 'tavern', label: '酒馆 API', hint: '直接借酒馆自己的模型，不用填地址' },
  { value: 'openai', label: 'OpenAI 兼容', hint: '/v1/chat/completions' },
  { value: 'custom', label: '自定义', hint: '自己填路径' },
];

/* 酒馆 chat_completion_source 的显示名，导入时拿来给预设起名字 */
const SOURCE_LABELS = {
  openai: 'OpenAI',
  claude: 'Claude',
  openrouter: 'OpenRouter',
  makersuite: 'Gemini',
  google: 'Gemini',
  mistralai: 'Mistral',
  cohere: 'Cohere',
  custom: '自定义',
  windowai: 'WindowAI',
};

const FIELDS = [
  { key: 'name', label: '名称', kind: 'text', placeholder: '比如 我的 GPT' },
  { key: 'engine', label: '引擎', kind: 'pick' },
  { key: 'url', label: '地址', kind: 'text', placeholder: 'https://你的接口' },
  { key: 'path', label: '路径', kind: 'text', placeholder: '/v1/chat/completions' },
  { key: 'model', label: '模型', kind: 'text', placeholder: 'gpt-4o-mini' },
  { key: 'key', label: 'Key', kind: 'text', placeholder: 'sk-...' },
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
  /* 永远留一套「酒馆 API」：借酒馆自己的模型，不能删，用来随时切回去 */
  let tavern = store.presets.find(preset => preset.engine === 'tavern');
  if (!tavern) {
    tavern = {
      id: 'api_tavern', name: '酒馆 API', engine: 'tavern', url: '', path: '', model: '', key: '', temp: 0.8,
    };
    store.presets.unshift(tavern);
  } else if (!tavern.name || tavern.name === '酒馆默认') {
    tavern.name = '酒馆 API';
  }
  if (!store.activeChat) store.activeChat = tavern.id;
  return store;
}

function presetName(store, id) {
  const item = store.presets.find(preset => preset.id === id);
  return item ? item.name || '未命名' : '没选';
}

/* 统一的 iOS 风格下拉框：白底、圆角、右侧箭头，原生 select 只负责取值 */
function iosSelect(act, items, value) {
  const options = items.map(item => `
    <option value="${esc(item.value)}"${String(item.value) === String(value) ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
  return `<div class="mp-select-wrap"><select data-act="${act}">${options}</select>${icon('chevron')}</div>`;
}

function saveCurrentScheme(ctx, text) {
  const store = api(ctx.state);
  const memory = memoryPresetsOf(ctx.state).find(item => item.id === ctx.state.settings.memory?.activeId)
    || memoryPresetsOf(ctx.state)[0];
  const name = String(text || '').trim().slice(0, 20)
    || `${presetName(store, store.activeChat)} · ${memory?.name || '记忆'}`;
  const scheme = {
    id: newId('lsch'),
    name,
    apiId: store.activeChat,
    memoryId: memory?.id || '',
    replyId: ctx.state.settings.reply?.activeId || '',
  };
  store.chatSchemes = chatSchemesOf(ctx.state).concat(scheme);
  store.chatSchemeId = scheme.id;
  ctx.save();
  ctx.rerender();
  ctx.toast(`整体方案存成「${name}」`);
}

function presetNote(preset) {
  if (!preset) return '';
  if (preset.engine === 'tavern') return '借酒馆自己的模型';
  return [engineLabel(preset.engine), preset.model, preset.url].filter(Boolean).join(' · ');
}

function findPreset(store) {
  return store.presets.find(preset => preset.id === editingId) || store.presets[0];
}

/* 地址可能填成 .../v1、.../v1/chat/completions 或只填域名，统一收成可拼 /v1 的根 */
function apiRoot(preset) {
  let url = String(preset?.url || '').trim().replace(/\/+$/, '');
  url = url.replace(/\/v1\/chat\/completions$/i, '').replace(/\/chat\/completions$/i, '');
  url = url.replace(/\/v1\/models$/i, '').replace(/\/models$/i, '');
  url = url.replace(/\/v1$/i, '');
  return url;
}

function modelsCandidates(preset) {
  const root = apiRoot(preset);
  if (!root) return [];
  const custom = String(preset?.path || '').trim();
  const list = [`${root}/v1/models`, `${root}/models`];
  /* 自定义路径是 /v1/chat/completions 时上面两套已经覆盖；别的代理路径也试一下同级 models */
  if (/chat\/completions/i.test(custom)) {
    const alt = custom.replace(/chat\/completions/i, 'models');
    list.unshift(`${root}${alt.startsWith('/') ? alt : `/${alt}`}`);
  }
  return [...new Set(list)];
}

function authHeaders(preset) {
  const headers = { Accept: 'application/json' };
  const key = String(preset?.key || '').trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function modelNames(payload) {
  const list = Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
      : Array.isArray(payload) ? payload : [];
  return list.map(item => (typeof item === 'string' ? item : item?.id || item?.name || ''))
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

/* 拉模型顺带就是连接测试：401 / 连不上 / 没这个路径都会明确报出来。
   先走酒馆后端（不跨域，还能用酒馆里存着的 Key），失败再退回浏览器直连。 */
async function fetchModels(ctx, preset) {
  let hostReason = '';
  if (typeof ctx?.host?.listModels === 'function') {
    try {
      const viaHost = await ctx.host.listModels({
        url: preset.url,
        key: preset.key,
        tavernSource: preset.tavernSource,
      });
      if (viaHost?.available) {
        if (viaHost.models?.length) return { url: '酒馆后端', list: viaHost.models };
        hostReason = viaHost.reason || '';
      }
    } catch (error) {
      hostReason = error.message || String(error);
    }
  }

  const urls = modelsCandidates(preset);
  if (!urls.length) throw new Error(hostReason || '先填接口地址');
  let last = '';
  for (const url of urls) {
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers: authHeaders(preset), cache: 'no-store', credentials: 'omit' });
    } catch (error) {
      last = `连不上 ${url}：${error.message || error}`;
      continue;
    }
    if (res.status === 404 || res.status === 405) {
      last = `${url} 没有模型列表`;
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new Error('Key 不对，或没有拉模型列表的权限');
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`接口返回 ${res.status}${detail ? `：${detail.slice(0, 100)}` : ''}`);
    }
    const text = await res.text();
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error('模型列表不是 JSON，可能地址填到了网页首页'); }
    const list = modelNames(payload);
    if (!list.length) throw new Error('接口连通了，但没返回可用模型');
    return { url, list };
  }
  throw new Error(last || hostReason || '拉不到模型列表，可以手动填模型名');
}

async function refreshModels(ctx, preset) {
  preset.status = { ok: false, text: '正在连接…', at: Date.now() };
  ctx.rerender();
  try {
    const { url, list } = await fetchModels(ctx, preset);
    preset.models = [...new Set(list)].sort();
    preset.status = { ok: true, text: `连接正常 · ${preset.models.length} 个模型 · ${url}`, at: Date.now() };
    ctx.save();
    ctx.rerender();
    return preset.models;
  } catch (error) {
    preset.status = { ok: false, text: error.message || String(error), at: Date.now() };
    ctx.save();
    ctx.rerender();
    ctx.toast(preset.status.text);
    return null;
  }
}


/* 从酒馆读一次接口设置，抄成一套预设；失败只提示，不改任何东西 */
async function importTavernPreset(ctx, store) {
  const info = typeof ctx.host?.readApi === 'function'
    ? await ctx.host.readApi()
    : { available: false, reason: '预览里读不到酒馆设置' };
  if (!info?.available) {
    ctx.toast(info?.reason || '没接上酒馆，导入不了');
    return;
  }

  const label = SOURCE_LABELS[info.source] || info.source || '酒馆';
  const importedUrl = String(info.url || '').trim().replace(/\/+$/, '');
  const same = store.presets.find(item => item.tavernSource === info.source)
    || store.presets.find(item => item.name === `酒馆 · ${label}`);
  if (same) {
    /* 再点一次导入 = 用酒馆现在这套刷新地址 / Key / 模型，不动小手机里别的预设 */
    same.engine = info.source === 'custom' ? 'custom' : 'openai';
    same.path = '/v1/chat/completions';
    if (importedUrl) same.url = importedUrl;
    if (info.key) same.key = info.key;
    if (info.model) same.model = info.model;
    same.tavernSource = info.source;
    editingId = same.id;
    ctx.save();
    ctx.go('api-item');
    ctx.toast(importedUrl ? `已按酒馆更新「${same.name}」` : `已更新「${same.name}」，地址还得手填`);
    return;
  }

  const preset = {
    id: newId('api'),
    name: `酒馆 · ${label}`,
    engine: info.source === 'custom' ? 'custom' : 'openai',
    url: importedUrl,
    path: '/v1/chat/completions',
    model: info.model || '',
    key: info.key || '',
    temp: 0.8,
    tavernSource: info.source,
    models: [],
  };
  store.presets.push(preset);
  editingId = preset.id;
  ctx.save();
  ctx.go('api-item');
  ctx.toast(importedUrl
    ? `导入了「${preset.name}」，接着测试连接、拉模型`
    : `导入了「${preset.name}」，酒馆没填反代地址，补上地址再连接`);
}

export const apiListApp = {
  id: 'api', name: '接口', icon: 'code',

  render(ctx) {
    const store = api(ctx.state);
    const schemes = chatSchemesOf(ctx.state);
    const scheme = activeChatScheme(ctx.state);
    const memoryList = memoryPresetsOf(ctx.state);
    const activeMemory = memoryList.find(item => item.id === ctx.state.settings.memory?.activeId) || memoryList[0] || null;
    const currentReply = replyPresetFor(ctx.state, null);
    const schemeName = scheme?.name || '未选';
    const schemeSummary = `${presetName(store, store.activeChat)} · ${currentReply?.name || '默认回复'} · ${activeMemory?.name || '记忆'}`;
    const apiOptions = store.presets.map(preset => ({ value: preset.id, label: preset.name || '未命名' }));
    const replyOptions = replyPresetsOf(ctx.state).map(item => ({ value: item.id, label: item.name || '未命名' }));
    const memoryOptions = memoryList.map(item => ({ value: item.id, label: item.name || '未命名' }));
    const rows = store.presets.map(preset => {
      const active = preset.id === store.activeChat ? '聊天' : '';
      const use = active;
      const inTavern = Boolean(preset.tavernSource) && preset.engine !== 'tavern' && !preset.key;
      const keyNote = inTavern ? 'Key 留在酒馆里' : `Key ${mask(preset.key)}`;
      const sub = preset.engine === 'tavern' && !preset.model
        ? '借酒馆自己的模型，不用填地址'
        : `${engineLabel(preset.engine)}${preset.model ? ` · ${preset.model}` : ''} · ${keyNote}`;
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
        <button class="mp-back" data-act="api-scheme-menu" type="button" title="管理 LLM 整体方案">${icon('settings')}</button>
        <button class="mp-back" data-act="api-new" type="button" title="新建预设">${icon('plus')}</button>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">聊天接口</div>
        <div class="mp-subtitle">一套预设 = 地址 + Key + 模型；LLM 整体方案再把 API、酒馆记忆和回复预设绑在一起</div>

        <div class="mp-ios-card">
          <div class="mp-ios-card-head">
            <div class="mp-ios-card-copy">
              <div class="mp-ios-card-label">LLM 整体方案</div>
              <button class="mp-ios-scheme" data-act="api-scheme-pick" type="button">
                <span class="mp-ios-card-title">${esc(schemeName)}</span>${icon('chevron')}
              </button>
              <div class="mp-ios-card-sub">${esc(schemeSummary)}</div>
            </div>
            <button class="mp-icon-btn mp-ios-card-menu" data-act="api-scheme-menu" type="button" title="管理 LLM 整体方案">${icon('settings')}</button>
          </div>
          <div class="mp-ios-two">
            <label class="mp-ios-field">
              <span class="mp-ios-field-label">切换 API</span>
              ${iosSelect('api-chat-select', apiOptions, store.activeChat)}
            </label>
            <label class="mp-ios-field">
              <span class="mp-ios-field-label">切换预设</span>
              ${iosSelect('api-reply-select', replyOptions, currentReply?.id || '')}
            </label>
          </div>
          <button class="mp-row mp-ios-memory-row" data-act="api-pick-memory" type="button">
            ${icon('book')}
            <span class="mp-row-main">
              <span class="mp-row-name">酒馆记忆</span>
              <span class="mp-row-sub">${esc(activeMemory?.name || '没选')}</span>
            </span>
            ${icon('chevron')}
          </button>
          <button class="mp-ios-edit-reply" data-act="api-open-presets" type="button">编辑回复预设${icon('chevron')}</button>
          <button class="mp-ios-add" data-act="api-scheme-new" type="button">＋ 把当前搭配存成新方案</button>
        </div>

        <div class="mp-group-label" style="margin-top:16px">LLM 链接</div>
        <div class="mp-group">${rows}</div>

        <button class="mp-row mp-api-import" data-act="api-import-tavern" type="button">
          ${icon('reply')}
          <span class="mp-row-main">
            <span class="mp-row-name">从酒馆导入当前接口</span>
            <span class="mp-row-sub">只读一次：把酒馆正在用的地址、Key、模型抄成一套</span>
          </span>
          ${icon('chevron')}
        </button>

        <div class="mp-api-note">
          右上角 ＋ 会拿当前聊天这套复制一份当模板；地址、Key、模型都在这一套里，不会串到别套。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const store = api(ctx.state);

    if (act === 'api-scheme-pick') {
      const list = chatSchemesOf(ctx.state);
      if (list.length <= 1) {
        ctx.toast('只有这一套，右上角齿轮可以管理');
        return true;
      }
      ctx.openSheet({
        kind: 'pick', title: '切换整体方案', note: '一套 = API + 酒馆记忆 + 回复预设',
        items: list.map(item => ({ label: item.name || '未命名', value: item.id, icon: 'spark' })),
        onPick: id => {
          const picked = list.find(item => item.id === String(id));
          if (!picked) return;
          applyChatScheme(ctx.state, picked);
          ctx.save();
          ctx.rerender();
          ctx.toast(`整体方案换成「${picked.name || '未命名'}」`);
        },
      });
      return true;
    }

    if (act === 'api-scheme-select') {
      const picked = chatSchemesOf(ctx.state).find(item => item.id === String(data.value || ''));
      if (!picked) return true;
      applyChatScheme(ctx.state, picked);
      ctx.save();
      ctx.rerender();
      ctx.toast(`整体方案换成「${picked.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-chat-select') {
      const target = store.presets.find(preset => preset.id === String(data.value || ''));
      if (!target) return true;
      store.activeChat = target.id;
      const scheme = activeChatScheme(ctx.state);
      if (scheme) {
        scheme.apiId = target.id;
        store.chatSchemeId = scheme.id;
      }
      ctx.save();
      ctx.rerender();
      ctx.toast(`聊天 API 换成「${target.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-reply-select') {
      const target = replyPresetsOf(ctx.state).find(item => item.id === String(data.value || ''));
      if (!target) return true;
      ctx.state.settings.reply.activeId = target.id;
      const scheme = activeChatScheme(ctx.state);
      if (scheme) {
        scheme.replyId = target.id;
        store.chatSchemeId = scheme.id;
      }
      ctx.save();
      ctx.rerender();
      ctx.toast(`回复预设换成「${target.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-open-presets') {
      ctx.go('app-presets');
      return true;
    }

    if (act === 'api-open') {
      editingId = String(data.id || '');
      ctx.go('api-item');
      return true;
    }

    if (act === 'api-pick-chat') {
      ctx.openSheet({
        kind: 'pick',
        title: '换一套聊天 API',
        note: '存过的都在这里，酒馆 API 一直在最上面',
        items: store.presets.map(preset => ({
          value: preset.id,
          label: preset.name || '未命名',
          note: preset.id === store.activeChat ? '正在用 · ' + presetNote(preset) : presetNote(preset),
        })),
        onPick: id => {
          const target = store.presets.find(preset => preset.id === id);
          if (!target) return;
          store.activeChat = target.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`聊天换成「${target.name || '未命名'}」`);
        },
      });
      return true;
    }

    if (act === 'api-pick-memory') {
      const presets = memoryPresetsOf(ctx.state);
      ctx.openSheet({
        kind: 'pick',
        title: '换一套酒馆记忆',
        note: '换完只影响当前这套搭配；要固定进方案请用上面的「存一套」',
        items: presets.map(item => ({
          value: item.id,
          label: item.name || '未命名',
          note: item.id === ctx.state.settings.memory?.activeId ? '正在用 · ' + memoryPresetSummary(item) : memoryPresetSummary(item),
        })),
        onPick: id => {
          const target = presets.find(item => item.id === id);
          if (!target) return;
          ctx.state.settings.memory.activeId = target.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`酒馆记忆换成「${target.name || '未命名'}」`);
        },
      });
      return true;
    }

    if (act === 'api-scheme') {
      const picked = chatSchemesOf(ctx.state).find(item => item.id === String(data.id || ''));
      if (!picked) return true;
      applyChatScheme(ctx.state, picked);
      ctx.save();
      ctx.rerender();
      ctx.toast(`整体方案换成「${picked.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-scheme-new') {
      const memory = memoryPresetsOf(ctx.state).find(item => item.id === ctx.state.settings.memory?.activeId);
      ctx.openSheet({
        kind: 'text', title: '存成一套整体方案',
        value: `${presetName(store, store.activeChat)} · ${memory?.name || '记忆'}`.slice(0, 20),
        placeholder: '比如：本地模型 · 最近原文',
        onText: text => saveCurrentScheme(ctx, text),
      });
      return true;
    }

    if (act === 'api-scheme-menu') {
      const scheme = activeChatScheme(ctx.state);
      ctx.openSheet({
        kind: 'pick',
        title: `LLM 整体方案 · ${scheme?.name || '未选'}`,
        items: [
          { label: '把当前搭配存成新方案', value: 'new', icon: 'plus' },
          { label: '给当前方案改名', value: 'rename', icon: 'brush' },
          { label: '复制当前方案', value: 'copy', icon: 'copy' },
          { label: '删除当前方案', value: 'del', icon: 'trash', danger: true },
        ],
        onPick: value => {
          if (value === 'new') {
            const memory = memoryPresetsOf(ctx.state).find(item => item.id === ctx.state.settings.memory?.activeId);
            ctx.openSheet({
              kind: 'text', title: '存成一套整体方案',
              value: `${presetName(store, store.activeChat)} · ${memory?.name || '记忆'}`.slice(0, 20),
              onText: text => saveCurrentScheme(ctx, text),
            });
            return;
          }
          if (!scheme) { ctx.toast('先选一套整体方案'); return; }
          if (value === 'rename') {
            ctx.openSheet({
              kind: 'text', title: '整体方案名字', value: scheme.name || '',
              onText: text => {
                scheme.name = String(text || '').trim().slice(0, 20) || scheme.name;
                ctx.save();
                ctx.rerender();
              },
            });
            return;
          }
          if (value === 'copy') {
            const copy = {
              id: newId('lsch'), name: `${scheme.name || '方案'} 副本`.slice(0, 20),
              apiId: scheme.apiId, memoryId: scheme.memoryId, replyId: scheme.replyId,
            };
            store.chatSchemes = chatSchemesOf(ctx.state).concat(copy);
            store.chatSchemeId = copy.id;
            ctx.save();
            ctx.rerender();
            ctx.toast(`复制成「${copy.name}」`);
            return;
          }
          if (value === 'del') {
            if (chatSchemesOf(ctx.state).length <= 1) {
              ctx.toast('至少留一套整体方案');
              return;
            }
            store.chatSchemes = chatSchemesOf(ctx.state).filter(item => item.id !== scheme.id);
            const next = store.chatSchemes[0];
            if (next) applyChatScheme(ctx.state, next);
            ctx.save();
            ctx.rerender();
            ctx.toast('这套整体方案删掉了');
          }
        },
      });
      return true;
    }

    if (act === 'api-import-tavern') {
      /* handle 必须保持同步返回，异步的事情交给这个函数自己跑完再刷新 */
      importTavernPreset(ctx, store);
      return true;
    }

    if (act === 'api-new') {
      /* 新建 = 拿当前这套做模板复制一份，不用从空白重填 */
      const source = store.presets.find(item => item.id === store.activeChat)
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
      ctx.rerender();
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
      const inTavern = Boolean(preset.tavernSource) && preset.engine !== 'tavern' && !raw;
      const shown = field.key === 'engine'
        ? engineLabel(preset.engine)
        : field.key === 'key' ? (inTavern ? '留在酒馆里' : mask(preset.key)) : raw;
      const empty = !shown && field.key !== 'engine';
      return `
        <button class="mp-row" data-act="api-field" data-key="${field.key}" type="button">
          <span class="mp-row-name" style="flex:none">${esc(field.label)}</span>
          <span class="mp-api-value${empty ? ' is-empty' : ''}">${esc(empty ? '没填' : shown)}</span>
          ${icon('chevron')}
        </button>`;
    }).join('');

    const asChat = preset.id === store.activeChat;
    const sub = preset.model
      ? `${engineLabel(preset.engine)} · ${preset.model}`
      : (preset.engine === 'tavern' ? '借酒馆自己的模型，不用填地址' : `${engineLabel(preset.engine)} · 模型没填`);
    const status = preset.status || null;
    const modelCount = Array.isArray(preset.models) ? preset.models.length : 0;
    const hasUrl = Boolean(apiRoot(preset));

    return `
      <div class="mp-nav">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
        ${preset.engine === 'tavern' ? '' : `<button class="mp-back" data-act="api-del" type="button" title="删除">${icon('trash')}</button>`}
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">${esc(preset.name || '未命名')}</div>
        <div class="mp-subtitle">${esc(sub)}</div>

        <div class="mp-group">${rows}</div>

        ${preset.engine === 'tavern' ? `
        <div class="mp-api-note" style="margin-top:12px">酒馆 API 直接用酒馆自己的模型，不用填地址，也不用拉模型；要连接外部接口请导入或新建一套。</div>
        ` : `
        <div class="mp-group-label" style="margin-top:16px">连接</div>
        <div class="mp-group">
          <div class="mp-row mp-api-status">
            <span class="mp-row-main">
              <span class="mp-row-name">连接状态</span>
              <span class="mp-row-sub${status?.ok ? ' is-ok' : ''}">${esc(status ? status.text : (hasUrl ? '还没测试，点下面「测试连接」' : '还没填地址'))}</span>
            </span>
          </div>
          <button class="mp-row" data-act="api-test" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">测试连接</span>
              <span class="mp-row-sub">经酒馆后端拉一次模型，确认地址和 Key</span>
            </span>${icon('refresh')}
          </button>
          <button class="mp-row" data-act="api-models" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">拉取可用模型</span>
              <span class="mp-row-sub">${modelCount ? `已拉到 ${modelCount} 个 · ${preset.model || '还没选'}` : '拉一次模型列表，选中的会存进这一套'}</span>
            </span>${icon('spark')}
          </button>
        </div>
        `}

        <div class="mp-group-label" style="margin-top:16px">用它</div>
        <div class="mp-api-use">
          <button class="mp-api-use-btn${asChat ? ' is-on' : ''}" data-act="api-use-chat" type="button">
            ${icon('chat')}<span>${asChat ? '聊天正在用' : '设为聊天'}</span>
          </button>
        </div>

        <button class="mp-btn mp-api-clone" data-act="api-clone" type="button">${icon('copy')}<span>复制成新的一套</span></button>

        <div class="mp-api-note">
          ${preset.tavernSource && !preset.key
    ? 'Key 留在酒馆里，测试连接和拉模型走酒馆后端；要在别处用这套再手填 Key。'
    : '地址 + Key + 模型是一整套，换模型就是换一套接口；要试新的，先复制这一套再改，原来的不动。'}
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
            if (value === 'tavern') {
              preset.url = '';
              preset.key = '';
              preset.model = '';
            } else if (value === 'openai') {
              if (!preset.url || preset.url === 'https://api.openai.com') preset.url = 'https://api.openai.com';
              if (!preset.model) preset.model = 'gpt-4o-mini';
            } else if (preset.url === 'https://api.openai.com') {
              preset.url = '';
            }
            preset.status = null;
            preset.models = [];
            ctx.save();
            ctx.rerender();
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
            if (field.key === 'url' || field.key === 'key' || field.key === 'path') {
              preset.status = null;
              preset.models = [];
            }
          }
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'api-test') {
      if (!apiRoot(preset) && typeof ctx.host?.listModels !== 'function') {
        ctx.toast('先填接口地址，再测试连接');
        return true;
      }
      refreshModels(ctx, preset).then(list => {
        if (list) ctx.toast(`连接正常，拉到 ${list.length} 个模型`);
      });
      return true;
    }

    if (act === 'api-models') {
      if (!apiRoot(preset) && typeof ctx.host?.listModels !== 'function') {
        ctx.toast('先填接口地址，再拉模型');
        return true;
      }
      refreshModels(ctx, preset).then(list => {
        const models = list || preset.models || [];
        if (!models.length) {
          ctx.toast('没拉到模型，也可以直接在「模型」那一行手填');
          return;
        }
        if (!list) ctx.toast('这次没拉成功，先用上次拉到的列表');
        ctx.openSheet({
          kind: 'pick',
          title: `选模型 · ${models.length} 个`,
          items: [
            { label: '手动输入模型名…', value: '__manual__', icon: 'brush' },
            ...models.map(name => ({
              label: name,
              value: name,
              note: name === preset.model ? '当前' : '',
            })),
          ],
          onPick: value => {
            if (value === '__manual__') {
              ctx.openSheet({
                kind: 'text', title: '模型名', value: preset.model || '', placeholder: 'gpt-4o-mini',
                onText: text => {
                  preset.model = String(text || '').trim();
                  ctx.save();
                  ctx.rerender();
                  ctx.toast(`模型存成「${preset.model || '没填'}」`);
                },
              });
              return;
            }
            preset.model = String(value || '');
            preset.status = { ok: true, text: `连接正常 · ${models.length} 个模型`, at: Date.now() };
            ctx.save();
            ctx.rerender();
            ctx.toast(`模型选成「${preset.model}」，已随这套接口保存`);
          },
        });
      });
      return true;
    }

    if (act === 'api-use-chat') {
      store.activeChat = preset.id;
      ctx.save();
      ctx.rerender();
      ctx.toast(`聊天换成「${preset.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-del') {
      if (preset.engine === 'tavern') {
        ctx.toast('酒馆 API 留着兜底，删不掉');
        return true;
      }
      if (store.presets.length <= 1) {
        ctx.toast('至少留一套');
        return true;
      }
      store.presets = store.presets.filter(item => item.id !== preset.id);
      const fallback = store.presets[0];
      if (store.activeChat === preset.id) store.activeChat = fallback.id;
      store.chatSchemes.forEach(item => { if (item.apiId === preset.id) item.apiId = fallback.id; });
      editingId = '';
      ctx.save();
      ctx.back();
      return true;
    }

    return false;
  },
};
