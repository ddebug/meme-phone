/**
 * meme-phone · 平行时空的分支页与「这一场的设置」
 *
 * 这一页只画这一场自己的话（背景楼层不铺出来）。
 * 发送就生成：消息先进这一场，再让酒馆用「背景 + 这一场」组装一次回复，回复也只回到这一场。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml, timeText } from '../shell.js';
import {
  contactById, theaterById, theaterTitleOf, theaterMessage, theatersOf, setTheaterConfig,
  THEATER_EXTRA_MAX,
} from '../data.js';
import { branchReply, stopTavernGeneration, readOpenTavernChat, readTavernMemory } from '../host.js';
import {
  branchStatusLine, branchMemoryLabel, branchHistoryLabel, branchContextPanelHtml, chatFileLabel,
} from './parallel.js';
import { estimateTokens } from '../reply-context.js';

const ROLES = { system: '系统', user: '用户', assistant: '角色' };
const running = new Map();
const promptCache = new Map();
const TITLE_MAX = 32;

function scrollToBottom(ctx) {
  const box = ctx.shell.root.querySelector('.mp-messages');
  if (!box) return;
  const jump = () => { box.scrollTop = box.scrollHeight; };
  jump();
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(jump);
}

function messageHtml(ctx, theater, message) {
  const cfg = theater.cfg || {};
  const me = Boolean(message.is_user);
  const contact = contactById(ctx.state, theater.contactId);
  const avatar = me
    ? avatarHtml(ctx.state.settings.user.name, ctx.state.settings.user.avatar)
    : avatarHtml(contact?.name || theater.characterName, contact?.avatar || theater.characterAvatar);
  return `
    <div class="mp-msg${me ? ' me' : ''}">
      ${cfg.showAvatar === false ? '' : avatar}
      <div class="mp-msg-body">
        <div class="mp-bubble">${esc(message.mes || '')}</div>
        ${cfg.showTime === false ? '' : `<div class="mp-msg-meta"><span>${message.at ? timeText(message.at) : ''}</span></div>`}
      </div>
    </div>`;
}

function headHtml(ctx, theater) {
  const contact = contactById(ctx.state, theater.contactId);
  return `
    <div class="mp-thread-head">
      <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
      ${avatarHtml(contact?.name || theater.characterName, contact?.avatar || theater.characterAvatar)}
      <div style="flex:1;min-width:0">
        <div class="mp-thread-name">${esc(theaterTitleOf(theater))}<span class="mp-pill">平行时空</span></div>
        <div class="mp-thread-status"><span>${esc(branchStatusLine(theater))}</span></div>
      </div>
      <button class="mp-icon-btn" data-act="branch-settings" data-theater="${theater.id}" type="button" aria-label="这一场的设置">${icon('settings')}</button>
    </div>`;
}

function contextStripHtml(theater) {
  const cfg = theater.cfg || {};
  const place = cfg.historyMode === 'none' ? '不带背景'
    : cfg.historyMode === 'recent' ? `最近 ${cfg.historyFloors || 30} 层`
      : `第 ${theater.forkFloor || 0} 楼`;
  return `
    <div class="mp-msg-more" data-act="branch-settings" data-theater="${theater.id}" style="cursor:pointer">
      ${esc(place)} · ${esc(branchMemoryLabel(theater))}
      <button class="mp-mini-btn" data-act="branch-prompt" data-theater="${theater.id}" type="button" style="margin-left:8px">看提示词</button>
    </div>`;
}

function composerHtml(ctx, theater) {
  const task = running.get(theater.id);
  const busy = Boolean(task && !task.done);
  const failed = theater.failed;
  return `
    <div class="mp-composer">
      ${failed ? `<div class="mp-composer-tip is-error">${esc(failed.reason || '这一轮没接通')}
        <button class="mp-mini-btn" data-act="branch-retry" data-theater="${theater.id}" type="button" style="margin-left:8px">重试</button>
        <button class="mp-mini-btn" data-act="branch-undo" data-theater="${theater.id}" type="button" style="margin-left:4px">撤回这句</button>
      </div>` : ''}
      <div class="mp-composer-row">
        <div class="mp-compose-box">
          <textarea class="mp-compose-input" rows="1" placeholder="发一句，酒馆那边接着写…" aria-label="输入消息">${esc(ctx.shell.live.inputValue || '')}</textarea>
          <button class="mp-send ${busy ? 'is-stop' : 'is-text'}" data-plain="1" data-busy="${busy ? '1' : '0'}" data-act="${busy ? 'branch-stop' : 'branch-send'}" data-theater="${theater.id}" type="button" aria-label="${busy ? '停止这次生成' : '发送'}">
            <span class="mp-send-now">${icon('send')}</span>
            <span class="mp-send-stop">${icon('stop')}</span>
          </button>
        </div>
      </div>
    </div>`;
}

function promptPanelHtml(prompt) {
  if (!Array.isArray(prompt) || !prompt.length) {
    return `<div class="mp-sheet-note">这一次没抓到酒馆发出去的提示词。文本补全接口不走这份事件，可以在酒馆里用 /prompt 查看；聊天补全接口会在下一轮写进这里。</div>`;
  }
  const rows = prompt.map(message => {
    const role = ROLES[message?.role] || message?.role || '';
    const content = String(message?.content || '');
    return `
      <div class="mp-prompt-row">
        <div class="mp-prompt-role"><i></i>${esc(role)}<span>${estimateTokens(content)}tk</span></div>
        <div class="mp-prompt-body">${esc(content)}</div>
      </div>`;
  }).join('');
  const total = prompt.reduce((sum, message) => sum + estimateTokens(String(message?.content || '')), 0);
  return `<div class="mp-sheet-note">这一次发给酒馆接口的 ${prompt.length} 条消息，合计约 ${total}tk。</div>${rows}`;
}

/** 旧版场景：还没有绑定聊天文件时，第一次生成就认当前打开的那个聊天。 */
async function bindIfNeeded(ctx, theater) {
  if (theater.chatFile && theater.forkFloor) return true;
  const host = await readOpenTavernChat();
  if (!host.available) return false;
  theater.chatFile = host.chatFile;
  theater.chatId = host.chatId;
  theater.characterName = theater.characterName || host.characterName;
  theater.characterAvatar = theater.characterAvatar || host.characterAvatar;
  theater.presetName = host.presetName;
  theater.forkFloor = host.forkFloor;
  theater.snapshot = host.snapshot || 'live';
  theater.base = [];
  theater.memory = host.memory;
  theater.legacy = false;
  return true;
}

