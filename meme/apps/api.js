/**
 * meme-phone · 接口与预设（只给聊天用）
 * 一个 preset 就是一套「地址 + Key + 模型」；绘图接口在绘图页里单独一套，互不相干。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import {
  newId, chatSchemesOf, activeChatScheme, applyChatScheme,
  replyPresetFor, replyPresetsOf,
} from '../data.js';

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

let expandedId = '';
let schemeEdit = null;   // { mode: 'new' | 'rename', value: '' }，放在方案按钮下面直接改
let apiDelete = null;    // { type: 'scheme' | 'api', id }：页面内删除确认，不直接执行
const drafts = new Map(); // preset.id -> 尚未保存的字段草稿，收起/切行都不丢
const DRAFTS_KEY = 'meme-phone:api-drafts:v1';
let draftsReady = false;

function draftStorage() {
  try {
    return globalThis.sessionStorage || null;
  } catch (error) {
    return null;
  }
}

/* 草稿只存在当前浏览器会话里：刷新、离开页面后回来还能接着改；
   关掉整个浏览器就丢掉，不把未保存的 Key 长期落盘。 */
function persistDrafts(state) {
  const storage = draftStorage();
  if (!storage) return;
  try {
    const presets = Array.isArray(state?.settings?.api?.presets) ? state.settings.api.presets : [];
    /* 只把真正改过的字段存进会话草稿，没改过的预设不占地方，也不重复存 Key */
    const changed = [...drafts.entries()].filter(([id, draft]) => {
      const preset = presets.find(item => item.id === id);
      if (!preset) return false;
      return ['name', 'engine', 'temp', 'url', 'path', 'model', 'key']
        .some(key => String(draft[key] ?? '') !== String(preset[key] ?? ''));
    });
    storage.setItem(DRAFTS_KEY, JSON.stringify(changed));
  } catch (error) { /* 容量或隐私模式失败时退回内存草稿 */ }
}

function hydrateDrafts(state) {
  if (draftsReady) return;
  draftsReady = true;
  const storage = draftStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(DRAFTS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (Array.isArray(saved)) {
      saved.forEach(entry => {
        if (!Array.isArray(entry) || !entry[0] || !entry[1] || typeof entry[1] !== 'object') return;
        drafts.set(String(entry[0]), entry[1]);
      });
    }
  } catch (error) {
    drafts.clear();
  }
}

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

/* 接口字段的草稿：展开面板里改的字先落在这里，点「保存修改」才写进预设。
 * 这样收起、切行、翻页都不会把没保存的字静默丢掉。 */
function draftFor(preset) {
  if (!preset) return null;
  if (!drafts.has(preset.id)) {
    drafts.set(preset.id, {
      name: preset.name || '',
      engine: preset.engine || 'openai',
      temp: typeof preset.temp === 'number' ? preset.temp : 0.8,
      url: preset.url || '',
      path: preset.path || '',
      model: preset.model || '',
      key: preset.key || '',
    });
  }
  return drafts.get(preset.id);
}

function draftValue(preset, key) {
  const draft = draftFor(preset);
  return draft ? draft[key] : preset?.[key];
}

function draftChanged(preset) {
  const draft = draftFor(preset);
  if (!preset || !draft) return false;
  return ['name', 'engine', 'temp', 'url', 'path', 'model', 'key']
    .some(key => String(draft[key] ?? '') !== String(preset[key] ?? ''));
}

function draftNote(preset) {
  const changed = draftChanged(preset);
  return `<div class="mp-api-draft-note${changed ? ' is-on' : ''}" data-draft-note>${changed ? '有未保存修改 · 点「保存修改」才写入' : '改动先留在草稿里，点「保存修改」才写入'}</div>`;
}

function readDraft(scope, draft) {
  if (!scope || !draft) return draft;
  scope.querySelectorAll('[data-api-field]').forEach(input => {
    const key = input.dataset.apiField;
    if (!key) return;
    const value = String(input.value || '');
    if (key === 'temp') {
      const num = Number(value);
      draft.temp = Number.isFinite(num) ? Math.min(2, Math.max(0, num)) : 0.8;
    } else {
      draft[key] = value.trim();
    }
  });
  return draft;
}

function markDraftNote(input) {
  const note = input?.closest('.mp-api-detail')?.querySelector('[data-draft-note]');
  if (note) {
    note.classList.add('is-on');
    note.textContent = '有未保存修改 · 点「保存修改」才写入';
  }
}

