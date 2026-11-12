/**
 * meme-phone · 外壳
 *
 * 一个桌面（小组件 + App 图标 + Dock）、一层页面栈、一套弹层与提示。
 * 页面本身在 apps/ 里，这里只负责：渲染容器、路由、事件分发、状态保存。
 */

import { icon as ico, TINT } from './icons.js';
import { PIXEL_BUNNY } from './theme-data.js';
import {
  chatsOf, chatById, lastMessage, contactById, latestDiary, unreadTotal, dayKey,
} from './data.js';

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function clockText(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/* 壁纸：none / day / night / custom。自定义图直接作为 CSS 变量铺进壳内 */
export function applyWall(root, settings) {
  if (!root || !settings) return;
  const wall = ['none', 'day', 'night', 'custom'].includes(settings.wallpaper) ? settings.wallpaper : 'none';
  root.dataset.mpWall = wall;
  if (wall === 'custom' && settings.customWall) {
    root.style.setProperty('--wall-custom', `url("${settings.customWall}")`);
  } else {
    root.style.removeProperty('--wall-custom');
  }
  /* 像素小兔主题自带壁纸，不改用户自己的自定义壁纸存档 */
  if (settings.dress?.theme === 'pixel') {
    root.style.setProperty('--wall-theme', `url("${PIXEL_BUNNY.wallpaper}")`);
  } else {
    root.style.removeProperty('--wall-theme');
  }
}

/* 装扮：字体、字号、行距、字重、灵动岛。所有值都用 CSS 变量，换页不会重排手机壳。 */
const FONT_STACKS = {
  system: ['-apple-system, "SF Pro Text", "PingFang SC", "HarmonyOS Sans SC", "Noto Sans SC", "Microsoft YaHei", sans-serif',
    '"Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif'],
  rounded: ['"YouYuan", "Yuanti SC", "Microsoft YaHei UI", "PingFang SC", "HarmonyOS Sans SC", sans-serif',
    '"Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif'],
  serif: ['"Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif',
    '"Songti SC", "Noto Serif SC", "Source Han Serif SC", SimSun, serif'],
  kai: ['"Kaiti SC", "STKaiti", KaiTi, "Noto Serif SC", serif',
    '"Kaiti SC", "STKaiti", KaiTi, "Noto Serif SC", serif'],
};

export function applyLook(root, settings) {
  if (!root) return;
  const dress = settings?.dress || {};
  const font = FONT_STACKS[dress.font] ? dress.font : 'system';
  const scale = Math.max(0.85, Math.min(1.3, Number(dress.fontSize) || 1));
  const line = Math.max(0.9, Math.min(1.3, Number(dress.lineHeight) || 1));
  const weight = [400, 500, 600].includes(Number(dress.fontWeight)) ? Number(dress.fontWeight) : 400;
  root.style.setProperty('--font-ui', FONT_STACKS[font][0]);
  root.style.setProperty('--font-serif', FONT_STACKS[font][1]);
  root.style.setProperty('--font-scale', String(scale));
  root.style.setProperty('--line-scale', String(line));
  root.style.setProperty('--font-weight', String(weight));
  root.dataset.mpIsland = dress.island === 'hide' ? 'hide' : 'show';
  root.dataset.mpSkin = ['frost', 'pixel'].includes(dress.theme) ? dress.theme : 'default';
  if (dress.theme === 'pixel') {
    root.style.setProperty('--theme-frame', `url("${PIXEL_BUNNY.avatarFrame}")`);
  } else {
    root.style.removeProperty('--theme-frame');
  }
}

export function dateText(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日<br>${WEEK[date.getDay()]}`;
}

export function timeText(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function shortText(ms) {
  const date = new Date(ms);
  const today = new Date();
  if (dayKey(date) === dayKey(today)) return timeText(ms);
  const diff = Math.round((today.setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 1) return '昨天';
  if (diff < 7) return `${diff} 天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function tintStyle(id) {
  const pair = TINT[id] || TINT.help;
  return `background:linear-gradient(155deg,${pair[0]},${pair[1]})`;
}

function avatarHtml(name, url, className = 'mp-avatar') {
  const style = url
    ? `background-image:url(&quot;${esc(url)}&quot;);background-size:cover;background-position:center`
    : tintStyle('contacts');
  const initial = String(name || '?').trim().slice(0, 1) || '?';
  return `<span class="${className}${url ? '' : ' is-tint'}" style="${style}">${url ? '' : esc(initial)}</span>`;
}

/* 每个桌面图标都先看装扮里有没有换过：自定义图片 > 换过的图形 > App 默认图形 */
function appTileHtml(app, state, badge = 0) {
  const custom = state?.settings?.dress?.icons?.[app.id];
  const image = typeof custom?.image === 'string' && custom.image.startsWith('data:image/') ? custom.image : '';
  const shape = typeof custom?.shape === 'string' ? custom.shape : app.icon;
  const style = image
    ? ` style="background-image:url(&quot;${esc(image)}&quot;);background-size:cover;background-position:center"`
    : '';
  return `<span class="mp-tile${image ? ' mp-tile-image' : ''}"${style}>${image ? '' : ico(shape)}${badge ? `<span class="mp-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</span>`;
}

/* ================================================================== 外壳 */

export function createShell(options) {
  const {
    root,
    ctx,
    apps,
    desktopApps,
    dockApps,
  } = options;

  const shell = {
    root,
    stack: [],
    sheet: null,
    sheetAnimated: false,
    toastTimer: 0,
    live: { inputValue: '', focus: false },
    scroller: null,
    deviceOffset: { x: 0, y: 0 },
  };

  Object.assign(ctx, {
    shell,
    go: (view, params = {}) => { shell.stack.push({ view, params }); shell.sheet = null; render(); },
    back: () => { shell.stack.pop(); shell.sheet = null; render(); },
    home: () => { shell.stack.length = 0; shell.sheet = null; render(); },
    rerender: () => render(),
    toast: (message) => { shell.toastMessage = message; render(); scheduleToastClear(); },
    openSheet: (sheet) => { shell.sheetAnimated = false; shell.sheet = sheet; render(); },
    closeSheet: () => { shell.sheet = null; shell.sheetAnimated = false; render(); },
    icon: ico,
    esc,
    TINT,
    clockText,
    dateText,
    timeText,
    shortText,
  });

  /* ------------------------------------------------------------ 渲染 */

  function desktopHtml() {
    const state = ctx.state;
    const chats = chatsOf(state);
    const recent = chats.find(chat => lastMessage(chat));
    const diary = latestDiary(state);
    const recentContact = recent ? contactById(state, recent.contactId) : null;
    const recentMsg = recent ? lastMessage(recent) : null;
    const me = Array.isArray(state.users)
      ? state.users.find(item => item && item.key && item.key === state.settings.user.key) || null
      : null;
    const themed = state.settings.dress?.theme === 'pixel' ? PIXEL_BUNNY : null;
    const myName = themed ? themed.profile.name : (state.settings.user.name || me?.name || '我');
    const myAvatar = themed ? themed.avatar : (state.settings.user.avatar || me?.avatarUrl || '');
    const myBio = themed ? themed.profile.bio : String(me?.description || '把每天的事，记在这台小手机里。').trim();
    const myHandle = themed ? themed.profile.handle : `@${String(myName).trim().replace(/\s+/g, '_') || 'me'}`;
    const myLocation = themed ? themed.profile.location : '在酒馆里';
    const myBanner = themed ? ` style="background-image:url(&quot;${themed.banner}&quot;);background-size:cover;background-position:center"` : '';
    const stampText = dateText().replace('<br>', ' · ');

    const iconButtons = desktopApps.map(app => `
      <button class="mp-app" data-act="open-app" data-app="${app.id}" type="button" aria-label="${esc(app.name)}">
        ${appTileHtml(app, state)}
        <span class="mp-app-label">${esc(app.name)}</span>
      </button>`).join('');

    const dockButtons = dockApps.map(app => {
      const badge = app.id === 'chat' ? unreadTotal(state) : 0;
      return `
      <button class="mp-app" data-act="open-app" data-app="${app.id}" type="button" aria-label="${esc(app.name)}">
        ${appTileHtml(app, state, badge)}
        <span class="mp-app-label">${esc(app.name)}</span>
      </button>`;
    }).join('');

    return `
      <div class="mp-desktop">
        <button class="mp-profile" data-act="open-app" data-app="user" type="button" aria-label="我的资料">
          <span class="mp-profile-banner"${myBanner}>
            <span class="mp-profile-stamp">${stampText}</span>
          </span>
          ${avatarHtml(myName, myAvatar, 'mp-profile-avatar')}
          <span class="mp-profile-name">${esc(myName)}</span>
          <span class="mp-profile-handle">${esc(myHandle)}</span>
          <span class="mp-profile-bio">${esc(myBio)}</span>
          <span class="mp-profile-loc">${ico('home')}<span>${esc(myLocation)}</span></span>
        </button>

        <div class="mp-widget-strip">
          <button class="mp-mini-widget" data-act="open-app" data-app="chat" type="button">
            <span class="mp-mini-head">${ico('chat')} 最近</span>
            ${recentContact ? `
            <span class="mp-mini-main">
              ${avatarHtml(recentContact.name, recentContact.avatar, 'mp-mini-avatar')}
              <span class="mp-mini-copy">
                <span class="mp-mini-name">${esc(recentContact.name)}</span>
                <span class="mp-mini-msg">${esc(recentMsg?.text || '')}</span>
              </span>
            </span>` : `
            <span class="mp-mini-empty">等一条新消息</span>`}
          </button>

          <button class="mp-mini-widget" data-act="open-app" data-app="diary" type="button">
            <span class="mp-mini-head">${ico('diary')} ${diary ? esc(diaryDateLabel(diary)) : '昨日日记'}</span>
            <span class="mp-mini-text">${diary ? esc(diary.text) : '这一格还空着。写一句今天的事，它就会留在这里。'}</span>
          </button>
        </div>

        <div class="mp-apps">${iconButtons}</div>

        <div class="mp-dock">${dockButtons}</div>
      </div>`;
  }

  function diaryDateLabel(diary) {
    const [, month, day] = diary.key.split('-');
    return `${Number(month)}月${Number(day)}日`;
  }

  function pageHtml() {
    const entry = shell.stack[shell.stack.length - 1];
    const app = apps[entry.view];
    if (!app) return desktopHtml();
    const body = app.render(ctx, entry.params || {});
    // 页面自己没画返回键就补一条：所有界面都得能回去
    const hasBack = String(body).includes('data-act="back"');
    return `
      <div class="mp-page" data-view="${esc(entry.view)}">
        ${hasBack ? '' : `<div class="mp-nav"><button class="mp-back" data-act="back" type="button">${ico('back')}<span>返回</span></button><span style="flex:1"></span></div>`}
        ${body}
      </div>`;
  }

  function sheetHtml() {
    const sheet = shell.sheet;
    if (!sheet) return '';
    const still = shell.sheetAnimated ? ' is-still' : '';

    if (sheet.kind === 'text') {
      return `
        <div class="mp-mask${still}" data-act="sheet-close"></div>
        <div class="mp-sheet${still}" role="dialog" aria-modal="true">
          ${sheet.title ? `<div class="mp-sheet-title">${esc(sheet.title)}</div>` : ''}
          <textarea id="mpSheetText" class="mp-sheet-textarea" placeholder="${esc(sheet.placeholder || '')}">${esc(sheet.value || '')}</textarea>
          <div style="display:flex;gap:8px;margin-top:9px">
            <button class="mp-sheet-cancel" data-act="sheet-close" type="button" style="margin-top:0;flex:1">取消</button>
            <button class="mp-sheet-cancel" data-act="sheet-text-ok" type="button" style="margin-top:0;flex:1.4;background:linear-gradient(150deg,#9583f2,#7f6ce9);color:#fff;box-shadow:0 8px 18px rgba(140,116,224,.26)">${esc(sheet.confirm || '存下来')}</button>
          </div>
        </div>`;
    }

    if (sheet.kind === 'form') {
      const fields = (sheet.fields || []).map((field, index) => {
        const id = `mpField${index}`;
        let control = '';
        if (field.type === 'textarea') {
          control = `<textarea id="${id}" class="mp-sheet-textarea mp-sheet-form-textarea" maxlength="${field.maxLength || 4000}" placeholder="${esc(field.placeholder || '')}">${esc(field.value || '')}</textarea>`;
        } else if (field.type === 'select') {
          const options = (field.options || []).map(option => `<option value="${esc(option.value)}"${String(option.value) === String(field.value) ? ' selected' : ''}>${esc(option.label)}</option>`).join('');
          control = `<div class="mp-select-wrap"><select id="${id}" class="mp-sheet-input mp-sheet-select">${options}</select>${ico('chevron')}</div>`;
        } else {
          control = `<input id="${id}" class="mp-sheet-input" type="text" maxlength="${field.maxLength || 30}" value="${esc(field.value || '')}" placeholder="${esc(field.placeholder || '')}">`;
        }
        return `<label class="mp-sheet-field">
          <span class="mp-sheet-field-label">${esc(field.label || '')}</span>
          ${control}
          ${field.hint ? `<span class="mp-sheet-field-hint">${esc(field.hint)}</span>` : ''}
        </label>`;
      }).join('');
      return `
        <div class="mp-mask${still}" data-act="sheet-close"></div>
        <div class="mp-sheet${still}" role="dialog" aria-modal="true">
          ${sheet.title ? `<div class="mp-sheet-title">${esc(sheet.title)}</div>` : ''}
          <div class="mp-sheet-form">${fields}</div>
          <div style="display:flex;gap:8px;margin-top:9px">
            <button class="mp-sheet-cancel" data-act="sheet-close" type="button" style="margin-top:0;flex:1">取消</button>
            <button class="mp-sheet-cancel" data-act="sheet-form-ok" type="button" style="margin-top:0;flex:1.4;background:linear-gradient(150deg,#9583f2,#7f6ce9);color:#fff;box-shadow:0 8px 18px rgba(140,116,224,.26)">${esc(sheet.confirm || '保存')}</button>
          </div>
        </div>`;
    }

    const items = (sheet.items || []).map(item => `
      <button class="mp-sheet-item${item.danger ? ' danger' : ''}" data-act="sheet-pick" data-value="${esc(item.value)}" type="button">
        ${item.icon ? ico(item.icon) : ''}<span>${esc(item.label)}</span>
      </button>`).join('');
    return `
      <div class="mp-mask${still}" data-act="sheet-close"></div>
      <div class="mp-sheet${still}" role="dialog" aria-modal="true">
        ${sheet.title ? `<div class="mp-sheet-title">${esc(sheet.title)}</div>` : ''}
        ${items}
        <button class="mp-sheet-cancel" data-act="sheet-close" type="button">取消</button>
      </div>`;
  }

  function render() {
    if (!root) return;
    const state = ctx.state;
    const status = state.settings.theme === 'night' ? 'night' : 'day';
    root.className = 'mp-root';
    root.dataset.mpTheme = status;
    applyWall(root, state.settings);
    applyLook(root, state.settings);
    const offsetX = Math.round(shell.deviceOffset?.x || 0);
    const offsetY = Math.round(shell.deviceOffset?.y || 0);
    root.innerHTML = `
      <div class="mp-overlay">
        <div class="mp-device" style="transform: translate(${offsetX}px, ${offsetY}px)">
          <div class="mp-screen">
            ${state.settings.dress?.island === 'hide' ? '' : '<div class="mp-island"></div>'}
            <div class="mp-drag-handle" data-drag="phone" title="按住顶部拖动手机"></div>
            <div class="mp-wallpaper"></div>
            <div class="mp-scrim"></div>
            <div class="mp-status">
              <span class="mp-status-left">${shell.stack.length ? `<button class="mp-status-back" data-act="back" type="button" aria-label="返回">${ico('back')}</button>` : ''}</span>
              <span class="mp-status-right">${clockText()}</span>
            </div>
            ${shell.stack.length ? pageHtml() : desktopHtml()}
            ${sheetHtml()}
            ${shell.toastMessage ? `<div class="mp-toast">${esc(shell.toastMessage)}</div>` : ''}
            <div class="mp-home-bar" data-act="home" title="回桌面"></div>
          </div>
        </div>
      </div>`;

    restoreLive();
    shell.improveSendState();
    if (shell.sheet) shell.sheetAnimated = true;
  }

  function restoreLive() {
    const input = root.querySelector('.mp-compose-box input');
    if (input && shell.live.inputValue) {
      input.value = shell.live.inputValue;
      shell.improveSendState();
      if (shell.live.focus) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    if (shell.scroller) {
      const box = root.querySelector('.mp-messages');
      if (box) box.scrollTop = shell.scroller;
    }
  }

  shell.improveSendState = function improveSendState() {
    const button = root.querySelector('.mp-send');
    const input = root.querySelector('.mp-compose-box input');
    if (!button || !input) return;
    const hasText = Boolean(input.value.trim());
    button.classList.toggle('is-text', hasText);
    button.classList.toggle('is-wake', !hasText);
  };

  shell.refresh = render;

  /* --------------------------------------------------------- 提示自动消失 */

  function scheduleToastClear() {
    clearTimeout(shell.toastTimer);
    shell.toastTimer = setTimeout(() => {
      shell.toastMessage = '';
      const node = root.querySelector('.mp-toast');
      if (node) node.remove();
    }, 2400);
  }

  /* ----------------------------------------------------------- 事件绑定 */

  const acts = {
    'open-app': (data) => { shell.live = { inputValue: '', focus: false }; ctx.go('app-' + data.app, {}); },
    'home': () => { shell.live = { inputValue: '', focus: false }; ctx.home(); },
    'back': () => { if (shell.sheet) ctx.closeSheet(); else ctx.back(); },
    'sheet-close': () => ctx.closeSheet(),
    'sheet-pick': (data) => {
      const sheet = shell.sheet;
      const handler = sheet?.onPick;
      const value = data.value;
      /* 先回调，再渲染：重渲染会重建对象，先关弹层会让回调改到旧对象上 */
      shell.sheet = null;
      shell.sheetAnimated = false;
      if (typeof handler === 'function') handler(value);
      if (!shell.sheet) render();
    },
    'sheet-text-ok': () => {
      const sheet = shell.sheet;
      const node = root.querySelector('#mpSheetText');
      const value = node ? node.value : '';
      const handler = sheet?.onText;
      shell.sheet = null;
      shell.sheetAnimated = false;
      if (typeof handler === 'function') handler(value);
      if (!shell.sheet) render();
    },
    'sheet-form-ok': () => {
      const sheet = shell.sheet;
      const fields = sheet?.fields || [];
      const values = {};
      fields.forEach((field, index) => {
        const node = root.querySelector(`#mpField${index}`);
        values[field.name] = node ? node.value : '';
      });
      const handler = sheet?.onForm;
      shell.sheet = null;
      shell.sheetAnimated = false;
      if (typeof handler === 'function') handler(values);
      if (!shell.sheet) render();
    },
    'toast': (data) => ctx.toast(data.message || ''),
    'phone-close': () => { if (typeof ctx.onClose === 'function') ctx.onClose(); },
    'toggle-theme': () => {
      const settings = ctx.state.settings;
      const next = settings.theme === 'night' ? 'day' : 'night';
      settings.theme = next;
      if (!['none', 'custom'].includes(settings.wallpaper)) settings.wallpaper = next;
      render();
      ctx.save();
    },
  };

  root.addEventListener('click', event => {
    const target = event.target.closest('[data-act]');
    if (!target || !root.contains(target)) return;
    const act = target.dataset.act;
    if (act === 'sheet-pick' && String(target.dataset.value).startsWith('__')) return;
    const data = Object.assign({}, target.dataset);
    const entry = shell.stack[shell.stack.length - 1];
    const app = entry ? apps[entry.view] : null;

    /* 页面先处理，未消费再交给全局 */
    if (app && typeof app.handle === 'function' && app.handle(ctx, act, data, event)) return;
    if (acts[act]) { acts[act](data, event); return; }
    if (typeof ctx.onGlobalAct === 'function' && ctx.onGlobalAct(act, data, event)) return;
  });

  /* 下拉框：原生 select 只负责取值，动作仍走统一 handle */
  root.addEventListener('change', event => {
    const target = event.target.closest('select[data-act]');
    if (!target || !root.contains(target)) return;
    const act = target.dataset.act;
    const data = Object.assign({}, target.dataset, { value: target.value });
    const entry = shell.stack[shell.stack.length - 1];
    const app = entry ? apps[entry.view] : null;
    if (app && typeof app.handle === 'function' && app.handle(ctx, act, data, event)) return;
    if (acts[act]) { acts[act](data, event); return; }
    if (typeof ctx.onGlobalAct === 'function' && ctx.onGlobalAct(act, data, event)) return;
  });

  /* 顶部中间拖动手机壳：只在最上面一条区域响应，不影响页面里的滑动 */
  let phoneDrag = null;
  function clampDeviceOffset(x, y) {
    const maxX = Math.max(0, (window.innerWidth + 390) / 2 - 90);
    const maxY = Math.max(0, (window.innerHeight + 844) / 2 - 120);
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-drag="phone"]');
    if (!handle) return;
    const device = root.querySelector('.mp-device');
    if (!device) return;
    event.preventDefault();
    event.stopPropagation();
    phoneDrag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: shell.deviceOffset?.x || 0,
      baseY: shell.deviceOffset?.y || 0,
    };
    device.classList.add('is-dragging');
    handle.setPointerCapture?.(event.pointerId);
  });
  window.addEventListener('pointermove', event => {
    if (!phoneDrag || event.pointerId !== phoneDrag.id) return;
    const device = root.querySelector('.mp-device');
    if (!device) return;
    const next = clampDeviceOffset(
      phoneDrag.baseX + event.clientX - phoneDrag.startX,
      phoneDrag.baseY + event.clientY - phoneDrag.startY
    );
    shell.deviceOffset = next;
    device.style.transform = `translate(${Math.round(next.x)}px, ${Math.round(next.y)}px)`;
    event.preventDefault();
  }, { passive: false });
  const endPhoneDrag = event => {
    if (!phoneDrag || event.pointerId !== phoneDrag.id) return;
    phoneDrag = null;
    root.querySelector('.mp-device')?.classList.remove('is-dragging');
  };
  window.addEventListener('pointerup', endPhoneDrag);
  window.addEventListener('pointercancel', endPhoneDrag);
  window.addEventListener('resize', () => {
    shell.deviceOffset = clampDeviceOffset(shell.deviceOffset?.x || 0, shell.deviceOffset?.y || 0);
    const device = root.querySelector('.mp-device');
    if (device) device.style.transform = `translate(${Math.round(shell.deviceOffset.x)}px, ${Math.round(shell.deviceOffset.y)}px)`;
  });

  /* 上滑：页面里快速上滑一段就回桌面 */
  let swipe = null;

  root.addEventListener('pointerdown', event => {
    if (!shell.stack.length) return;
    const screen = root.querySelector('.mp-screen');
    if (!screen) return;
    const rect = screen.getBoundingClientRect();
    const fromBottom = event.clientY - rect.top;
    const zone = event.pointerType === 'mouse' ? rect.height - 150 : rect.height * 0.5;
    if (fromBottom < zone) return;
    swipe = { x: event.clientX, y: event.clientY, t: Date.now() };
  });

  root.addEventListener('pointerup', event => {
    if (!swipe) return;
    const dy = event.clientY - swipe.y;
    const dx = Math.abs(event.clientX - swipe.x);
    const dt = Date.now() - swipe.t;
    const need = event.pointerType === 'mouse' ? -60 : -90;
    const hit = dy <= need && dx <= 80 && dt <= 620;
    swipe = null;
    if (!hit || !shell.stack.length) return;
    if (document.activeElement?.blur) document.activeElement.blur();
    shell.live = { inputValue: '', focus: false };
    ctx.home();
  });

  root.addEventListener('pointercancel', () => { swipe = null; });

  /* 长按：data-hold 元素 420ms 触发 hold 动作 */
  let holdTimer = 0;
  let holdTarget = null;

  root.addEventListener('pointerdown', event => {
    const target = event.target.closest('[data-hold]');
    if (!target) return;
    holdTarget = target;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      if (!holdTarget) return;
      const entry = shell.stack[shell.stack.length - 1];
      const app = entry ? apps[entry.view] : null;
      const data = Object.assign({}, holdTarget.dataset);
      if (app?.handle && app.handle(ctx, holdTarget.dataset.hold, data, event)) {
        if (navigator.vibrate) navigator.vibrate(12);
      }
      holdTarget = null;
    }, 420);
  });

  const cancelHold = () => { clearTimeout(holdTimer); holdTarget = null; };
  root.addEventListener('pointerup', cancelHold);
  root.addEventListener('pointercancel', cancelHold);
  root.addEventListener('pointermove', cancelHold);

  /* 输入：不整页重绘，只切发送键状态并同步草稿 */
  root.addEventListener('input', event => {
    const input = event.target.closest('.mp-compose-box input');
    if (!input) return;
    shell.live.inputValue = input.value;
    shell.improveSendState();
    const entry = shell.stack[shell.stack.length - 1];
    if (entry && ctx.onDraft) ctx.onDraft(entry, input.value);
  });

  root.addEventListener('focusin', event => {
    if (event.target.closest('.mp-compose-box input')) shell.live.focus = true;
  });

  root.addEventListener('focusout', event => {
    if (event.target.closest('.mp-compose-box input')) shell.live.focus = false;
  });

  root.addEventListener('scroll', event => {
    if (event.target.classList?.contains('mp-messages')) shell.scroller = event.target.scrollTop;
  }, true);

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (shell.sheet) { ctx.closeSheet(); return; }
      if (shell.stack.length) { ctx.back(); return; }
      ctx.onClose?.();
    }
    if (event.key === 'Enter' && event.target.closest('.mp-compose-box input')) {
      const send = root.querySelector('.mp-send');
      if (send) send.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });

  /* 桌面时钟每分钟走一次；只在桌面时刷新 */
  const timer = setInterval(() => {
    if (!shell.stack.length && !shell.sheet) render();
  }, 60000);

  render();

  return {
    shell,
    render,
    destroy() { clearInterval(timer); clearTimeout(shell.toastTimer); if (root) root.innerHTML = ''; },
  };
}

/* 供页面复用的骨架 */
export function pageNav(ctx, { title, back = true, right = '' }) {
  return `
    <div class="mp-nav">
      ${back ? `<button class="mp-back" data-act="back" type="button">${ico('back')}<span>${esc(title || '')}</span></button>` : ''}
      <span style="flex:1"></span>
      ${right}
    </div>`;
}

export function chatAvatarHtml(contact) {
  return avatarHtml(contact?.name, contact?.avatar);
}

export { avatarHtml, tintStyle };
