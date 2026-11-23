/**
 * meme-phone · 平行时空（酒馆聊天分支）
 *
 * 每一场都绑在某个酒馆聊天文件上：开一场时把那个文件的楼层整段抄下来当 base，
 * 生成时交给酒馆自己的 prompt 组装，回复只存在这台小手机里，一个字都不写回聊天文件。
 * 所以这里不需要小手机的模型 / 接口 / 回复预设，也没有未读、置顶、免打扰。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml, shortText } from '../shell.js';
import {
  contactById, contactForTavernCharacter, theatersOf, theaterTitleOf, addTheater,
} from '../data.js';
import { readOpenTavernChat } from '../host.js';

const TITLE_MAX = 32;

/** 这一场接在哪个文件的第几楼。 */
export function branchStatusLine(theater) {
  const file = theater.chatFile ? `《${theater.chatFile}》` : '当前酒馆聊天';
  return `接在 ${file} 第 ${theater.forkFloor || 0} 楼`;
}

/** 背景从哪来：柏宝书总结 / 酒馆原文 / 旧版场景。 */
export function branchMemoryLabel(theater) {
  const memory = theater.memory || {};
  if (memory.engine === 'baibai' && memory.text) return `柏宝书总结 · ${memory.text.length} 字`;
  return theater.base?.length ? '酒馆原文 · 按预设自己裁' : '没有背景（旧版场景）';
}

/** 「这一场的背景」面板：快照楼层数、酒馆记忆的注入口径、重开一场的说明。 */
export function branchContextPanelHtml(theater) {
  const memory = theater.memory || {};
  const base = Array.isArray(theater.base) ? theater.base : [];
  return `
    <div class="mp-sheet-note">${esc(branchStatusLine(theater))} · 快照 ${base.length} 层 · ${esc(branchMemoryLabel(theater))}</div>
    ${memory.text ? `<div class="mp-prompt-role"><i></i>酒馆记忆的注入口径<span>${esc(branchMemoryLabel(theater))}</span></div><div class="mp-prompt-body">${esc(memory.text)}</div>` : ''}
    <div class="mp-sheet-note">快照里的楼层是开这一场那一刻的酒馆原样（柏宝书的记忆叶子也跟着楼层走）。酒馆里后来继续聊的，不会自动进这一场；想跟上就重新开一场。</div>`;
}


function branchPreview(theater) {
  const messages = theater?.messages || [];
  const last = messages[messages.length - 1];
  if (!last) return `从《${theater?.chatFile || '酒馆聊天'}》第 ${theater?.forkFloor || 0} 楼接下去`;
  const body = String(last.mes || '').replace(/\s+/g, ' ').slice(0, 60);
  return `${last.is_user ? '我：' : ''}${body}`;
}

/** 起一场：直接认酒馆当前打开的那个聊天文件，不弹表单、不取名。 */
export async function createParallelBranch(ctx) {
  const host = await readOpenTavernChat();
  if (!host.available) {
    ctx.toast(host.reason || '先在酒馆里打开要分叉的那个聊天');
    return null;
  }
  const contactId = contactForTavernCharacter(ctx.state, {
    name: host.characterName,
    tavernAvatar: host.characterAvatar,
  });
  const theater = addTheater(ctx.state, {
    contactId,
    characterName: host.characterName,
    characterAvatar: host.characterAvatar,
    chatFile: host.chatFile,
    chatId: host.chatId,
    presetName: host.presetName,
    forkFloor: host.forkFloor,
    base: host.base,
    memory: host.memory,
  });
  ctx.save();
  ctx.toast(`从第 ${host.forkFloor} 楼分出一条时间线`);
  return theater;
}

function openRenameForm(ctx, theater) {
  ctx.openSheet({
    kind: 'form',
    title: '给这一场改个名字',
    note: `默认叫「${theaterTitleOf(theater)}」，改了以后就不再跟着编号走。`,
    fields: [{
      name: 'title',
      label: '这一场叫什么',
      value: theaterTitleOf(theater),
      placeholder: '留空就回到默认名字',
      maxLength: TITLE_MAX,
    }],
    confirm: '存下来',
    onForm: (values) => {
      const title = String(values.title || '').trim().slice(0, TITLE_MAX);
      theater.title = title || defaultSafeTitle(ctx.state, theater);
      theater.autoTitle = !title;
      ctx.save();
      ctx.rerender();
      ctx.toast('改好了');
    },
  });
}

