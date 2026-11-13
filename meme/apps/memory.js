/**
 * meme-phone · 酒馆记忆页
 *
 * 顶上只报「现在读的是总结还是原文、多少楼、多少字、多少层」，不铺全文；
 * 下面一个开关切换这位角色读总结还是原文（没有总结时置灰），
 * 再往下才是记忆方案（层数 / 首楼 / 改名 / 复制 / 删除）。
 */

import { icon } from '../icons.js';
import {
  newId, memoryPresetsOf, contactById, chatsOf, memoryPresetFor, memoryReadModeFor, memoryGlobalReadMode,
} from '../data.js';
import { esc } from '../shell.js';
import { memoryModeLabel, memoryPresetSummary, buildMemoryContext } from '../memory.js';

let memoryChosen = '';
let memoryView = {
  contactId: '', loading: false, error: '', text: '', source: '', file: '', demo: false,
  summaryCount: 0, mode: '', hasSummary: false, metrics: null,
};
let memoryAutoKey = '';
let memEdit = '';
let memRename = false;
let memDelete = '';

function singleContacts(state) {
  return Object.values(state.contacts || {}).filter(contact => contact && contact.kind !== 'group');
}

function defaultMemoryContact(state) {
  const chat = chatsOf(state)[0];
  const byChat = chat ? contactById(state, chat.contactId) : null;
  return byChat || singleContacts(state)[0] || null;
}

function emptyView(contactId) {
  return {
    contactId, loading: false, error: '', text: '', source: 'empty', file: '', demo: false,
    summaryCount: 0, mode: '', hasSummary: false, metrics: null,
  };
}

/* 重渲染会把整页重建、滚动回顶部，看起来像刷新；这里把滚动位置带过去 */
function pageBox(ctx) {
  return ctx?.shell?.root?.querySelector('.mp-page-body') || null;
}

function redraw(ctx) {
  const top = pageBox(ctx)?.scrollTop || 0;
  ctx.rerender();
  const box = pageBox(ctx);
  if (box) box.scrollTop = top;
}

function say(ctx, message) {
  const top = pageBox(ctx)?.scrollTop || 0;
  ctx.toast(message);
  const box = pageBox(ctx);
  if (box) box.scrollTop = top;
}

function readMemory(ctx, contactId, note = '') {
  const contact = contactById(ctx.state, contactId);
  if (!contact) {
    memoryView = emptyView(contactId);
    return;
  }
  /* 读的过程中状态卡会缩成一行，滚动位置会被夹小；读完按原位置放回去 */
  const top = pageBox(ctx)?.scrollTop || 0;
  memoryView = { ...emptyView(contactId), loading: true };
  redraw(ctx);
  buildMemoryContext(ctx.state, { contactId }, 1600).then(result => {
    memoryView = {
      contactId,
      loading: false,
      error: '',
      text: String(result?.text || ''),
      source: String(result?.source || 'empty'),
      file: String(result?.file || ''),
      demo: Boolean(result?.demo),
      summaryCount: Number(result?.summaryCount) || 0,
      mode: String(result?.mode || ''),
      hasSummary: Boolean(result?.hasSummary),
      metrics: result?.metrics || null,
    };
    redraw(ctx);
    const box = pageBox(ctx);
    if (box && top) box.scrollTop = top;
    if (note) say(ctx, note);
  }).catch(error => {
    memoryView = { ...emptyView(contactId), error: error?.message || '读取失败' };
    redraw(ctx);
    const box = pageBox(ctx);
    if (box && top) box.scrollTop = top;
  });
}

