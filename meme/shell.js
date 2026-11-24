/**
 * meme-phone · 外壳
 *
 * 一个桌面（小组件 + App 图标 + Dock）、一层页面栈、一套弹层与提示。
 * 页面本身在 apps/ 里，这里只负责：渲染容器、路由、事件分发、状态保存。
 */

import { icon as ico, TINT } from './icons.js';
import { PIXEL_BUNNY } from './theme-data.js';
import {
  unreadTotal, dayKey, chatsOf, contactById, lastMessage, messagePreview,
} from './data.js';

export function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 上滑回桌面只在手机底部这一小段起手才成立。
 * 起点在能滚动的列表里（聊天消息、设置列表、弹层）或输入区时不接管，避免滚一下就被退出。
 */
export function canStartHomeSwipe({ pointerType = 'mouse', screenHeight = 844, fromBottom = 0, onScrollable = false } = {}) {
  if (onScrollable) return false;
  if (!Number(screenHeight)) return false;
  const zone = pointerType === 'mouse' ? 96 : 64;
  return Number(fromBottom) >= Number(screenHeight) - zone;
}

/** 上滑判定的几何条件：够快、向上、别歪。 */
export function isHomeSwipeHit({ pointerType = 'mouse', dx = 0, dy = 0, dt = 0 } = {}) {
  const need = pointerType === 'mouse' ? -60 : -90;
  return Number(dy) <= need && Math.abs(Number(dx)) <= 80 && Number(dt) <= 620;
}

export function clockText(date = new Date()) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/* 按宿主窗口可用尺寸等比缩放手机壳；纯函数便于校验。
 * 注意：这里拿到的宽高必须是“窗口真实大小”，不能是软键盘弹起后被压缩的可视尺寸——
 * 否则一打字整机就跟着缩成一小条。基准视口在 createShell 里记下，打字期间不更新。 */
export function computeDeviceScale(vw, vh) {
  if (!vw || !vh) return 1;
  const fit = Math.min((vw - 48) / 390, (vh - 48) / 844);
  return Math.max(0.45, Math.min(1, fit));
}

/* 读当前窗口布局视口尺寸。视觉视口(visualViewport)在键盘弹起时会收缩，不能用作基准。 */
function readViewport() {
  return { w: window.innerWidth || 0, h: window.innerHeight || 0 };
}

/* 决定缩放采用哪个视口：打字(软键盘弹起)期间保留基准，避免整机被压缩后的可视高度带小；
   非聚焦时采纳新视口，响应真实的窗口拖动 / 旋转。纯函数便于校验。 */
export function viewportForScale(base, next, typing) {
  if (typing) return base || next;
  return next || base;
}

/* 手机竖屏判定：宽度 ≤768px 且竖着的视口。这类视口走窄屏规则——
   缩放只由宽度决定，软键盘顶上来时只缩短高度，不缩宽度。纯函数便于校验。 */
export function isMobileViewport(vw, vh) {
  const w = Number(vw) || 0;
  const h = Number(vh) || 0;
  if (w <= 0 || h <= 0) return false;
  return w <= 768 && h >= w;
}

/* 整机外框常量：.mp-device 是 content-box，390×844 之外四边各 10px padding */
const DEVICE_W = 390;
const DEVICE_H = 844;
const DEVICE_PAD = 20;
const MOBILE_GUTTER = 8;

/* 整机尺寸。桌面沿用按宽高双项等比缩放（历史基线不变）；手机竖屏只按宽度定缩放，
   宽度始终不随键盘变化，高度在剩余可视高度里缩短。availH 是键盘弹起后剩下的高度。
   返回 scale 与 device 的 CSS 高度（不含 padding）。纯函数便于校验。 */