function replyNameFor(state, id) {
  const item = replyPresetsOf(state).find(preset => preset.id === id);
  return item ? (item.name || '未命名') : '没选';
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
  /* 整体方案只存 API + 回复预设；第一次进来没有方案时补一套当前搭配 */
  if (!Array.isArray(store.chatSchemes)) store.chatSchemes = [];
  if (!store.chatSchemes.length) {
    store.chatSchemes.push({
      id: newId('lsch'),
      name: '默认方案',
      apiId: store.activeChat,
      replyId: replyPresetsOf(state)[0]?.id || '',
    });
  }
  if (!store.chatSchemes.some(item => item.id === store.chatSchemeId)) {
    store.chatSchemeId = store.chatSchemes[0].id;
  }
  return store;
}

function presetName(store, id) {
  const item = store.presets.find(preset => preset.id === id);
  return item ? item.name || '未命名' : '没选';
}

/* 统一的 iOS 风格下拉框：白底、圆角、右侧箭头，原生 select 只负责取值 */
function iosSelect(act, items, value, attrs = '') {
  const options = items.map(item => `
    <option value="${esc(item.value)}"${String(item.value) === String(value) ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
  return `<div class="mp-select-wrap"><select data-act="${act}"${attrs}>${options}</select>${icon('chevron')}</div>`;
}

function saveCurrentScheme(ctx, text) {
  const store = api(ctx.state);
  const reply = replyPresetFor(ctx.state, null);
  const name = String(text || '').trim().slice(0, 20)
    || `${presetName(store, store.activeChat)} · ${reply?.name || '回复预设'}`;
  const scheme = {
    id: newId('lsch'),
    name,
    apiId: store.activeChat,
    replyId: reply?.id || '',
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

async function refreshModels(ctx, preset, values = preset) {
  preset.status = { ok: false, text: '正在连接…', at: Date.now() };
  ctx.rerender();
  try {
    const { url, list } = await fetchModels(ctx, values);
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

  const profileLabel = String(info.name || '').trim();
  const sourceLabel = SOURCE_LABELS[info.source] || info.source || '酒馆';
  const label = profileLabel || sourceLabel;
  const autoName = `酒馆 · ${label}`;
  const importedUrl = String(info.url || '').trim().replace(/\/+$/, '');
  const legacyName = `酒馆 · ${sourceLabel}`;
  const same = store.presets.find(item => info.profileId && item.tavernProfileId === info.profileId)
    || store.presets.find(item => item.name === autoName)
    || store.presets.find(item => item.tavernSource === info.source && !item.tavernProfileId && (item.name === legacyName || (!item.tavernAutoName && item.name.startsWith('酒馆 · '))))
    || null;
  if (same) {
    /* 再点一次导入 = 用酒馆现在这套刷新地址 / Key / 模型，不动小手机里别的预设 */
    same.engine = info.source === 'custom' ? 'custom' : 'openai';
    same.path = '/v1/chat/completions';
    if (importedUrl) same.url = importedUrl;
    if (info.key) same.key = info.key;
    if (info.model) same.model = info.model;
    same.tavernSource = info.source;
    if (info.profileId) same.tavernProfileId = info.profileId;
    /* 只有名字还是上次导入自动起的，才跟着酒馆的新名字改；用户改过名就不动 */
    const prevAuto = same.tavernAutoName || legacyName;
    if (!same.name || same.name === prevAuto) same.name = autoName;
    same.tavernAutoName = autoName;
    expandedId = same.id;
    ctx.save();
    ctx.rerender();
    ctx.toast(importedUrl ? `已按酒馆更新「${same.name}」` : `已更新「${same.name}」，地址还得手填`);
    return;
  }

  const preset = {
    id: newId('api'),
    name: autoName,
    engine: info.source === 'custom' ? 'custom' : 'openai',
    url: importedUrl,
    path: '/v1/chat/completions',
    model: info.model || '',
    key: info.key || '',
    temp: 0.8,
    tavernSource: info.source,
    tavernProfileId: info.profileId || '',
    tavernAutoName: autoName,
    models: [],
  };
  store.presets.push(preset);
  expandedId = preset.id;
  ctx.save();
  ctx.rerender();
  ctx.toast(importedUrl
    ? `导入了「${preset.name}」，接着测试连接、拉模型`
    : `导入了「${preset.name}」，酒馆没填反代地址，补上地址再连接`);
}

/* 把展开面板里手填的值读回草稿；点任何操作前先读，避免一刷新就把刚改的字弄丢 */

function presetDetail(ctx, store, preset) {
  const draft = draftFor(preset);
  const tavern = draft.engine === 'tavern';
  const status = preset.status || null;
  const models = Array.isArray(preset.models) ? preset.models : [];
  const hasUrl = Boolean(apiRoot(draft));
  const engineOptions = ENGINES.filter(item => item.value !== 'tavern').map(item => `
    <option value="${item.value}"${item.value === draft.engine ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
  const modelOptions = models.map(name => `
    <option value="${esc(name)}"${name === draft.model ? ' selected' : ''}>${esc(name)}</option>`).join('');
  const modelPicker = models.length ? `
    <div class="mp-api-model">
      <div class="mp-select-wrap mp-api-mini-select"><select data-act="api-model-select" data-id="${preset.id}">
        ${modelOptions}
      </select>${icon('chevron')}</div>
      <input class="mp-api-input" data-api-field="model" type="text" value="${esc(draft.model || '')}" placeholder="也可以手填模型名">
    </div>` : `<input class="mp-api-input" data-api-field="model" type="text" value="${esc(draft.model || '')}" placeholder="gpt-4o-mini">`;

  return `
    <div class="mp-api-detail" data-id="${preset.id}">
      <div class="mp-api-edit">
        <label class="mp-api-field" style="grid-column:1/-1">
          <span>名称</span>
          <input class="mp-api-input" data-api-field="name" type="text" value="${esc(draft.name || '')}" placeholder="比如 我的 GPT">
        </label>
        <label class="mp-api-field">
          <span>引擎</span>
          ${tavern ? '<div class="mp-api-static">酒馆 API（固定兜底）</div>' : `<div class="mp-select-wrap mp-api-mini-select">
            <select data-act="api-engine" data-id="${preset.id}">${engineOptions}</select>${icon('chevron')}
          </div>`}
        </label>
        <label class="mp-api-field">
          <span>温度</span>
          <input class="mp-api-input" data-api-field="temp" type="text" value="${esc(String(draft.temp ?? 0.8))}" placeholder="0.8">
        </label>
        ${tavern ? '' : `
        <label class="mp-api-field" style="grid-column:1/-1">
          <span>地址</span>
          <input class="mp-api-input" data-api-field="url" type="text" value="${esc(draft.url || '')}" placeholder="https://你的接口">
        </label>
        <label class="mp-api-field" style="grid-column:1/-1">
          <span>路径</span>
          <input class="mp-api-input" data-api-field="path" type="text" value="${esc(draft.path || '')}" placeholder="/v1/chat/completions">
        </label>
        <div class="mp-api-field" style="grid-column:1/-1">
          <span>模型</span>
          ${modelPicker}
        </div>
        <label class="mp-api-field" style="grid-column:1/-1">
          <span>Key</span>
          <input class="mp-api-input" data-api-field="key" type="text" value="${esc(draft.key || '')}" placeholder="sk-...">
        </label>`}
      </div>

      <div class="mp-api-status-inline${status?.ok ? ' is-ok' : ''}">
        ${esc(status ? status.text : (tavern ? '借酒馆自己的模型，不用填地址' : (hasUrl ? '还没测试，改完点保存修改' : '还没填地址')))}
      </div>
      ${draftNote(preset)}

      <div class="mp-draw-actions">
        <button class="mp-draw-action is-primary" data-act="api-inline-save" data-id="${preset.id}" type="button">保存修改</button>
        <button class="mp-draw-action" data-act="api-draft-reset" data-id="${preset.id}" type="button">取消修改</button>
        ${tavern ? '' : `<button class="mp-draw-action" data-act="api-test" data-id="${preset.id}" type="button">连接并拉取模型</button>`}
      </div>
      <div class="mp-draw-actions">
        ${tavern ? '' : `<button class="mp-draw-action" data-act="api-clone" data-id="${preset.id}" type="button">复制一套</button>
        <button class="mp-draw-action is-danger" data-act="api-del" data-id="${preset.id}" type="button">删除接口</button>`}
      </div>
    </div>`;
}

function deleteConfirm(state, store) {
  if (!apiDelete) return '';
  if (apiDelete.type === 'scheme') {
    const scheme = chatSchemesOf(state).find(item => item.id === apiDelete.id);
    if (!scheme) return '';
    return `
      <div class="mp-api-delete">
        <div class="mp-api-delete-title">删除整体方案「${esc(scheme.name || '未命名')}」？</div>
        <div class="mp-api-delete-sub">只会删掉这套「接口 + 回复预设」的组合，不删接口，也不删回复预设。至少会留一套方案。</div>
        <div class="mp-draw-actions">
          <button class="mp-draw-action is-danger" data-act="api-scheme-del-confirm" type="button">确认删除方案</button>
          <button class="mp-draw-action" data-act="api-delete-cancel" type="button">取消</button>
        </div>
      </div>`;
  }

  const preset = store.presets.find(item => item.id === apiDelete.id);
  if (!preset) return '';
  const linked = chatSchemesOf(state).filter(item => item.apiId === preset.id);
  const chats = Object.values(state.chats || {}).filter(chat => chat.llmPresetId === preset.id);
  return `
    <div class="mp-api-delete">
      <div class="mp-api-delete-title">删除接口「${esc(preset.name || '未命名')}」？</div>
      <div class="mp-api-delete-sub">
        删除后不能恢复。${linked.length ? `${linked.length} 套整体方案引用它，可以选择一起删除。` : '没有整体方案引用它，但可能正被当前聊天临时使用。'}
        ${store.activeChat === preset.id ? '当前聊天正在用它，删除后会改指兜底。' : ''}
        ${chats.length ? `${chats.length} 个单独引用它的会话会恢复跟随手机。` : ''}
        ${linked.length ? '只删接口时方案会改指兜底；删空方案时会自动补一套兜底方案。' : ''}
      </div>
      <div class="mp-draw-actions">
        ${linked.length ? `<button class="mp-draw-action is-danger" data-act="api-del-schemes-confirm" type="button">删除接口 + ${linked.length} 套方案</button>` : ''}
        <button class="mp-draw-action${linked.length ? '' : ' is-danger'}" data-act="api-del-confirm" type="button">只删接口</button>
        <button class="mp-draw-action" data-act="api-delete-cancel" type="button">取消</button>
      </div>
    </div>`;
}

function deleteApiPreset(ctx, store, pending, withSchemes) {
  const linked = chatSchemesOf(ctx.state).filter(item => item.apiId === pending.id);
  const linkedCount = linked.length;
  const chatCount = Object.values(ctx.state.chats || {}).filter(chat => chat.llmPresetId === pending.id).length;
  store.presets = store.presets.filter(item => item.id !== pending.id);
  const fallback = store.presets[0];
  let fallbackCreated = false;

  if (withSchemes) {
    const kept = chatSchemesOf(ctx.state).filter(item => item.apiId !== pending.id);
    if (!kept.length) {
      const reply = replyPresetFor(ctx.state, null);
      const scheme = { id: newId('lsch'), name: '默认', apiId: fallback.id, replyId: reply?.id || '' };
      store.chatSchemes = [scheme];
      store.chatSchemeId = scheme.id;
      fallbackCreated = true;
    } else {
      store.chatSchemes = kept;
      if (!kept.some(item => item.id === store.chatSchemeId)) store.chatSchemeId = kept[0].id;
    }
  } else {
    store.chatSchemes.forEach(item => { if (item.apiId === pending.id) item.apiId = fallback.id; });
    if (!store.chatSchemes.some(item => item.id === store.chatSchemeId)) {
      store.chatSchemeId = store.chatSchemes[0]?.id || '';
    }
  }

  if (store.activeChat === pending.id) store.activeChat = fallback.id;
  /* 单个聊天如果引用过这套接口，清掉引用，别留下空 id */
  Object.values(ctx.state.chats || {}).forEach(chat => {
    if (chat && chat.llmPresetId === pending.id) chat.llmPresetId = '';
  });
  if (expandedId === pending.id) expandedId = '';
  drafts.delete(pending.id);
  persistDrafts(ctx.state);
  apiDelete = null;
  ctx.save();
  ctx.rerender();
  const parts = [`接口「${pending.name || '未命名'}」删掉了`];
  if (fallbackCreated) parts.push('方案删空，补了一套「默认」');
  else if (withSchemes && linkedCount) parts.push(`${linkedCount} 套方案一起删了`);
  else if (linkedCount) parts.push(`${linkedCount} 套方案已改指兜底`);
  if (chatCount) parts.push(`${chatCount} 个会话恢复跟随手机`);
  ctx.toast(parts.join('，'));
}

export const apiListApp = {
  id: 'api', name: '接口', icon: 'code',

  render(ctx) {
    hydrateDrafts(ctx.state);
    const store = api(ctx.state);
    const staleDrafts = [...drafts.keys()].filter(id => {
      const preset = store.presets.find(item => item.id === id);
      return !preset || !draftChanged(preset);
    });
    if (staleDrafts.length) {
      staleDrafts.forEach(id => drafts.delete(id));
      persistDrafts(ctx.state);
    }
    const schemes = chatSchemesOf(ctx.state);
    const scheme = activeChatScheme(ctx.state);
    const currentReply = replyPresetFor(ctx.state, null);
    const schemeDirty = Boolean(scheme && (scheme.apiId !== store.activeChat || scheme.replyId !== currentReply?.id));
    const currentSummary = `${presetName(store, store.activeChat)} · ${currentReply?.name || '回复预设'}`;
    const savedSummary = scheme
      ? `${presetName(store, scheme.apiId)} · ${replyNameFor(ctx.state, scheme.replyId)}`
      : '还没有整体方案';
    const schemeOptions = schemes.length
      ? schemes.map(item => ({ value: item.id, label: item.name || '未命名' }))
      : [{ value: '', label: '未选方案' }];
    const apiOptions = store.presets.map(preset => ({ value: preset.id, label: preset.name || '未命名' }));
    const replyOptions = replyPresetsOf(ctx.state).map(item => ({ value: item.id, label: item.name || '未命名' }));
    const rows = store.presets.map(preset => {
      const draft = draftFor(preset);
      const active = preset.id === store.activeChat ? '聊天' : '';
      const changed = draftChanged(preset);
      const inTavern = Boolean(preset.tavernSource) && draft.engine !== 'tavern' && !draft.key;
      const keyNote = inTavern ? 'Key 留在酒馆里' : `Key ${mask(draft.key)}`;
      const sub = draft.engine === 'tavern' && !draft.model
        ? '借酒馆自己的模型，不用填地址'
        : `${engineLabel(draft.engine)}${draft.model ? ` · ${draft.model}` : ''} · ${keyNote}`;
      const open = preset.id === expandedId;
      return `
        <div class="mp-api-stack">
          <button class="mp-row mp-api-row${open ? ' is-open' : ''}" data-act="api-toggle" data-id="${preset.id}" type="button" aria-expanded="${open}">
            ${ctx.icon ? ctx.icon('code') : icon('code')}
            <span class="mp-row-main">
              <span class="mp-row-name">${esc(draft.name || '未命名')}${active ? `<span class="mp-api-tag">${esc(active)}</span>` : ''}${changed ? '<span class="mp-api-tag is-draft">未保存</span>' : ''}</span>
              <span class="mp-row-sub">${esc(sub)}</span>
            </span>
            <span class="mp-api-caret">${icon('chevron')}</span>
          </button>
          ${open ? presetDetail(ctx, store, preset) : ''}
        </div>`;
    }).join('');

    return `
      <div class="mp-nav">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">聊天接口</div>
        <div class="mp-subtitle">一套接口 = 地址 + Key + 模型；整体方案只记「聊天 API + 回复预设」，不关联酒馆记忆</div>

        <div class="mp-ios-card">
          <div class="mp-ios-card-label">当前聊天方案</div>
          ${iosSelect('api-scheme-select', schemeOptions, scheme?.id || '')}
          <div class="mp-api-state">
            <div><span>当前生效</span><strong>${esc(currentSummary)}</strong></div>
            <div><span>方案保存</span><strong>${esc(savedSummary)}</strong></div>
          </div>
          ${schemeDirty
            ? `<div class="mp-api-dirty">当前选择还没保存：改 API 或回复预设会先影响新聊天，点「保存当前选择到方案」才写进这套方案。</div>`
            : '<div class="mp-api-dirty is-clear">当前选择和方案保存一致。</div>'}
          <div class="mp-ios-two">
            <label class="mp-ios-field">
              <span class="mp-ios-field-label">当前聊天 API</span>
              ${iosSelect('api-chat-select', apiOptions, store.activeChat)}
            </label>
            <label class="mp-ios-field">
              <span class="mp-ios-field-label">当前回复预设</span>
              ${iosSelect('api-reply-select', replyOptions, currentReply?.id || '')}
            </label>
          </div>

          <div class="mp-draw-actions">
            <button class="mp-draw-action is-primary" data-act="api-scheme-save" type="button">保存当前选择到方案</button>
            ${schemeDirty ? '<button class="mp-draw-action" data-act="api-scheme-revert" type="button">恢复为方案值</button>' : ''}
          </div>
          <div class="mp-draw-actions">
            <button class="mp-draw-action" data-act="api-scheme-new" type="button">新建方案</button>
            <button class="mp-draw-action" data-act="api-scheme-rename" type="button">改名</button>
            <button class="mp-draw-action" data-act="api-scheme-copy" type="button">复制方案</button>
            <button class="mp-draw-action is-danger" data-act="api-scheme-del" type="button">删除方案</button>
          </div>
          <div class="mp-draw-actions">
            <button class="mp-draw-action" data-act="api-new" type="button">＋ 新建接口</button>
            <button class="mp-draw-action" data-act="api-import-tavern" type="button">导入酒馆接口</button>
          </div>

          ${schemeEdit ? `
          <div class="mp-api-name-edit">
            <input id="api-scheme-name" class="mp-api-input" type="text" maxlength="20" value="${esc(schemeEdit.value || '')}" placeholder="方案名字">
            <button class="mp-draw-side is-primary" data-act="api-scheme-name-save" type="button">确定</button>
            <button class="mp-draw-side" data-act="api-scheme-name-cancel" type="button">取消</button>
          </div>` : ''}

          <button class="mp-ios-edit-reply" data-act="api-open-presets" type="button">编辑回复预设${icon('chevron')}</button>
        </div>

        ${deleteConfirm(ctx.state, store)}

        <div class="mp-group-label" style="margin-top:16px">聊天 API 预设</div>
        <div class="mp-group">${rows}</div>

        <div class="mp-api-note">
          点接口行就在当前列表里展开详情，改完点「保存修改」；方案只记 API 和回复预设，记忆不在方案里。
        </div>
      </div>`;
  },

  onInput(ctx, event) {
    const input = event.target?.closest?.('[data-api-field]');
    if (!input) return false;
    const preset = api(ctx.state).presets.find(item => item.id === input.closest('.mp-api-detail')?.dataset.id);
    if (!preset) return false;
    const draft = draftFor(preset);
    const key = input.dataset.apiField;
    if (key === 'temp') {
      const num = Number(String(input.value || ''));
      draft.temp = Number.isFinite(num) ? Math.min(2, Math.max(0, num)) : 0.8;
    } else if (key) {
      draft[key] = String(input.value || '').trim();
    }
    markDraftNote(input);
    persistDrafts(ctx.state);
    return true;
  },

  handle(ctx, act, data, event) {
    const store = api(ctx.state);
    const scheme = activeChatScheme(ctx.state);

    if (act === 'api-toggle') {
      const id = String(data.id || '');
      const previous = store.presets.find(preset => preset.id === expandedId);
      const detail = ctx.shell.root?.querySelector(`.mp-api-detail[data-id="${expandedId}"]`);
      if (previous && detail) readDraft(detail, draftFor(previous));
      expandedId = expandedId === id ? '' : id;
      schemeEdit = null;
      apiDelete = null;
      ctx.rerender();
      return true;
    }

    if (act === 'api-scheme-select') {
      const picked = chatSchemesOf(ctx.state).find(item => item.id === String(data.value || ''));
      if (!picked) return true;
      applyChatScheme(ctx.state, picked);
      schemeEdit = null;
      apiDelete = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`整体方案换成「${picked.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-chat-select') {
      const target = store.presets.find(preset => preset.id === String(data.value || ''));
      if (!target) return true;
      store.activeChat = target.id;
      apiDelete = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`当前聊天 API 换成「${target.name || '未命名'}」；保存后写进方案`);
      return true;
    }

    if (act === 'api-reply-select') {
      const target = replyPresetsOf(ctx.state).find(item => item.id === String(data.value || ''));
      if (!target) return true;
      ctx.state.settings.reply.activeId = target.id;
      apiDelete = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`当前回复预设换成「${target.name || '未命名'}」；保存后写进方案`);
      return true;
    }

    if (act === 'api-scheme-revert') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      const savedApi = store.presets.find(preset => preset.id === scheme.apiId);
      const savedReply = replyPresetsOf(ctx.state).find(item => item.id === scheme.replyId);
      if (savedApi) store.activeChat = savedApi.id;
      if (savedReply) ctx.state.settings.reply.activeId = savedReply.id;
      ctx.save();
      ctx.rerender();
      ctx.toast('已恢复成这套方案保存的值');
      return true;
    }

    if (act === 'api-open-presets') {
      ctx.go('app-presets');
      return true;
    }

    if (act === 'api-scheme-save') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      scheme.apiId = store.activeChat;
      scheme.replyId = ctx.state.settings.reply?.activeId || '';
      store.chatSchemeId = scheme.id;
      schemeEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`已保存到方案「${scheme.name || '未命名'}」`);
      return true;
    }

    if (act === 'api-scheme-new') {
      const reply = replyPresetFor(ctx.state, null);
      schemeEdit = {
        mode: 'new',
        value: `${presetName(store, store.activeChat)} · ${reply?.name || '回复预设'}`.slice(0, 20),
      };
      ctx.rerender();
      return true;
    }

    if (act === 'api-scheme-rename') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      schemeEdit = { mode: 'rename', value: scheme.name || '' };
      ctx.rerender();
      return true;
    }

    if (act === 'api-scheme-name-cancel') {
      schemeEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'api-scheme-name-save') {
      const input = event?.target?.closest('.mp-api-name-edit')?.querySelector('input');
      const name = String(input?.value || schemeEdit?.value || '').trim().slice(0, 20);
      if (!name) { ctx.toast('先写个方案名字'); return true; }
      const mode = schemeEdit?.mode;
      schemeEdit = null;
      if (mode === 'rename') {
        if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
        scheme.name = name;
        ctx.save();
        ctx.rerender();
        ctx.toast(`方案改名为「${name}」`);
      } else {
        saveCurrentScheme(ctx, name);
      }
      return true;
    }

    if (act === 'api-scheme-copy') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      const copy = {
        id: newId('lsch'),
        name: `${scheme.name || '方案'} 副本`.slice(0, 20),
        apiId: scheme.apiId,
        replyId: scheme.replyId,
      };
      store.chatSchemes = chatSchemesOf(ctx.state).concat(copy);
      store.chatSchemeId = copy.id;
      schemeEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`复制成「${copy.name}」`);
      return true;
    }

    if (act === 'api-scheme-del') {
      if (!scheme) { ctx.toast('先选一套整体方案'); return true; }
      if (chatSchemesOf(ctx.state).length <= 1) { ctx.toast('至少留一套整体方案'); return true; }
      apiDelete = { type: 'scheme', id: scheme.id };
      schemeEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'api-scheme-del-confirm') {
      const pending = apiDelete?.type === 'scheme'
        ? chatSchemesOf(ctx.state).find(item => item.id === apiDelete.id)
        : null;
      if (!pending) { apiDelete = null; ctx.rerender(); return true; }
      if (chatSchemesOf(ctx.state).length <= 1) {
        apiDelete = null;
        ctx.rerender();
        ctx.toast('至少留一套整体方案');
        return true;
      }
      store.chatSchemes = chatSchemesOf(ctx.state).filter(item => item.id !== pending.id);
      const next = store.chatSchemes[0];
      if (next) applyChatScheme(ctx.state, next);
      apiDelete = null;
      schemeEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`整体方案「${pending.name || '未命名'}」删掉了`);
      return true;
    }

    if (act === 'api-delete-cancel') {
      apiDelete = null;
      ctx.rerender();
      return true;
    }

    if (act === 'api-engine') {
      const preset = store.presets.find(item => item.id === String(data.id || ''));
      if (!preset) return true;
      const draft = readDraft(event?.target?.closest('.mp-api-detail'), draftFor(preset));
      draft.engine = String(data.value || 'openai');
      draft.path = defaultPath(draft.engine);
      if (draft.engine === 'tavern') {
        draft.url = '';
        draft.key = '';
        draft.model = '';
      } else if (draft.engine === 'openai') {
        if (!draft.url || draft.url === 'https://api.openai.com') draft.url = 'https://api.openai.com';
        if (!draft.model) draft.model = 'gpt-4o-mini';
        if (!draft.path) draft.path = '/v1/chat/completions';
      } else if (draft.url === 'https://api.openai.com') {
        draft.url = '';
      }
      preset.status = null;
      preset.models = [];
      persistDrafts(ctx.state);
      ctx.rerender();
      return true;
    }

    if (act === 'api-model-select') {
      const preset = store.presets.find(item => item.id === String(data.id || ''));
      if (!preset) return true;
      const draft = readDraft(event?.target?.closest('.mp-api-detail'), draftFor(preset));
      draft.model = String(data.value || '').trim();
      persistDrafts(ctx.state);
      ctx.rerender();
      return true;
    }

    if (act === 'api-inline-save') {
      const preset = store.presets.find(item => item.id === String(data.id || ''));
      if (!preset) return true;
      const draft = readDraft(event?.target?.closest('.mp-api-detail'), draftFor(preset));
      const previous = { ...preset };
      const savedDraft = { ...draft };
      const before = { url: preset.url, path: preset.path, key: preset.key, engine: preset.engine };
      Object.assign(preset, draft);
      if (!preset.name) preset.name = '未命名接口';
      if (before.url !== preset.url || before.path !== preset.path || before.key !== preset.key || before.engine !== preset.engine) {
        preset.status = null;
        preset.models = [];
      }
      ctx.rerender();
      ctx.save().then(saved => {
        if (saved === false) {
          /* 落盘失败：把界面退回去，草稿留着，别让用户以为已经写进去了 */
          Object.assign(preset, previous);
          drafts.set(preset.id, savedDraft);
          persistDrafts(ctx.state);
          ctx.rerender();
          return;
        }
        drafts.delete(preset.id);
        persistDrafts(ctx.state);
        ctx.rerender();
        ctx.toast(`已保存「${preset.name}」`);
      });
      return true;
    }

    if (act === 'api-draft-reset') {
      const preset = store.presets.find(item => item.id === String(data.id || ''));
      if (!preset) return true;
      drafts.delete(preset.id);
      persistDrafts(ctx.state);
      ctx.rerender();
      ctx.toast('这次修改已经取消');
      return true;
    }

    if (act === 'api-test' || act === 'api-models') {
      const preset = store.presets.find(item => item.id === String(data.id || ''));
      if (!preset) return true;
      const draft = readDraft(event?.target?.closest('.mp-api-detail'), draftFor(preset));
      const probe = { ...preset, ...draft };
      if (!apiRoot(probe) && typeof ctx.host?.listModels !== 'function') {
        ctx.toast('先填接口地址，再连接');
        return true;
      }
      refreshModels(ctx, preset, probe).then(list => {
        if (!list) return;
        ctx.toast(`连接正常，拉到 ${list.length} 个模型`);
      });
      return true;
    }

    if (act === 'api-use-chat') {
      const preset = store.presets.find(item => item.id === String(data.id || ''));
      if (!preset) return true;
      const draft = readDraft(event?.target?.closest('.mp-api-detail'), draftFor(preset));
      Object.assign(preset, draft);
      drafts.delete(preset.id);
      persistDrafts(ctx.state);
      store.activeChat = preset.id;
      ctx.save();
      ctx.rerender();
      ctx.toast(`聊天换成「${preset.name || '未命名'}」；保存后写进方案`);
      return true;
    }

    if (act === 'api-clone') {
      const source = store.presets.find(item => item.id === String(data.id || '')) || store.presets[0];
      if (!source) return true;
      const preset = clonePreset(source, ' 副本');
      store.presets.push(preset);
      expandedId = preset.id;
      schemeEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(`复制成「${preset.name}」`);
      return true;
    }

    if (act === 'api-del') {
      const preset = store.presets.find(item => item.id === String(data.id || ''));
      if (!preset) return true;
      if (preset.engine === 'tavern') { ctx.toast('酒馆 API 留着兜底，删不掉'); return true; }
      if (store.presets.length <= 1) { ctx.toast('至少留一套接口'); return true; }
      apiDelete = { type: 'api', id: preset.id };
      schemeEdit = null;
      ctx.rerender();
      return true;
    }

    if (act === 'api-del-confirm' || act === 'api-del-schemes-confirm') {
      const pending = apiDelete?.type === 'api'
        ? store.presets.find(item => item.id === apiDelete.id)
        : null;
      if (!pending) { apiDelete = null; ctx.rerender(); return true; }
      if (pending.engine === 'tavern' || store.presets.length <= 1) {
        apiDelete = null;
        ctx.rerender();
        ctx.toast('至少留一套接口');
        return true;
      }
      deleteApiPreset(ctx, store, pending, act === 'api-del-schemes-confirm');
      return true;
    }

    if (act === 'api-import-tavern') {
      importTavernPreset(ctx, store);
      return true;
    }

    if (act === 'api-new') {
      /* 新建接口：优先拿当前外部接口当模板；当前是酒馆 API 就开一套空白外部接口 */
      const source = store.presets.find(item => item.id === store.activeChat && item.engine !== 'tavern')
        || store.presets.find(item => item.engine !== 'tavern');
      const preset = source ? clonePreset(source, ' 副本') : {
        id: newId('api'),
        name: '新接口',
        engine: 'openai',
        url: '',
        path: '/v1/chat/completions',
        model: '',
        key: '',
        temp: 0.8,
      };
      store.presets.push(preset);
      expandedId = preset.id;
      schemeEdit = null;
      ctx.save();
      ctx.rerender();
      ctx.toast(source ? `基于「${source.name || '未命名'}」复制了一份` : '开了一套空白外部接口');
      return true;
    }

    return false;
  },
};