async function generateReply(ctx, theater) {
  const task = { done: false, stopped: false };
  running.set(theater.id, task);
  ctx.rerender();
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
    if (Array.isArray(result.prompt) && result.prompt.length) promptCache.set(theater.id, result.prompt);
    theater.messages.push(theaterMessage({
      name: theater.characterName,
      text,
      at: Date.now(),
      source: 'tavern',
    }));
    theater.failed = null;
  } catch (error) {
    if (!task.stopped) {
      theater.failed = { at: Date.now(), reason: error?.message || '这一轮没接通' };
    }
  } finally {
    task.done = true;
    running.delete(theater.id);
    theater.updatedAt = Date.now();
    /* 手机可能已经关掉了：保存和重绘都只在界面还在时做，别把结果丢在已销毁的 shell 上 */
    try { ctx.save?.(); } catch { /* store 已停用 */ }
    try { ctx.rerender?.(); } catch { /* 界面已经关了 */ }
    try { scrollToBottom(ctx); } catch { /* 同上 */ }
  }
}

/** 用户发出去的那一句先落进这一场；生成失败就留着，可以重试或撤回。 */
async function sendBranch(ctx, theater) {
  if (running.get(theater.id) && !running.get(theater.id).done) return;
  const text = String(ctx.shell.live.inputValue || '').trim();
  if (!text) { ctx.toast('先写一句，酒馆那边才有下文'); return; }
  const bound = await bindIfNeeded(ctx, theater);
  if (!bound) {
    ctx.toast('这一场还没绑定酒馆聊天：先在酒馆打开一个聊天再发');
    return;
  }
  theater.messages.push(theaterMessage({
    isUser: true,
    name: ctx.state.settings.user.name,
    text,
    at: Date.now(),
    source: 'user',
  }));
  theater.failed = null;
  theater.updatedAt = Date.now();
  ctx.shell.live = { inputValue: '', focus: false };
  ctx.save();
  ctx.rerender();
  scrollToBottom(ctx);
  await generateReply(ctx, theater);
}

