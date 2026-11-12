/**
 * meme-phone · 酒馆扩展入口
 *
 * 只做三件事：在扩展设置里放一个面板、在扩展菜单里放一个入口、负责挂载/卸载界面。
 * 界面本身的代码全在 meme/ 下，与宿主无关的部分可以单独打开预览页看。
 */

import { eventSource, event_types, getRequestHeaders } from '/script.js';
import { openMemePhone, closeMemePhone, initMemePhone, isOpen, getState, closeMemePhone as closeUI } from './meme/index.js';

const PANEL_ID = 'meme-phone-settings';
const MENU_ID = 'meme-phone-menu-entry';

let panel = null;
let bootPromise = null;
let busy = false;

function ui(role) { return panel?.querySelector(`[data-role="${role}"]`); }

function setStatus(text, isError = false) {
  const node = ui('status');
  if (!node) return;
  node.textContent = text;
  node.dataset.error = String(isError);
}

function describeStatus(status) {
  if (!status) return '';
  if (status.error) return `保存出错：${status.error}\n请先在下面导出备份，再刷新页面。`;
  if (status.saving) return '正在保存…';
  if (status.dirty) return '有改动还没写入。';
  return '已同步。';
}

async function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = initMemePhone({ getHeaders: () => getRequestHeaders() })
    .catch(error => { bootPromise = null; throw error; });
  return bootPromise;
}

async function openPhone() {
  if (busy) return;
  busy = true;
  setStatus('正在打开…');
  try {
    await boot();
    await openMemePhone({ getHeaders: () => getRequestHeaders(), seedFromTavern: true });
    setStatus('已打开。关掉窗口后回到这里。');
  } catch (error) {
    setStatus(`打开失败：${error?.message || error}`, true);
  } finally {
    busy = false;
  }
}

function registerMenuEntry() {
  let item = document.getElementById(MENU_ID);
  if (!item) {
    const menu = document.querySelector('#extensionsMenu');
    if (!menu) return null;
    item = document.createElement('div');
    item.id = MENU_ID;
    item.className = 'list-group-item flex-container flexGap5';
    item.innerHTML = '<div class="fa-solid fa-mobile-screen extensionsMenuExtensionButton"></div><span>meme-phone</span>';
    item.addEventListener('click', () => { void openPhone(); });
    menu.append(item);
  }
  return item;
}