function num(value) {
  const n = Number(value) || 0;
  if (n < 10000) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${(n / 10000).toFixed(1)} 万`;
}

function readModeLabel(mode) {
  if (mode === 'summary') return '只用总结';
  if (mode === 'recent') return '只读原文';
  return '有总结读总结';
}

function presetById(state, id) {
  return memoryPresetsOf(state).find(item => item.id === id) || null;
}

function row(state, preset) {
  const active = state.settings.memory?.activeId === preset.id;
  return `
    <button class="mp-set-row" data-act="mem-edit" data-id="${esc(preset.id)}" type="button">
      <span class="mp-set-ico">${icon('book')}</span>
      <span class="mp-set-name">${esc(preset.name)}<small>${esc(memoryPresetSummary(preset))}</small></span>
      ${active ? '<span class="mp-set-value">使用中</span>' : ''}
      <span style="color:var(--text-4)">${icon('chevron')}</span>
    </button>`;
}

/** 顶部：现在读到了什么。只报数字，不铺正文。 */
function statusCard(ctx, chosen, view, preset) {
  if (!chosen) {
    return '<div class="mp-empty" style="padding:14px">还没有角色，先去通讯录或酒馆拉一份名单。</div>';
  }
  if (view.loading) return '<div class="mp-api-note" style="margin:0">正在读这个角色最新的聊天文件…</div>';
  if (view.error) return `<div class="mp-api-note is-warn" style="margin:0">${esc(view.error)}</div>`;

  const source = view.source === 'summary' ? 'summary' : view.source === 'recent' ? 'recent' : 'empty';
  const metrics = view.metrics || {};
  const nums = source === 'summary'
    ? [['segments', '段'], ['depth', '层'], ['chars', '字']]
    : source === 'recent'
      ? [['lines', '楼'], ['chars', '字']]
      : [];
  const label = source === 'summary' ? '总结' : source === 'recent' ? '原文' : '没有记忆';
  const foot = [
    `方案「${preset?.name || '默认'}」`,
    view.file ? String(view.file).replace(/\.jsonl$/i, '') : '',
    view.demo ? '演示数据' : '',
  ].filter(Boolean).join(' · ');

  const emptyHint = view.hasSummary
    ? '这套方式现在只读原文，但这位角色的聊天文件里没有可读的楼层。'
    : '这位角色暂时没读到柏宝书总结，也没有酒馆聊天原文。';

  return `
    <div class="mp-mem-now">
      <div class="mp-mem-now-head">
        <span class="mp-mem-chip${source === 'recent' ? ' is-recent' : ''}${source === 'empty' ? ' is-empty' : ''}">${label}</span>
        <span class="mp-mem-now-plan">${esc(foot)}</span>
      </div>
      ${nums.length ? `
      <div class="mp-mem-nums">
        ${nums.map(([key, unit]) => `<span class="mp-mem-num"><b>${num(metrics[key])}</b><i>${unit}</i></span>`).join('')}
      </div>` : `<div class="mp-mem-now-empty">${esc(emptyHint)}</div>`}
      ${source === 'summary' ? '<div class="mp-mem-now-foot">柏宝书总结按段读，不铺原文</div>' : ''}
    </div>`;
}

/* 方案管理不再走弹窗：在当前列表里展开，改完就地保存 */
function presetPanel(ctx, preset) {
  const state = ctx.state;
  const active = state.settings.memory?.activeId === preset.id;
  const modeNote = preset.mode === 'auto'
    ? '方案来源：跟随上面的开关'
    : `方案来源：${memoryModeLabel(preset.mode)}（按角色的开关优先）`;
  return `
    <div class="mp-card mp-mem-edit">
      <div class="mp-card-title">${esc(preset.name)}${active ? '<span class="mp-api-tag">使用中</span>' : ''}</div>
      <label class="mp-api-field">
        <span>保留层数</span>
        <input id="mem-floors-input" class="mp-api-input" type="text" value="${esc(String(preset.floors || 10))}"
          placeholder="1 到 50" inputmode="numeric" data-act="mem-floors" data-id="${esc(preset.id)}">
      </label>
      <div class="mp-mem-panel-note">${esc(modeNote)} · 最近 ${preset.floors || 10} 层 · ${preset.skipFirstFloor ? '首楼用原文' : '首楼用总结'}</div>
      <button class="mp-set-row mp-mem-first" data-act="mem-first" data-id="${esc(preset.id)}" type="button">
        <span class="mp-set-name">首楼用原文<small>首楼总结丢东西时再开</small></span>
        <span class="mp-switch${preset.skipFirstFloor ? ' on' : ''}"></span>
      </button>
      <div class="mp-draw-actions">
        ${active ? '' : `<button class="mp-draw-action is-primary" data-act="mem-use" data-id="${esc(preset.id)}" type="button">设为手机默认方案</button>`}
        <button class="mp-draw-action" data-act="mem-rename-open" data-id="${esc(preset.id)}" type="button">改名</button>
        <button class="mp-draw-action" data-act="mem-clone" data-id="${esc(preset.id)}" type="button">复制一套</button>
        <button class="mp-draw-action is-danger" data-act="mem-del" data-id="${esc(preset.id)}" type="button">删除这套</button>
      </div>
      ${memRename ? `
      <div class="mp-api-name-edit">
        <input id="mem-rename-input" class="mp-api-input" type="text" maxlength="20" value="${esc(preset.name)}" placeholder="方案名字">
        <button class="mp-draw-side is-primary" data-act="mem-rename-save" data-id="${esc(preset.id)}" type="button">确定</button>
        <button class="mp-draw-side" data-act="mem-rename-cancel" type="button">取消</button>
      </div>` : ''}
      ${memDelete === preset.id ? `
      <div class="mp-api-delete">
        <div class="mp-api-delete-title">删除「${esc(preset.name)}」？</div>
        <div class="mp-api-delete-sub">只删这套记忆方案；正在用它时，手机会改用剩下第一套。至少留一套。</div>
        <div class="mp-draw-actions">
          <button class="mp-draw-action is-danger" data-act="mem-del-confirm" data-id="${esc(preset.id)}" type="button">确认删除</button>
          <button class="mp-draw-action" data-act="mem-del-cancel" type="button">取消</button>
        </div>
      </div>` : ''}
      <button class="mp-ios-edit-reply" data-act="mem-edit-close" type="button">收起${icon('chevron')}</button>
    </div>`;
}

function renderPage(ctx) {
  const state = ctx.state;
  const presets = memoryPresetsOf(state);
  const active = presetById(state, state.settings.memory?.activeId) || presets[0] || null;
  const contacts = singleContacts(state);
  const fallback = defaultMemoryContact(state);
  const chosen = contacts.find(contact => contact.id === memoryChosen) || fallback || null;
  if (chosen) memoryChosen = chosen.id;

  /* 进页面自动读一次当前角色；换角色时重新读。只读，不写聊天文件。 */
  if (chosen && memoryView.contactId !== chosen.id && memoryAutoKey !== chosen.id) {
    memoryAutoKey = chosen.id;
    setTimeout(() => readMemory(ctx, chosen.id), 0);
  }

  const view = memoryView.contactId === chosen?.id
    ? memoryView
    : { ...emptyView(chosen?.id || ''), loading: true };
  const preset = memoryPresetFor(state, null);
  const mode = view.mode || memoryReadModeFor(state, chosen?.id, preset);
  const hasSummary = Boolean(view.hasSummary);
  const readSummary = mode !== 'recent';
  const canSwitch = hasSummary;
  const switchHint = !chosen
    ? '先选一位角色'
    : view.loading
      ? '正在读这位角色的聊天文件…'
      : !canSwitch
        ? '这位角色还没有柏宝书总结，只能读原文'
        : readSummary
          ? '有柏宝书总结就读总结，关掉读原文'
          : '读最近几楼的原文，打开就换回总结';

  return `
    <div class="mp-page-body">
      <div class="mp-subtitle" style="margin-top:0">酒馆记忆：读角色最新聊天文件；有总结可切总结，没有就读最近原文</div>

      <div class="mp-group-head" style="margin-top:16px">
        <div class="mp-group-label">当前读取</div>
        <button class="mp-draw-side" data-act="mem-read" type="button"${view.loading ? ' disabled' : ''}>${view.loading ? '读取中…' : '重新读取'}</button>
      </div>
      <div class="mp-group">
        ${contacts.length ? `
        <div class="mp-select-wrap" style="margin:0 0 10px">
          <select data-act="mem-character">
            ${contacts.map(contact => `<option value="${esc(contact.id)}"${contact.id === chosen?.id ? ' selected' : ''}>${esc(contact.name || '未命名')}</option>`).join('')}
          </select>${icon('chevron')}
        </div>` : ''}
        <div class="mp-card mp-mem-card">${statusCard(ctx, chosen, view, preset)}</div>
      </div>

      <div class="mp-group-label" style="margin-top:16px">读取方式</div>
      <div class="mp-group-box">
        <button class="mp-set-row${canSwitch ? '' : ' is-off'}" data-act="mem-toggle-read" type="button"${canSwitch ? '' : ' disabled aria-disabled="true"'}>
          <span class="mp-set-ico">${icon('book')}</span>
          <span class="mp-set-name">读总结<small>${esc(switchHint)}</small></span>
          <span class="mp-switch${readSummary && canSwitch ? ' on' : ''}"></span>
        </button>
      </div>

      <div class="mp-group-label" style="margin-top:16px">记忆方案</div>
      <div class="mp-group-box">
        ${presets.map(item => `${row(state, item)}${memEdit === item.id ? presetPanel(ctx, item) : ''}`).join('') || '<div class="mp-empty">还没有方案。</div>'}
      </div>
      <div class="mp-group-box">
        <button class="mp-set-row" data-act="mem-new" type="button">
          <span class="mp-set-ico">${icon('plus')}</span>
          <span class="mp-set-name">新建一套<small>在「${esc(active?.name || '默认')}」的基础上改</small></span>
          <span style="color:var(--text-4)">${icon('chevron')}</span>
        </button>
      </div>

      <div class="mp-group-label" style="margin-top:16px">怎么读</div>
      <div class="mp-card">
        <div class="mp-card-title">层数</div>
        <div class="mp-card-sub">一层就是酒馆里的一条消息。层数越多，模型记得越远，但占的上下文也越多。</div>
        <div class="mp-card-title" style="margin-top:12px">默认</div>
        <div class="mp-card-sub">手机默认读${memoryGlobalReadMode(state) === 'recent' ? '原文' : '总结'}（在「设置 · 记忆」里改）；这位角色单独切过就按开关。</div>
      </div>
    </div>`;
}

function handle(ctx, act, data) {
  if (act === 'mem-character') {
    const contactId = String(data?.value || data?.id || '');
    if (!contactId || !contactById(ctx.state, contactId)) return true;
    memoryChosen = contactId;
    memoryAutoKey = contactId;
    readMemory(ctx, contactId);
    return true;
  }

  if (act === 'mem-read') {
    const contact = contactById(ctx.state, memoryChosen) || defaultMemoryContact(ctx.state);
    if (!contact) { say(ctx, '还没有角色可读'); return true; }
    memoryChosen = contact.id;
    memoryAutoKey = contact.id;
    readMemory(ctx, contact.id);
    return true;
  }

  /* 读取方式开关：写进这位角色的单独设置；没有总结就不让切 */
  if (act === 'mem-toggle-read') {
    const contact = contactById(ctx.state, memoryChosen) || defaultMemoryContact(ctx.state);
    if (!contact) { say(ctx, '先选一位角色'); return true; }
    if (memoryView.contactId !== contact.id || !memoryView.hasSummary) {
      say(ctx, '这位角色还没有柏宝书总结，只能读原文');
      return true;
    }
    const store = ctx.state.settings.memory;
    if (!store.byContact || typeof store.byContact !== 'object') store.byContact = {};
    const next = memoryReadModeFor(ctx.state, contact.id, memoryPresetFor(ctx.state, null)) === 'recent' ? 'auto' : 'recent';
    store.byContact[contact.id] = next;
    ctx.save();
    /* 切完立刻按新方式重读一遍：顶部数字跟着变，不会停在旧的「总结」上 */
    readMemory(ctx, contact.id, next === 'recent' ? '这位角色改成读原文' : '这位角色改回读总结');
    return true;
  }

  if (act === 'mem-edit') {
    const id = String(data.id || '');
    memEdit = memEdit === id ? '' : id;
    memRename = false;
    memDelete = '';
    redraw(ctx);
    return true;
  }

  if (act === 'mem-edit-close') {
    memEdit = '';
    memRename = false;
    memDelete = '';
    redraw(ctx);
    return true;
  }

  if (act === 'mem-new') {
    const active = presetById(ctx.state, ctx.state.settings.memory?.activeId) || memoryPresetsOf(ctx.state)[0] || null;
    const preset = {
      id: newId('mem'),
      name: '新的记忆方案',
      mode: active?.mode || 'auto',
      floors: active?.floors || 10,
      skipFirstFloor: Boolean(active?.skipFirstFloor),
    };
    ctx.state.settings.memory.presets.push(preset);
    memEdit = preset.id;
    memRename = false;
    memDelete = '';
    ctx.save();
    redraw(ctx);
    return true;
  }

  /* 层数就地保存：改完直接写，不再单独一个「保存层数」按钮 */
  if (act === 'mem-floors') {
    const live = presetById(ctx.state, String(data.id || ''));
    if (!live) return true;
    const floors = Math.max(1, Math.min(50, Number(String(data.value || '').replace(/[^\d]/g, '')) || 10));
    if (floors === live.floors) return true;
    live.floors = floors;
    ctx.save();
    say(ctx, `最近 ${floors} 层`);
    return true;
  }

  if (act === 'mem-first') {
    const live = presetById(ctx.state, String(data.id || ''));
    if (!live) return true;
    live.skipFirstFloor = !live.skipFirstFloor;
    ctx.save();
    redraw(ctx);
    say(ctx, live.skipFirstFloor ? '首楼改成注入原文' : '首楼恢复用总结');
    return true;
  }

  if (act === 'mem-use') {
    const live = presetById(ctx.state, String(data.id || ''));
    if (!live) return true;
    ctx.state.settings.memory.activeId = live.id;
    ctx.save();
    redraw(ctx);
    say(ctx, `手机默认记忆方案改成「${live.name}」`);
    return true;
  }

  if (act === 'mem-rename-open') {
    memRename = true;
    memDelete = '';
    redraw(ctx);
    return true;
  }

  if (act === 'mem-rename-save') {
    const live = presetById(ctx.state, String(data.id || ''));
    if (!live) return true;
    const input = ctx.shell.root?.querySelector('#mem-rename-input');
    const name = String(input?.value || '').trim().slice(0, 20);
    if (!name) { say(ctx, '名字不能空着'); return true; }
    live.name = name;
    memRename = false;
    ctx.save();
    redraw(ctx);
    say(ctx, '名字改好了');
    return true;
  }

  if (act === 'mem-rename-cancel') {
    memRename = false;
    redraw(ctx);
    return true;
  }

  if (act === 'mem-clone') {
    const live = presetById(ctx.state, String(data.id || ''));
    if (!live) return true;
    const copy = {
      id: newId('mem'),
      name: `${live.name} 副本`.slice(0, 20),
      mode: live.mode,
      floors: live.floors,
      skipFirstFloor: Boolean(live.skipFirstFloor),
    };
    ctx.state.settings.memory.presets.push(copy);
    memEdit = copy.id;
    memRename = false;
    memDelete = '';
    ctx.save();
    redraw(ctx);
    say(ctx, `复制成「${copy.name}」`);
    return true;
  }

  if (act === 'mem-del') {
    const live = presetById(ctx.state, String(data.id || ''));
    if (!live) return true;
    if (memoryPresetsOf(ctx.state).length <= 1) { say(ctx, '至少留一套记忆方案'); return true; }
    memDelete = live.id;
    memRename = false;
    redraw(ctx);
    return true;
  }

  if (act === 'mem-del-cancel') {
    memDelete = '';
    redraw(ctx);
    return true;
  }

  if (act === 'mem-del-confirm') {
    const store = ctx.state.settings.memory;
    const live = presetById(ctx.state, String(data.id || ''));
    if (!live) return true;
    if (memoryPresetsOf(ctx.state).length <= 1) { say(ctx, '至少留一套记忆方案'); return true; }
    const index = store.presets.findIndex(item => item.id === live.id);
    if (index < 0) return true;
    store.presets.splice(index, 1);
    if (store.activeId === live.id) store.activeId = store.presets[0].id;
    memDelete = '';
    memEdit = '';
    memRename = false;
    ctx.save();
    redraw(ctx);
    say(ctx, `记忆方案「${live.name}」删掉了`);
    return true;
  }

  return false;
}

export const memoryPresetsApp = {
  id: 'memory-presets', name: '酒馆记忆', icon: 'book',
  render(ctx, params = {}) {
    /* 从角色卡点进来时直接定位到这位，并重新读一次他的聊天文件 */
    const wanted = String(params.contactId || '');
    if (wanted && contactById(ctx.state, wanted)) {
      if (memoryChosen !== wanted) memoryAutoKey = '';
      memoryChosen = wanted;
    }
    return renderPage(ctx);
  },
  handle(ctx, act, data) { return handle(ctx, act, data); },
};
