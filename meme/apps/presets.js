/**
 * meme-phone · 回复预设
 * 一套预设 = 主回复指令 + 可排序的提示词条目 + 注入的上下文；
 * 手机默认一套，单个聊天也可以自己换一套。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import { newId, replyPresetsOf, replyPresetFor, normalizeReplyContext, normalizeReplyItems, normalizeCharacters, defaultReplyItems, REPLY_CONTEXT_SPECS, chatsOf } from '../data.js';
import { buildReplyMessages } from '../reply-context.js';
import { tavernQuietPrompt } from '../host.js';

let editingId = '';
let creating = false;
let renaming = false;
let deleting = false;
let preview = { presetId: '', tab: 'messages', chatId: '', loading: false, error: '', data: null, flat: '' };

function resetPreview() {
  preview = { presetId: '', tab: preview.tab || 'messages', chatId: preview.chatId || '', loading: false, error: '', data: null, flat: '' };
}

function clip(text, max = 42) {
  const value = String(text || '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function injectedCount(preset) {
  return promptItems(preset).filter(item => item.kind === 'context' && item.enabled).length;
}

function contextNote(preset) {
  const count = injectedCount(preset);
  return count ? `注入 ${count} 段上下文` : '不注入上下文';
}

function promptItems(preset) {
  return normalizeReplyItems(preset?.items, preset?.context);
}

function itemNote(preset) {
  const items = promptItems(preset);
  const chat = items.filter(item => item.kind === 'chat').length;
  const context = items.filter(item => item.kind === 'context').length;
  const app = items.filter(item => item.kind === 'app').length;
  if (!items.length) return '没有附加提示';
  return [
    chat ? `聊天 ${chat} 条` : '',
    context ? `上下文 ${context} 条` : '',
    app ? `其他软件 ${app} 条` : '',
  ].filter(Boolean).join(' · ');
}

function itemKindLabel(item) {
  if (item.kind === 'context') return '上下文注入';
  if (item.kind === 'app') return `其他软件${item.app ? ` · ${item.app}` : ''}`;
  return '聊天行为';
}

function roleLabel(role) {
  return role === 'user' ? '用户' : role === 'assistant' ? '角色示例' : '系统';
}

function contextItemNote(item, context) {
  const spec = REPLY_CONTEXT_SPECS[item.auto];
  if (item.auto === 'history') return `最近 ${context.historyLimit} 条会话`;
  return spec?.note || '手机读取当前数据';
}

function setContextEnabled(preset, key, enabled) {
  const context = normalizeReplyContext(preset.context);
  context[key] = Boolean(enabled);
  preset.context = context;
}

function charactersLabel(item) {
  const list = normalizeCharacters(item?.characters);
  if (!list.length) return '';
  return list.length > 2 ? `仅 ${list.slice(0, 2).join('、')} 等 ${list.length} 个角色` : `仅 ${list.join('、')}`;
}

const PREVIEW_STATUS = {
  disabled: '关掉了',
  app: '不进聊天',
  'other-character': '别的角色',
  empty: '没有内容',
  duplicate: '内容重复',
  'over-budget': '超出预算',
};

function previewHtml(preset) {
  if (!preview.presetId || preview.presetId !== preset.id) {
    return '<div class="mp-api-note">点「跑一遍」会按当前开关、顺序和上面选中的会话，走和真实聊天完全相同的那套组装逻辑。</div>';
  }
  if (preview.loading) return '<div class="mp-api-note">正在组装…</div>';
  if (preview.error) return `<div class="mp-api-note is-warn">${esc(preview.error)}</div>`;
  if (!preview.data) return '<div class="mp-api-note">还没有结果。</div>';

  const { messages, report } = preview.data;
  const skipped = (report.items || []).filter(item => item.status !== 'injected');
  const body = preview.tab === 'flat'
    ? `<pre class="mp-preview-flat">${esc(preview.flat || '（空）')}</pre>`
    : (messages.length
      ? messages.map((message, index) => `
        <div class="mp-preview-msg">
          <div class="mp-preview-role"><span>${index + 1}</span>${esc(roleLabel(message.role))}${message.source ? ` · ${esc(message.source)}` : ''}</div>
          <pre>${esc(message.content)}</pre>
        </div>`).join('')
      : '<div class="mp-empty" style="padding:14px">这一遍没有组装出任何消息。</div>');

  return `
    <div class="mp-preview-tabs">
      <button class="mp-preview-tab${preview.tab === 'messages' ? ' is-on' : ''}" data-act="reply-preview-tab" data-tab="messages" type="button">结构化消息 ${messages.length}</button>
      <button class="mp-preview-tab${preview.tab === 'flat' ? ' is-on' : ''}" data-act="reply-preview-tab" data-tab="flat" type="button">酒馆扁平文本</button>
    </div>
    <div class="mp-preview-panel">${body}</div>
    <div class="mp-preview-foot">
      共 ${messages.length} 条 · 条目占用 ${report.charUsed}/${report.charBudget} 字 · 人设世界书：${esc(report.personaBook || '未绑定')}
      ${skipped.length ? `<br>没注入：${esc(skipped.map(item => `${item.label}（${PREVIEW_STATUS[item.status] || item.reason || item.status}）`).join('；'))}` : ''}
    </div>`;
}

function characterOptions(ctx) {
  const names = [...new Set((ctx.state.characters || []).map(card => String(card?.name || '')).filter(Boolean))];
  return names.map(name => ({ value: name, label: name }));
}

function openCharactersForm(ctx, preset, item) {
  const options = characterOptions(ctx);
  ctx.openSheet({
    kind: 'form',
    title: `「${item.label}」对谁生效`,
    confirm: '保存',
    fields: [
      options.length ? {
        name: 'characters',
        type: 'checks',
        label: '角色卡',
        value: normalizeCharacters(item.characters),
        options,
        hint: '勾选 = 只在这些角色的一对一聊天里生效；一个都不勾 = 全部角色。群聊只注入没勾角色的公共条目。',
      } : {
        name: 'characters',
        type: 'text',
        label: '角色卡名字',
        value: normalizeCharacters(item.characters).join('、'),
        placeholder: '留空 = 全部角色',
        maxLength: 200,
        hint: '还没读到角色卡；先按名字填，用「、」或逗号分隔。',
      },
    ],
    onForm: values => {
      const items = promptItems(preset);
      const index = items.findIndex(candidate => candidate.id === item.id);
      if (index < 0) return;
      const raw = Array.isArray(values.characters)
        ? values.characters
        : String(values.characters || '').split(/[、,，/]/).map(part => part.trim());
      const next = normalizeCharacters(raw);
      items[index] = { ...items[index], characters: next };
      preset.items = items;
      resetPreview();
      ctx.save();
      ctx.rerender();
      ctx.toast(next.length ? `只对 ${next.join('、')} 生效` : '改成全部角色');
    },
  });
}

function openItemForm(ctx, preset, itemId = '', scope = 'chat') {
  const items = promptItems(preset);
  const index = itemId ? items.findIndex(item => item.id === itemId) : -1;
  const item = index >= 0 ? items[index] : null;
  if (item && item.editable === false) {
    ctx.toast('这条是固定条目，不能改内容');
    return;
  }
  const defaultKind = item?.kind || (scope === 'app' ? 'app' : 'chat');
  const charOptions = characterOptions(ctx);
  ctx.openSheet({
    kind: 'form',
    title: item ? '编辑提示词条目' : '添加提示词条目',
    confirm: item ? '保存' : '添加',
    fields: [
      { name: 'label', type: 'text', label: '名称', value: item?.label || '', placeholder: '比如：聊天任务、行为要求', maxLength: 30 },
      { name: 'kind', type: 'select', label: '类型', value: defaultKind, options: [
        { value: 'chat', label: '聊天行为（聊天软件）' },
        { value: 'app', label: '其他软件' },
      ] },
      { name: 'app', type: 'text', label: '软件名', value: item?.app || '', placeholder: '日历 / 外卖 / 音乐 / 购物', maxLength: 20, hint: '类型选“其他软件”时才填，聊天条目留空' },
      charOptions.length ? {
        name: 'characters', type: 'checks', label: '适用角色',
        value: normalizeCharacters(item?.characters), options: charOptions,
        hint: '勾选 = 只在这些角色的一对一聊天里生效；一个都不勾 = 全部角色。群聊只注入没勾角色的公共条目。',
      } : {
        name: 'characters', type: 'text', label: '适用角色', value: normalizeCharacters(item?.characters).join('、'), placeholder: '留空 = 全部角色', maxLength: 200,
        hint: '还没读到角色卡；先按名字填，用「、」或逗号分隔。',
      },
      { name: 'role', type: 'select', label: '角色', value: item?.role || 'system', options: [
        { value: 'system', label: '系统（system）' },
        { value: 'user', label: '用户（user）' },
        { value: 'assistant', label: '角色示例（assistant）' },
      ] },
      { name: 'content', type: 'textarea', label: '内容', value: item?.content || '', placeholder: '这段文字会按顺序拼进发给模型的提示词', maxLength: 4000, hint: '可以用 {{user}}、{{char}}、{{当前时间}} 这三个变量' },
    ],
    onForm: values => {
      const next = promptItems(preset);
      const nextItem = {
        id: item?.id || newId('item'),
        label: String(values.label || '').trim().slice(0, 30) || '自定义条目',
        kind: values.kind === 'app' ? 'app' : 'chat',
        app: values.kind === 'app' ? String(values.app || '').trim().slice(0, 20) : '',
        characters: normalizeCharacters(Array.isArray(values.characters)
          ? values.characters
          : String(values.characters || '').split(/[、,，/]/).map(part => part.trim())),
        role: ['system', 'user', 'assistant'].includes(values.role) ? values.role : 'system',
        content: String(values.content || '').trim().slice(0, 4000),
        enabled: item?.enabled !== false,
        editable: true,
        deletable: true,
        order: item?.order ?? next.length,
      };
      if (index >= 0) next[index] = { ...next[index], ...nextItem, id: next[index].id };
      else next.push(nextItem);
      preset.items = next;
      resetPreview();
      ctx.save();
      ctx.toast(item ? '条目已更新' : '条目已添加');
    },
  });
}

function exportPresets(ctx) {
  const payload = {
    version: 1,
    kind: 'meme-phone-reply-presets',
    activeId: ctx.state.settings.reply?.activeId || '',
    presets: replyPresetsOf(ctx.state).map(preset => ({
      id: preset.id,
      name: preset.name,
      text: preset.text,
      context: normalizeReplyContext(preset.context),
      items: promptItems(preset),
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `meme-phone-presets-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ctx.toast('预设已导出');
}

function importPresets(ctx) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const list = Array.isArray(raw) ? raw : (raw?.presets || raw?.reply?.presets || []);
      if (!Array.isArray(list) || !list.length) throw new Error('没有找到预设列表');
      const seen = new Set();
      const next = list.slice(0, 20).map((item, index) => {
        let id = String(item.id || newId('reply'));
        if (seen.has(id)) id = `${id}_${index}`;
        seen.add(id);
        return {
          id,
          name: String(item.name || '').trim().slice(0, 20) || `导入预设 ${index + 1}`,
          text: String(item.text || '').trim().slice(0, 3000),
          context: normalizeReplyContext(item.context),
          items: normalizeReplyItems(item.items, item.context),
        };
      });
      ctx.openSheet({
        kind: 'pick',
        title: '导入回复预设',
        note: `导入 ${next.length} 套会覆盖手机现有的 ${replyPresetsOf(ctx.state).length} 套`,
        items: [{ label: '覆盖导入', value: 'import', icon: 'refresh', danger: true }],
        onPick: value => {
          if (value !== 'import') return;
          ctx.state.settings.reply.presets = next;
          ctx.state.settings.reply.activeId = next[0].id;
          ctx.save();
          ctx.go('app-presets');
          ctx.toast(`已导入 ${next.length} 套预设`);
        },
      });
    } catch (error) {
      ctx.toast(`导入失败：${error?.message || '文件格式不对'}`);
    }
  };
  input.click();
}

function findPreset(state, id) {
  const list = replyPresetsOf(state);
  const target = String(id || '');
  /* 有 id 就必须精确命中：找不到就显示「这套预设不在了」，不静默退回第一套 */
  if (target) return list.find(item => item.id === target) || null;
  return list.find(item => item.id === state?.settings?.reply?.activeId) || list[0] || null;
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
          <span class="mp-row-sub">${esc(clip(preset.text || '还没写指令'))} · ${esc(itemNote(preset))} · ${esc(contextNote(preset))}</span>
        </span>
        ${icon('chevron')}
      </button>`).join('');

    return `
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <div class="mp-title" style="flex:1">回复预设</div>
          <button class="mp-icon-btn" data-act="reply-more" type="button" aria-label="导入导出">${icon('more')}</button>
          <button class="mp-icon-btn" data-act="reply-new" type="button" aria-label="新建预设">${icon('plus')}</button>
        </div>
        <div class="mp-subtitle">一套预设就是一条条提示词：回复指令、聊天行为、其他软件、上下文注入都在同一个列表里，能开关能排序</div>

        ${creating ? `
        <div class="mp-group mp-api-inline" style="margin-top:12px">
          <input id="mpReplyNewName" class="mp-api-input" type="text" maxlength="20" value="${esc(`${active?.name || '预设'} 副本`)}" placeholder="新预设叫什么">
          <button class="mp-draw-side is-primary" data-act="reply-new-save" type="button">创建</button>
          <button class="mp-draw-side" data-act="reply-new-cancel" type="button">取消</button>
        </div>` : ''}

        <div class="mp-group-label" style="margin-top:14px">手机默认 · ${list.length} 套</div>
        <div class="mp-group-box">
          ${rows || '<div class="mp-empty">还没有回复预设，点右上角新建一套。</div>'}
        </div>

        <div class="mp-api-note" style="margin-top:14px">
          预设只决定回复方式和注入的上下文，不存 API 地址、Key 或酒馆记忆本身；酒馆记忆仍按「记忆」里那套方案读取。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'reply-more') {
      ctx.openSheet({
        kind: 'pick',
        title: '预设管理',
        note: '导入导出的是整套预设，包含回复指令、条目和上下文开关',
        items: [
          { label: '导出预设', value: 'export', icon: 'book' },
          { label: '导入预设', value: 'import', icon: 'refresh' },
        ],
        onPick: value => {
          if (value === 'export') exportPresets(ctx);
          if (value === 'import') importPresets(ctx);
        },
      });
      return true;
    }

    if (act === 'reply-new') {
      creating = true;
      ctx.rerender();
      return true;
    }

    if (act === 'reply-new-cancel') {
      creating = false;
      ctx.rerender();
      return true;
    }

    if (act === 'reply-new-save') {
      const source = replyPresetFor(ctx.state, null);
      const input = globalThis.document?.getElementById('mpReplyNewName');
      const name = String(input?.value || '').trim().slice(0, 20) || '新预设';
      const preset = {
        id: newId('reply'),
        name,
        text: source?.text || '',
        context: normalizeReplyContext(source?.context),
        items: promptItems(source).map(item => ({ ...item })),
      };
      ctx.state.settings.reply.presets.push(preset);
      ctx.state.settings.reply.activeId = preset.id;
      editingId = preset.id;
      creating = false;
      resetPreview();
      ctx.save();
      ctx.go('reply-item', { id: preset.id });
      ctx.toast(`新建了「${name}」`);
      return true;
    }

    if (act === 'reply-open') {
      editingId = String(data.id || '');
      creating = false;
      resetPreview();
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
    if (editingId !== preset.id) {
      renaming = false;
      deleting = false;
    }
    editingId = preset.id;
    const chats = chatsOf(ctx.state);
    const previewChat = chats.find(chat => chat.id === preview.chatId) || chats[0] || null;
    const active = replyPresetFor(ctx.state, null);
    const isActive = active?.id === preset.id;
    const text = String(preset.text || '');
    const context = normalizeReplyContext(preset.context);
    const items = promptItems(preset);
    const contextCount = items.filter(item => item.kind === 'context').length;
    const itemRow = (item) => {
      const index = items.indexOf(item);
      const isContext = item.kind === 'context';
      const openAct = isContext ? 'reply-context-open' : 'reply-item-open';
      const chars = charactersLabel(item);
      const sub = isContext
        ? `${roleLabel(item.role)} · ${item.enabled ? '已启用' : '已关闭'} · ${contextItemNote(item, context)}${chars ? ` · ${chars}` : ''}`
        : `${roleLabel(item.role)} · ${item.enabled ? '已启用' : '已关闭'} · ${item.content.length} 字${chars ? ` · ${chars}` : ''}`;
      return `
      <div class="mp-preset-item${isContext ? ' is-context' : ''}">
        <button class="mp-preset-item-main" data-act="${openAct}" data-id="${esc(item.id)}" type="button">
          <span class="mp-preset-item-label"><span class="mp-preset-name">${esc(item.label)}</span><span class="mp-preset-tag${isContext ? ' is-context' : item.kind === 'app' ? ' is-app' : ''}">${esc(itemKindLabel(item))}</span></span>
          <span class="mp-preset-item-sub">${esc(sub)}</span>
        </button>
        <div class="mp-preset-item-actions">
          <button class="mp-item-switch" data-act="reply-item-toggle" data-id="${esc(item.id)}" type="button" title="${item.enabled ? '关闭' : '启用'}" role="switch" aria-checked="${item.enabled ? 'true' : 'false'}"><span class="mp-switch${item.enabled ? ' on' : ''}"></span></button>
          <button class="mp-item-mini is-up" data-act="reply-item-up" data-id="${esc(item.id)}" type="button" title="上移"${index === 0 ? ' disabled' : ''}>${icon('chevron')}</button>
          <button class="mp-item-mini" data-act="reply-item-down" data-id="${esc(item.id)}" type="button" title="下移"${index === items.length - 1 ? ' disabled' : ''}>${icon('chevron')}</button>
          ${item.deletable ? `<button class="mp-item-mini" data-act="reply-item-del" data-id="${esc(item.id)}" type="button" title="删除">${icon('trash')}</button>` : ''}
        </div>
      </div>`;
    };
    const itemRows = items.map(itemRow).join('');

    return `
      <div class="mp-nav">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
        <button class="mp-back" data-act="reply-item-reset" type="button" title="恢复默认条目">${icon('refresh')}</button>
        <button class="mp-back" data-act="reply-del" type="button" title="删除">${icon('trash')}</button>
      </div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">${esc(preset.name || '未命名预设')}</div>
        <div class="mp-subtitle">${isActive ? '手机现在默认用这套' : '只在聊天设置里选中它时生效'} · 条目按顺序拼进模型消息</div>

        ${deleting ? `
        <div class="mp-group mp-api-inline is-danger" style="margin-top:12px">
          <span class="mp-row-name" style="flex:1">删掉「${esc(preset.name || '这套预设')}」？</span>
          <button class="mp-draw-side is-danger" data-act="reply-del-confirm" type="button">删除</button>
          <button class="mp-draw-side" data-act="reply-del-cancel" type="button">取消</button>
        </div>` : ''}

        <div class="mp-group" style="margin-top:14px">
          ${renaming ? `
          <div class="mp-api-inline">
            <input id="mpReplyName" class="mp-api-input" type="text" maxlength="20" value="${esc(preset.name || '')}" placeholder="预设名字">
            <button class="mp-draw-side is-primary" data-act="reply-rename-save" type="button">确定</button>
            <button class="mp-draw-side" data-act="reply-rename-cancel" type="button">取消</button>
          </div>` : `
          <button class="mp-row" data-act="reply-field" data-key="name" type="button">
            <span class="mp-row-name" style="flex:none">名称</span>
            <span class="mp-api-value">${esc(preset.name || '没填')}</span>
            ${icon('chevron')}
          </button>`}
          <button class="mp-row" data-act="reply-field" data-key="text" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">回复指令</span>
              <span class="mp-row-sub mp-reply-preview">${esc(text || '还没写，模型会按默认方式回')}</span>
            </span>
            ${icon('chevron')}
          </button>
        </div>

        <div class="mp-group-head" style="margin-top:16px">
          <div class="mp-group-label">提示词条目 · ${items.length} 条${contextCount ? `（上下文 ${contextCount}）` : ''}</div>
          <button class="mp-icon-btn" data-act="reply-item-add" type="button" aria-label="添加提示词条目">${icon('plus')}</button>
        </div>
        <div class="mp-group mp-preset-list">
          ${itemRows || '<div class="mp-empty" style="padding:16px 14px">还没有条目，点上面的加号加一条。</div>'}
        </div>
        <div class="mp-api-note" style="margin-top:8px">
          带「上下文注入」的是手机按当前会话自动读取的条目，和手写条目在同一个列表里，可以开关、排序；点开还能改世界书、聊天记录和适用角色。
        </div>

        <div class="mp-group" style="margin-top:12px">
          <button class="mp-row" data-act="reply-budget" type="button">
            <span class="mp-row-main">
              <span class="mp-row-name">整套上下文预算</span>
              <span class="mp-row-sub">条目超过 ${context.charBudget} 字就不再继续塞，保证请求不会撑爆</span>
            </span>
            <span class="mp-api-value">${context.charBudget} 字</span>
            ${icon('chevron')}
          </button>
        </div>

        <div class="mp-group-head" style="margin-top:16px">
          <div class="mp-group-label">实际注入预览</div>
          <button class="mp-draw-side is-primary" data-act="reply-preview-run" type="button"${preview.loading ? ' disabled' : ''}>${preview.loading ? '组装中…' : '跑一遍'}</button>
        </div>
        ${chats.length ? `
        <div class="mp-select-wrap" style="margin:0 0 8px">
          <select data-act="reply-preview-chat">
            ${chats.map(chat => {
              const contact = ctx.state.contacts?.[chat.contactId];
              return `<option value="${esc(chat.id)}"${previewChat?.id === chat.id ? ' selected' : ''}>${esc(contact?.name || '未命名会话')} · ${esc(clip(chat.messages?.slice(-1)[0]?.text || '还没有消息', 18))}</option>`;
            }).join('')}
          </select>${icon('chevron')}
        </div>` : '<div class="mp-api-note">还没有会话，先回聊天发一条，再来预览。</div>'}
        ${previewHtml(preset)}

        <div class="mp-group-label" style="margin-top:16px">用在</div>
        <div class="mp-api-use">
          <button class="mp-api-use-btn${isActive ? ' is-on' : ''}" data-act="reply-use" type="button">
            ${icon('reply')}<span>${isActive ? '手机正在用' : '设为手机默认'}</span>
          </button>
        </div>

        <div class="mp-api-note" style="margin-top:14px">
          点「回复指令」改主指令；聊天行为条目会按角色接在它后面，其他软件条目单独存着，不会混进聊天回复。单个聊天可以在聊天设置里单独选一套。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    /* 条目动作里的 data.id 是条目 id，不是预设 id；详情页始终以 editingId 定位当前这套预设 */
    const preset = findPreset(ctx.state, editingId);
    if (!preset) return false;

    if (act === 'reply-rename-save') {
      const input = globalThis.document?.getElementById('mpReplyName');
      const name = String(input?.value || '').trim().slice(0, 20);
      if (name) preset.name = name;
      renaming = false;
      ctx.save();
      ctx.rerender();
      ctx.toast(name ? '名字改好了' : '名字没变');
      return true;
    }

    if (act === 'reply-rename-cancel') {
      renaming = false;
      ctx.rerender();
      return true;
    }

    if (act === 'reply-field') {
      const key = String(data.key || '');
      if (key === 'name') {
        renaming = true;
        ctx.rerender();
        return true;
      }
      if (key === 'text') {
        ctx.openSheet({
          kind: 'text', title: '告诉模型怎么回消息', value: preset.text || '',
          placeholder: '比如：像平时发微信一样，口语、短句，一次只回一两句，不要旁白和括号动作。',
          onText: text => {
            preset.text = String(text || '').trim().slice(0, 3000);
            resetPreview();
            ctx.save();
            ctx.rerender();
            ctx.toast('回复指令已更新');
          },
        });
        return true;
      }
    }

    if (act === 'reply-item-reset') {
      ctx.openSheet({
        kind: 'pick',
        title: '恢复默认条目',
        note: '会恢复整套默认条目，包括 7 条上下文注入；主回复指令不动',
        items: [{ label: '恢复默认条目', value: 'reset', icon: 'refresh', danger: true }],
        onPick: value => {
          if (value !== 'reset') return;
          preset.items = defaultReplyItems();
          preset.context = normalizeReplyContext({});
          resetPreview();
          ctx.save();
          ctx.rerender();
          ctx.toast('提示词条目已恢复默认');
        },
      });
      return true;
    }

    if (act === 'reply-item-add') {
      if (data.scope === 'chat' || data.scope === 'app') {
        openItemForm(ctx, preset, '', data.scope);
        return true;
      }
      ctx.openSheet({
        kind: 'pick',
        title: '加一类条目',
        note: '聊天行为只影响聊天回复；其他软件只给日历、外卖、音乐这类页面用',
        items: [
          { label: '聊天行为条目', value: 'chat', icon: 'chat', note: '聊天软件里的说法和习惯' },
          { label: '其他软件条目', value: 'app', icon: 'plan', note: '日历、外卖、音乐之类的提示' },
        ],
        onPick: value => {
          if (value !== 'chat' && value !== 'app') return;
          setTimeout(() => openItemForm(ctx, preset, '', value), 0);
        },
      });
      return true;
    }

    if (act === 'reply-item-open') {
      const item = promptItems(preset).find(candidate => candidate.id === data.id);
      if (item?.kind === 'context') {
        ctx.toast('这条是自动注入条目，点开关或条目本身可以调整');
        return true;
      }
      openItemForm(ctx, preset, String(data.id || ''));
      return true;
    }

    if (act === 'reply-context-open') {
      const item = promptItems(preset).find(candidate => candidate.id === data.id);
      if (!item || item.kind !== 'context') return false;
      const spec = REPLY_CONTEXT_SPECS[item.auto];
      const context = normalizeReplyContext(preset.context);
      const toggleLabel = item.enabled ? '关闭这条注入' : '开启这条注入';
      const toggle = () => {
        const next = !item.enabled;
        const items = promptItems(preset).map(candidate => candidate.id === item.id ? { ...candidate, enabled: next } : candidate);
        preset.items = items;
        setContextEnabled(preset, item.auto, next);
        resetPreview();
        ctx.save();
        ctx.rerender();
        ctx.toast(`${item.label}已${next ? '启用' : '关闭'}`);
      };
      const setNumber = (key, value, message) => {
        const nextContext = normalizeReplyContext(preset.context);
        nextContext[key] = value;
        preset.context = nextContext;
        resetPreview();
        ctx.save();
        ctx.rerender();
        ctx.toast(message);
      };

      if (item.auto === 'history') {
        ctx.openSheet({
          kind: 'pick',
          title: '手机聊天记录',
          note: `这条会按当前会话自动取最近几条消息；现在是 ${context.historyLimit} 条。`,
          items: [
            { label: toggleLabel, value: 'toggle', icon: item.enabled ? 'close' : 'plus' },
            ...[5, 10, 15, 20, 30].map(value => ({
              value: `n:${value}`,
              label: `保留最近 ${value} 条`,
              note: value === context.historyLimit ? '现在用的' : '',
            })),
            { label: '只对某些角色生效', value: 'characters', icon: 'contacts', note: charactersLabel(item) || '现在是全部角色' },
          ],
          onPick: value => {
            if (value === 'toggle') toggle();
            else if (value === 'characters') openCharactersForm(ctx, preset, item);
            else if (String(value).startsWith('n:')) {
              const count = Number(String(value).slice(2));
              setNumber('historyLimit', count, `聊天记录改成保留 ${count} 条`);
            }
          },
        });
        return true;
      }

      if (item.auto === 'lorebook') {
        ctx.openSheet({
          kind: 'pick',
          title: '人设世界书',
          note: `只读当前人设绑定的那本；常驻条目每次都进，关键词条目按最近 ${context.bookFloors} 条聊天匹配，单次最多 ${context.bookBudget} 字。`,
          items: [
            { label: toggleLabel, value: 'toggle', icon: item.enabled ? 'close' : 'plus' },
            ...[5, 10, 15, 20, 30].map(value => ({
              value: `f:${value}`,
              label: `关键词只看最近 ${value} 条聊天`,
              note: value === context.bookFloors ? '现在用的' : '',
            })),
            ...[800, 1200, 2000, 3000, 4000].map(value => ({
              value: `b:${value}`,
              label: `世界书最多 ${value} 字`,
              note: value === context.bookBudget ? '现在用的' : '',
            })),
            { label: '只对某些角色生效', value: 'characters', icon: 'contacts', note: charactersLabel(item) || '现在是全部角色' },
          ],
          onPick: value => {
            if (value === 'toggle') toggle();
            else if (value === 'characters') openCharactersForm(ctx, preset, item);
            else if (String(value).startsWith('f:')) {
              const count = Number(String(value).slice(2));
              setNumber('bookFloors', count, `世界书关键词改成看最近 ${count} 条`);
            } else if (String(value).startsWith('b:')) {
              const size = Number(String(value).slice(2));
              setNumber('bookBudget', size, `世界书上限改成 ${size} 字`);
            }
          },
        });
        return true;
      }

      ctx.openSheet({
        kind: 'pick',
        title: item.label,
        note: `${spec?.note || '手机读取当前数据'}。这条不用手写，内容跟着当前会话变。`,
        items: [
          { label: toggleLabel, value: 'toggle', icon: item.enabled ? 'close' : 'plus' },
          { label: '只对某些角色生效', value: 'characters', icon: 'contacts', note: charactersLabel(item) || '现在是全部角色' },
        ],
        onPick: value => {
          if (value === 'toggle') toggle();
          else if (value === 'characters') openCharactersForm(ctx, preset, item);
        },
      });
      return true;
    }

    if (act === 'reply-budget') {
      const context = normalizeReplyContext(preset.context);
      ctx.openSheet({
        kind: 'pick',
        title: '整套上下文预算',
        note: `条目按顺序往里装，累计超过预算的条目这次就不注入，避免请求太长把模型撑爆。现在是 ${context.charBudget} 字。`,
        items: [4000, 6000, 8000, 12000, 16000].map(value => ({
          value: `n:${value}`,
          label: `${value} 字`,
          note: value === context.charBudget ? '现在用的' : '',
        })),
        onPick: value => {
          if (!String(value).startsWith('n:')) return;
          const size = Number(String(value).slice(2));
          const nextContext = normalizeReplyContext(preset.context);
          nextContext.charBudget = size;
          preset.context = nextContext;
          resetPreview();
          ctx.save();
          ctx.rerender();
          ctx.toast(`整套预算改成 ${size} 字`);
        },
      });
      return true;
    }

    if (act === 'reply-preview-tab') {
      preview.tab = data.tab === 'flat' ? 'flat' : 'messages';
      ctx.rerender();
      return true;
    }

    if (act === 'reply-preview-chat') {
      const chatId = String(data.value || '');
      if (!chatsOf(ctx.state).some(chat => chat.id === chatId)) return true;
      preview = { presetId: '', tab: preview.tab || 'messages', chatId, loading: false, error: '', data: null, flat: '' };
      ctx.rerender();
      return true;
    }

    if (act === 'reply-preview-run') {
      const chats = chatsOf(ctx.state);
      const chat = chats.find(item => item.id === preview.chatId) || chats[0] || null;
      const contact = chat ? ctx.state.contacts?.[chat.contactId] || null : null;
      preview = { presetId: preset.id, tab: preview.tab || 'messages', chatId: chat?.id || '', loading: true, error: '', data: null, flat: '' };
      ctx.rerender();
      buildReplyMessages(ctx.state, chat, contact).then(result => {
        preview = {
          presetId: preset.id,
          tab: preview.tab || 'messages',
          chatId: chat?.id || '',
          loading: false,
          error: '',
          data: result,
          flat: tavernQuietPrompt(result.messages),
        };
        ctx.rerender();
      }).catch(error => {
        preview = { presetId: preset.id, tab: preview.tab || 'messages', chatId: chat?.id || '', loading: false, error: error?.message || '组装失败', data: null, flat: '' };
        ctx.rerender();
      });
      return true;
    }

    if (act === 'reply-del') {
      deleting = true;
      ctx.rerender();
      return true;
    }

    if (act === 'reply-del-cancel') {
      deleting = false;
      ctx.rerender();
      return true;
    }

    if (act === 'reply-del-confirm') {
      const list = replyPresetsOf(ctx.state);
      if (list.length <= 1) {
        deleting = false;
        ctx.rerender();
        ctx.toast('至少留一套回复预设');
        return true;
      }
      ctx.state.settings.reply.presets = list.filter(item => item.id !== preset.id);
      if (ctx.state.settings.reply.activeId === preset.id) {
        ctx.state.settings.reply.activeId = ctx.state.settings.reply.presets[0].id;
      }
      deleting = false;
      editingId = '';
      resetPreview();
      ctx.save();
      ctx.go('app-presets');
      ctx.toast('这套预设删掉了');
      return true;
    }

    if (act === 'reply-item-toggle') {
      const items = promptItems(preset);
      const index = items.findIndex(item => item.id === data.id);
      if (index < 0) return false;
      const next = { ...items[index], enabled: !items[index].enabled };
      items[index] = next;
      preset.items = items;
      if (next.kind === 'context' && next.auto) setContextEnabled(preset, next.auto, next.enabled);
      resetPreview();
      ctx.save();
      ctx.rerender();
      ctx.toast(`${next.label}已${next.enabled ? '启用' : '关闭'}`);
      return true;
    }

    if (act === 'reply-item-up' || act === 'reply-item-down') {
      const items = promptItems(preset);
      const index = items.findIndex(item => item.id === data.id);
      const target = act === 'reply-item-up' ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= items.length) return true;
      [items[index], items[target]] = [items[target], items[index]];
      items.forEach((item, order) => { item.order = order; });
      preset.items = items;
      resetPreview();
      ctx.save();
      ctx.rerender();
      ctx.toast('条目顺序已调整');
      return true;
    }

    if (act === 'reply-item-del') {
      const items = promptItems(preset);
      const item = items.find(candidate => candidate.id === data.id);
      if (!item) return false;
      if (item.deletable === false) {
        ctx.toast('这条是固定条目，不能删');
        return true;
      }
      ctx.openSheet({
        kind: 'pick',
        title: '删除提示词条目',
        note: `「${item.label}」不再拼进发给模型的提示词`,
        items: [{ label: '删除这条', value: 'delete', icon: 'trash', danger: true }],
        onPick: value => {
          if (value !== 'delete') return;
          preset.items = items.filter(candidate => candidate.id !== item.id);
          resetPreview();
          ctx.save();
          ctx.rerender();
          ctx.toast('条目已删除');
        },
      });
      return true;
    }

    if (act === 'reply-use') {
      ctx.state.settings.reply.activeId = preset.id;
      editingId = preset.id;
      ctx.save();
      ctx.rerender();
      ctx.toast(`手机默认改用「${preset.name}」`);
      return true;
    }

    return false;
  },
};