function defaultSafeTitle(state, theater) {
  const count = Object.values(state.theaters || {}).filter(item => item.chatFile === theater.chatFile).length;
  return `${theater.characterName || 'TA'} · 分叉 ${Math.max(1, count)}`;
}

function openBranchMenu(ctx, theater) {
  ctx.openSheet({
    title: theaterTitleOf(theater),
    note: `${theater.characterName || 'TA'} · ${theater.chatFile || '未绑定酒馆聊天'}`,
    items: [
      { label: '改名', value: 'rename', icon: 'brush' },
      { label: '看背景', value: 'context', icon: 'book' },
      { label: '删掉这一场', value: 'delete', icon: 'trash', danger: true },
    ],
    onPick: (value) => {
      if (value === 'rename') {
        openRenameForm(ctx, theater);
        return;
      }
      if (value === 'context') {
        ctx.openSheet({
          kind: 'panel',
          title: '这一场的背景',
          render: () => branchContextPanelHtml(theater),
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
          ctx.save();
          ctx.rerender();
          ctx.toast('这一场删掉了');
        },
      });
    },
  });
}

export const parallelApp = {
  id: 'parallel', name: '平行时空', icon: 'parallel',

  render(ctx) {
    const list = theatersOf(ctx.state);
    const order = [];
    const groups = new Map();
    for (const theater of list) {
      const key = theater.chatFile || `x:${theater.characterName}`;
      if (!groups.has(key)) {
        groups.set(key, { file: theater.chatFile, characterName: theater.characterName, list: [] });
        order.push(key);
      }
      groups.get(key).list.push(theater);
    }

    const cards = order.map(key => {
      const group = groups.get(key);
      const head = group.characterName || 'TA';
      return `
        <div class="mp-group-label" style="margin-top:12px">${esc(head)}${group.file ? ` · ${esc(group.file)}` : ''} · ${group.list.length} 场</div>
        <div class="mp-group-box">
          ${group.list.map(theater => {
            const contact = contactById(ctx.state, theater.contactId);
            return `
            <button class="mp-row" data-act="open-branch" data-theater="${theater.id}" data-hold="branch-menu" type="button">
              ${avatarHtml(contact?.name || theater.characterName, contact?.avatar || theater.characterAvatar)}
              <div class="mp-row-main">
                <div class="mp-row-name">${esc(theaterTitleOf(theater))}</div>
                <div class="mp-row-sub">${esc(branchPreview(theater))}</div>
              </div>
              <div class="mp-row-side">
                <span>${theater.updatedAt ? shortText(theater.updatedAt) : ''}</span>
                <span class="mp-pill plain">${(theater.messages || []).length} 句</span>
              </div>
            </button>`;
          }).join('')}
        </div>`;
    }).join('');

    return `
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <div class="mp-subtitle" style="margin-top:0;flex:1">平行时空 · 酒馆聊天的一条分支，只留在这台小手机</div>
          <button class="mp-icon-btn" data-act="branch-new" type="button" aria-label="从当前聊天开一场">${icon('plus')}</button>
        </div>
        ${cards || '<div class="mp-empty">还没有开过场。<br>先在酒馆打开一个聊天，再点右上角的「+」——会从那个聊天当前的最后一楼分出来，预设、角色卡、世界书和记忆都用酒馆原来那套。</div>'}
        <div class="mp-card-sub" style="color:var(--text-4);margin-top:14px">
          生成走酒馆自己的组装（预设 / 角色卡 / 世界书 / 记忆），回复只写进这里，不写回聊天文件，也不进未读。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'branch-new') {
      createParallelBranch(ctx).then(theater => {
        if (!theater) return;
        ctx.go('parallel-branch', { theaterId: theater.id });
      });
      return true;
    }
    if (act === 'open-branch') {
      if (!ctx.state.theaters[data.theater]) return true;
      ctx.go('parallel-branch', { theaterId: data.theater });
      return true;
    }
    if (act === 'branch-menu') {
      const theater = ctx.state.theaters[data.theater];
      if (theater) openBranchMenu(ctx, theater);
      return true;
    }
    return false;
  },
};

/** 供其它页面复用：改这一场名字。 */
export function openParallelRename(ctx, theater) {
  openRenameForm(ctx, theater);
}
