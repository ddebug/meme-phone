/**
 * meme-phone · 平行时空（酒馆聊天分支）
 *
 * 每一场都绑在某个酒馆聊天文件上：开一场时只记分叉点，生成时按「这一场的设置」
 * 截出背景楼层，交给酒馆自己的 prompt 组装，回复只存在这台小手机里，
 * 一个字都不写回聊天文件。所以这里不需要小手机的模型 / 接口 / 回复预设，也没有未读、置顶、免打扰。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml, shortText } from '../shell.js';
import {
  contactById, contactForTavernCharacter, theatersOf, theaterTitleOf, addTheater,
} from '../data.js';
import { readOpenTavernChat } from '../host.js';

const TITLE_MAX = 32;

/** 聊天文件名去掉 .jsonl 和开头重复的角色名，标题里不用拖一长串后缀。 */
export function chatFileLabel(file, characterName = '') {
  let label = String(file || '').replace(/\.jsonl$/i, '');
  const name = String(characterName || '').trim();
  if (name && label.startsWith(`${name} - `)) label = label.slice(name.length + 3);
  return label;
}

/** 这一场接在哪：分叉点 / 最近 N 层 / 不带背景。 */
export function branchStatusLine(theater) {
  const cfg = theater?.cfg || {};
  const file = theater?.chatFile ? `《${chatFileLabel(theater.chatFile, theater.characterName)}》` : '当前酒馆聊天';
  if (cfg.historyMode === 'none') return '不带酒馆背景，只带这一场说过的话';
  if (cfg.historyMode === 'recent') return `接在 ${file} 最近的 ${cfg.historyFloors || 30} 层`;
  return `接在 ${file} 第 ${theater?.forkFloor || 0} 楼`;
}

/** 背景从哪来：分叉点快照 / 现取楼层 / 最近 N 层 / 不带。 */
export function branchHistoryLabel(theater) {
  const cfg = theater?.cfg || {};
  if (cfg.historyMode === 'none') return '不带背景';
  if (cfg.historyMode === 'recent') return `最近 ${cfg.historyFloors || 30} 层`;
  if (theater?.base?.length) return `内联快照 · ${theater.base.length} 层`;
  return theater?.forkFloor ? `酒馆原文 · 前 ${theater.forkFloor} 楼` : '没有背景';
}

/** 记忆口径：跟随酒馆当下的记忆，还是把开这一场时的总结固定下来。 */
export function branchMemoryLabel(theater) {
  const memory = theater?.memory || {};
  const mode = theater?.cfg?.memoryMode || 'tavern';
  const size = String(memory.text || '').trim().length;
  if (mode === 'fixed') return size ? `固定开场时的总结 · ${size} 字` : '固定总结 · 这场开场时没读到';
  if (size) return `跟随酒馆 · 开场读到 ${size} 字`;
  return memory.engine === 'baibai' ? '跟随酒馆 · 当时没读到总结' : '跟随酒馆';
}

/** 「这一场的背景」面板：背景口径、记忆口径、额外指令、分叉点说明。 */
export function branchContextPanelHtml(theater) {
  const cfg = theater?.cfg || {};
  const memory = theater?.memory || {};
  const fork = theater?.forkFloor || 0;
  const extra = String(cfg.extraPrompt || '').trim();
  const rows = [
    ['背景', branchHistoryLabel(theater), cfg.historyMode === 'fork' && theater?.base?.length
      ? '存档里存着当时那段聊天的副本'
      : cfg.historyMode === 'fork'
        ? `每次生成从酒馆当前聊天里取前 ${fork} 楼`
        : cfg.historyMode === 'recent'
          ? '取酒馆当前聊天最新的一段，分叉点只作记录'
          : '不给背景楼层，只看这一场自己说的话'],
    ['记忆', branchMemoryLabel(theater), cfg.memoryMode === 'fixed'
      ? '把开这一场时的柏宝书总结固定注入，之后酒馆里聊的不再影响这一场'
      : '跟着酒馆现在的记忆走，分叉点之后酒馆聊的也会进这一场'],
    ['额外指令', extra ? `${extra.length} 字` : '没有', extra ? '每次生成都附在酒馆那套提示后面' : '回设置页可以写一段只属于这一场的指令'],
  ];
  return `
    <div class="mp-sheet-note">${esc(branchStatusLine(theater))}</div>
    ${rows.map(([label, value, note]) => `
      <div class="mp-prompt-role"><i></i>${esc(label)}<span>${esc(value)}</span></div>
      <div class="mp-prompt-body">${esc(note)}</div>`).join('')}
    ${memory.text ? `<div class="mp-prompt-role"><i></i>开场时的记忆<span>${esc(branchMemoryLabel(theater))}</span></div><div class="mp-prompt-body">${esc(memory.text)}</div>` : ''}
    <div class="mp-sheet-note">分叉点固定在第 ${fork} 楼。酒馆里后来继续聊的，不会自动进这一场；想跟上就在这一场的设置里「跟到最新楼层」。</div>`;
}

