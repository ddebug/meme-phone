/**
 * meme-phone · 酒馆记忆预设页
 *
 * 从聊天设置里的「酒馆记忆」进来：给手机选默认方案，也能新建 / 改名 / 改来源 / 改层数 / 删除。
 */

import { icon } from '../icons.js';
import { newId, memoryPresetsOf, contactById, chatsOf } from '../data.js';
import { esc } from '../shell.js';
import { MEMORY_MODES, memoryModeLabel, memoryPresetSummary, buildMemoryContext } from '../memory.js';

let memoryChosen = '';
let memoryView = { contactId: '', loading: false, error: '', text: '', source: '', file: '', demo: false, summaryCount: 0 };
let memoryAutoKey = '';

function singleContacts(state) {
  return Object.values(state.contacts || {}).filter(contact => contact && contact.kind !== 'group');
}

function defaultMemoryContact(state) {
  const chat = chatsOf(state)[0];
  const byChat = chat ? contactById(state, chat.contactId) : null;
  return byChat || singleContacts(state)[0] || null;
}

function readMemory(ctx, contactId) {
  const contact = contactById(ctx.state, contactId);
  if (!contact) {
    memoryView = { contactId, loading: false, error: '', text: '', source: 'empty', file: '', demo: false, summaryCount: 0 };
    return;
  }
  memoryView = { contactId, loading: true, error: '', text: '', source: '', file: '', demo: false, summaryCount: 0 };
  ctx.rerender();
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
    };
    ctx.rerender();
  }).catch(error => {
    memoryView = { contactId, loading: false, error: error?.message || '读取失败', text: '', source: '', file: '', demo: false, summaryCount: 0 };
    ctx.rerender();
  });
}