/** 失败后重试：不再多写一句用户消息，直接拿这一场现有的话再生成一次。 */
function retryBranch(ctx, theater) {
  if (running.get(theater.id) && !running.get(theater.id).done) return;
  if (!theater.messages.length) { ctx.toast('这一场还没有话可说'); return; }
  theater.failed = null;
  ctx.save();
  ctx.rerender();
  generateReply(ctx, theater);
}

/** 撤回最后一句：只撤最后那一条，失败提示一起清掉。 */
function undoLastMessage(ctx, theater) {
  const list = theater.messages || [];
  const last = list[list.length - 1];
  if (!last) { ctx.toast('这一场还没有话'); return; }
  list.pop();
  theater.failed = null;
  theater.updatedAt = Date.now();
  ctx.save();
  ctx.rerender();
  ctx.toast(last.is_user ? '刚才那句撤回了' : '最后一句撤回了');
}

/** 重新让 TA 说最后一句：把末尾那条回复丢掉再生成。 */
function regenerateLast(ctx, theater) {
  if (running.get(theater.id) && !running.get(theater.id).done) return;
  const list = theater.messages || [];
  const last = list[list.length - 1];
  if (!last) { ctx.toast('这一场还没有话可说'); return; }
  /* 先确认丢完还剩东西再动，别把唯一一条弹掉又什么都没生成 */
  if (!last.is_user && list.length === 1) { ctx.toast('这一场还没有可以重说的一句'); return; }
  if (!last.is_user) list.pop();
  theater.failed = null;
  theater.updatedAt = Date.now();
  ctx.save();
  ctx.rerender();
  generateReply(ctx, theater);
}

function openRenameForm(ctx, theater) {
  ctx.openSheet({
    kind: 'form',
    title: '给这一场改个名字',
    note: '默认是「角色 · 分叉 N」；改了以后不再跟着编号走。',
    fields: [{ name: 'title', label: '这一场叫什么', value: theaterTitleOf(theater), maxLength: TITLE_MAX }],
    confirm: '存下来',
    onForm: (values) => {
      const title = String(values.title || '').trim().slice(0, TITLE_MAX);
      theater.title = title || `${theater.characterName || 'TA'} · 分叉 ${Math.max(1, theatersOf(ctx.state, { chatFile: theater.chatFile }).length)}`;
      theater.autoTitle = !title;
      ctx.save();
      ctx.rerender();
      ctx.toast('改好了');
    },
  });
}

/* ---------- 这一场的设置页 ---------- */

function setRow(theaterId, { iconName, title, sub, act, toggle, value, danger }) {
  return `
    <button class="mp-set-row${danger ? ' is-danger' : ''}" data-act="${act}" data-theater="${esc(theaterId)}" type="button">
      <span class="mp-set-ico">${icon(iconName)}</span>
      <span class="mp-set-name">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${toggle !== undefined
        ? `<span class="mp-switch${toggle ? ' on' : ''}"></span>`
        : value ? `<span class="mp-set-value">${esc(value)}</span>` : ''}
      ${toggle === undefined ? `<span style="color:var(--text-4)">${icon('chevron')}</span>` : ''}
    </button>`;
}