export function deviceLayout(vw, vh, availH, mobile) {
  const w = Number(vw) || 0;
  const h = Number(vh) || 0;
  const avail = Number(availH) || h;
  if (!mobile) return { scale: computeDeviceScale(w, h), height: DEVICE_H };
  const fit = (w - MOBILE_GUTTER * 2) / (DEVICE_W + DEVICE_PAD);
  const scale = Math.max(0.45, Math.min(1, fit));
  const usable = Math.max(240, avail - MOBILE_GUTTER * 2);
  const fullVisual = (DEVICE_H + DEVICE_PAD) * scale;
  const height = fullVisual <= usable ? DEVICE_H : Math.max(240, usable / scale - DEVICE_PAD);
  return { scale, height };
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

/* 桌面上的“我”只认用户自己的资料：主题只换壁纸 / 横幅 / 头像框，不接管昵称、头像和签名 */
export function desktopIdentity(state) {
  const user = state?.settings?.user || {};
  const me = Array.isArray(state?.users)
    ? state.users.find(item => item && item.key && item.key === user.key) || null
    : null;
  const myName = user.name || me?.name || '我';
  const myAvatar = user.avatar || me?.avatarUrl || '';
  const ownBio = String(state?.settings?.profile?.bio || '').trim();
  const myBio = ownBio || String(me?.description || '把每天的事，记在这台小手机里。').trim();
  return { myName, myAvatar, myBio };
}

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
  /* 像素小兔也走磨砂玻璃组件，只保留小兔壁纸 / 横幅 / 头像框这层美术 */
  root.dataset.mpSkin = dress.theme === 'pixel' ? 'frost' : (dress.theme === 'frost' ? 'frost' : 'default');
  root.dataset.mpArt = dress.theme === 'pixel' ? 'pixel' : '';
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
    /* 是否有输入控件正聚焦：打字弹起软键盘期间为 true，用来忽略键盘造成的视口收缩 */
    typing: false,
    /* 缩放基准视口：打开手机时记下的窗口尺寸，不跟随软键盘期的可视高度抖动 */
    baseViewport: readViewport(),
    scroller: null,
    bioEdit: false,
    homePage: 0,
    deviceOffset: { x: 0, y: 0 },
  };

  Object.assign(ctx, {
    shell,
    go: (view, params = {}) => { shell.stack.push({ view, params }); shell.sheet = null; render(); },
    back: () => { shell.stack.pop(); shell.sheet = null; render(); },
    home: () => { shell.stack.length = 0; shell.sheet = null; render(); },
    rerender: () => render(),
    /* 提示条就地更新，不整页重绘：不会打断正在输入的字、选区、弹层和滚动位置 */
    toast: (message) => { shell.toastMessage = message; showToast(message); scheduleToastClear(); },
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

  /* 首页快捷入口只认最后说过话的会话，不跟置顶排序走。 */
  function recentChatOf(state) {
    return chatsOf(state)
      .slice()
      .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0))[0] || null;
  }

  /* 两个双格小组件 + 桌面 App；布局按屏保存在 settings.desktop.pages 里。 */
  const homeWidgets = [
    { id: 'widget-recent', name: '最近聊天', type: 'widget' },
    { id: 'widget-theme', name: '显示模式', type: 'widget' },
  ];
  const homeItems = new Map([
    ...homeWidgets.map(item => [item.id, item]),
    ...desktopApps.map(app => [app.id, { ...app, type: 'app' }]),
  ]);
  const HOME_SCREEN_COUNT = 2;

  function defaultHomePages() {
    const pages = Array.from({ length: HOME_SCREEN_COUNT }, () => []);
    homeWidgets.forEach(item => pages[0].push(item.id));
    desktopApps.forEach(app => pages[Number(app.screen) === 2 ? 1 : 0].push(app.id));
    return pages;
  }

  function homePages() {
    const fallback = defaultHomePages();
    const raw = ctx.state?.settings?.desktop?.pages;
    if (!Array.isArray(raw)) return fallback;
    const pages = Array.from({ length: HOME_SCREEN_COUNT }, () => []);
    const seen = new Set();
    raw.slice(0, HOME_SCREEN_COUNT).forEach((list, pageIndex) => {
      if (!Array.isArray(list)) return;
      list.forEach(id => {
        const key = String(id || '');
        if (!homeItems.has(key) || seen.has(key)) return;
        seen.add(key);
        pages[pageIndex].push(key);
      });
    });
    /* 老存档或以后新增的入口：按默认所属屏补回，不丢入口。 */
    homeItems.forEach((item, id) => {
      if (seen.has(id)) return;
      const pageIndex = item.type === 'widget' || Number(item.screen) !== 2 ? 0 : 1;
      pages[pageIndex].push(id);
    });
    return pages;
  }

  function saveHomePages(pages) {
    const settings = ctx.state.settings;
    settings.desktop = { ...(settings.desktop || {}), pages: pages.map(list => list.slice()) };
    ctx.save();
  }

  function homePreview(chat) {
    const last = lastMessage(chat);
    if (!last) return '还没有消息';
    const text = String(messagePreview(last) || '').replace(/\s+/g, ' ').trim();
    if (!text) return last.image ? '[图片]' : '还没有消息';
    return text.length > 22 ? `${text.slice(0, 22)}…` : text;
  }

  function recentWidgetHtml(pageIndex, recentChat, recentContact) {
    const name = recentContact?.name || (recentChat ? '聊天' : '还没有聊天');
    const preview = recentChat ? homePreview(recentChat) : '';
    const stamp = recentChat ? clockText(new Date(Number(recentChat.updatedAt) || Date.now())) : '';
    return `
      <button class="mp-home-widget mp-hw-recent" data-drag-id="widget-recent" data-page="${pageIndex}" data-act="open-recent"${recentChat ? ` data-chat="${esc(recentChat.id)}"` : ''} type="button" aria-label="最近聊天">
        <span class="mp-hw-top"><span class="mp-hw-kicker">最近聊天</span><span class="mp-hw-time">${esc(stamp)}</span></span>
        <span class="mp-hw-main">
          ${avatarHtml(name, recentContact?.avatar || '', 'mp-hw-avatar')}
          <span class="mp-hw-copy"><span class="mp-hw-name">${esc(name)}</span><span class="mp-hw-preview">${esc(preview)}</span></span>
        </span>
      </button>`;
  }

  function themeWidgetHtml(pageIndex, state) {
    const night = state.settings.theme === 'night';
    return `
      <button class="mp-home-widget mp-hw-theme${night ? ' is-night' : ''}" data-drag-id="widget-theme" data-page="${pageIndex}" data-act="toggle-theme" type="button" aria-label="${night ? '切换到日间模式' : '切换到夜间模式'}">
        <span class="mp-hw-top"><span class="mp-hw-kicker">显示模式</span><span class="mp-hw-time">${night ? '夜间' : '日间'}</span></span>
        <span class="mp-hw-main">
          <span class="mp-hw-orb">${ico(night ? 'moon' : 'sun')}</span>
          <span class="mp-hw-copy"><span class="mp-hw-name">${night ? '夜间模式' : '日间模式'}</span><span class="mp-hw-preview">${night ? '深色背景' : '浅色背景'}</span></span>
        </span>
      </button>`;
  }

  function homeItemHtml(id, pageIndex, state) {
    const item = homeItems.get(id);
    if (!item) return '';
    if (id === 'widget-recent') {
      const recentChat = recentChatOf(state);
      const recentContact = recentChat ? contactById(state, recentChat.contactId) : null;
      return recentWidgetHtml(pageIndex, recentChat, recentContact);
    }
    if (id === 'widget-theme') return themeWidgetHtml(pageIndex, state);
    const app = item;
    return `
      <button class="mp-app" data-drag-id="${esc(app.id)}" data-page="${pageIndex}" data-act="open-app" data-app="${esc(app.id)}" type="button" aria-label="${esc(app.name)}">
        ${appTileHtml(app, state)}
        <span class="mp-app-label">${esc(app.name)}</span>
      </button>`;
  }

  function pageIndexSafe() {
    return Math.max(0, Math.min(HOME_SCREEN_COUNT - 1, Number(shell.homePage) || 0));
  }

  function setHomePage(index) {
    const next = Math.max(0, Math.min(HOME_SCREEN_COUNT - 1, Number(index) || 0));
    shell.homePage = next;
    const track = root.querySelector('.mp-home-track');
    if (track) track.style.transform = `translate3d(-${next * 100}%,0,0)`;
    root.querySelectorAll('.mp-home-dot').forEach(dot => {
      const on = Number(dot.dataset.page) === next;
      dot.classList.toggle('is-on', on);
      dot.setAttribute('aria-current', on ? 'true' : 'false');
    });
  }

  /* 拖动：按落点重排当前屏；拖到页点则整项移到另一屏。 */
  let drag = null;
  let homeSwipe = null;
  let suppressClickUntil = 0;

  function dropAfter(el, x, y) {
    const box = el.getBoundingClientRect();
    const band = box.height * .28;
    if (y >= box.top + band && y <= box.bottom - band) return x > box.left + box.width * .5;
    return y > box.top + box.height * .5;
  }

  function nearestHomeItem(page, x, y, sourceId) {
    let best = null;
    page.querySelectorAll('[data-drag-id]').forEach(el => {
      if (el.dataset.dragId === sourceId) return;
      const box = el.getBoundingClientRect();
      const dx = x < box.left ? box.left - x : (x > box.right ? x - box.right : 0);
      const dy = y < box.top ? box.top - y : (y > box.bottom ? y - box.bottom : 0);
      const distance = Math.hypot(dx, dy);
      if (!best || distance < best.distance) best = { el, distance };
    });
    return best?.el || null;
  }

  function dragHitAt(x, y, source) {
    const node = document.elementFromPoint(x, y);
    if (!node) return null;
    const dot = node.closest('.mp-home-dot[data-page-drop]');
    if (dot) return { type: 'dot', page: Number(dot.dataset.pageDrop), el: dot };
    const item = node.closest('[data-drag-id]');
    if (item && item.dataset.dragId !== source.id) {
      return { type: 'item', page: Number(item.dataset.page), id: item.dataset.dragId, el: item, after: dropAfter(item, x, y) };
    }
    const page = node.closest('[data-home-page]');
    if (!page) {
      const viewport = node.closest('.mp-home-viewport');
      if (!viewport) return null;
      const current = viewport.querySelector(`[data-home-page="${pageIndexSafe()}"]`);
      if (!current) return null;
      return blankPageTarget(current, x, y, source);
    }
    return blankPageTarget(page, x, y, source);
  }

  function blankPageTarget(page, x, y, source) {
    /* 落在空白处时找最近的一个项，按它的上半/下半、左半/右半决定插在前还是后。 */
    const near = nearestHomeItem(page, x, y, source.id);
    if (near) {
      return { type: 'item', page: Number(page.dataset.homePage), id: near.dataset.dragId, el: near, after: dropAfter(near, x, y) };
    }
    return { type: 'page', page: Number(page.dataset.homePage), el: page };
  }

  function clearDragMarks() {
    root.querySelectorAll('.is-drop-target').forEach(node => {
      node.classList.remove('is-drop-target');
      delete node.dataset.dropAfter;
    });
  }

  function finishDrag(event, cancelled = false) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const current = drag;
    drag = null;
    root.classList.remove('is-item-dragging');
    current.node.classList.remove('is-dragging');
    current.node.style.transform = '';
    clearDragMarks();
    if (cancelled || !current.active) return;
    suppressClickUntil = Date.now() + 400;
    const target = dragHitAt(event.clientX, event.clientY, current);
    if (!target) return;

    const pages = homePages();
    const sourcePage = Number(current.page);
    const from = pages[sourcePage]?.indexOf(current.id) ?? -1;
    if (from < 0) return;
    const destPage = target.page;
    if (!pages[destPage]) return;

    if (target.type === 'dot' && destPage === sourcePage) return;
    pages[sourcePage].splice(from, 1);
    let at = pages[destPage].length;
    if (target.type === 'item') {
      at = pages[destPage].indexOf(target.id);
      if (at < 0) at = pages[destPage].length;
      if (target.after) at += 1;
    }
    pages[destPage].splice(at, 0, current.id);
    saveHomePages(pages);
    shell.homePage = destPage;
    render();
  }

  root.addEventListener('pointerdown', event => {
    if (shell.stack.length || shell.sheet) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = event.target instanceof Element ? event.target.closest('[data-drag-id]') : null;
    if (!node || !root.contains(node)) return;
    drag = {
      id: node.dataset.dragId,
      page: Number(node.dataset.page) || 0,
      node,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      active: false,
    };
  });

  root.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < 8) return;
      drag.active = true;
      drag.node.classList.add('is-dragging');
      root.classList.add('is-item-dragging');
      try { drag.node.setPointerCapture(event.pointerId); } catch { /* 触摸设备不支持也不影响 */ }
    }
    if (event.cancelable) event.preventDefault();
    drag.x = event.clientX;
    drag.y = event.clientY;
    drag.node.style.transform = `translate3d(${dx}px, ${dy}px, 0) scale(1.035)`;
    const hit = dragHitAt(event.clientX, event.clientY, drag);
    clearDragMarks();
    if (hit && (hit.type === 'item' || hit.type === 'dot')) {
      hit.el.classList.add('is-drop-target');
      if (hit.type === 'item') hit.el.dataset.dropAfter = hit.after ? '1' : '0';
    }
  });

  root.addEventListener('pointerup', event => finishDrag(event));
  root.addEventListener('pointercancel', event => finishDrag(event, true));

  /* 空白处左右滑：翻到另一屏；从 App / 小组件上起手仍然是拖动，不抢手势。 */
  function finishHomeSwipe(event, cancelled = false) {
    if (!homeSwipe || event.pointerId !== homeSwipe.pointerId) return;
    const current = homeSwipe;
    homeSwipe = null;
    current.view.classList.remove('is-swiping');
    if (cancelled || !current.active) { setHomePage(current.startPage); return; }
    suppressClickUntil = Date.now() + 250;
    const dx = event.clientX - current.startX;
    const threshold = Math.max(36, current.width * .16);
    let next = current.startPage;
    if (dx < -threshold && next < HOME_SCREEN_COUNT - 1) next += 1;
    else if (dx > threshold && next > 0) next -= 1;
    setHomePage(next);
  }

  root.addEventListener('pointerdown', event => {
    if (drag || shell.stack.length || shell.sheet) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const node = event.target instanceof Element ? event.target : null;
    if (!node || node.closest('[data-act], [data-drag-id], input, textarea, select')) return;
    const view = node.closest('.mp-home-viewport');
    if (!view) return;
    homeSwipe = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPage: pageIndexSafe(),
      width: view.clientWidth || 1,
      view,
      active: false,
    };
  });

  root.addEventListener('pointermove', event => {
    if (!homeSwipe || drag || event.pointerId !== homeSwipe.pointerId) return;
    const dx = event.clientX - homeSwipe.startX;
    const dy = event.clientY - homeSwipe.startY;
    if (!homeSwipe.active) {
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
      homeSwipe.active = true;
      homeSwipe.view.classList.add('is-swiping');
    }
    if (event.cancelable) event.preventDefault();
    const track = homeSwipe.view.querySelector('.mp-home-track');
    if (track) track.style.transform = `translate3d(${-homeSwipe.startPage * homeSwipe.width + dx}px,0,0)`;
  });

  root.addEventListener('pointerup', event => finishHomeSwipe(event));
  root.addEventListener('pointercancel', event => finishHomeSwipe(event, true));

  function desktopHtml() {
    const state = ctx.state;
    const themeArt = state.settings.dress?.theme === 'pixel' ? PIXEL_BUNNY : null;
    const { myName, myAvatar, myBio } = desktopIdentity(state);
    const ownBanner = String(state.settings.profile?.banner || '').trim();
    const themedBanner = themeArt ? themeArt.banner : '';
    const bannerImage = ownBanner || themedBanner;
    const bannerStyle = bannerImage ? ` style="background-image:url(&quot;${bannerImage}&quot;);background-size:cover;background-position:center"` : '';
    const stampText = dateText().replace('<br>', ' · ');
    const pages = homePages();
    const pageIndex = pageIndexSafe();

    const dockButtons = dockApps.map(app => {
      const badge = app.id === 'chat' ? unreadTotal(state) : 0;
      return `
      <button class="mp-app" data-act="open-app" data-app="${app.id}" type="button" aria-label="${esc(app.name)}">
        ${appTileHtml(app, state, badge)}
        <span class="mp-app-label">${esc(app.name)}</span>
      </button>`;
    }).join('');
    const homePageHtml = pages.map((ids, index) => `
      <div class="mp-home-page" data-home-page="${index}">
        ${ids.map(id => homeItemHtml(id, index, state)).join('')}
      </div>`).join('');
    const homeDotsHtml = pages.map((_, index) => `
      <button class="mp-home-dot${index === pageIndex ? ' is-on' : ''}" data-act="home-page" data-page="${index}" data-page-drop="${index}" type="button" aria-label="第 ${index + 1} 屏" aria-current="${index === pageIndex ? 'true' : 'false'}"></button>`).join('');

    return `
      <div class="mp-desktop">
        <div class="mp-profile">
          <span class="mp-profile-banner${bannerImage ? ' is-custom' : ''}" data-act="profile-banner"${bannerStyle} title="点一下换背景图">
            <span class="mp-profile-stamp">${stampText}</span>
          </span>
          <span class="mp-profile-avatar${myAvatar ? '' : ' is-empty'}" data-act="open-app" data-app="user"${myAvatar ? ` style="background-image:url(&quot;${myAvatar}&quot;)"` : ''}>${myAvatar ? '' : esc(String(myName).slice(0, 1))}</span>
          <span class="mp-profile-name" data-act="open-app" data-app="user">${esc(myName)}</span>
          ${shell.bioEdit ? `
          <div class="mp-profile-bio-edit">
            <input id="mpProfileBio" class="mp-profile-bio-input" type="text" maxlength="30" value="${esc(myBio)}" placeholder="写一句签名">
            <button class="mp-profile-mini is-primary" data-act="profile-bio-save" type="button">存</button>
            <button class="mp-profile-mini" data-act="profile-bio-cancel" type="button">取消</button>
          </div>` : `
          <button class="mp-profile-bio" data-act="profile-bio-edit" type="button">
            <span>${esc(myBio || '点这里写签名')}</span>
            ${ico('brush')}
          </button>`}
        </div>
        <input id="mpProfileBanner" type="file" accept="image/*" style="position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0">

        <div class="mp-home-viewport">
          <div class="mp-home-track" style="transform:translate3d(-${pageIndex * 100}%,0,0)">
            ${homePageHtml}
          </div>
        </div>
        <div class="mp-home-dots">${homeDotsHtml}</div>

        <div class="mp-dock">${dockButtons}</div>
      </div>`;
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

    if (sheet.kind === 'panel') {
      let content = '';
      try {
        content = typeof sheet.render === 'function' ? String(sheet.render()) : String(sheet.body || '');
      } catch (error) {
        content = '<div class="mp-empty">面板暂时打不开。</div>';
      }
      return `
        <div class="mp-mask${still}" data-act="sheet-close"></div>
        <div class="mp-sheet mp-sheet-panel${still}" role="dialog" aria-modal="true">
          ${sheet.title ? `<div class="mp-sheet-title">${esc(sheet.title)}</div>` : ''}
          ${content}
          <button class="mp-sheet-cancel" data-act="sheet-close" type="button">${esc(sheet.doneLabel || '完成')}</button>
        </div>`;
    }

    if (sheet.kind === 'form') {
      const fields = (sheet.fields || []).map((field, index) => {
        const id = `mpField${index}`;
        let control = '';
        if (field.type === 'textarea') {
          control = `<textarea id="${id}" class="mp-sheet-textarea mp-sheet-form-textarea" maxlength="${field.maxLength || 4000}" placeholder="${esc(field.placeholder || '')}">${esc(field.value || '')}</textarea>`;
        } else if (field.type === 'checks') {
          const picked = new Set(Array.isArray(field.value) ? field.value.map(String) : []);
          const options = (field.options || []).map(option => `
            <label class="mp-sheet-check">
              <input type="checkbox" data-check-field="${esc(field.name)}" value="${esc(option.value)}"${picked.has(String(option.value)) ? ' checked' : ''}>
              <span>${esc(option.label)}</span>
            </label>`).join('');
          control = `<div class="mp-sheet-checks">${options}</div>`;
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
      <button class="mp-sheet-item${item.danger ? ' danger' : ''}${item.disabled ? ' is-off' : ''}" data-act="sheet-pick" data-value="${esc(item.value)}" type="button"${item.disabled ? ' disabled aria-disabled="true"' : ''}>
        ${item.icon ? ico(item.icon) : ''}
        <span class="mp-sheet-item-main">
          <span>${esc(item.label)}</span>
          ${item.note ? `<small>${esc(item.note)}</small>` : ''}
        </span>
      </button>`).join('');
    return `
      <div class="mp-mask${still}" data-act="sheet-close"></div>
      <div class="mp-sheet${still}" role="dialog" aria-modal="true">
        ${sheet.title ? `<div class="mp-sheet-title">${esc(sheet.title)}</div>` : ''}
        ${sheet.note ? `<div class="mp-sheet-note">${esc(sheet.note)}</div>` : ''}
        ${items}
        <button class="mp-sheet-cancel" data-act="sheet-close" type="button">取消</button>
      </div>`;
  }

  /* 桌面宿主的窗口往往装不下 844 高的手机：按基准视口等比缩小，整机才不会被裁掉。
     基准视口不随打字弹键盘时的可视高度收缩更新（见 onWindowResize）。 */
  /* 视觉视口矩形：软键盘弹起时 height 扣掉键盘高度，offsetTop/Left 是当前可见区起点 */
  function visualBox() {
    const vv = window.visualViewport;
    return {
      top: vv ? (vv.offsetTop || 0) : 0,
      left: vv ? (vv.offsetLeft || 0) : 0,
      w: vv ? vv.width : (window.innerWidth || 0),
      h: vv ? vv.height : (window.innerHeight || 0),
    };
  }

  /* 当前该用哪套尺寸：手机竖屏按宽度定缩放、把高度让给键盘；桌面沿用基准视口等比缩放 */
  function layoutNow() {
    const vp = readViewport();
    const box = visualBox();
    if (isMobileViewport(vp.w, vp.h)) {
      return { mobile: true, box, ...deviceLayout(vp.w, vp.h, box.h, true) };
    }
    const base = shell.baseViewport || vp;
    return { mobile: false, box, scale: computeDeviceScale(base.w, base.h), height: DEVICE_H };
  }

  function deviceTransformOf(layout) {
    /* 手机竖屏宽度已占满，没有拖动余量 */
    const offset = layout.mobile ? { x: 0, y: 0 } : (shell.deviceOffset || { x: 0, y: 0 });
    return `translate(${Math.round(offset.x || 0)}px, ${Math.round(offset.y || 0)}px) scale(${layout.scale.toFixed(4)})`;
  }

  function deviceTransform() {
    return deviceTransformOf(layoutNow());
  }

  /* 浮层贴住当前可视区，整机按布局结果设缩放与高度：键盘弹起时只有高度在变 */
  function applyLayout() {
    const overlay = root?.querySelector('.mp-overlay');
    const device = root?.querySelector('.mp-device');
    if (!overlay || !device) return null;
    const layout = layoutNow();
    overlay.style.top = `${Math.round(layout.box.top)}px`;
    overlay.style.left = `${Math.round(layout.box.left)}px`;
    overlay.style.width = `${Math.round(layout.box.w)}px`;
    overlay.style.height = `${Math.round(layout.box.h)}px`;
    device.style.height = `${Math.round(layout.height)}px`;
    device.style.transform = deviceTransformOf(layout);
    return layout;
  }

  function render() {
    if (!root) return;
    const state = ctx.state;
    const status = state.settings.theme === 'night' ? 'night' : 'day';
    /* 同一页重绘（切下拉、保存、开关）时把滚动位置带回原位，别让它看起来像整页刷新 */
    const prevView = shell.stack[shell.stack.length - 1]?.view || '';
    const prevScroll = root.querySelector('.mp-page-body')?.scrollTop || 0;
    /* 重绘前记下输入框的光标/选区，重绘后放回原位，别让正在打的字跳到末尾 */
    const prevInput = root.querySelector('.mp-compose-box input');
    const prevSel = prevInput && root.ownerDocument?.activeElement === prevInput
      ? { start: prevInput.selectionStart, end: prevInput.selectionEnd, dir: prevInput.selectionDirection }
      : null;
    root.className = 'mp-root';
    root.dataset.mpTheme = status;
    applyWall(root, state.settings);
    applyLook(root, state.settings);
    /* 先算一次布局：整机高度与缩放一起写进首帧，避免开手机时先按 844 高闪一下再收 */
    const layout = layoutNow();
    const overlayStyle = `top: ${Math.round(layout.box.top)}px; left: ${Math.round(layout.box.left)}px; width: ${Math.round(layout.box.w)}px; height: ${Math.round(layout.box.h)}px`;
    root.innerHTML = `
      <div class="mp-overlay" style="${overlayStyle}">
        <div class="mp-device" style="height: ${Math.round(layout.height)}px; transform: ${deviceTransformOf(layout)}">
          <div class="mp-screen">
            ${state.settings.dress?.island === 'hide' ? '' : '<div class="mp-island"></div>'}
            <div class="mp-drag-handle" data-drag="phone" title="按住顶部拖动手机"></div>
            <div class="mp-wallpaper"></div>
            <div class="mp-scrim"></div>
            <div class="mp-status">
              <span class="mp-status-left">${shell.stack.length && !shell.sheet ? `<button class="mp-status-back" data-act="back" type="button" aria-label="返回">${ico('back')}</button>` : ''}</span>
              <span class="mp-status-right">${clockText()}</span>
            </div>
            ${shell.stack.length ? pageHtml() : desktopHtml()}
            ${sheetHtml()}
            ${shell.toastMessage ? `<div class="mp-toast">${esc(shell.toastMessage)}</div>` : ''}
            <div class="mp-home-bar" data-act="home" title="回桌面"></div>
          </div>
        </div>
      </div>`;

    restoreLive(prevSel);
    shell.improveSendState();
    /* 文字弹层打开后把光标放进去，键盘能直接输入；不抢正在编辑的输入框焦点 */
    if (shell.sheet?.kind === 'text') {
      const node = root.querySelector('#mpSheetText');
      if (node) node.focus();
    }
    if (prevScroll > 0 && (shell.stack[shell.stack.length - 1]?.view || '') === prevView) {
      const box = root.querySelector('.mp-page-body');
      if (box) box.scrollTop = prevScroll;
    }
    if (shell.sheet) shell.sheetAnimated = true;
  }

  function restoreLive(prevSel = null) {
    const input = root.querySelector('.mp-compose-box input');
    if (input && shell.live.inputValue) {
      input.value = shell.live.inputValue;
      shell.improveSendState();
      if (shell.live.focus) {
        input.focus();
        const len = input.value.length;
        const start = prevSel ? Math.min(Math.max(0, prevSel.start), len) : len;
        const end = prevSel ? Math.min(Math.max(start, prevSel.end), len) : len;
        input.setSelectionRange(start, end, prevSel?.dir || 'none');
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
    const busy = button.dataset.busy === '1';
    const pending = Math.max(0, Number(button.dataset.pending) || 0);
    button.classList.toggle('is-stop', busy);
    button.classList.remove('is-text', 'is-request', 'is-wake');
    let label = '停止这次生成';
    if (busy) {
      // 平行时空这类「发送即生成」的 composer 只有停止与发送两种态，不吃唤醒态
    } else if (button.dataset.plain === '1') {
      button.classList.add('is-text');
      label = '发送';
    } else {
      button.classList.toggle('is-text', hasText);
      button.classList.toggle('is-request', !hasText && pending > 0);
      button.classList.toggle('is-wake', !hasText && pending === 0);
      if (hasText) {
        label = '发送';
      } else if (pending > 0) {
        label = `让 TA 回这 ${pending} 条`;
      } else {
        label = '发送';
      }
    }
    button.setAttribute('aria-label', label);
    button.title = label;
  };

  shell.refresh = render;

  /* --------------------------------------------------------- 提示自动消失 */

  /** 就地插入/更新提示条，不重绘整页。 */
  function showToast(message = shell.toastMessage) {
    if (!root) return;
    const screen = root.querySelector('.mp-screen');
    if (!screen) { render(); return; }
    let node = root.querySelector('.mp-toast');
    if (!node) {
      node = document.createElement('div');
      node.className = 'mp-toast';
      const home = screen.querySelector('.mp-home-bar');
      if (home) screen.insertBefore(node, home);
      else screen.append(node);
    }
    node.textContent = String(message || '');
    /* 连着弹两条时把进场动画重播一次 */
    node.style.animation = 'none';
    void node.offsetWidth;
    node.style.animation = '';
  }

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
    'open-recent': (data) => {
      const chat = data.chat ? ctx.state.chats[data.chat] : recentChatOf(ctx.state);
      if (!chat) { ctx.toast('还没有聊天'); return; }
      shell.live = { inputValue: '', focus: false };
      ctx.go('thread', { chatId: chat.id });
    },
    'home-page': (data) => { setHomePage(Number(data.page)); },
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
        if (field.type === 'checks') {
          values[field.name] = [...root.querySelectorAll(`[data-check-field="${field.name}"]`)].filter(node => node.checked).map(node => node.value);
          return;
        }
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
    'profile-banner': () => { root.querySelector('#mpProfileBanner')?.click(); },
    'profile-bio-edit': () => {
      shell.bioEdit = true;
      render();
      setTimeout(() => {
        const node = root.querySelector('#mpProfileBio');
        if (!node) return;
        node.focus();
        node.select();
        node.onkeydown = (event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            root.querySelector('[data-act="profile-bio-save"]')?.click();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            root.querySelector('[data-act="profile-bio-cancel"]')?.click();
          }
        };
      }, 60);
    },
    'profile-bio-save': () => {
      const node = root.querySelector('#mpProfileBio');
      const value = String(node ? node.value : '').trim().slice(0, 30);
      const settings = ctx.state.settings;
      if (!settings.profile || typeof settings.profile !== 'object') settings.profile = { bio: '', banner: '' };
      settings.profile.bio = value;
      shell.bioEdit = false;
      render();
      ctx.save();
      ctx.toast(value ? '签名已经换了' : '签名清空了');
    },
    'profile-bio-cancel': () => { shell.bioEdit = false; render(); },
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
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    /* 原生 <select> / <input> 的取值只走下面的 change 事件；click 阶段还没有选中值，
       不能按按钮动作执行，否则打开下拉或聚焦输入框时会被默认值保存并整页重渲染。 */
    if (event.target.closest('select[data-act], input[data-act], textarea[data-act]')) return;
    const target = event.target.closest('[data-act]');
    if (!target || !root.contains(target)) return;
    const act = target.dataset.act;
    /* 不可点的选项用 disabled 字段，不再按 data-value 前缀一刀切，避免把正常取值吞掉 */
    const data = Object.assign({}, target.dataset);
    const entry = shell.stack[shell.stack.length - 1];
    const app = entry ? apps[entry.view] : null;

    /* 页面先处理，未消费再交给全局 */
    if (app && typeof app.handle === 'function' && app.handle(ctx, act, data, event)) return;
    if (acts[act]) { acts[act](data, event); return; }
    if (typeof ctx.onGlobalAct === 'function' && ctx.onGlobalAct(act, data, event)) return;
  });

  /* 下拉框 / 输入框：原生控件只负责取值，动作仍走统一 handle */
  root.addEventListener('change', event => {
    const target = event.target.closest('[data-act]');
    if (!target || !root.contains(target)) return;
    if (!['SELECT', 'INPUT', 'TEXTAREA'].includes(target.tagName)) return;
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
    /* 手机竖屏宽度已占满，没有拖动余量 */
    if (isMobileViewport(window.innerWidth || 0, window.innerHeight || 0)) return { x: 0, y: 0 };
    const layout = layoutNow();
    const maxX = Math.max(0, (window.innerWidth + (DEVICE_W + DEVICE_PAD) * layout.scale) / 2 - 90 * layout.scale);
    const maxY = Math.max(0, (window.innerHeight + (DEVICE_H + DEVICE_PAD) * layout.scale) / 2 - 120 * layout.scale);
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
  const onPhoneDragMove = event => {
    if (!phoneDrag || event.pointerId !== phoneDrag.id) return;
    const device = root.querySelector('.mp-device');
    if (!device) return;
    const next = clampDeviceOffset(
      phoneDrag.baseX + event.clientX - phoneDrag.startX,
      phoneDrag.baseY + event.clientY - phoneDrag.startY
    );
    shell.deviceOffset = next;
    device.style.transform = deviceTransform();
    event.preventDefault();
  };
  window.addEventListener('pointermove', onPhoneDragMove, { passive: false });
  const endPhoneDrag = event => {
    if (!phoneDrag || event.pointerId !== phoneDrag.id) return;
    phoneDrag = null;
    root.querySelector('.mp-device')?.classList.remove('is-dragging');
  };
  window.addEventListener('pointerup', endPhoneDrag);
  window.addEventListener('pointercancel', endPhoneDrag);
  /* 按当前窗口真实尺寸刷新缩放基准并重排整机 */
  function refreshViewport() {
    shell.baseViewport = readViewport();
    shell.deviceOffset = clampDeviceOffset(shell.deviceOffset?.x || 0, shell.deviceOffset?.y || 0);
    applyLayout();
  }
  function onWindowResize() {
    /* 手机竖屏：键盘顶上来只缩高度、宽度不动，直接按新的可视区重排 */
    if (isMobileViewport(window.innerWidth || 0, window.innerHeight || 0)) {
      applyLayout();
      return;
    }
    /* 桌面：打字弹起软键盘时可视高度会被临时压缩，不能据此把整机缩小；
       聚焦期间保留基准视口，失焦后由 focusout 再按真实窗口刷新一次。 */
    shell.baseViewport = viewportForScale(shell.baseViewport, readViewport(), shell.typing);
    shell.deviceOffset = clampDeviceOffset(shell.deviceOffset?.x || 0, shell.deviceOffset?.y || 0);
    applyLayout();
  }
  window.addEventListener('resize', onWindowResize);
  if (window.visualViewport && typeof window.visualViewport.addEventListener === 'function') {
    window.visualViewport.addEventListener('resize', onWindowResize);
    /* iOS 软键盘时页面常被整体平移而不触发 resize，scroll 也当一次重排信号 */
    window.visualViewport.addEventListener('scroll', onWindowResize);
  }

  /* 上滑：在手机底部那一小段快速上滑才回桌面。
     聊天/分支页的消息列表本身就要上滑滚，输入框里也要上滑选字，这些地方一律不算，
     免得随手滚一下聊天就被退出。 */
  let swipe = null;

  /** 从手势起点往上找，碰到能滚动的容器就不接管这次上滑。 */
  function insideScrollable(node) {
    let el = node;
    while (el && el !== root) {
      if (el.scrollHeight > el.clientHeight + 2) {
        const overflow = getComputedStyle(el).overflowY;
        if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  root.addEventListener('pointerdown', event => {
    if (!shell.stack.length) return;
    const screen = root.querySelector('.mp-screen');
    if (!screen) return;
    if (event.target.closest?.('input, textarea, [contenteditable="true"], .mp-messages, .mp-sheet, .mp-home-viewport')) return;
    const rect = screen.getBoundingClientRect();
    if (!canStartHomeSwipe({
      pointerType: event.pointerType,
      screenHeight: rect.height,
      fromBottom: event.clientY - rect.top,
      onScrollable: insideScrollable(event.target),
    })) return;
    swipe = { x: event.clientX, y: event.clientY, t: Date.now() };
  });

  root.addEventListener('pointerup', event => {
    if (!swipe) return;
    const current = swipe;
    swipe = null;
    if (!shell.stack.length) return;
    if (!isHomeSwipeHit({
      pointerType: event.pointerType,
      dx: event.clientX - current.x,
      dy: event.clientY - current.y,
      dt: Date.now() - current.t,
    })) return;
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
    /* 真的在打字即视为输入态：兜住个别环境 focusin 没派发的情况 */
    if (event.target.closest('input, textarea')) shell.typing = true;
    const entry = shell.stack[shell.stack.length - 1];
    const app = entry ? apps[entry.view] : null;
    if (app && typeof app.onInput === 'function' && app.onInput(ctx, event)) return;
    const input = event.target.closest('.mp-compose-box input');
    if (!input) return;
    shell.live.inputValue = input.value;
    shell.improveSendState();
    if (entry && ctx.onDraft) ctx.onDraft(entry, input.value);
  });

  /* 键盘弹出动画期间可视区会连续变化，聚焦后再补两次重排，兜住个别环境不发 resize 的情况 */
  let keyboardTimer = 0;
  function scheduleLayout() {
    clearTimeout(keyboardTimer);
    keyboardTimer = setTimeout(applyLayout, 260);
  }

  root.addEventListener('focusin', event => {
    if (event.target.closest('input, textarea')) shell.typing = true;
    if (event.target.closest('.mp-compose-box input')) shell.live.focus = true;
    if (event.target.closest('input, textarea')) scheduleLayout();
  });

  root.addEventListener('focusout', event => {
    if (event.target.closest('input, textarea')) shell.typing = false;
    if (event.target.closest('.mp-compose-box input')) {
      shell.live.focus = false;
      /* 键盘收起后视口高度恢复，按真实窗口重新对一次缩放基准；延迟等收起动画结束 */
      setTimeout(() => { if (!shell.typing) refreshViewport(); }, 120);
    }
  });

  root.addEventListener('scroll', event => {
    if (event.target.classList?.contains('mp-messages')) shell.scroller = event.target.scrollTop;
  }, true);

  root.addEventListener('keydown', event => {
    /* 中文输入法正在组词时，Enter/Escape 是在选词上屏或取消候选，不作为快捷键 */
    if (event.isComposing || event.keyCode === 229) return;
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
    /* 关手机时把挂在 window 上的监听和计时器一起收掉，反复开关不累积 */
    destroy() {
      clearInterval(timer);
      clearTimeout(shell.toastTimer);
      clearTimeout(keyboardTimer);
      window.removeEventListener('pointermove', onPhoneDragMove);
      window.removeEventListener('pointerup', endPhoneDrag);
      window.removeEventListener('pointercancel', endPhoneDrag);
      window.removeEventListener('resize', onWindowResize);
      if (window.visualViewport && typeof window.visualViewport.removeEventListener === 'function') {
        window.visualViewport.removeEventListener('resize', onWindowResize);
        window.visualViewport.removeEventListener('scroll', onWindowResize);
      }
      if (root) root.innerHTML = '';
    },
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