function memorySourceLabel(view) {
  if (view.source === 'summary') return `柏宝书总结 · ${view.summaryCount} 段`;
  if (view.source === 'recent') return '最近几层酒馆聊天原文';
  return '没有可用的记忆';
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

function renderPage(ctx) {
  const presets = memoryPresetsOf(ctx.state);
  const active = presetById(ctx.state, ctx.state.settings.memory?.activeId) || presets[0] || null;
  const contacts = singleContacts(ctx.state);
  const fallback = defaultMemoryContact(ctx.state);
  const chosen = contacts.find(contact => contact.id === memoryChosen) || fallback || null;
  if (chosen) memoryChosen = chosen.id;

  /* 进页面自动读一次当前角色；换角色时重新读。只读，不写聊天文件。 */
  if (chosen && memoryView.contactId !== chosen.id && memoryAutoKey !== chosen.id) {
    memoryAutoKey = chosen.id;
    setTimeout(() => readMemory(ctx, chosen.id), 0);
  }
  const view = memoryView.contactId === chosen?.id ? memoryView : { loading: true, text: '', error: '', source: '', file: '', demo: false, summaryCount: 0 };
  const memoryBody = !chosen
    ? '<div class="mp-empty" style="padding:14px">还没有角色，先去通讯录或酒馆拉一份名单。</div>'
    : view.loading
      ? '<div class="mp-api-note" style="margin:0">正在读这个角色最新的聊天文件…</div>'
      : view.error
        ? `<div class="mp-api-note is-warn" style="margin:0">${esc(view.error)}</div>`
        : view.text
          ? `<div class="mp-mem-text">${esc(view.text)}</div>
             <div class="mp-mem-meta">${esc(memorySourceLabel(view))}${view.file ? ` · ${esc(view.file.replace(/\.jsonl$/i, ''))}` : ''}${view.demo ? ' · 演示数据' : ''}</div>`
          : `<div class="mp-empty" style="padding:14px">这位角色暂时没读到柏宝书记忆，也没有酒馆聊天原文。</div>
             <div class="mp-api-note" style="margin:0">只读当前角色最新的聊天文件；没有记忆时就是空的，不会去改酒馆里的聊天。</div>`;

  return `
    <div class="mp-page-body">
      <div class="mp-title">酒馆记忆</div>
      <div class="mp-subtitle">读角色最新聊天文件；有柏宝书记忆时先用记忆</div>

      <div class="mp-group-head" style="margin-top:16px">
        <div class="mp-group-label">已读记忆 · 当前会话角色</div>
        <button class="mp-draw-side" data-act="mem-read" type="button"${view.loading ? ' disabled' : ''}>${view.loading ? '读取中…' : '重新读取'}</button>
      </div>
      <div class="mp-group">
        ${contacts.length ? `
        <div class="mp-select-wrap" style="margin:0 0 10px">
          <select data-act="mem-character">
            ${contacts.map(contact => `<option value="${esc(contact.id)}"${contact.id === chosen?.id ? ' selected' : ''}>${esc(contact.name || '未命名')}</option>`).join('')}
          </select>${icon('chevron')}
        </div>` : ''}
        <div class="mp-card mp-mem-card">${memoryBody}</div>
      </div>

      <div class="mp-group" style="margin-top:16px">
        <div class="mp-group-label">手机默认方案</div>
        <div class="mp-group-box">
          ${presets.map(item => row(ctx.state, item)).join('') || '<div class="mp-empty">还没有方案。</div>'}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-box">
          <button class="mp-set-row" data-act="mem-new" type="button">
            <span class="mp-set-ico">${icon('plus')}</span>
            <span class="mp-set-name">新建一套<small>在「${esc(active?.name || '默认')}」的基础上改</small></span>
            <span style="color:var(--text-4)">${icon('chevron')}</span>
          </button>
        </div>
      </div>

      <div class="mp-group-label" style="margin-top:16px">怎么读</div>
      <div class="mp-card">
        <div class="mp-card-title">自动（默认）</div>
        <div class="mp-card-sub">这个角色最新的聊天文件里有柏宝书记忆，就注入记忆；没有记忆，才读最近几层酒馆聊天原文。</div>
        <div class="mp-card-title" style="margin-top:12px">层数</div>
        <div class="mp-card-sub">一层就是酒馆里的一条消息。层数越多，模型记得越远，但占的上下文也越多。</div>
        <div class="mp-card-title" style="margin-top:12px">首楼</div>
        <div class="mp-card-sub">默认连首楼一起读总结；如果首楼总结丢了三件事或说话方式，可以在方案里改成「首楼用原文」。</div>
      </div>
    </div>`;
}

function openEdit(ctx, preset) {
  if (!preset) return;
  ctx.openSheet({
    title: preset.name,
    items: [
      { label: '设为手机默认', value: 'use', note: '所有跟随手机的会话都用这套' },
      { label: '改名', value: 'rename' },
      { label: '改记忆来源', value: 'mode', note: memoryModeLabel(preset.mode) },
      { label: '改保留层数', value: 'floors', note: `最近 ${preset.floors || 10} 层` },
      { label: preset.skipFirstFloor ? '首楼：用原文' : '首楼：用总结', value: 'first', note: preset.skipFirstFloor ? '不注入首楼总结，改注入首楼原文' : '首楼也读酒馆总结' },
      { label: '复制一套', value: 'clone' },
      { label: '删除这套', value: 'delete', danger: true },
    ],
    onPick: (value) => {
      const store = ctx.state.settings.memory;
      const live = presetById(ctx.state, preset.id);
      if (!live) return;

      if (value === 'use') {
        store.activeId = live.id;
        ctx.save();
        ctx.rerender();
        ctx.toast(`手机默认记忆改成「${live.name}」`);
        return;
      }

      if (value === 'rename') {
        ctx.openSheet({
          kind: 'text', title: '改个名字', value: live.name, placeholder: '比如：最近原文、长记忆',
          onText: (text) => {
            const name = String(text || '').trim().slice(0, 20);
            if (!name) return;
            live.name = name;
            ctx.save();
            ctx.rerender();
          },
        });
        return;
      }

      if (value === 'mode') {
        ctx.openSheet({
          title: '记忆来源',
          items: MEMORY_MODES.map(item => ({ label: item.label, value: item.value, note: item.hint })),
          onPick: (mode) => {
            if (!['auto', 'summary', 'recent'].includes(mode)) return;
            live.mode = mode;
            ctx.save();
            ctx.rerender();
          },
        });
        return;
      }

      if (value === 'floors') {
        ctx.openSheet({
          kind: 'text', title: '保留多少层', value: String(live.floors || 10),
          placeholder: '1 到 50，默认 10',
          onText: (text) => {
            const floors = Math.max(1, Math.min(50, Number(String(text).replace(/[^\d]/g, '')) || 10));
            live.floors = floors;
            ctx.save();
            ctx.rerender();
            ctx.toast(`最近 ${floors} 层`);
          },
        });
        return;
      }

      if (value === 'first') {
        live.skipFirstFloor = !live.skipFirstFloor;
        ctx.save();
        ctx.rerender();
        ctx.toast(live.skipFirstFloor ? '首楼改成注入原文' : '首楼恢复用总结');
        return;
      }

      if (value === 'clone') {
        const copy = {
          id: newId('mem'),
          name: `${live.name} 副本`.slice(0, 20),
          mode: live.mode,
          floors: live.floors,
          skipFirstFloor: Boolean(live.skipFirstFloor),
        };
        store.presets.push(copy);
        ctx.save();
        ctx.rerender();
        openEdit(ctx, copy);
        return;
      }

      if (value === 'delete') {
        if (store.presets.length <= 1) {
          ctx.toast('至少留一套记忆方案');
          return;
        }
        ctx.openSheet({
          title: `删除「${live.name}」？`,
          items: [
            { label: '确认删除', value: 'delete', danger: true },
            { label: '先留着', value: 'keep' },
          ],
          onPick: (pick) => {
            if (pick !== 'delete') return;
            const index = store.presets.findIndex(item => item.id === live.id);
            if (index < 0) return;
            store.presets.splice(index, 1);
            const fallback = store.presets[0].id;
            if (store.activeId === live.id) store.activeId = fallback;
            ctx.save();
            ctx.rerender();
            ctx.toast('这套记忆方案删掉了');
          },
        });
      }
    },
  });
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
    if (!contact) { ctx.toast('还没有角色可读'); return true; }
    memoryChosen = contact.id;
    memoryAutoKey = contact.id;
    readMemory(ctx, contact.id);
    return true;
  }

  if (act === 'mem-edit') {
    openEdit(ctx, presetById(ctx.state, data.id));
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
    ctx.save();
    ctx.rerender();
    openEdit(ctx, preset);
    return true;
  }

  return false;
}

export const memoryPresetsApp = {
  id: 'memory-presets', name: '酒馆记忆', icon: 'book',
  render(ctx) { return renderPage(ctx); },
  handle(ctx, act, data) { return handle(ctx, act, data); },
};
