/**
 * meme-phone · 平行时空的分支页
 *
 * 这一页只画这一场自己的话（base 是背景，不铺出来）。
 * 发送就生成：消息先进这一场，再让酒馆用「快照 + 这一场」组装一次回复，回复也只回到这一场。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml, timeText } from '../shell.js';
import { contactById, theaterById, theaterTitleOf, theaterMessage, theatersOf } from '../data.js';
import { branchReply, stopTavernGeneration, readOpenTavernChat } from '../host.js';
import { branchStatusLine, branchMemoryLabel, branchContextPanelHtml } from './parallel.js';
import { estimateTokens } from '../reply-context.js';

const ROLES = { system: '系统', user: '用户', assistant: '角色' };
const running = new Map();
const promptCache = new Map();

function scrollToBottom(ctx) {
  const box = ctx.shell.root.querySelector('.mp-messages');
  if (box) box.scrollTop = box.scrollHeight;
}

function messageHtml(ctx, theater, message) {
  const me = Boolean(message.is_user);
  const contact = contactById(ctx.state, theater.contactId);
  return `
    <div class="mp-msg${me ? ' me' : ''}">
      ${me
        ? avatarHtml(ctx.state.settings.user.name, ctx.state.settings.user.avatar)
        : avatarHtml(contact?.name || theater.characterName, contact?.avatar || theater.characterAvatar)}
      <div class="mp-msg-body">
        <div class="mp-bubble">${esc(message.mes || '')}</div>
        <div class="mp-msg-meta"><span>${message.at ? timeText(message.at) : ''}</span></div>
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
      <button class="mp-icon-btn" data-act="branch-menu" data-theater="${theater.id}" type="button" aria-label="这一场的设置">${icon('settings')}</button>
    </div>`;
}

function contextStripHtml(theater) {
  return `
    <div class="mp-msg-more" data-act="branch-context" data-theater="${theater.id}" style="cursor:pointer">
      ${esc(branchStatusLine(theater))} · ${esc(branchMemoryLabel(theater))}
      ${theater.presetName ? ` · 预设 ${esc(theater.presetName)}` : ''}
      <button class="mp-mini-btn" data-act="branch-prompt" data-theater="${theater.id}" type="button" style="margin-left:8px">看提示词</button>
    </div>`;
}

function composerHtml(ctx, theater) {
  const task = running.get(theater.id);
  const busy = Boolean(task && !task.done);
  return `
    <div class="mp-composer">
      ${theater.failed ? `<div class="mp-composer-tip is-error">${esc(theater.failed.reason || '这一轮没接通')}</div>` : ''}
      <div class="mp-composer-row">
        <div class="mp-compose-box">
          <input type="text" placeholder="发一句，酒馆那边接着写…" value="${esc(ctx.shell.live.inputValue || '')}" aria-label="输入消息">
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

function contextPanelHtml(theater) {
  return branchContextPanelHtml(theater);
}

/** 旧版场景：还没有绑定聊天文件时，第一次生成就认当前打开的那个聊天。 */
async function bindIfNeeded(ctx, theater) {
  if (theater.chatFile && theater.base?.length) return true;
  const host = await readOpenTavernChat();
  if (!host.available) return false;
  theater.chatFile = host.chatFile;
  theater.chatId = host.chatId;
  theater.characterName = theater.characterName || host.characterName;
  theater.characterAvatar = theater.characterAvatar || host.characterAvatar;
  theater.presetName = host.presetName;
  theater.forkFloor = host.forkFloor;
  theater.base = host.base;
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
    ctx.save();
    ctx.rerender();
    scrollToBottom(ctx);
  }
}

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
      blocks.push(`
        <div class="mp-msg mp-msg-typing">
          ${avatarHtml(theater.characterName, theater.characterAvatar)}
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
      ctx.openSheet({ kind: 'panel', title: '这一场的背景', render: () => contextPanelHtml(theater) });
      return true;
    }

    if (act === 'branch-menu') {
      if (!theater) return true;
      ctx.openSheet({
        title: theaterTitleOf(theater),
        note: `${theater.characterName || 'TA'} · ${theater.chatFile || '未绑定酒馆聊天'}${theater.presetName ? ` · 预设 ${theater.presetName}` : ''}`,
        items: [
          { label: '改名', value: 'rename', icon: 'brush' },
          { label: '看这一场的背景', value: 'context', icon: 'bookmark' },
          { label: '删掉这一场', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'context') {
            ctx.openSheet({ kind: 'panel', title: '这一场的背景', render: () => contextPanelHtml(theater) });
            return;
          }
          if (value === 'rename') {
            const siblings = theatersOf(ctx.state, { chatFile: theater.chatFile }).length;
            ctx.openSheet({
              kind: 'form',
              title: '给这一场改个名字',
              note: '默认是「角色 · 分叉 N」；改了以后不再跟着编号走。',
              fields: [{ name: 'title', label: '这一场叫什么', value: theaterTitleOf(theater), maxLength: 32 }],
              confirm: '存下来',
              onForm: (values) => {
                const title = String(values.title || '').trim().slice(0, 32);
                theater.title = title || `${theater.characterName || 'TA'} · 分叉 ${Math.max(1, siblings)}`;
                theater.autoTitle = !title;
                ctx.save();
                ctx.rerender();
                ctx.toast('改好了');
              },
            });
            return;
          }
          if (value !== 'delete') return;
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
        },
      });
      return true;
    }

    return false;
  },
};
