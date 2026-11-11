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

export async function startMemePhone() {
  mountPanel();
  try {
    await boot();
    setStatus(describeStatus({ ready: true }));
  } catch (error) {
    setStatus(`载入失败：${error?.message || error}`, true);
  }
  registerMenuEntry();
  setInterval(() => { if (!isOpen()) registerMenuEntry(); }, 5000);
}

if (eventSource?.once && event_types?.APP_READY) eventSource.once(event_types.APP_READY, () => { void startMemePhone(); });
if (document.readyState === 'complete' && document.getElementById('extensionsMenu')) {
  queueMicrotask(() => { void startMemePhone(); });
}

export { openMemePhone, closeMemePhone, closeUI };