function mountPanel() {
  if (panel) return;
  panel = document.createElement('details');
  panel.id = PANEL_ID;
  panel.open = false;
  panel.innerHTML = `
    <summary>meme-phone · 桌面式小手机</summary>
    <p class="meme-note">桌面 + App 图标的前端，数据单独存在 <code>/user/files/meme-phone.json</code>，不会写进酒馆的角色卡或聊天记录。</p>
    <p class="meme-note">召唤：点扩展菜单，或点聊天框上方快捷回复栏里的「召唤手机」；也可以在输入框敲 <code>/meme</code>。</p>
    <div class="meme-actions">
      <button type="button" data-role="open">打开手机</button>
      <button type="button" data-role="export">导出备份</button>
      <label><input type="file" accept=".json,application/json" data-role="import">导入备份</label>
    </div>
    <p data-role="status" class="meme-note"></p>
  `;

  const target = document.querySelector('#extensions_settings2, #extensions_settings');
  if (!target) panel.classList.add('meme-floating');
  (target || document.body).append(panel);

  ui('open').addEventListener('click', () => { void openPhone(); });

  ui('export').addEventListener('click', () => {
    try {
      const state = getState();
      if (!state) { setStatus('还没载入数据。', true); return; }
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `meme-phone-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('备份已导出。');
    } catch (error) {
      setStatus(`导出失败：${error?.message || error}`, true);
    }
  });

  ui('import').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!globalThis.confirm('导入会替换当前 meme-phone 的全部数据。确定继续？')) return;
      const { importState } = await import('./meme/index.js');
      await importState(parsed);
      setStatus('导入完成，刷新页面后再打开手机。');
    } catch (error) {
      setStatus(`导入失败：${error?.message || error}`, true);
    } finally {
      event.target.value = '';
    }
  });

  globalThis.addEventListener('meme-phone-storage-status', event => {
    setStatus(describeStatus(event.detail));
  });
}

/* ------------------------------------------------------------ 召唤入口 */

/**
 * 注册 /meme 斜杠命令：快捷回复（QR）点一下就能召唤出手机。
 * 酒馆没给这套接口时静默跳过，不影响菜单入口。
 */
function registerSlashCommand() {
  try {
    const ctx = globalThis.SillyTavern?.getContext?.() || {};
    const Parser = ctx.SlashCommandParser || globalThis.SlashCommandParser;
    const Command = ctx.SlashCommand || globalThis.SlashCommand;
    if (!Parser?.addCommandObject || !Command?.fromProps) return false;
    if (globalThis.__MEME_QR_REGISTERED__) return true;
    Parser.addCommandObject(Command.fromProps({
      name: 'meme',
      aliases: ['召唤手机'],
      helpString: '打开 meme-phone 小手机（也可以给它当快捷回复用）',
      returns: 'nothing',
      callback: () => { void openPhone(); return ''; },
    }));
    globalThis.__MEME_QR_REGISTERED__ = true;
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ QR 快速回复栏按钮 */

/**
 * 在聊天框上方的原生快速回复栏（#qr--bar）里挂一个「召唤手机」按钮，
 * 外观直接复用 ST 原生 .qr--button 样式，不另写皮肤。
 *
 * 范式与相邻的 ST-BaiBai-Book / JS-Slash-Runner 一致：
 *   #qr--bar（没有就自建一条同款）
 *     └ .qr--buttons（没有就补一个）
 *         └ .qr--button（我们的按钮）
 * ST 切聊天 / 改 QR 设置时会重建 #qr--bar，把我们的按钮冲掉，
 * 所以用 MutationObserver 盯住 #send_form，被冲掉就补回；聊天框懒加载时先轮询。
 */

const QR_BTN_ID = 'meme-phone-qr-button';
const QR_BAR_CLASS = 'meme-phone-qr-bar';
let qrPollTimer = null;
let qrObserver = null;

function ensureQrHolder(sendForm) {
  let bar = Array.from(sendForm.querySelectorAll('div')).find(node => node.id === 'qr--bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'qr--bar';
    bar.className = `${QR_BAR_CLASS} flex-container flexGap5`;
    sendForm.prepend(bar);
  }
  let holder = bar.querySelector('.qr--buttons');
  if (!holder) {
    holder = document.createElement('div');
    holder.className = 'qr--buttons';
    bar.appendChild(holder);
  }
  return holder;
}

function buildQrButton() {
  const btn = document.createElement('div');
  btn.id = QR_BTN_ID;
  btn.className = 'qr--button menu_button interactable';
  btn.setAttribute('tabindex', '0');
  btn.title = '打开 meme-phone 小手机';
  btn.textContent = '召唤手机';
  const activate = event => {
    event.preventDefault();
    event.stopPropagation();
    void openPhone();
  };
  btn.addEventListener('click', activate);
  btn.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') activate(event);
  });
  return btn;
}

/** 真正执行插入：成功或已存在返回 true，聊天框未就绪返回 false（由轮询重试）。 */
function tryInjectQr() {
  const sendForm = document.getElementById('send_form');
  if (!sendForm) return false;
  if (document.getElementById(QR_BTN_ID)) return true;
  ensureQrHolder(sendForm).appendChild(buildQrButton());
  return true;
}

function removeQrButton() {
  document.getElementById(QR_BTN_ID)?.remove();
  // 若是我们自建的空 #qr--bar，按钮撤了就一并回收，别留空条
  const bar = document.querySelector(`#qr--bar.${QR_BAR_CLASS}`);
  if (bar && !bar.querySelector('.qr--buttons')?.children.length) bar.remove();
}

/** 盯住 #send_form：ST 重建 #qr--bar 把按钮冲掉时补回（幂等，tryInjectQr 自带存在检查）。 */
function startQrObserver() {
  if (qrObserver) return;
  const sendForm = document.getElementById('send_form');
  if (!sendForm) return;
  qrObserver = new MutationObserver(() => {
    if (!document.getElementById(QR_BTN_ID)) tryInjectQr();
  });
  qrObserver.observe(sendForm, { childList: true, subtree: true });
}

/** 按开关同步 QR 按钮的有无；当前扩展没有开关，启动即常开，幂等。 */
function syncQrButton(enabled) {
  if (qrPollTimer) {
    clearInterval(qrPollTimer);
    qrPollTimer = null;
  }
  if (!enabled) {
    qrObserver?.disconnect();
    qrObserver = null;
    removeQrButton();
    return;
  }
  if (tryInjectQr()) {
    startQrObserver();
    return;
  }
  // 聊天框懒加载：轮询等它出现，封顶 ~20s（40 次）后放弃，绝不常驻空转。
  let attempts = 0;
  qrPollTimer = setInterval(() => {
    if (tryInjectQr() || ++attempts > 40) {
      if (qrPollTimer) {
        clearInterval(qrPollTimer);
        qrPollTimer = null;
      }
      if (document.getElementById(QR_BTN_ID)) startQrObserver();
    }
  }, 500);
}

/* ------------------------------------------------------------ 柏宝书只读桥 */

/**
 * meme-phone 只读取已安装柏宝书暴露的 `STBaiBaiBook`；
 * 不再动态导入 `baibai-book/` 内置副本。
 *
 * 两份柏宝书会挂载到同一个 `#bbs-app-host`，后启动的副本会清空前一份的
 * shadow root；扩展菜单又按固定 `#bbs-menu-item` 去重，容易出现菜单还在、
 * 点开却是空白或无反应的情况。手机侧的记忆读取仍然走 `bookApi()` 只读桥。
 */

export async function startMemePhone() {
  mountPanel();
  registerSlashCommand();
  syncQrButton(true);
  try {
    await boot();
    setStatus(describeStatus({ ready: true }));
  } catch (error) {
    setStatus(`载入失败：${error?.message || error}`, true);
  }
  registerMenuEntry();
  setInterval(() => {
    if (!isOpen()) registerMenuEntry();
    if (!document.getElementById(QR_BTN_ID) && tryInjectQr()) startQrObserver();
  }, 5000);
}

if (eventSource?.once && event_types?.APP_READY) eventSource.once(event_types.APP_READY, () => { void startMemePhone(); });
if (document.readyState === 'complete' && document.getElementById('extensionsMenu')) {
  queueMicrotask(() => { void startMemePhone(); });
}

export { openMemePhone, closeMemePhone, closeUI };
