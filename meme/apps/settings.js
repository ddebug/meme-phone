/**
 * meme-phone · 设置
 * 原来那个「加号菜单」里的东西，全部收进这里。
 */

import { icon, TINT } from '../icons.js';
import { esc } from '../shell.js';
import { proactivePromptFor, normalizeProactivePrompt } from '../data.js';
import { PROACTIVE_PROMPT_MAX_LENGTH } from '../preset-defaults.js';
import { openParallelRoom } from '../room.js';

function downloadBackup(ctx, includeKeys) {
  try {
    const blob = new Blob([ctx.store.exportJson(includeKeys)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `meme-phone-${new Date().toISOString().slice(0, 10)}${includeKeys ? '-with-keys' : ''}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ctx.toast(includeKeys ? '已导出（含接口 Key）' : '已导出（不含接口 Key）');
  } catch { ctx.toast('导出失败'); }
}

function backupSummary(parsed) {
  const state = parsed && typeof parsed === 'object' && parsed.meme ? parsed.meme : parsed;
  if (!state || typeof state !== 'object') return { ok: false };
  const chats = Object.values(state.chats || {});
  const theaters = Object.values(state.theaters || {});
  return {
    ok: true,
    contacts: Object.keys(state.contacts || {}).length,
    chats: chats.length,
    scenes: theaters.length,
    messages: chats.reduce((sum, chat) => sum + (chat.messages?.length || 0), 0)
      + theaters.reduce((sum, theater) => sum + (theater.messages?.length || 0), 0),
    diary: Object.keys(state.diary?.entries || {}).length,
    favorites: (state.favorites || []).length,
  };
}

function row(ctx, { iconName, title, sub, act, value, toggle, app }) {
  return `
    <button class="mp-set-row" data-act="${act || 'noop'}"${app ? ` data-app="${app}"` : ''} type="button">
      <span class="mp-set-ico">${icon(iconName)}</span>
      <span class="mp-set-name">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${toggle !== undefined
        ? `<span class="mp-switch${toggle ? ' on' : ''}"></span>`
        : value ? `<span class="mp-set-value">${esc(value)}</span>` : ''}
      ${toggle === undefined ? `<span style="color:var(--text-4)">${icon('chevron')}</span>` : ''}
    </button>`;
}

async function saveProactivePrompt(ctx, value) {
  const prompt = normalizeProactivePrompt(value);
  if (ctx.state.settings.proactive.prompt !== prompt) {
    ctx.state.settings.proactive.prompt = prompt;
    ctx.ai?.clearPreview?.();
  }
  try { return await ctx.save() !== false; }
  catch (error) {
    ctx.toast(error?.message || '保存失败，提示词草稿已保留');
    return false;
  }
}

function openProactivePromptEditor(ctx, draft = proactivePromptFor(ctx.state)) {
  const custom = Boolean(normalizeProactivePrompt(ctx.state.settings.proactive.prompt));
  ctx.openSheet({
    kind: 'form',
    title: `主动开口提示词 · ${custom ? '自定义' : '默认'}`,
    confirm: '保存',
    fields: [{
      name: 'prompt', type: 'textarea', label: '空着发送时，告诉 TA 怎么主动开口',
      value: draft, maxLength: PROACTIVE_PROMPT_MAX_LENGTH,
      placeholder: '留空保存即恢复默认提示词',
      hint: `可用 {{char}}、{{user}}、{{当前时间}}、{{间隔时长}}、{{沉默阈值}}。间隔时长是最近一条用户消息距今，缺失时为“未知”；沉默阈值仅作参考，不会新增定时消息。最多 ${PROACTIVE_PROMPT_MAX_LENGTH} 字，留空保存即恢复默认。`,
    }],
    onForm: async values => {
      const draft = typeof values.prompt === 'string' ? values.prompt : '';
      if (!await saveProactivePrompt(ctx, draft)) {
        // 外壳提交时已关掉表单；保存失败重新打开，保留这次输入供重试。
        openProactivePromptEditor(ctx, draft);
        return;
      }
      ctx.rerender();
      ctx.toast(normalizeProactivePrompt(draft) ? '主动开口提示词已保存' : '已使用默认主动开口提示词');
    },
  });
}

export const settingsApp = {
  id: 'settings', name: '设置', icon: 'settings',

  render(ctx) {
    const state = ctx.state;
    const host = ctx.shell.hostInfo || {};
    const apiReady = host.hasGenerate;
    const customProactivePrompt = Boolean(normalizeProactivePrompt(state.settings.proactive.prompt));

    const worlds = ctx.world?.list?.() || [];

    return `
      <div class="mp-page-body">

        <div class="mp-group">
          <div class="mp-group-label">身份与外观</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'contacts', title: '用户', value: state.settings.user.name || '还没选', act: 'set-open', app: 'user' })}
            ${row(ctx, { iconName: 'brush', title: '装扮与主题', act: 'set-open-dress' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">同层小手机</div>
          <div class="mp-group-box">
            ${row(ctx, {
              iconName: 'chat-world',
              title: '默认进入聊天记录聊天',
              sub: '打开手机时直接落到当前酒馆聊天对应的同层小手机',
              act: 'set-toggle-world-auto',
              toggle: state.settings.world?.autoEnter !== false,
            })}
            ${row(ctx, {
              iconName: 'book',
              title: '同层小手机列表',
              sub: worlds.length ? `${worlds.length} 条 · 每条单独绑一份酒馆聊天记录` : '还没有 · 从当前酒馆聊天新建',
              act: 'set-world-list',
            })}
            ${row(ctx, {
              iconName: 'plus',
              title: '从当前酒馆聊天新建',
              sub: '读那一份记忆，聊完写回那份隐藏楼层',
              act: 'set-world-new',
            })}
            ${row(ctx, { iconName: 'parallel', title: '创建番外', sub: '从当前酒馆聊天分一条平行时间线', act: 'set-world-branch' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">AI 设置 · 连接</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'code', title: '酒馆连接', value: apiReady ? '已连接' : '未连接', act: 'set-host-status' })}
            ${row(ctx, { iconName: 'code', title: '聊天接口与预设', act: 'set-open', app: 'api' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">AI 设置 · 怎么回复</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'reply', title: '回复预设', act: 'set-open', app: 'presets' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">主动开口</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'reply', title: '主动开口提示词', value: customProactivePrompt ? '自定义' : '默认', act: 'set-proactive-prompt' })}
            ${row(ctx, { iconName: 'clock', title: '空发送时参考沉默多久', value: `${state.settings.proactive.idleMinutes} 分钟`, act: 'set-idle' })}
            ${customProactivePrompt ? row(ctx, { iconName: 'reply', title: '恢复默认提示词', act: 'set-proactive-prompt-reset' }) : ''}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">AI 设置 · 参考什么材料</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'book', title: '手机读法', act: 'set-toggle-memory-read', toggle: state.settings.memory.readMode !== 'recent' })}
            ${row(ctx, { iconName: 'search', title: '酒馆角色', act: 'set-open-cards' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">生成与玩法</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'image', title: '绘图', act: 'set-open', app: 'draw' })}
            ${row(ctx, { iconName: 'smile', title: '表情包', act: 'set-open', app: 'emoji' })}
            ${row(ctx, { iconName: 'bookmark', title: '收藏', value: `${(state.favorites || []).length} 条`, act: 'set-open', app: 'favorites' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">数据与备份</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'copy', title: '导出备份', act: 'set-export' })}
            ${row(ctx, { iconName: 'upload', title: '从备份恢复', act: 'set-import' })}
            ${row(ctx, { iconName: 'trash', title: '清空手机数据', act: 'set-wipe' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">高级与帮助</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'bell', title: '消息提醒', act: 'set-toggle-remind', toggle: state.settings.chat.remind !== false })}
            ${row(ctx, { iconName: 'code', title: '请求调试栏', act: 'set-toggle-debug', toggle: state.settings.chat.debugBar === true })}
            ${row(ctx, { iconName: 'help', title: '帮助', act: 'set-open', app: 'help' })}
            ${row(ctx, { iconName: 'help', title: '关于 meme-phone', act: 'set-about' })}
          </div>
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const state = ctx.state;

    if (act === 'set-open-dress') { ctx.go('app-dress'); return true; }
    if (act === 'set-world-list') {
      const worlds = ctx.world?.list?.() || [];
      if (!worlds.length) { ctx.toast('还没有同层小手机；先在酒馆打开一段聊天，再从当前聊天新建'); return true; }
      ctx.openSheet({
        title: `同层小手机 · ${worlds.length} 条`,
        note: '每一条都单独绑一份酒馆聊天记录：只读那份记忆，只写回那份。',
        items: worlds
          .slice()
          .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))
          .slice(0, 20)
          .map(chat => ({
            label: `${chat.world.ownerName || '这一条'} · ${chat.world.storyDate || '第 1 天'}`,
            value: chat.id,
            icon: 'book',
            note: `《${chat.world.chatFile || '没有绑定聊天'}》`,
          })),
        onPick: (id) => {
          ctx.world?.open?.(id);
        },
      });
      return true;
    }
    if (act === 'set-world-new') {
      ctx.world?.createFromCurrent?.();
      return true;
    }
    if (act === 'set-world-branch') { openParallelRoom(ctx); return true; }

    if (act === 'set-toggle-world-auto') {
      state.settings.world = state.settings.world || { autoEnter: true };
      state.settings.world.autoEnter = state.settings.world.autoEnter === false;
      ctx.save();
      ctx.rerender();
      ctx.toast(state.settings.world.autoEnter
        ? '以后打开手机直接进当前聊天对应的同层小手机'
        : '以后打开手机停在桌面，不自动进同层小手机');
      return true;
    }
    if (act === 'set-open-appearance') { ctx.go('app-appearance'); return true; }
    if (act === 'set-open-cards') { ctx.go('app-contacts', { tab: 'cards' }); return true; }

    if (act === 'set-open') {
      if (data?.app) ctx.go(`app-${data.app}`);
      return true;
    }

    if (act === 'set-toggle-remind') {
      state.settings.chat.remind = state.settings.chat.remind === false;
      ctx.save();
      ctx.rerender();
      ctx.toast(state.settings.chat.remind ? '有新消息会显示未读角标' : '全局不显示未读角标，会话免打扰仍然有效');
      return true;
    }

    if (act === 'set-toggle-debug') {
      state.settings.chat.debugBar = state.settings.chat.debugBar !== true;
      ctx.save();
      ctx.rerender();
      ctx.toast(state.settings.chat.debugBar ? '聊天输入栏上方会显示请求预览' : '请求调试栏已关掉');
      return true;
    }

    if (act === 'set-toggle-memory-read') {
      const store = state.settings.memory;
      store.readMode = store.readMode === 'recent' ? 'summary' : 'recent';
      ctx.save();
      ctx.rerender();
      ctx.toast(store.readMode === 'recent'
        ? '手机读法改成最近原文；按角色单独切过的仍然按开关'
        : '手机读法改成总结优先；没有总结时读最近原文');
      return true;
    }

    if (act === 'set-proactive-prompt') {
      openProactivePromptEditor(ctx);
      return true;
    }

    if (act === 'set-proactive-prompt-reset') {
      if (!normalizeProactivePrompt(ctx.state.settings.proactive.prompt)) return true;
      ctx.openSheet({
        title: '恢复默认主动开口提示词？',
        items: [{ label: '恢复默认提示词', value: 'restore', icon: 'reply', note: '只恢复这段提示词，沉默参考和其他设置都不变。' }],
        onPick: async value => {
          if (value !== 'restore') return;
          if (!await saveProactivePrompt(ctx, '')) {
            openProactivePromptEditor(ctx);
            return;
          }
          ctx.rerender();
          ctx.toast('已恢复默认主动开口提示词');
        },
      });
      return true;
    }

    if (act === 'set-idle') {
      ctx.openSheet({
        title: '沉默多久算久',
        items: [30, 60, 120, 240].map(min => ({ label: `${min} 分钟`, value: String(min) })),
        onPick: async value => {
          ctx.state.settings.proactive.idleMinutes = Number(value);
          ctx.ai?.clearPreview?.();
          await ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'set-host-status') {
      ctx.host.probe().then(host => {
        ctx.toast(host.inTavern
          ? `已接入酒馆 · 角色 ${host.hasCharacters ? '可读' : '不可读'} · 模型 ${host.hasGenerate ? '可用' : '不可用'}`
          : '预览环境：没有接酒馆，回复是演示文案');
      }).catch(() => ctx.toast('读不到酒馆连接状态'));
      return true;
    }

    if (act === 'set-export') {
      ctx.openSheet({
        title: '导出备份',
        items: [
          { label: '不含接口 Key（推荐）', value: 'no-keys', icon: 'download', note: '联系人、会话、日记、预设都导出；连接凭据留在本机' },
          { label: '包含接口 Key', value: 'with-keys', icon: 'shield', danger: true, note: '会把接口密钥写进文件，分享前先确认' },
        ],
        onPick: (value) => downloadBackup(ctx, value === 'with-keys'),
      });
      return true;
    }

    if (act === 'set-import') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        let parsed;
        try { parsed = JSON.parse(await file.text()); }
        catch { ctx.toast('备份格式不对，当前数据未改动'); return; }
        const summary = backupSummary(parsed);
        if (!summary.ok) { ctx.toast('备份格式不对，当前数据未改动'); return; }
        ctx.openSheet({
          title: '恢复这份备份？',
          items: [{
            label: `联系人 ${summary.contacts} · 会话 ${summary.chats} · 平行时空 ${summary.scenes} 场 · 消息 ${summary.messages} · 日记 ${summary.diary} · 收藏 ${summary.favorites}`,
            value: 'confirm',
            icon: 'upload',
            note: '不含 Key 的备份恢复后，本机现有连接凭据保留不变；确认后覆盖当前数据。',
          }],
          onPick: async (value) => {
            if (value !== 'confirm') return;
            const result = await ctx.importBackup(parsed);
            if (!result.ok) { ctx.toast(result.error || '恢复失败，当前数据未改动'); return; }
            ctx.toast('已恢复备份');
            ctx.rerender();
          },
        });
      };
      input.click();
      return true;
    }

    if (act === 'set-wipe') {
      ctx.openSheet({
        title: '清空之后不能恢复',
        items: [{ label: '我想清空', value: 'yes', icon: 'trash', danger: true }],
        onPick: async (value) => {
          if (value !== 'yes') return;
          await ctx.reset();
        },
      });
      return true;
    }

    if (act === 'set-about') {
      ctx.toast('meme-phone 0.1.0 · 桌面 + App 形态，前端整套重写');
      return true;
    }

    return false;
  },
};

export const appearanceApp = {
  id: 'appearance', name: '外观', icon: 'brush',

  render(ctx) {
    const wall = ctx.state.settings.wallpaper || 'none';
    const customWall = ctx.state.settings.customWall || '';

    const walls = [
      { key: 'none', title: '素色', swatch: 'repeating-conic-gradient(rgba(160,150,200,.18) 0% 25%, rgba(255,255,255,0) 0% 50%) 50% / 16px 16px' },
      { key: 'day', title: '晨光素色', swatch: 'linear-gradient(160deg,#fbf7ff,#f2f5fd 48%,#f6faf5)' },
      { key: 'night', title: '夜色素色', swatch: 'linear-gradient(160deg,#191627,#141222 52%,#0f141a)' },
      { key: 'custom', title: '自定义', swatch: customWall ? `url("${customWall}") center / cover` : 'linear-gradient(150deg,#e7e1f7,#f7e8ef 55%,#e8f5f2)' },
    ];

    const row = (item, act, dataKey) => `
      <button class="mp-row" data-act="${act}" data-${dataKey}="${item.key}" type="button" style="padding:12px;align-items:center">
        <span style="width:66px;height:66px;border-radius:16px;flex:0 0 auto;background:${item.swatch};box-shadow:var(--shadow-s)"></span>
        <span class="mp-row-main">
          <span class="mp-row-name">${esc(item.title)}${wall === item.key ? '<span class="mp-pill">当前</span>' : ''}</span>
        </span>
      </button>`;

    return `
      <div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button><span style="flex:1"></span></div>
      <div class="mp-page-body">
        <div class="mp-group-label" style="margin-top:0">背景</div>
        ${walls.map(item => row(item, 'pick-wall', 'wall')).join('')}
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="mp-btn" data-act="choose-custom-wall" type="button" style="flex:1">
            ${icon('image')}<span style="margin-left:6px">${customWall ? '换一张图' : '从相册选一张'}</span>
          </button>
          ${customWall ? `<button class="mp-btn" data-act="remove-custom-wall" type="button" style="flex:0 0 auto;padding:0 16px">${icon('trash')}<span>删除</span></button>` : ''}
        </div>
        <input id="mpWallFile" type="file" accept="image/*" style="display:none">

        <button class="mp-dress-link" data-act="set-open-dress" type="button">${icon('brush')}换明暗、字体、灵动岛和 App 图标</button>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'set-open-dress') { ctx.go('app-dress'); return true; }
    if (act === 'pick-wall') {
      if (data.wall === 'custom' && !ctx.state.settings.customWall) {
        document.getElementById('mpWallFile')?.click();
        return true;
      }
      const wall = ['none', 'day', 'night', 'custom'].includes(data.wall) ? data.wall : 'none';
      ctx.state.settings.wallpaper = wall;
      if (ctx.state.settings.dress) ctx.state.settings.dress.theme = 'default';
      if (wall === 'day') ctx.state.settings.theme = 'day';
      if (wall === 'night') ctx.state.settings.theme = 'night';
      ctx.rerender();
      ctx.save();
      ctx.toast(wall === 'none' ? '屏幕内换成素色底'
        : wall === 'day' ? '换成晨光素色'
          : wall === 'night' ? '换成夜色素色' : '换成自定义壁纸');
      return true;
    }
    if (act === 'choose-custom-wall') {
      document.getElementById('mpWallFile')?.click();
      return true;
    }
    if (act === 'remove-custom-wall') {
      ctx.state.settings.customWall = '';
      if (ctx.state.settings.wallpaper === 'custom') ctx.state.settings.wallpaper = 'day';
      ctx.rerender();
      ctx.save();
      ctx.toast('已删掉自定义壁纸');
      return true;
    }
    return false;
  },
};
