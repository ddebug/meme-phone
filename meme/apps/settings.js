/**
 * meme-phone · 设置
 * 原来那个「加号菜单」里的东西，全部收进这里。
 */

import { icon, TINT } from '../icons.js';
import { esc, tintStyle } from '../shell.js';
import { contactsOf, chatsOf, unreadTotal } from '../data.js';
import { imageEndpoint } from './draw.js';

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
    const image = imageEndpoint(state);
    const imageLabel = image.engine === 'custom' ? '自定义接口' : image.engine === 'doubao' ? '豆包 · 火山方舟' : 'NovelAI 官方';
    const imageReady = image.engine === 'custom' ? Boolean(image.url) : Boolean(image.url && image.key);
    const wallLabel = state.settings.wallpaper === 'none' ? '素色底'
      : state.settings.wallpaper === 'day' ? '晨光粉彩'
        : state.settings.wallpaper === 'night' ? '夜色'
          : '自定义壁纸';

    return `
      <div class="mp-page-body">
        <div class="mp-title">设置</div>
        <div class="mp-subtitle">meme-phone · 0.1.0</div>

        <div class="mp-group">
          <div class="mp-group-label">账号</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'contacts', title: '用户', sub: `${state.settings.userMode === 'pin' ? '固定' : '跟随酒馆'} · ${state.settings.user.name}`, act: 'set-open', app: 'user' })}
            ${row(ctx, { iconName: 'brush', title: '装扮与主题', sub: `${wallLabel} · ${state.settings.theme === 'night' ? '夜间' : '日间'} · 字体与图标`, act: 'set-open-dress' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">聊天</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'bell', title: '消息提醒', sub: '有新消息时在图标上显示红点', act: 'set-toggle-remind', toggle: state.settings.chat.remind !== false })}
            ${row(ctx, { iconName: 'chat', title: '空着发送 = 让 TA 主动开口', sub: '不写空消息，只触发一句主动的话', act: 'set-toggle-wake', toggle: state.settings.chat.wake !== false })}
            ${row(ctx, { iconName: 'reply', title: '回复预设', sub: '告诉模型该怎么回消息，可多套切换', act: 'set-open', app: 'presets' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">主动开口</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'spark', title: '允许主动开口', sub: state.settings.proactive.enabled ? '开着：空发送可以触发；没有定时任务' : '已关闭：空发送不会触发', act: 'set-toggle-proactive', toggle: state.settings.proactive.enabled })}
            ${row(ctx, { iconName: 'clock', title: '空发送时参考沉默多久', sub: '写进主动开口的提示，不会自己定时发消息', act: 'set-idle', value: `${state.settings.proactive.idleMinutes} 分钟` })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">模型</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'code', title: '酒馆连接', sub: apiReady ? '酒馆模型可用；聊天接口在「聊天接口与预设」里改' : '未接入（预览环境）；聊天接口在「聊天接口与预设」里改', act: 'set-host-status', value: apiReady ? '已连接' : '未连接' })}
            ${row(ctx, { iconName: 'reply', title: '日记提示词', sub: '决定它怎么替你写日记', act: 'set-prompt' })}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">生成</div>
          <div class="mp-group-box">
            ${row(ctx, { iconName: 'image', title: '绘图', sub: imageReady ? `${imageLabel} · ${image.model || '模型没填'}` : `${imageLabel} · 还没填${image.engine === 'custom' ? '地址' : ' Key'}`, act: 'set-open', app: 'draw' })}
            ${row(ctx, { iconName: 'code', title: '聊天接口与预设', sub: '每套 = 地址 + Key + 模型，只影响聊天', act: 'set-open', app: 'api' })}
            ${row(ctx, { iconName: 'search', title: '查角色', sub: (state.charactersFromTavern ? `酒馆里 ${state.characters.length} 张角色卡` : '看酒馆里每张角色卡的设定'), act: 'set-open-cards' })}
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

    if (act === 'set-open-dress') { ctx.go('app-dress'); return true; }
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

    if (act === 'set-toggle-wake') {
      state.settings.chat.wake = state.settings.chat.wake === false;
      ctx.save();
      ctx.rerender();
      ctx.toast(state.settings.chat.wake ? '空发送可以触发主动开口' : '空发送不再触发');
      return true;
    }

    if (act === 'set-toggle-proactive') {
      state.settings.proactive.enabled = !state.settings.proactive.enabled;
      ctx.save();
      ctx.rerender();
      ctx.toast(state.settings.proactive.enabled ? '允许主动开口了' : '主动开口关掉了');
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

    if (act === 'set-host-status') {
      ctx.host.probe().then(host => {
        ctx.toast(host.inTavern
          ? `已接入酒馆 · 角色 ${host.hasCharacters ? '可读' : '不可读'} · 模型 ${host.hasGenerate ? '可用' : '不可用'}`
          : '预览环境：没有接酒馆，回复是演示文案');
      }).catch(() => ctx.toast('读不到酒馆连接状态'));
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
    const customWall = ctx.state.settings.customWall || '';

    const walls = [
      { key: 'none', title: '素色', sub: '不铺图片，屏幕里用干净的浅色纸（壳外仍透出酒馆）', swatch: 'repeating-conic-gradient(rgba(160,150,200,.18) 0% 25%, rgba(255,255,255,0) 0% 50%) 50% / 16px 16px' },
      { key: 'day', title: '晨光粉彩', sub: '樱粉与薄荷的柔光壁纸', swatch: 'linear-gradient(150deg,#ffe3ef,#e4f7f0 55%,#efe6ff)' },
      { key: 'night', title: '夜色', sub: '深墨蓝到紫罗兰的流体光带', swatch: 'linear-gradient(150deg,#1a1f2b,#2b2350 60%,#0a0c11)' },
      { key: 'custom', title: '自定义', sub: customWall ? '用你选的那张图，只铺在手机屏幕里' : '从相册选一张图，壳外仍然透明', swatch: customWall ? `url("${customWall}") center / cover` : 'linear-gradient(150deg,#e7e1f7,#f7e8ef 55%,#e8f5f2)' },
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
        <div class="mp-title" style="margin-top:0">壁纸与主题</div>
        <div class="mp-subtitle">背景和明暗；字体、灵动岛与图标在「装扮」里</div>

        <div class="mp-group-label" style="margin-top:10px">背景</div>
        ${walls.map(item => row(item, 'pick-wall', 'wall')).join('')}
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="mp-btn" data-act="choose-custom-wall" type="button" style="flex:1">
            ${icon('image')}<span style="margin-left:6px">${customWall ? '换一张图' : '从相册选一张'}</span>
          </button>
          ${customWall ? `<button class="mp-btn" data-act="remove-custom-wall" type="button" style="flex:0 0 auto;padding:0 16px">删除</button>` : ''}
        </div>
        <input id="mpWallFile" type="file" accept="image/*" style="display:none">
        <div class="mp-subtitle" style="margin-top:6px;font-size: calc(11.5px * var(--font-scale))">图片会存进小手机存档，导出备份时一起带走；只铺在屏幕里。</div>

        <div class="mp-group-label" style="margin-top:14px">主题</div>
        <button class="mp-set-row" data-act="pick-theme" data-theme="${theme === 'night' ? 'day' : 'night'}" type="button">
          <span class="mp-set-ico">${icon('moon')}</span>
          <span class="mp-set-name">夜间玻璃<small>${theme === 'night' ? '现在是深色，晚上不刺眼' : '现在是日间浅色，打开后换成深色'}</small></span>
          <span class="mp-switch${theme === 'night' ? ' on' : ''}"></span>
        </button>

        <button class="mp-dress-link" data-act="set-open-dress" type="button">${icon('brush')}字体、灵动岛和 App 图标去「装扮」换</button>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'set-open-dress') { ctx.go('app-dress'); return true; }
    if (act === 'pick-theme') {
      const next = data.theme === 'night' ? 'night' : 'day';
      ctx.state.settings.theme = next;
      /* 图片壁纸跟着明暗一起走，免得选了夜间还是一屏亮壁纸；自定义图不跟着换 */
      if (!['none', 'custom'].includes(ctx.state.settings.wallpaper)) ctx.state.settings.wallpaper = next;
      ctx.rerender();
      ctx.save();
      ctx.toast(next === 'night' ? '夜间玻璃已打开' : '换回日间玻璃');
      return true;
    }
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
        : wall === 'day' ? '换成晨光粉彩壁纸'
          : wall === 'night' ? '换成夜色壁纸' : '换成自定义壁纸');
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
