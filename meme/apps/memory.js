/**
 * meme-phone · 酒馆记忆预设页
 *
 * 从聊天设置里的「酒馆记忆」进来：给手机选默认方案，也能新建 / 改名 / 改来源 / 改层数 / 删除。
 */

import { icon } from '../icons.js';
import { newId, memoryPresetsOf, syncActiveChatScheme } from '../data.js';
import { esc } from '../shell.js';
import { MEMORY_MODES, memoryModeLabel, memoryPresetSummary } from '../memory.js';

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
  return `
    <div class="mp-page-body">
      <div class="mp-title">酒馆记忆</div>
      <div class="mp-subtitle">默认读这个角色最新的酒馆聊天；有柏宝书总结时先用总结</div>

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
        <div class="mp-card-sub">这个角色当前酒馆聊天有柏宝书总结，就注入总结；没有总结，才读最近几层酒馆聊天原文。</div>
        <div class="mp-card-title" style="margin-top:12px">层数</div>
        <div class="mp-card-sub">一层就是酒馆里的一条消息。层数越多，模型记得越远，但占的上下文也越多。</div>
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
      { label: '复制一套', value: 'clone' },
      { label: '删除这套', value: 'delete', danger: true },
    ],
    onPick: (value) => {
      const store = ctx.state.settings.memory;
      const live = presetById(ctx.state, preset.id);
      if (!live) return;

      if (value === 'use') {
        store.activeId = live.id;
        syncActiveChatScheme(ctx.state);
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

      if (value === 'clone') {
        const copy = {
          id: newId('mem'),
          name: `${live.name} 副本`.slice(0, 20),
          mode: live.mode,
          floors: live.floors,
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
            if (store.activeId === live.id) store.activeId = store.presets[0].id;
            syncActiveChatScheme(ctx.state);
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