function settingsBody(ctx, params = {}) {
  const theater = theaterById(ctx.state, params.theaterId);
  if (!theater) return `<div class="mp-page-body"><div class="mp-empty">这一场已经不在了。</div></div>`;
  const cfg = theater.cfg || {};
  const contact = contactById(ctx.state, theater.contactId);
  const count = (theater.messages || []).length;
  const status = [
    theater.characterName || 'TA',
    theater.chatFile ? chatFileLabel(theater.chatFile, theater.characterName) : '未绑定酒馆聊天',
    `${count} 句`,
    theater.presetName ? `预设 ${theater.presetName}` : '',
  ].filter(Boolean).join(' · ');
  const memorySize = String(theater.memory?.text || '').trim().length;
  const historyModeLabel = cfg.historyMode === 'none' ? '不带背景'
    : cfg.historyMode === 'recent' ? `最近 ${cfg.historyFloors || 30} 层` : `分叉点之前（第 ${theater.forkFloor || 0} 楼）`;
  const memoryModeLabel = cfg.memoryMode === 'fixed'
    ? (memorySize ? `固定开场时的总结 · ${memorySize} 字` : '固定总结（没读到）')
    : '跟随酒馆';
  const extraLabel = String(cfg.extraPrompt || '').trim() ? `${String(cfg.extraPrompt).trim().length} 字` : '没有';

  return `
    <div class="mp-page-body">
      <div class="mp-chat-set-head">
        ${avatarHtml(contact?.name || theater.characterName, contact?.avatar || theater.characterAvatar)}
        <div class="mp-chat-set-main">
          <div class="mp-chat-set-name">${esc(theaterTitleOf(theater))}</div>
          <div class="mp-chat-set-sub">${esc(status)}</div>
        </div>
      </div>

      <div class="mp-group" style="margin-top:16px">
        <div class="mp-group-label">背景</div>
        <div class="mp-group-box">
          ${setRow(theater.id, {
            iconName: 'bookmark',
            title: '从哪里接',
            sub: cfg.historyMode === 'fork'
              ? '分叉点之前的楼层，酒馆后来继续聊的不进来'
              : cfg.historyMode === 'recent'
                ? '取酒馆最新的一段，适合不想要开头'
                : '只带这一场自己说的话',
            act: 'ps-history',
            value: historyModeLabel,
          })}
          ${setRow(theater.id, {
            iconName: 'book',
            title: '看这一场的背景',
            sub: '分叉点、背景口径与开场时的记忆原文',
            act: 'ps-context',
            value: '看背景',
          })}
          ${cfg.historyMode === 'recent' ? `
          <label class="mp-set-row mp-set-row-number">
            <span class="mp-set-ico">${icon('clock')}</span>
            <span class="mp-set-name">取最近几层<small>1 - 200 层，按酒馆当前聊天算</small></span>
            <input class="mp-set-number" type="number" inputmode="numeric" min="1" max="200" step="1"
              value="${cfg.historyFloors || 30}" data-act="ps-floors" data-theater="${esc(theater.id)}" aria-label="取最近几层">
          </label>` : ''}
        </div>
      </div>

      <div class="mp-group" style="margin-top:16px">
        <div class="mp-group-label">记忆</div>
        <div class="mp-group-box">
          ${setRow(theater.id, {
            iconName: 'spark',
            title: '记忆口径',
            sub: cfg.memoryMode === 'fixed'
              ? '把开场时的总结固定注入，不受酒馆后来聊的影响'
              : '酒馆注入什么就用什么，分叉点之后聊的也会进来',
            act: 'ps-memory',
            value: memoryModeLabel,
          })}
          ${setRow(theater.id, {
            iconName: 'refresh',
            title: '读一下酒馆现在的记忆',
            sub: memorySize ? '用现在的总结替换开场时那份' : '这场开场时没读到，可以现在补一份',
            act: 'ps-refresh-memory',
            value: memorySize ? '重新读' : '去读',
          })}
        </div>
      </div>

      <div class="mp-group" style="margin-top:16px">
        <div class="mp-group-label">这一场</div>
        <div class="mp-group-box">
          ${setRow(theater.id, {
            iconName: 'reply',
            title: '额外指令',
            sub: '只对这一场生效，附在酒馆那套提示后面',
            act: 'ps-extra',
            value: extraLabel,
          })}
          ${setRow(theater.id, { iconName: 'clock', title: '显示时间', sub: '关掉以后气泡下面不显示发送时间', act: 'ps-toggle-time', toggle: cfg.showTime !== false })}
          ${setRow(theater.id, { iconName: 'contacts', title: '显示头像', sub: '关掉以后只留气泡，适合截图分享', act: 'ps-toggle-avatar', toggle: cfg.showAvatar !== false })}
        </div>
      </div>

      <div class="mp-group" style="margin-top:16px">
        <div class="mp-group-label">操作</div>
        <div class="mp-group-box">
          ${setRow(theater.id, { iconName: 'refresh', title: '跟到酒馆最新楼层', sub: `现在接在第 ${theater.forkFloor || 0} 楼`, act: 'ps-follow', value: '跟上' })}
          ${setRow(theater.id, { iconName: 'contacts', title: '重新绑定当前聊天', sub: '换一个聊天文件接，这一场说过的话留着', act: 'ps-rebind', value: '重绑' })}
          ${setRow(theater.id, { iconName: 'reply', title: '重新让 TA 说最后一句', sub: '丢掉末尾那条回复再生成一次', act: 'ps-regen', value: '重说' })}
          ${setRow(theater.id, { iconName: 'trash', title: '清空这一场的发言', sub: '背景和设置都留着，只清这一场说过的话', act: 'ps-clear', value: '清空' })}
          ${setRow(theater.id, { iconName: 'brush', title: '改名', sub: '默认是「角色 · 分叉 N」', act: 'ps-rename', value: '改名' })}
          ${setRow(theater.id, { iconName: 'trash', title: '删掉这一场', sub: '只删小手机里的分支，酒馆那边不动', act: 'ps-delete', danger: true, value: '删除' })}
        </div>
      </div>
    </div>`;
}

