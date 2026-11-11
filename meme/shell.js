/**
 * meme-phone · 外壳
 *
 * 一个桌面（小组件 + App 图标 + Dock）、一层页面栈、一套弹层与提示。
 * 页面本身在 apps/ 里，这里只负责：渲染容器、路由、事件分发、状态保存。
 */

import { icon as ico, TINT } from './icons.js';
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
  const style = url ? `${tintStyle('contacts')};background-image:url("${esc(url)}")` : tintStyle('contacts');
  const initial = String(name || '?').trim().slice(0, 1) || '?';
  return `<span class="${className}" style="${style}">${url ? '' : esc(initial)}</span>`;
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
    toastTimer: 0,
    live: { inputValue: '', focus: false },
    scroller: null,
  };

  Object.assign(ctx, {
    shell,
    go: (view, params = {}) => { shell.stack.push({ view, params }); shell.sheet = null; render(); },
    back: () => { shell.stack.pop(); shell.sheet = null; render(); },
    home: () => { shell.stack.length = 0; shell.sheet = null; render(); },
    rerender: () => render(),
    toast: (message) => { shell.toastMessage = message; render(); scheduleToastClear(); },
    openSheet: (sheet) => { shell.sheet = sheet; render(); },
    closeSheet: () => { shell.sheet = null; render(); },
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

    const iconButtons = desktopApps.map(app => `
      <button class="mp-app" data-act="open-app" data-app="${app.id}" type="button" aria-label="${esc(app.name)}">
        <span class="mp-tile" style="${tintStyle(app.id)}">${ico(app.icon)}</span>
        <span class="mp-app-label">${esc(app.name)}</span>
      </button>`).join('');

    const dockButtons = dockApps.map(app => {
      const badge = app.id === 'chat' ? unreadTotal(state) : 0;
      return `
      <button class="mp-app" data-act="open-app" data-app="${app.id}" type="button" aria-label="${esc(app.name)}">
        <span class="mp-tile" style="${tintStyle(app.id)}">${ico(app.icon)}${badge ? `<span class="mp-badge">${badge > 99 ? '99+' : badge}</span>` : ''}</span>
        <span class="mp-app-label">${esc(app.name)}</span>
      </button>`;
    }).join('');

    return `
      <div class="mp-desktop">
        <div class="mp-widget" data-act="open-app" data-app="diary">
          <div class="mp-widget-top">
            <div class="mp-clock">${clockText()}</div>
            <div class="mp-date">${dateText()}</div>
          </div>
          <div class="mp-di-card">
            <div class="mp-di-label">${ico('diary')} 昨日日记${diary ? ` · ${esc(diaryDateLabel(diary))}` : ''}</div>
            <div class="mp-di-text">${diary ? esc(diary.text).replace(/\n/g, '<br>') : '这一格还空着。写一句今天的事，它就会留在这里。'}</div>
          </div>
          ${recentContact ? `
          <div class="mp-recent">
            ${avatarHtml(recentContact.name, recentContact.avatar, 'mp-avatar')}
            <div class="mp-recent-body">
              <div class="mp-recent-name">${esc(recentContact.name)}${recent.unread ? ` · ${recent.unread} 条未读` : ''}</div>
              <div class="mp-recent-msg">${esc(recentMsg?.text || '')}</div>
            </div>
          </div>` : ''}
        </div>

        <div class="mp-apps">${iconButtons}</div>

        <div class="mp-quick">
          <button class="mp-quick-btn" data-act="open-app" data-app="chat" type="button">${ico('chat')}<span>发消息</span></button>
          <button class="mp-quick-btn" data-act="open-app" data-app="diary" type="button">${ico('diary')}<span>写日记</span></button>
          <button class="mp-quick-btn" data-act="toggle-theme" type="button">${ico(state.settings.theme === 'night' ? 'sun' : 'moon')}<span>${state.settings.theme === 'night' ? '日间' : '夜间'}</span></button>
        </div>

        <div class="mp-dock">${dockButtons}</div>
      </div>`;
  }

  function diaryDateLabel(diary) {
    const [, month, day] = diary.key.split('-');
    return `${Number(month)}月${Number(day)}日`;
  }

  function floatHomeHtml() {
    return `
      <button class="mp-float-home" data-act="home" type="button">${ico('home')}<span>桌面</span></button>`;
  }

  function actionsHtml() {
    const depth = shell.stack.length;
    return `
      <div class="mp-actions">
        <button class="mp-action-btn primary" data-act="home" type="button">${ico('home')}<span>回桌面</span></button>
        ${depth > 1 ? `<button class="mp-action-btn" data-act="back" type="button">${ico('back')}<span>后退</span></button>` : ''}
        <button class="mp-action-btn" data-act="phone-close" type="button">${ico('close')}<span>收起</span></button>
        <span class="mp-actions-hint">上滑也能回桌面</span>
      </div>`;
  }

  function pageHtml() {
    const entry = shell.stack[shell.stack.length - 1];
    const app = apps[entry.view];
    if (!app) return desktopHtml();
    const withThread = entry.view === 'thread' || entry.view === 'contact' || entry.view === 'extra-detail';
    return `
      <div class="mp-page" data-view="${esc(entry.view)}">
        ${app.render(ctx, entry.params || {})}
        ${withThread ? floatHomeHtml() : actionsHtml()}
      </div>`;
  }

  function sheetHtml() {
    const sheet = shell.sheet;
    if (!sheet) return '';

    if (sheet.kind === 'text') {
      return `
        <div class="mp-mask" data-act="sheet-close"></div>
        <div class="mp-sheet" role="dialog" aria-modal="true">
          ${sheet.title ? `<div class="mp-sheet-title">${esc(sheet.title)}</div>` : ''}
          <textarea id="mpSheetText" style="width:100%;height:150px;box-sizing:border-box;border-radius:16px;padding:12px 13px;font:inherit;font-size:13.5px;line-height:1.72;color:var(--text);background:rgba(142,123,242,.05);border:1px solid rgba(142,123,242,.16);outline:none;resize:none;font-family:var(--font-serif)" placeholder="${esc(sheet.placeholder || '')}">${esc(sheet.value || '')}</textarea>
          <div style="display:flex;gap:8px;margin-top:9px">
            <button class="mp-sheet-cancel" data-act="sheet-close" type="button" style="margin-top:0;flex:1">取消</button>
            <button class="mp-sheet-cancel" data-act="sheet-text-ok" type="button" style="margin-top:0;flex:1.4;background:linear-gradient(150deg,#9583f2,#7f6ce9);color:#fff;box-shadow:0 8px 18px rgba(140,116,224,.26)">${esc(sheet.confirm || '存下来')}</button>
          </div>
        </div>`;
    }

    const items = (sheet.items || []).map(item => `
      <button class="mp-sheet-item${item.danger ? ' danger' : ''}" data-act="sheet-pick" data-value="${esc(item.value)}" type="button">
        ${item.icon ? ico(item.icon) : ''}<span>${esc(item.label)}</span>
      </button>`).join('');
    return `
      <div class="mp-mask" data-act="sheet-close"></div>
      <div class="mp-sheet" role="dialog" aria-modal="true">
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
    root.dataset.mpWall = ['none', 'day', 'night'].includes(state.settings.wallpaper) ? state.settings.wallpaper : 'none';
    root.innerHTML = `
      <div class="mp-overlay">
        <div class="mp-device">
          <div class="mp-screen">
            <div class="mp-island"></div>
            <div class="mp-wallpaper"></div>
            <div class="mp-scrim"></div>
            <div class="mp-status">
              <span>${clockText()}</span>
              <span class="mp-status-right">${ico('bell')}</span>
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
    'back': () => ctx.back(),
    'sheet-close': () => ctx.closeSheet(),
    'sheet-pick': (data) => {
      const sheet = shell.sheet;
      const handler = sheet?.onPick;
      const value = data.value;
      ctx.closeSheet();
      if (typeof handler === 'function') handler(value);
    },
    'sheet-text-ok': () => {
      const sheet = shell.sheet;
      const node = root.querySelector('#mpSheetText');
      const value = node ? node.value : '';
      const handler = sheet?.onText;
      ctx.closeSheet();
      if (typeof handler === 'function') handler(value);
    },
    'toast': (data) => ctx.toast(data.message || ''),
    'phone-close': () => { if (typeof ctx.onClose === 'function') ctx.onClose(); },
    'toggle-theme': () => {
      const settings = ctx.state.settings;
      settings.theme = settings.theme === 'night' ? 'day' : 'night';
      ctx.save();
      render();
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
