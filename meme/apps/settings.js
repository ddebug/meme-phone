/**
 * meme-phone · 设置
 * 原来那个「加号菜单」里的东西，全部收进这里。
 */

import { icon, TINT } from '../icons.js';
import { esc, tintStyle } from '../shell.js';
import { contactsOf, chatsOf, unreadTotal } from '../data.js';

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

export const settingsApp = {
  id: 'settings', name: '设置', icon: 'settings',

  render(ctx) {
    const state = ctx.state;
    const host = ctx.shell.hostInfo || {};
    const apiReady = host.hasGenerate;
    const contacts = contactsOf(state).length;
    const image = state.settings.image || {};
    const imageLabel = image.engine === 'custom' ? '自定义接口' : image.engine === 'doubao' ? '豆包 · 火山方舟' : 'NovelAI 官方';
    const imageLink = image.engine === 'custom' ? (image.custom || {}) : image.engine === 'doubao' ? (image.doubao || {}) : (image.novelai || {});
    const imageReady = image.engine === 'custom' ? Boolean(imageLink.url) : Boolean(imageLink.key);

    return `
      <div class="mp-page-body">
        <div class="mp-title">设置</div>
        <div class="mp-subtitle">meme-phone · 0.1.0</div>

        <div class="mp-group">
          <div class="mp-group-label">账号</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'contacts', title: '用户', sub: `${state.settings.userMode === 'pin' ? '固定' : '跟随酒馆'} · ${state.settings.user.name}`, act: 'set-open', app: 'user' })}
            ${row(ctx, { iconName: 'brush', title: '外观与主题', sub: `${state.settings.wallpaper === 'none' ? '背景透明' : state.settings.wallpaper === 'day' ? '晨光粉彩' : '夜色'} · ${state.settings.theme === 'night' ? '夜间' : '日间'}`, act: 'set-open-appearance' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">聊天</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'bell', title: '消息提醒', sub: '有新消息时在图标上显示红点', act: 'set-toggle-remind', toggle: state.settings.chat.remind !== false })}
            ${row(ctx, { iconName: 'chat', title: '空着发送 = 让 TA 主动开口', sub: '不写空消息，只触发一句主动的话', act: 'set-toggle-wake', toggle: state.settings.chat.wake !== false })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">主动消息</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'spark', title: '让角色主动来找你', sub: state.settings.proactive.enabled ? `沉默 ${state.settings.proactive.idleMinutes} 分钟后，每天最多 ${state.settings.proactive.dailyCount} 次` : '已关闭', act: 'set-toggle-proactive', toggle: state.settings.proactive.enabled })}
            ${row(ctx, { iconName: 'clock', title: '沉默多久算久', sub: '到了就允许 TA 先说一句', act: 'set-idle', value: `${state.settings.proactive.idleMinutes} 分钟` })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">模型</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'code', title: 'API 设置', sub: apiReady ? '已接入酒馆当前模型' : '未接入（预览环境）', act: 'set-api', value: apiReady ? '已连接' : '未连接' })}
            ${row(ctx, { iconName: 'reply', title: '日记提示词', sub: '决定它怎么替你写日记', act: 'set-prompt' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">生成</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'image', title: '绘图', sub: imageReady ? `${imageLabel} · ${imageLink.model || '模型没填'}` : `${imageLabel} · 还没填${state.settings.image.engine === 'custom' ? '地址' : ' Key'}`, act: 'set-open', app: 'draw' })}
            ${row(ctx, { iconName: 'code', title: '聊天接口与预设', sub: '每套 = 地址 + Key + 模型，只影响聊天', act: 'set-open', app: 'api' })}
            ${row(ctx, { iconName: 'search', title: '查角色', sub: (state.charactersFromTavern ? `酒馆里 ${state.characters.length} 张角色卡` : '看酒馆里每张角色卡的设定'), act: 'set-open', app: 'characters' })}
            ${row(ctx, { iconName: 'book', title: '酒馆总结', sub: (typeof globalThis !== 'undefined' && globalThis.STBaiBaiBook ? '已接上：所有总结 / 人物 / 物品 / 场景 / 悬念' : '酒馆里的长期总结，装好后自动接管摘要'), act: 'set-open', app: 'book' })}
            ${row(ctx, { iconName: 'smile', title: '表情包', sub: '表情面板里那些贴纸', act: 'set-open', app: 'emoji' })}
            ${row(ctx, { iconName: 'help', title: '帮助', sub: '怎么用、快捷键、常见问题', act: 'set-open', app: 'help' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">数据</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'copy', title: '导出备份', sub: '一份 json，包含全部聊天与日记', act: 'set-export' })}
            ${row(ctx, { iconName: 'trash', title: '清空手机数据', sub: '联系方式、聊天、日记全部清掉', act: 'set-wipe' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">关于</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'help', title: '关于 meme-phone', sub: `${contacts} 位联系人 · ${chatsOf(state).length} 个会话 · ${unreadTotal(state)} 条未读`, act: 'set-about' })}
          </div>
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const state = ctx.state;

    if (act === 'set-open-appearance') { ctx.go('app-appearance'); return true; }

    if (act === 'set-open') {
      if (data?.app) ctx.go(`app-${data.app}`);
      return true;
    }

    if (act === 'set-toggle-remind') {
      state.settings.chat.remind = state.settings.chat.remind === false;
      ctx.save();
      ctx.rerender();
      return true;
    }

    if (act === 'set-toggle-wake') {
      state.settings.chat.wake = state.settings.chat.wake === false;
      ctx.save();
      ctx.rerender();
      return true;
    }

    if (act === 'set-toggle-proactive') {
      state.settings.proactive.enabled = !state.settings.proactive.enabled;
      ctx.save();
      ctx.rerender();
      return true;
    }

    if (act === 'set-idle') {
      ctx.openSheet({
        title: '沉默多久算久',
        items: [30, 60, 120, 240].map(min => ({ label: `${min} 分钟`, value: String(min) })),
        onPick: (value) => {
          state.settings.proactive.idleMinutes = Number(value);
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'set-api') {
      ctx.openSheet({
        title: '模型来源',
        items: [
          { label: '用酒馆当前的模型', value: 'host' },
          { label: '查看连接状态', value: 'status' },
        ],
        onPick: async (value) => {
          if (value === 'host') {
            const host = await ctx.host.probe();
            state.settings.api.source = host.hasGenerate ? 'host' : 'default';
            ctx.save();
            ctx.toast(host.hasGenerate ? '用的是酒馆的模型' : '预览环境没有模型，先看界面');
            ctx.rerender();
          }
          if (value === 'status') {
            const host = await ctx.host.probe();
            ctx.toast(host.inTavern ? `已接入酒馆 · 角色 ${host.hasCharacters ? '可读' : '不可读'} · 模型 ${host.hasGenerate ? '可用' : '不可用'}` : '预览环境：没有接酒馆，回复是演示文案');
          }
        },
      });
      return true;
    }

    if (act === 'set-prompt') {
      ctx.openSheet({
        kind: 'text', title: '日记怎么写', value: state.diary.prompt, placeholder: '给模型的指令…', confirm: '存下',
        onText: (text) => {
          state.diary.prompt = String(text || '').trim() || state.diary.prompt;
          ctx.save();
          ctx.toast('存好了');
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'set-export') {
      try {
        const blob = new Blob([ctx.store.exportJson()], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `meme-phone-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        ctx.toast('已导出');
      } catch { ctx.toast('导出失败'); }
      return true;
    }

    if (act === 'set-wipe') {
      ctx.openSheet({
        title: '清空之后不能恢复',
        items: [{ label: '我想清空', value: 'yes', icon: 'trash', danger: true }],
        onPick: async (value) => {
          if (value !== 'yes') return;
          ctx.reset();
          ctx.toast('已经清空');
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
    const theme = ctx.state.settings.theme;
    const wall = ctx.state.settings.wallpaper || 'none';

    const themes = [
      { key: 'day', title: '日间', sub: '浅色玻璃，白天看着干净', swatch: 'linear-gradient(150deg,#ffffff,#f3edfa 60%,#eef7f3)' },
      { key: 'night', title: '夜间', sub: '深色玻璃，晚上不刺眼', swatch: 'linear-gradient(150deg,#3a3454,#221d38 60%,#36304f)' },
    ];

    const walls = [
      { key: 'none', title: '透明', sub: '不铺底色，直接透出酒馆自己的背景', swatch: 'repeating-conic-gradient(rgba(160,150,200,.18) 0% 25%, rgba(255,255,255,0) 0% 50%) 50% / 16px 16px' },
      { key: 'day', title: '晨光粉彩', sub: '樱粉与薄荷的柔光壁纸', swatch: 'linear-gradient(150deg,#ffe3ef,#e4f7f0 55%,#efe6ff)' },
      { key: 'night', title: '夜色', sub: '深墨蓝到紫罗兰的流体光带', swatch: 'linear-gradient(150deg,#1a1f2b,#2b2350 60%,#0a0c11)' },
    ];

    const row = (item, act, dataKey) => `
      <button class="mp-row" data-act="${act}" data-${dataKey}="${item.key}" type="button" style="padding:12px;align-items:flex-start">
        <span style="width:66px;height:66px;border-radius:16px;flex:0 0 auto;background:${item.swatch};box-shadow:var(--shadow-s)"></span>
        <span class="mp-row-main">
          <span class="mp-row-name">${esc(item.title)}${wall === item.key ? '<span class="mp-pill">当前</span>' : ''}</span>
          <span class="mp-row-sub" style="white-space:normal">${esc(item.sub)}</span>
        </span>
      </button>`;

    return `
      <div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button><span style="flex:1"></span></div>
      <div class="mp-page-body">
        <div class="mp-title" style="margin-top:0">外观</div>
        <div class="mp-subtitle">背景、主题与图标</div>

        <div class="mp-group-label" style="margin-top:10px">背景</div>
        ${walls.map(item => row(item, 'pick-wall', 'wall')).join('')}

        <div class="mp-group-label" style="margin-top:14px">主题</div>
        <div style="display:flex;gap:8px">
          ${themes.map(item => `
            <button class="mp-chip-btn${theme === item.key ? ' is-on' : ''}" data-act="pick-theme" data-theme="${item.key}" type="button" style="flex:1">
              <span style="width:22px;height:22px;border-radius:7px;background:${item.swatch};box-shadow:inset 0 0 0 1px rgba(120,110,170,.16)"></span>
              <span style="display:flex;flex-direction:column;gap:2px;text-align:left">
                <span style="font-size:12.5px">${esc(item.title)}</span>
                <span style="font-size:10.5px;color:var(--text-3)">${esc(item.sub)}</span>
              </span>
            </button>`).join('')}
        </div>

        <div class="mp-group-label" style="margin-top:14px">图标</div>
        <div class="mp-group-box" style="padding:14px">
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;justify-items:center">
            ${Object.keys(TINT).slice(0, 8).map(key => `<span style="width:44px;height:44px;border-radius:13px;display:grid;place-items:center;${tintStyle(key)};box-shadow:var(--shadow-s)">${icon(key === 'membership' ? 'crown' : key)}</span>`).join('')}
          </div>
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'pick-theme') {
      ctx.state.settings.theme = data.theme;
      ctx.save();
      ctx.rerender();
      ctx.toast(data.theme === 'night' ? '夜间玻璃已打开' : '换回日间玻璃');
      return true;
    }
    if (act === 'pick-wall') {
      ctx.state.settings.wallpaper = data.wall;
      ctx.save();
      ctx.rerender();
      ctx.toast(data.wall === 'none' ? '背景已透明' : data.wall === 'day' ? '换成晨光粉彩壁纸' : '换成夜色壁纸');
      return true;
    }
    return false;
  },
};