async function followLatest(ctx, theater) {
  const host = await readOpenTavernChat();
  if (!host.available) { ctx.toast(host.reason || '先在酒馆里打开这个聊天'); return; }
  if (theater.chatId && host.chatId && theater.chatId !== host.chatId) {
    ctx.toast('酒馆现在开的不是这一场绑的聊天，先打开它');
    return;
  }
  theater.forkFloor = host.forkFloor;
  theater.base = [];
  theater.snapshot = 'live';
  theater.updatedAt = Date.now();
  ctx.save();
  ctx.rerender();
  ctx.toast(`跟上到第 ${host.forkFloor} 楼`);
}

async function rebindToOpenChat(ctx, theater) {
  const host = await readOpenTavernChat();
  if (!host.available) { ctx.toast(host.reason || '先在酒馆里打开要接的聊天'); return; }
  theater.chatFile = host.chatFile;
  theater.chatId = host.chatId;
  theater.characterName = host.characterName || theater.characterName;
  theater.characterAvatar = host.characterAvatar || theater.characterAvatar;
  theater.presetName = host.presetName;
  theater.forkFloor = host.forkFloor;
  theater.snapshot = 'live';
  theater.base = [];
  theater.memory = host.memory;
  theater.legacy = false;
  theater.updatedAt = Date.now();
  if (!theater.contactId) {
    /* 认不出来就交给通讯录同步，不在这里硬造联系人 */
    const known = Object.values(ctx.state.contacts || {})
      .find(item => item.tavernAvatar === host.characterAvatar || item.name === host.characterName);
    theater.contactId = known?.id || '';
  }
  ctx.save();
  ctx.rerender();
  ctx.toast(`重新绑到《${chatFileLabel(host.chatFile, host.characterName)}》第 ${host.forkFloor} 楼`);
}

function refreshMemory(ctx, theater) {
  const memory = readTavernMemory();
  if (!String(memory.text || '').trim()) { ctx.toast('酒馆现在没有可读的记忆'); return; }
  theater.memory = memory;
  ctx.save();
  ctx.rerender();
  ctx.toast('换成酒馆现在的记忆了');
}