function branchPreview(theater) {
  const messages = theater?.messages || [];
  const last = messages[messages.length - 1];
  if (!last) return `从《${chatFileLabel(theater?.chatFile, theater?.characterName) || '酒馆聊天'}》第 ${theater?.forkFloor || 0} 楼接下去`;
  const body = String(last.mes || '').replace(/\s+/g, ' ').slice(0, 60);
  return `${last.is_user ? '我：' : ''}${body}`;
}

/** 列表上的小标签：一眼看出这一场怎么取背景。 */
function branchPill(theater) {
  const cfg = theater?.cfg || {};
  if (cfg.historyMode === 'none') return '无背景';
  if (cfg.historyMode === 'recent') return `最近 ${cfg.historyFloors || 30} 层`;
  return `第 ${theater?.forkFloor || 0} 楼`;
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
    snapshot: host.snapshot || 'live',
    base: host.base,
    memory: host.memory,
  });
  ctx.save();
  ctx.toast(`从第 ${host.forkFloor} 楼分出一条时间线`);
  return theater;
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
        <div class="mp-group-label" style="margin-top:12px">${esc(head)}${group.file ? ` · ${esc(chatFileLabel(group.file, head))}` : ''} · ${group.list.length} 场</div>
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
                <span class="mp-pill plain">${esc(branchPill(theater))} · ${(theater.messages || []).length} 句</span>
              </div>
            </button>`;
          }).join('')}
        </div>`;
    }).join('');

    return `
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <button class="mp-icon-btn" data-act="branch-new" type="button" aria-label="从当前聊天开一场">${icon('plus')}</button>
        </div>
        ${cards || '<div class="mp-empty">还没有开过场。<br>先在酒馆打开一个聊天，再点左上角的「+」——会从那个聊天当前的最后一楼分出来，预设、角色卡、世界书和记忆都用酒馆原来那套。</div>'}
      </div>`;
  },

  handle(ctx, act, data) {
    const theater = data?.theater ? ctx.state.theaters[data.theater] : null;
    if (act === 'branch-new') {
      createParallelBranch(ctx).then(branch => {
        if (!branch) return;
        ctx.go('parallel-branch', { theaterId: branch.id });
      });
      return true;
    }
    if (act === 'open-branch') {
      if (!theater) return true;
      ctx.go('parallel-branch', { theaterId: theater.id });
      return true;
    }
    /* 长按只留一个入口，改名 / 删除都在设置页里，少一套重复菜单 */
    if (act === 'branch-menu') {
      if (!theater) return true;
      ctx.openSheet({
        title: theaterTitleOf(theater),
        note: `${esc(theater.characterName || 'TA')} · ${esc(branchHistoryLabel(theater))} · ${esc(branchMemoryLabel(theater))}`,
        items: [
          { label: '这一场的设置', value: 'settings', icon: 'settings', note: '背景 / 记忆 / 额外指令 / 显示' },
          { label: '打开这一场', value: 'open', icon: 'chat' },
          { label: '删掉这一场', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'settings') {
            ctx.go('parallel-settings', { theaterId: theater.id });
            return;
          }
          if (value === 'open') {
            ctx.go('parallel-branch', { theaterId: theater.id });
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
      return true;
    }
    return false;
  },
};
