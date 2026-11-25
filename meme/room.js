/**
 * meme-phone · 平行时空 · 独立房间
 *
 * 这一页不挂在小手机的 App 路由上，也不套手机壳：它自己在 body 上铺一层满屏房间，
 * 左边是「场」，右边是这一场的会话，设置从右侧抽屉进。数据和生成还是走小手机存档
 * 与酒馆的 quiet prompt，但界面、事件、样式全部由本文件自己管，等于一个新做的界面。
 */

import { icon } from './icons.js';
import {
  theatersOf, theaterById, theaterTitleOf, theaterMessage, addTheater,
  contactById, contactForTavernCharacter, setTheaterConfig, THEATER_EXTRA_MAX,
} from './data.js';
import { branchReply, stopTavernGeneration, readOpenTavernChat, readTavernMemory } from './host.js';
import { estimateTokens } from './reply-context.js';

const TITLE_MAX = 32;
const roleName = { system: '系统', user: '用户', assistant: '角色' };

const room = {
  ctx: null,
  root: null,
  id: '',
  draft: '',
  panel: null,          // null | 'settings' | 'prompt' | 'dialog'
  dialog: null,         // { kind, title, note, confirm, input }
  ctxOpen: false,
  extraDraft: '',
  listOpen: false,
  runs: new Map(),
  prompts: new Map(),
  toastTimer: 0,
};