export const parallelSettingsApp = {
  id: 'parallel-settings', name: '这一场的设置', icon: 'settings',

  render(ctx, params = {}) {
    return settingsBody(ctx, params);
  },

  handle(ctx, act, data) {
    const theater = theaterById(ctx.state, data.theater);
    if (!String(act).startsWith('ps-')) return false;
    if (!theater) { ctx.toast('这一场已经不在了'); return true; }

    if (act === 'ps-history') {
      ctx.openSheet({
        kind: 'pick',
        title: '这一场从哪接',
        note: '只影响交给酒馆的那段背景，预设、角色卡、世界书都不变。',
        items: [
          { label: '分叉点之前', value: 'fork', icon: 'bookmark', note: `接在第 ${theater.forkFloor || 0} 楼，之后的酒馆聊天不进来` },
          { label: '最近一段', value: 'recent', icon: 'clock', note: `取酒馆最新 ${theater.cfg?.historyFloors || 30} 层` },
          { label: '不带背景', value: 'none', icon: 'trash', note: '只带这一场自己说的话' },
        ],
        onPick: (value) => {
          setTheaterConfig(theater, { historyMode: value });
          ctx.save();
          ctx.rerender();
          ctx.toast('背景换好了');
        },
      });
      return true;
    }

    if (act === 'ps-context') {
      ctx.openSheet({ kind: 'panel', title: '这一场的背景', render: () => branchContextPanelHtml(theater) });
      return true;
    }

    if (act === 'ps-floors') {
      const floors = Math.min(200, Math.max(1, Math.round(Number(data.value) || 0)));
      if (!floors) return true;
      setTheaterConfig(theater, { historyFloors: floors });
      ctx.save();
      ctx.rerender();
      ctx.toast(`取最近 ${floors} 层`);
      return true;
    }

    if (act === 'ps-memory') {
      const hasMemory = Boolean(String(theater.memory?.text || '').trim());
      ctx.openSheet({
        kind: 'pick',
        title: '记忆怎么给',
        items: [
          { label: '跟随酒馆', value: 'tavern', icon: 'spark', note: '酒馆注入什么就用什么，分叉点之后聊的也会进这一场' },
          {
            label: '固定开场时的总结',
            value: 'fixed',
            icon: 'bookmark',
            note: hasMemory ? `把这场开场读到的 ${String(theater.memory.text).trim().length} 字固定注入` : '这场没读到总结，先去「读一下酒馆现在的记忆」',
          },
        ],
        onPick: (value) => {
          if (value === 'fixed' && !hasMemory) { ctx.toast('这场还没读到总结，先读一份再固定'); return; }
          setTheaterConfig(theater, { memoryMode: value });
          ctx.save();
          ctx.rerender();
          ctx.toast(value === 'fixed' ? '记忆固定成开场那份了' : '记忆跟着酒馆走了');
        },
      });
      return true;
    }

    if (act === 'ps-refresh-memory') { refreshMemory(ctx, theater); return true; }

    if (act === 'ps-extra') {
      ctx.openSheet({
        kind: 'text',
        title: '这一场的额外指令',
        value: theater.cfg?.extraPrompt || '',
        placeholder: '只对这一场说的话，比如「他还不知道那件事」',
        maxLength: THEATER_EXTRA_MAX,
        confirm: '存下来',
        onText: (text) => {
          setTheaterConfig(theater, { extraPrompt: String(text || '').trim() });
          ctx.save();
          ctx.rerender();
          ctx.toast('额外指令存好了');
        },
      });
      return true;
    }

    if (act === 'ps-toggle-time' || act === 'ps-toggle-avatar') {
      const key = act === 'ps-toggle-time' ? 'showTime' : 'showAvatar';
      const now = theater.cfg?.[key] !== false;
      setTheaterConfig(theater, { [key]: !now });
      ctx.save();
      ctx.rerender();
      ctx.toast(now ? '已收起' : '已显示');
      return true;
    }

    if (act === 'ps-follow') { followLatest(ctx, theater); return true; }
    if (act === 'ps-rebind') { rebindToOpenChat(ctx, theater); return true; }
    if (act === 'ps-regen') { regenerateLast(ctx, theater); return true; }

    if (act === 'ps-clear') {
      ctx.openSheet({
        title: '清空这一场说过的话？',
        items: [{
          label: '确认清空',
          value: 'clear',
          icon: 'trash',
          danger: true,
          note: '背景、记忆、额外指令都留着，酒馆那边不动。',
        }],
        onPick: (pick) => {
          if (pick !== 'clear') return;
          theater.messages = [];
          theater.failed = null;
          theater.updatedAt = Date.now();
          ctx.save();
          ctx.rerender();
          ctx.toast('这一场清空了');
        },
      });
      return true;
    }

    if (act === 'ps-rename') { openRenameForm(ctx, theater); return true; }

    if (act === 'ps-delete') {
      ctx.openSheet({
        title: `删掉「${theaterTitleOf(theater)}」？`,
        items: [{
          label: '确认删掉这一场',
          value: 'delete',
          icon: 'trash',
          danger: true,
          note: '只删这台小手机里存的分支；酒馆聊天文件、角色卡、柏宝书记忆都不动。',
        }],
        onPick: (pick) => {
          if (pick !== 'delete') return;
          delete ctx.state.theaters[theater.id];
          running.delete(theater.id);
          promptCache.delete(theater.id);
          ctx.save();
          ctx.go('app-parallel');
          ctx.toast('这一场删掉了');
        },
      });
      return true;
    }

    return false;
  },
};

