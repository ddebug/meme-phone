/**
 * meme-phone · 回复预设
 * 每一套预设就是一段告诉模型「该怎么回消息」的指令；
 * 手机默认一套，单个聊天也可以自己换一套。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import { newId, replyPresetsOf, replyPresetFor } from '../data.js';

let editingId = '';

function clip(text, max = 42) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function findPreset(state, id) {
  const list = replyPresetsOf(state);
  return list.find(item => item.id === id) || list[0] || null;
}

export const presetsApp = {
  id: 'presets', name: '预设', icon: 'reply',

  render(ctx) {
    const list = replyPresetsOf(ctx.state);
    const active = replyPresetFor(ctx.state, null);
    const rows = list.map((preset, index) => `
      <button class="mp-row" data-act="reply-open" data-id="${esc(preset.id)}" type="button">
        <span class="mp-row-main">
          <span class="mp-row-name">${esc(preset.name || `预设 ${index + 1}`)}${preset.id === active?.id ? '<span class="mp-api-tag">手机</span>' : ''}</span>
          <span class="mp-row-sub">${esc(clip(preset.text || '还没写指令'))}</span>
        </span>
        ${icon('chevron')}
      </button>`).join('');

    return `
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <div class="mp-title" style="flex:1">回复预设</div>
          <button class="mp-icon-btn" data-act="reply-new" type="button" aria-label="新建预设">${icon('plus')}</button>
        </div>
        <div class="mp-subtitle">告诉模型该怎么回消息；聊天设置里还能给单个会话换一套</div>

        <div class="mp-group-label" style="margin-top:14px">手机默认 · ${list.length} 套</div>
        <div class="mp-group-box">
          ${rows || '<div class="mp-empty">还没有回复预设，点右上角新建一套。</div>'}
        </div>

        <div class="mp-api-note" style="margin-top:14px">
          预设只决定回复的语气、长短和格式，不存 API 地址、Key 或酒馆记忆。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'reply-new') {
      const source = replyPresetFor(ctx.state, null);
      ctx.openSheet({
        kind: 'text', title: '新预设叫什么',
        value: `${source?.name || '预设'} 副本`.slice(0, 20),
        placeholder: '比如：短句、黏人、正经一点',
        onText: text => {
          const name = String(text || '').trim().slice(0, 20) || '新预设';
          const preset = { id: newId('reply'), name, text: source?.text || '' };
          ctx.state.settings.reply.presets.push(preset);
          ctx.state.settings.reply.activeId = preset.id;
          editingId = preset.id;
          ctx.save();
          ctx.go('reply-item', { id: preset.id });
          ctx.toast(`新建了「${name}」`);
        },
      });
      return true;
    }

    if (act === 'reply-open') {
      editingId = String(data.id || '');
      ctx.go('reply-item', { id: editingId });
      return true;
    }

    return false;
  },
};

export const replyPresetApp = {
  id: 'reply-item', name: '回复预设', icon: 'reply',

  render(ctx, params = {}) {
    const id = String(params.id || editingId || '');
    const preset = findPreset(ctx.state, id);
    if (!preset) return '<div class="mp-page-body"><div class="mp-empty">这套预设不在了。</div></div>';
    editingId = preset.id;
    const active = replyPresetFor(ctx.state, null);
    const isActive = active?.id === preset.id;
    const text = String(preset.text || '');

    return `
      <div class="mp-nav">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
        <button class="mp-back" data-act="reply-del" type="button" title="删除">${icon('trash')}</button>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">${esc(preset.name || '未命名预设')}</div>
        <div class="mp-subtitle">${isActive ? '手机现在默认用这套' : '只在聊天设置里选中它时生效'}</div>

        <div class="mp-group" style="margin-top:14px">
          <button class="mp-row" data-act="reply-field" data-key="name" type="button">
            <span class="mp-row-name" style="flex:none">名称</span>
            <span class="mp-api-value">${esc(preset.name || '没填')}</span>
            ${icon('chevron')}
          </button>
          <button class="mp-row" data-act="reply-field" data-key="text" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">回复指令</span>
              <span class="mp-row-sub mp-reply-preview">${esc(text || '还没写，模型会按默认方式回')}</span>
            </span>
            ${icon('chevron')}
          </button>
        </div>

        <div class="mp-group-label" style="margin-top:16px">用在</div>
        <div class="mp-api-use">
          <button class="mp-api-use-btn${isActive ? ' is-on' : ''}" data-act="reply-use" type="button">
            ${icon('reply')}<span>${isActive ? '手机正在用' : '设为手机默认'}</span>
          </button>
        </div>

        <div class="mp-api-note" style="margin-top:14px">
          点「回复指令」改这段文字，模型每次回消息前都会读到它。单个聊天可以在聊天设置里单独选一套。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const preset = findPreset(ctx.state, String(data?.id || editingId));
    if (!preset) return false;

    if (act === 'reply-field') {
      const key = String(data.key || '');
      if (key === 'name') {
        ctx.openSheet({
          kind: 'text', title: '预设名字', value: preset.name || '',
          placeholder: '比如：短句、黏人、正经一点',
          onText: text => {
            preset.name = String(text || '').trim().slice(0, 20) || preset.name;
            ctx.save();
            ctx.rerender();
          },
        });
        return true;
      }
      if (key === 'text') {
        ctx.openSheet({
          kind: 'text', title: '告诉模型怎么回消息', value: preset.text || '',
          placeholder: '比如：像平时发微信一样，口语、短句，一次只回一两句，不要旁白和括号动作。',
          onText: text => {
            preset.text = String(text || '').trim().slice(0, 3000);
            ctx.save();
            ctx.rerender();
            ctx.toast('回复指令已更新');
          },
        });
        return true;
      }
    }

    if (act === 'reply-use') {
      ctx.state.settings.reply.activeId = preset.id;
      editingId = preset.id;
      ctx.save();
      ctx.rerender();
      ctx.toast(`手机默认改用「${preset.name}」`);
      return true;
    }

    if (act === 'reply-del') {
      const list = replyPresetsOf(ctx.state);
      if (list.length <= 1) {
        ctx.toast('至少留一套回复预设');
        return true;
      }
      ctx.state.settings.reply.presets = list.filter(item => item.id !== preset.id);
      if (ctx.state.settings.reply.activeId === preset.id) {
        ctx.state.settings.reply.activeId = ctx.state.settings.reply.presets[0].id;
      }
      ctx.go('app-presets');
      ctx.toast('这套预设删掉了');
      return true;
    }

    return false;
  },
};