/* --------------------------------------------------------------- 小工具 */

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clock(ms) {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function when(ms) {
  if (!ms) return '';
  const date = new Date(ms);
  const today = new Date();
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return clock(ms);
  const days = Math.round((new Date(today).setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function chatName(file, character = '') {
  let label = String(file || '').replace(/\.jsonl$/i, '');
  const name = String(character || '').trim();
  if (name && label.startsWith(`${name} - `)) label = label.slice(name.length + 3);
  return label;
}

function statusLine(theater) {
  const cfg = theater?.cfg || {};
  if (cfg.historyMode === 'none') return '不带酒馆背景';
  if (cfg.historyMode === 'recent') return `最近 ${cfg.historyFloors || 30} 层`;
  return `第 ${theater?.forkFloor || 0} 楼`;
}

function historyLabel(theater) {
  const cfg = theater?.cfg || {};
  if (cfg.historyMode === 'none') return '不带背景';
  if (cfg.historyMode === 'recent') return `最近 ${cfg.historyFloors || 30} 层`;
  if (theater?.base?.length) return `内联快照 · ${theater.base.length} 层`;
  return theater?.forkFloor ? `酒馆原文 · 前 ${theater.forkFloor} 楼` : '没有背景';
}

function memoryLabel(theater) {
  const mode = theater?.cfg?.memoryMode || 'tavern';
  const size = String(theater?.memory?.text || '').trim().length;
  if (mode === 'fixed') return size ? `固定开场时 ${size} 字` : '固定总结 · 没读到';
  return size ? `跟随酒馆 · ${size} 字` : '跟随酒馆';
}

/** 这次生成实际拿到的记忆是什么：柏宝书总结 / 没读到（不是原始楼层）。 */
function memorySource(theater) {
  const size = String(theater?.memory?.text || '').trim().length;
  const engine = String(theater?.memory?.engine || '');
  if (engine === 'baibai' && size) return `现在读到的是柏宝书总结，${size} 字`;
  if (engine === 'baibai') return '柏宝书在，但这次没读到总结';
  return '没读到柏宝书总结；生成时按酒馆自己的提示词注入走';
}

function hue(name) {
  let sum = 0;
  for (const ch of String(name || '?')) sum = (sum * 31 + ch.codePointAt(0)) % 360;
  return sum;
}

function avatar(name, url, className = 'prt-av') {
  const initial = String(name || '?').trim().slice(0, 1) || '?';
  const style = url
    ? `background-image:url(&quot;${esc(url)}&quot;)`
    : `background:linear-gradient(150deg,hsl(${hue(name)} 46% 62%),hsl(${hue(name) + 34} 44% 48%))`;
  return `<span class="${className}${url ? ' has-img' : ''}" style="${style}">${url ? '' : esc(initial)}</span>`;
}

function contactOf(theater) {
  return theater?.contactId ? contactById(room.ctx.state, theater.contactId) : null;
}

function nameOf(theater) {
  return contactOf(theater)?.name || theater?.characterName || 'TA';
}

function avatarOf(theater) {
  const contact = contactOf(theater);
  return contact?.avatar || theater?.characterAvatar || '';
}

function preview(theater) {
  const messages = theater?.messages || [];
  const last = messages[messages.length - 1];
  if (!last) return `从《${chatName(theater?.chatFile, theater?.characterName) || '酒馆聊天'}》第 ${theater?.forkFloor || 0} 楼接下去`;
  return `${last.is_user ? '我：' : ''}${String(last.mes || '').replace(/\s+/g, ' ').slice(0, 60)}`;
}

function themeOf() {
  return room.ctx?.state?.settings?.theme === 'night' ? 'night' : 'day';
}

function isBusy(theater) {
  const task = theater ? room.runs.get(theater.id) : null;
  return Boolean(task && !task.done);
}

function toast(text) {
  if (!room.root) return;
  let node = room.root.querySelector('.prt-toast');
  if (!node) {
    node = document.createElement('div');
    node.className = 'prt-toast';
    room.root.appendChild(node);
  }
  node.textContent = text;
  node.classList.add('is-on');
  clearTimeout(room.toastTimer);
  room.toastTimer = setTimeout(() => node?.classList.remove('is-on'), 2200);
}

function save() {
  try { room.ctx?.save?.(); } catch { /* 存档停了也不该炸界面 */ }
}

/* --------------------------------------------------------------- 界面 */

function railHtml(activeTheater) {
  const list = theatersOf(room.ctx.state);
  const order = [];
  const groups = new Map();
  for (const theater of list) {
    const key = theater.chatFile || `x:${theater.characterName}`;
    if (!groups.has(key)) {
      groups.set(key, { file: theater.chatFile, name: theater.characterName, list: [] });
      order.push(key);
    }
    groups.get(key).list.push(theater);
  }

  const body = order.map(key => {
    const group = groups.get(key);
    const head = group.name || 'TA';
    return `
      <div class="prt-group">${esc(head)}${group.file ? `<span>${esc(chatName(group.file, head))}</span>` : ''}</div>
      ${group.list.map(theater => `
        <button class="prt-item${theater.id === activeTheater?.id ? ' is-on' : ''}" data-prt="open" data-id="${esc(theater.id)}" type="button">
          ${avatar(nameOf(theater), avatarOf(theater))}
          <span class="prt-item-main">
            <span class="prt-item-name">${esc(theaterTitleOf(theater))}</span>
            <span class="prt-item-sub">${esc(preview(theater))}</span>
          </span>
          <span class="prt-item-when">${theater.updatedAt ? when(theater.updatedAt) : ''}</span>
        </button>`).join('')}`;
  }).join('');

  return `
    <aside class="prt-rail${room.listOpen || !activeTheater ? ' is-open' : ''}">
      <header class="prt-rail-top">
        <button class="prt-ico" data-prt="exit" type="button" aria-label="回小手机">${icon('back')}</button>
        <span class="prt-rail-name">平行时空</span>
        <button class="prt-ico is-accent" data-prt="new" type="button" aria-label="从当前聊天开一场">${icon('plus')}</button>
      </header>
      <div class="prt-rail-list">${body || `
        <div class="prt-blank">
          还没有开过场。
          <br>先在酒馆打开一个聊天，再点右上角的加号。
        </div>`}</div>
      <footer class="prt-rail-foot">
        <button class="prt-rail-new" data-prt="new" type="button">
          ${icon('plus')}<span>从当前聊天开一场</span>
        </button>
      </footer>
    </aside>`;
}

function headHtml(theater) {
  return `
    <header class="prt-top">
      <button class="prt-ico prt-only-narrow" data-prt="rail" type="button" aria-label="看别的场">${icon('plan')}</button>
      ${avatar(nameOf(theater), avatarOf(theater), 'prt-av is-lg')}
      <div class="prt-title">
        <div class="prt-title-name">${esc(theaterTitleOf(theater))}</div>
        <div class="prt-title-sub">${esc(chatName(theater.chatFile, theater.characterName) || '未绑定酒馆聊天')}</div>
      </div>
      <button class="prt-ico" data-prt="settings" type="button" aria-label="这一场的设置">${icon('settings')}</button>
    </header>`;
}

function messageHtml(theater, message) {
  const cfg = theater.cfg || {};
  const me = Boolean(message.is_user);
  const name = me ? (message.name || '我') : (message.name || nameOf(theater));
  const url = me ? (room.ctx.state.settings.user.avatar || '') : avatarOf(theater);
  const time = cfg.showTime === false || !message.at ? '' : clock(message.at);
  return `
    <article class="prt-msg${me ? ' me' : ''}">
      ${cfg.showAvatar === false ? '' : avatar(name, url)}
      <div class="prt-body">
        <div class="prt-who"><b>${esc(name)}</b>${time ? `<span>${time}</span>` : ''}</div>
        <div class="prt-text">${esc(message.mes || '')}</div>
      </div>
    </article>`;
}

function noteHtml(theater) {
  return `
    <div class="prt-note">
      <span>${esc(statusLine(theater))}</span>
      <span class="dot">·</span>
      <span>${esc(memoryLabel(theater))}</span>
      <button class="prt-mini" data-prt="prompt" type="button">看提示词</button>
    </div>`;
}

function streamHtml(theater) {
  const blocks = [noteHtml(theater)];
  for (const message of theater.messages || []) blocks.push(messageHtml(theater, message));
  if (isBusy(theater)) {
    blocks.push(`
      <article class="prt-msg is-typing">
        ${avatar(nameOf(theater), avatarOf(theater))}
        <div class="prt-body">
          <div class="prt-who"><b>${esc(nameOf(theater))}</b></div>
          <div class="prt-dots"><i></i><i></i><i></i></div>
        </div>
      </article>`);
  }
  if (!(theater.messages || []).length && !isBusy(theater)) {
    blocks.push('<div class="prt-blank is-center">还没说话。发一句，酒馆会顺着这条分支往下写。</div>');
  }
  return `<div class="prt-stream" data-prt-stream>${blocks.join('')}</div>`;
}

function composerHtml(theater) {
  const busy = isBusy(theater);
  const failed = theater.failed;
  return `
    <div class="prt-compose">
      ${failed ? `
        <div class="prt-fail">
          <span>${esc(failed.reason || '这一轮没接通')}</span>
          <button class="prt-mini is-strong" data-prt="retry" type="button">重试</button>
          <button class="prt-mini" data-prt="undo" type="button">撤回这句</button>
        </div>` : ''}
      <div class="prt-input">
        <textarea data-prt-input rows="1" enterkeyhint="send" placeholder="发一句，酒馆那边接着写…"
          autocomplete="off" autocorrect="off" autocapitalize="sentences" spellcheck="false" maxlength="2000">${esc(room.draft)}</textarea>
        <button class="prt-send${busy ? ' is-stop' : ''}" data-prt="${busy ? 'stop' : 'send'}" type="button" aria-label="${busy ? '停止这次生成' : '发送'}">
          ${icon(busy ? 'stop' : 'send')}
        </button>
      </div>
    </div>`;
}

function mainHtml(theater) {
  if (!theater) {
    const any = theatersOf(room.ctx.state).length;
    return `
      <main class="prt-main">
        <div class="prt-welcome">
          <div class="prt-welcome-mark">${icon('parallel')}</div>
          <div class="prt-welcome-text">
            ${any ? '从左边挑一场接着聊，或者从当前酒馆聊天再开一条时间线。'
              : '从酒馆某段聊天分出来的一条时间线。收发只存在小手机里，酒馆那边一个字都不会多。'}
          </div>
          <button class="prt-primary" data-prt="new" type="button">${icon('plus')}<span>从当前聊天开一场</span></button>
        </div>
      </main>`;
  }
  return `
    <main class="prt-main">
      ${headHtml(theater)}
      ${streamHtml(theater)}
      ${composerHtml(theater)}
    </main>`;
}

/* --------------------------------------------------------------- 设置抽屉 */

function row({ act, id, title, sub = '', value = '', danger = false }) {
  return `
    <button class="prt-row${danger ? ' is-danger' : ''}" data-prt="${act}" data-id="${esc(id)}" type="button">
      <span class="prt-row-main">
        <span class="prt-row-name">${esc(title)}</span>
        ${sub ? `<span class="prt-row-sub">${esc(sub)}</span>` : ''}
      </span>
      ${value ? `<span class="prt-row-value">${esc(value)}</span>` : ''}
      ${icon('chevron')}
    </button>`;
}

function switchRow({ act, id, title, sub = '', on }) {
  return `
    <button class="prt-row" data-prt="${act}" data-id="${esc(id)}" type="button">
      <span class="prt-row-main">
        <span class="prt-row-name">${esc(title)}</span>
        ${sub ? `<span class="prt-row-sub">${esc(sub)}</span>` : ''}
      </span>
      <span class="prt-sw${on ? ' is-on' : ''}"><i></i></span>
    </button>`;
}

function chips({ act, id, options, current }) {
  return `
    <div class="prt-chips">
      ${options.map(item => `
        <button class="prt-chip${item.value === current ? ' is-on' : ''}" data-prt="${act}" data-id="${esc(id)}" data-v="${esc(item.value)}" type="button">${esc(item.label)}</button>`).join('')}
    </div>`;
}

function contextBlock(theater) {
  const cfg = theater.cfg || {};
  const extra = String(cfg.extraPrompt || '').trim();
  return `
    <div class="prt-ctx">
      <div class="prt-ctx-row"><b>背景</b><span>${esc(historyLabel(theater))}</span></div>
      <div class="prt-ctx-note">${esc(cfg.historyMode === 'fork' && theater.base?.length
        ? '存档里存着当时那段聊天的副本，酒馆后来聊的不会进来。'
        : cfg.historyMode === 'recent'
          ? '每次生成取酒馆当前聊天最新的一段，分叉点只作记录。'
          : cfg.historyMode === 'none'
            ? '不给背景楼层，只看这一场自己说的话。'
            : `每次生成从酒馆当前聊天取前 ${theater.forkFloor || 0} 楼。`)}</div>
      <div class="prt-ctx-row"><b>分叉点</b><span>第 ${theater.forkFloor || 0} 楼</span></div>
      ${extra ? `<div class="prt-ctx-row"><b>额外指令</b><span>${esc(String(cfg.extraPrompt).trim().length)} 字</span></div>` : ''}
      ${theater.memory?.text ? `
        <div class="prt-ctx-row"><b>开场记忆</b><span>${esc(memoryLabel(theater))}</span></div>
        <div class="prt-ctx-text">${esc(theater.memory.text)}</div>` : ''}
    </div>`;
}

function settingsHtml(theater) {
  const cfg = theater.cfg || {};
  const memorySize = String(theater.memory?.text || '').trim().length;
  return `
    <div class="prt-scrim" data-prt="close-panel"></div>
    <aside class="prt-pop">
      <header class="prt-pop-top">
        <button class="prt-ico" data-prt="close-panel" type="button" aria-label="回到会话">${icon('back')}</button>
        <div class="prt-pop-title">
          <b>这一场</b>
          <span>${esc(nameOf(theater))} · ${esc(chatName(theater.chatFile, theater.characterName) || '未绑定')}</span>
        </div>
        <button class="prt-ico" data-prt="rename" type="button" aria-label="改名">${icon('brush')}</button>
      </header>
      <div class="prt-pop-body">
        <div class="prt-label">背景</div>
        ${chips({
          act: 'history', id: theater.id, current: cfg.historyMode || 'fork',
          options: [
            { value: 'fork', label: '分叉点之前' },
            { value: 'recent', label: '最近一段' },
            { value: 'none', label: '不带背景' },
          ],
        })}
        ${cfg.historyMode === 'recent' ? `
          <label class="prt-row prt-row-input">
            <span class="prt-row-main">
              <span class="prt-row-name">取最近几层</span>
              <span class="prt-row-sub">1 - 200，按酒馆当前聊天算</span>
            </span>
            <input class="prt-number" type="number" inputmode="numeric" min="1" max="200" step="1"
              value="${cfg.historyFloors || 30}" data-prt-floors data-id="${esc(theater.id)}" aria-label="取最近几层">
          </label>` : ''}
        ${row({ act: 'toggle-ctx', id: theater.id, title: '看这一场的背景', value: room.ctxOpen ? '收起' : '展开' })}
        ${room.ctxOpen ? contextBlock(theater) : ''}

        <div class="prt-label">记忆</div>
        ${chips({
          act: 'memory', id: theater.id, current: cfg.memoryMode || 'tavern',
          options: [
            { value: 'tavern', label: '跟随酒馆' },
            { value: 'fixed', label: '固定开场总结' },
          ],
        })}
        <div class="prt-hint">${esc(memorySource(theater))}</div>
        ${row({ act: 'refresh-memory', id: theater.id, title: '读一下酒馆现在的记忆', sub: memorySize ? '用现在的总结替换开场那份' : '这场还没读到总结', value: memorySize ? '重新读' : '去读' })}

        <div class="prt-label">这一场</div>
        <div class="prt-extra">
          <textarea data-prt-extra maxlength="${THEATER_EXTRA_MAX}" placeholder="只对这一场说的话，比如「他还不知道那件事」">${esc(room.extraDraft)}</textarea>
          <button class="prt-mini is-strong" data-prt="save-extra" data-id="${esc(theater.id)}" type="button">存下来</button>
        </div>
        ${switchRow({ act: 'toggle-time', id: theater.id, title: '显示时间', on: cfg.showTime !== false })}
        ${switchRow({ act: 'toggle-avatar', id: theater.id, title: '显示头像', sub: '关掉以后只留文字，适合截图分享', on: cfg.showAvatar !== false })}
        ${switchRow({ act: 'toggle-worldbook', id: theater.id, title: '带角色世界书', sub: '关掉以后这一场不注入这个角色绑的主书和附加书，酒馆那边不动', on: cfg.showWorldBook !== false })}

        <div class="prt-label">操作</div>
        ${row({ act: 'follow', id: theater.id, title: '跟到酒馆最新楼层', sub: `现在接在第 ${theater.forkFloor || 0} 楼`, value: '跟上' })}
        ${row({ act: 'regen', id: theater.id, title: '重新让 TA 说最后一句', sub: '丢掉末尾那条回复再生成', value: '重说' })}
        ${row({ act: 'prompt', id: theater.id, title: '看上一次的提示词', value: room.prompts.has(theater.id) ? '有' : '没有' })}
        ${row({ act: 'ask-clear', id: theater.id, title: '清空这一场说过的话', sub: '背景和设置都留着', value: '清空', danger: true })}
        ${row({ act: 'ask-delete', id: theater.id, title: '删掉这一场', sub: '只删小手机里的分支，酒馆那边不动', value: '删除', danger: true })}
      </div>
    </aside>`;
}

function promptHtml(theater) {
  const prompt = room.prompts.get(theater.id) || null;
  const rows = Array.isArray(prompt) && prompt.length
    ? prompt.map(message => `
      <div class="prt-prompt-row">
        <div class="prt-prompt-role">${esc(roleName[message?.role] || message?.role || '')}<span>${estimateTokens(String(message?.content || ''))}tk</span></div>
        <div class="prt-prompt-text">${esc(message?.content || '')}</div>
      </div>`).join('')
    : '<div class="prt-blank">这一次没抓到酒馆发出去的提示词。文本补全接口不走这份事件，可以在酒馆里用 /prompt 查看；聊天补全接口会在下一轮写进这里。</div>';
  const total = Array.isArray(prompt) ? prompt.reduce((sum, m) => sum + estimateTokens(String(m?.content || '')), 0) : 0;
  return `
    <div class="prt-scrim" data-prt="close-panel"></div>
    <aside class="prt-pop">
      <header class="prt-pop-top">
        <button class="prt-ico" data-prt="close-panel" type="button" aria-label="回到会话">${icon('back')}</button>
        <div class="prt-pop-title"><b>上一次发出的提示词</b><span>${Array.isArray(prompt) ? `${prompt.length} 条 · 约 ${total}tk` : '还没生成过'}</span></div>
      </header>
      <div class="prt-pop-body">${rows}</div>
    </aside>`;
}

function dialogHtml() {
  const dialog = room.dialog;
  if (!dialog) return '';
  return `
    <div class="prt-scrim is-solid" data-prt="close-dialog"></div>
    <div class="prt-dialog">
      <div class="prt-dialog-title">${esc(dialog.title)}</div>
      ${dialog.note ? `<div class="prt-dialog-note">${esc(dialog.note)}</div>` : ''}
      ${dialog.input !== undefined ? `<input class="prt-dialog-input" data-prt-dialog-input value="${esc(dialog.input)}" maxlength="${dialog.maxLength || TITLE_MAX}">` : ''}
      <div class="prt-dialog-actions">
        <button class="prt-dialog-btn" data-prt="close-dialog" type="button">先不动</button>
        <button class="prt-dialog-btn is-danger" data-prt="confirm-dialog" type="button">${esc(dialog.confirm || '确定')}</button>
      </div>
    </div>`;
}

function paint() {
  if (!room.root) return;
  const theater = theaterById(room.ctx.state, room.id) || null;
  if (room.id && !theater) room.id = '';
  room.root.dataset.prtTheme = themeOf();
  room.root.dataset.prtView = theater ? 'chat' : 'list';

  const hadFocus = Boolean(room.root.contains(document.activeElement))
    && document.activeElement?.matches('[data-prt-input]');
  const layers = [
    room.panel === 'settings' && theater ? settingsHtml(theater) : '',
    room.panel === 'prompt' && theater ? promptHtml(theater) : '',
    dialogHtml(),
  ].join('');

  room.root.innerHTML = `
    <div class="prt-shell">
      ${railHtml(theater)}
      ${mainHtml(theater)}
    </div>
    ${layers}`;

  if (hadFocus) room.root.querySelector('[data-prt-input]')?.focus();
  scrollBottom();
}

function scrollBottom() {
  const stream = room.root?.querySelector('[data-prt-stream]');
  if (!stream) return;
  const jump = () => { stream.scrollTop = stream.scrollHeight; };
  jump();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(jump);
}

function autoGrow(node) {
  if (!node) return;
  node.style.height = 'auto';
  node.style.height = `${Math.min(node.scrollHeight, 180)}px`;
}

/* --------------------------------------------------------------- 生成 */

async function readHost() {
  const host = await readOpenTavernChat();
  return host;
}

async function bindIfNeeded(theater) {
  if (theater.chatFile) return true;
  const host = await readHost();
  if (!host.available) { toast(host.reason || '先在酒馆里打开要接的聊天'); return false; }
  theater.chatFile = host.chatFile;
  theater.chatId = host.chatId;
  theater.characterName = host.characterName || theater.characterName;
  theater.characterAvatar = host.characterAvatar || theater.characterAvatar;
  theater.presetName = host.presetName;
  theater.forkFloor = host.forkFloor;
  theater.snapshot = host.snapshot || 'live';
  theater.base = [];
  theater.memory = host.memory;
  theater.legacy = false;
  return true;
}

async function generate(theater) {
  const task = { done: false, stopped: false };
  room.runs.set(theater.id, task);
  paint();
  try {
    const result = await branchReply({
      base: theater.base || [],
      branch: theater.messages || [],
      characterName: theater.characterName,
      chatId: theater.chatId,
      chatFile: theater.chatFile,
      forkFloor: theater.forkFloor,
      cfg: theater.cfg,
      memory: theater.memory,
    });
    if (task.stopped) return;
    const text = String(result.text || '').trim();
    if (!text) throw new Error('酒馆那边没有返回内容');
    if (Array.isArray(result.prompt) && result.prompt.length) room.prompts.set(theater.id, result.prompt);
    theater.messages.push(theaterMessage({ name: theater.characterName, text, at: Date.now(), source: 'tavern' }));
    theater.failed = null;
  } catch (error) {
    if (!task.stopped) theater.failed = { at: Date.now(), reason: error?.message || '这一轮没接通' };
  } finally {
    task.done = true;
    room.runs.delete(theater.id);
    theater.updatedAt = Date.now();
    save();
    paint();
  }
}

async function send(theater) {
  if (isBusy(theater)) return;
  const text = String(room.draft || '').trim();
  if (!text) { toast('先写一句，酒馆那边才有下文'); return; }
  const bound = await bindIfNeeded(theater);
  if (!bound) { toast('这一场还没绑定酒馆聊天：先在酒馆打开一个聊天再发'); return; }
  theater.messages.push(theaterMessage({
    isUser: true, name: room.ctx.state.settings.user.name, text, at: Date.now(), source: 'user',
  }));
  theater.failed = null;
  theater.updatedAt = Date.now();
  room.draft = '';
  save();
  paint();
  await generate(theater);
}

function retry(theater) {
  if (!theater || isBusy(theater)) return;
  if (!(theater.messages || []).length) { toast('这一场还没有话可说'); return; }
  theater.failed = null;
  save();
  generate(theater);
}

function undo(theater) {
  if (!theater) return;
  const list = theater.messages || [];
  const last = list[list.length - 1];
  if (!last) { toast('这一场还没有话'); return; }
  list.pop();
  theater.failed = null;
  theater.updatedAt = Date.now();
  save();
  paint();
  toast(last.is_user ? '刚才那句撤回了' : '最后一句撤回了');
}

function stop(theater) {
  const task = theater ? room.runs.get(theater.id) : null;
  if (!theater || !task || task.done) { toast('这一场现在没有在生成'); return; }
  task.stopped = true;
  stopTavernGeneration();
  toast('已停止，结果不会写进这一场');
  paint();
}

function regenerate(theater) {
  if (!theater || isBusy(theater)) return;
  const list = theater.messages || [];
  const last = list[list.length - 1];
  if (!last) { toast('这一场还没有话可说'); return; }
  if (!last.is_user && list.length === 1) { toast('这一场还没有可以重说的一句'); return; }
  if (!last.is_user) list.pop();
  theater.failed = null;
  theater.updatedAt = Date.now();
  save();
  paint();
  generate(theater);
}

async function createBranch() {
  const host = await readHost();
  if (!host.available) { toast(host.reason || '先在酒馆里打开要分叉的那个聊天'); return; }
  const contactId = contactForTavernCharacter(room.ctx.state, {
    name: host.characterName,
    tavernAvatar: host.characterAvatar,
  });
  const theater = addTheater(room.ctx.state, {
    contactId,
    characterName: host.characterName,
    characterAvatar: host.characterAvatar,
    chatFile: host.chatFile,
    chatId: host.chatId,
    presetName: host.presetName,
    forkFloor: host.forkFloor,
    snapshot: host.snapshot || 'live',
    base: host.base,
    memory: host.memory,
  });
  save();
  toast(`从第 ${host.forkFloor} 楼分出一条时间线`);
  room.id = theater.id;
  room.panel = null;
  room.ctxOpen = false;
  room.draft = '';
  paint();
}

async function followLatest(theater) {
  const host = await readHost();
  if (!host.available) { toast(host.reason || '先在酒馆里打开这个聊天'); return; }
  if (theater.chatId && host.chatId && theater.chatId !== host.chatId) {
    toast('酒馆现在开的不是这一场绑的聊天，先打开它');
    return;
  }
  theater.forkFloor = host.forkFloor;
  theater.base = [];
  theater.snapshot = 'live';
  theater.updatedAt = Date.now();
  save();
  paint();
  toast(`跟上到第 ${host.forkFloor} 楼`);
}

function refreshMemory(theater) {
  const memory = readTavernMemory();
  if (!String(memory.text || '').trim()) { toast('酒馆现在没有可读的记忆'); return; }
  theater.memory = memory;
  save();
  paint();
  toast('换成酒馆现在的记忆了');
}

/* --------------------------------------------------------------- 交互 */

function open(theaterId) {
  if (!theaterById(room.ctx.state, theaterId)) return;
  room.id = theaterId;
  room.panel = null;
  room.dialog = null;
  room.ctxOpen = false;
  room.draft = '';
  room.listOpen = false;
  paint();
}

function close() {
  if (room.root) room.root.remove();
  room.root = null;
  room.panel = null;
  room.dialog = null;
  for (const task of room.runs.values()) task.stopped = true;
  if (room.runs.size) stopTavernGeneration();
  room.runs.clear();
  try { room.ctx?.home?.(); } catch { /* 已经关掉了 */ }
}

function act(name, idValue, extra) {
  const theater = theaterById(room.ctx.state, idValue || room.id);
  switch (name) {
    case 'exit': close(); return;
    case 'rail':
      room.listOpen = !room.listOpen;
      room.root.querySelector('.prt-rail')?.classList.toggle('is-open', room.listOpen);
      room.root.classList.toggle('rail-on', room.listOpen);
      return;
    case 'new': createBranch(); return;
    case 'open': open(idValue); return;
    case 'send': if (theater) send(theater); return;
    case 'stop': stop(theater); return;
    case 'retry': retry(theater); return;
    case 'undo': undo(theater); return;
    case 'settings':
      if (!theater) return;
      room.panel = 'settings';
      room.ctxOpen = false;
      room.extraDraft = String(theater.cfg?.extraPrompt || '');
      paint();
      return;
    case 'close-panel': room.panel = null; room.dialog = null; paint(); return;
    case 'toggle-ctx': room.ctxOpen = !room.ctxOpen; paint(); return;
    case 'history':
      if (!theater) return;
      setTheaterConfig(theater, { historyMode: extra });
      save();
      paint();
      return;
    case 'memory': {
      if (!theater) return;
      const has = Boolean(String(theater.memory?.text || '').trim());
      if (extra === 'fixed' && !has) { toast('这场还没读到总结，先读一份再固定'); return; }
      setTheaterConfig(theater, { memoryMode: extra });
      save();
      paint();
      toast(extra === 'fixed' ? '记忆固定成开场那份了' : '记忆跟着酒馆走了');
      return;
    }
    case 'refresh-memory': if (theater) refreshMemory(theater); return;
    case 'save-extra': {
      if (!theater) return;
      const node = room.root.querySelector('[data-prt-extra]');
      setTheaterConfig(theater, { extraPrompt: String(node?.value || '').trim() });
      room.extraDraft = String(theater.cfg.extraPrompt || '');
      save();
      toast('额外指令存好了');
      return;
    }
    case 'toggle-time':
    case 'toggle-avatar':
    case 'toggle-worldbook': {
      if (!theater) return;
      const key = name === 'toggle-time' ? 'showTime'
        : name === 'toggle-avatar' ? 'showAvatar' : 'showWorldBook';
      const now = theater.cfg?.[key] !== false;
      setTheaterConfig(theater, { [key]: !now });
      save();
      paint();
      if (name === 'toggle-worldbook') toast(now ? '这一场不带角色世界书了' : '这一场会带上角色世界书');
      return;
    }
    case 'follow': if (theater) followLatest(theater); return;
    case 'regen': regenerate(theater); return;
    case 'prompt':
      if (!theater) return;
      room.panel = 'prompt';
      paint();
      return;
    case 'ask-clear':
      if (!theater) return;
      room.dialog = {
        kind: 'clear', title: '清空这一场说过的话？', note: '背景、记忆、额外指令都留着，酒馆那边不动。', confirm: '确认清空',
      };
      paint();
      return;
    case 'ask-delete':
      if (!theater) return;
      room.dialog = {
        kind: 'delete', title: `删掉「${theaterTitleOf(theater)}」？`, note: '只删小手机里存的分支；酒馆聊天文件、角色卡、记忆都不动。', confirm: '确认删掉',
      };
      paint();
      return;
    case 'rename':
      if (!theater) return;
      room.dialog = {
        kind: 'rename', title: '给这一场改个名字', note: '默认是「角色 · 分叉 N」。', confirm: '存下来',
        input: theaterTitleOf(theater), maxLength: TITLE_MAX,
      };
      paint();
      setTimeout(() => room.root?.querySelector('[data-prt-dialog-input]')?.select(), 0);
      return;
    case 'close-dialog': room.dialog = null; paint(); return;
    case 'confirm-dialog': confirmDialog(theater); return;
    default: return;
  }
}

function confirmDialog(theater) {
  const dialog = room.dialog;
  if (!dialog) return;
  if (dialog.kind === 'rename') {
    if (!theater) return;
    const value = String(room.root.querySelector('[data-prt-dialog-input]')?.value || '').trim().slice(0, TITLE_MAX);
    theater.title = value || `${theater.characterName || 'TA'} · 分叉 ${Math.max(1, theatersOf(room.ctx.state, { chatFile: theater.chatFile }).length)}`;
    theater.autoTitle = !value;
    save();
    room.dialog = null;
    paint();
    toast('改好了');
    return;
  }
  if (dialog.kind === 'clear') {
    if (!theater) return;
    theater.messages = [];
    theater.failed = null;
    theater.updatedAt = Date.now();
    save();
    room.dialog = null;
    paint();
    toast('这一场清空了');
    return;
  }
  if (dialog.kind === 'delete') {
    if (!theater) return;
    delete room.ctx.state.theaters[theater.id];
    room.runs.delete(theater.id);
    room.prompts.delete(theater.id);
    if (room.id === theater.id) room.id = '';
    save();
    room.dialog = null;
    paint();
    toast('这一场删掉了');
  }
}

function bind() {
  const root = room.root;
  root.addEventListener('click', event => {
    /* 窄屏抽屉：点到会话那边就收回去，不用再找按钮 */
    if (room.listOpen && !event.target.closest('.prt-rail') && !event.target.closest('.prt-only-narrow')) {
      room.listOpen = false;
      root.querySelector('.prt-rail')?.classList.remove('is-open');
      root.classList.remove('rail-on');
    }
    const node = event.target.closest('[data-prt]');
    if (!node || !root.contains(node)) return;
    event.preventDefault();
    const name = node.dataset.prt;
    /* 点遮罩只关面板，不把点击透到下面的会话 */
    act(name, node.dataset.id, node.dataset.v);
  });

  root.addEventListener('input', event => {
    const field = event.target;
    if (field.matches('[data-prt-input]')) {
      room.draft = field.value;
      autoGrow(field);
      return;
    }
    if (field.matches('[data-prt-extra]')) {
      room.extraDraft = field.value;
    }
  });

  root.addEventListener('change', event => {
    const field = event.target;
    if (field.matches('[data-prt-floors]')) {
      const theater = theaterById(room.ctx.state, field.dataset.id);
      if (!theater) return;
      const floors = Math.min(200, Math.max(1, Math.round(Number(field.value) || 0)));
      if (!floors) { field.value = theater.cfg?.historyFloors || 30; return; }
      setTheaterConfig(theater, { historyFloors: floors });
      field.value = floors;
      save();
      toast(`取最近 ${floors} 层`);
    }
  });

  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (room.dialog) { room.dialog = null; paint(); return; }
      if (room.panel) { room.panel = null; paint(); return; }
      if (room.listOpen) { room.listOpen = false; root.querySelector('.prt-rail')?.classList.remove('is-open'); root.classList.remove('rail-on'); }
      return;
    }
    if (event.target.matches('[data-prt-dialog-input]') && event.key === 'Enter') {
      event.preventDefault();
      confirmDialog(theaterById(room.ctx.state, room.id));
      return;
    }
    if (!event.target.matches('[data-prt-input]')) return;
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    act('send');
  });

  /* 关掉小手机 / 换存档：别让这一轮结果落回已销毁的房间 */
}

/** 打开房间：已有场就直接进最近那一场，没有就落在开场页。 */
export function openParallelRoom(ctx) {
  if (room.root && room.root.isConnected) {
    room.ctx = ctx;
    paint();
    return;
  }
  room.ctx = ctx;
  room.id = theatersOf(ctx.state)[0]?.id || '';
  room.draft = '';
  room.panel = null;
  room.dialog = null;
  room.listOpen = false;
  room.ctxOpen = false;
  room.extraDraft = '';

  const root = document.createElement('div');
  root.className = 'prt';
  document.body.appendChild(root);
  room.root = root;
  bind();
  paint();
}

/** 供宿主关手机时统一叫停。 */
export function cancelParallelRoom() {
  let any = false;
  for (const task of room.runs.values()) {
    task.stopped = true;
    any = true;
  }
  if (any) stopTavernGeneration();
  return any;
}