/** 关手机、整份替换存档前叫停所有还在跑的分支，别让结果落到已经换掉的状态上。 */
export function cancelParallelRun() {
  let any = false;
  for (const task of running.values()) {
    task.stopped = true;
    any = true;
  }
  if (any) stopTavernGeneration();
  return any;
}

export const parallelBranchApp = {
  id: 'parallel-branch', name: '平行时空 · 这一场', icon: 'parallel',

  render(ctx, params = {}) {
    const theater = theaterById(ctx.state, params.theaterId);
    if (!theater) {
      return `<div class="mp-page-body"><div class="mp-empty">这一场已经不在了。</div></div>`;
    }
    const task = running.get(theater.id);
    const busy = Boolean(task && !task.done);
    const messages = theater.messages || [];
    const blocks = [contextStripHtml(theater)];
    blocks.push(...messages.map(message => messageHtml(ctx, theater, message)));
    if (busy) {
      const contact = contactById(ctx.state, theater.contactId);
      blocks.push(`
        <div class="mp-msg mp-msg-typing">
          ${avatarHtml(contact?.name || theater.characterName, contact?.avatar || theater.characterAvatar)}
          <div class="mp-msg-body"><div class="mp-typing"><i></i><i></i><i></i></div></div>
        </div>`);
    }
    if (!messages.length && !busy) {
      blocks.push('<div class="mp-empty" style="padding:14px 0">还没说话。<br>发一句，酒馆会顺着这条分支往下写。</div>');
    }
    return `
      <div class="mp-thread">
        ${headHtml(ctx, theater)}
        <div class="mp-messages" id="mpMessages">${blocks.join('')}</div>
        ${composerHtml(ctx, theater)}
      </div>`;
  },

  handle(ctx, act, data) {
    const theater = theaterById(ctx.state, data.theater);

    if (act === 'branch-send') {
      if (theater) sendBranch(ctx, theater);
      return true;
    }

    if (act === 'branch-retry') {
      if (theater) retryBranch(ctx, theater);
      return true;
    }

    if (act === 'branch-undo') {
      if (theater) undoLastMessage(ctx, theater);
      return true;
    }

    if (act === 'branch-stop') {
      const task = theater ? running.get(theater.id) : null;
      if (!theater || !task || task.done) { ctx.toast('这一场现在没有在生成'); return true; }
      task.stopped = true;
      stopTavernGeneration();
      ctx.toast('已停止，结果不会写进这一场');
      return true;
    }

    if (act === 'branch-prompt') {
      if (!theater) return true;
      const prompt = promptCache.get(theater.id) || null;
      ctx.openSheet({
        kind: 'panel',
        title: '这一次发出的提示词',
        render: () => promptPanelHtml(prompt),
      });
      return true;
    }

    if (act === 'branch-context') {
      if (!theater) return true;
      ctx.openSheet({ kind: 'panel', title: '这一场的背景', render: () => branchContextPanelHtml(theater) });
      return true;
    }

    if (act === 'branch-settings') {
      if (!theater) return true;
      ctx.go('parallel-settings', { theaterId: theater.id });
      return true;
    }

    return false;
  },
};
