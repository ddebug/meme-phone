/**
 * meme-phone · 平行时空
 *
 * 一个角色可以开多场：「这一场」就是另一条时间线里的一段对话。
 * 生成用的是和原生聊天同一套组装（预设 / 接口 / 上下文 / 柏宝书记忆），
 * 但收发只写进这一场自己的会话里，不写回原生聊天，也不进聊天列表和未读数。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml, shortText } from '../shell.js';
import {
  contactById, contactsOf, parallelChatsOf, parallelTitleOf, addParallelChat,
  lastMessage, messagePreview,
} from '../data.js';

function scenePreview(chat) {
  const message = lastMessage(chat);
  if (!message) return '还没开口。';
  const body = messagePreview(message);
  return `${message.from === 'me' ? '我：' : ''}${body}`;
}

/** 新开一场：先选角色，再给这一场起名字、写它从哪儿开始。 */
function openContactPicker(ctx) {
  const contacts = contactsOf(ctx.state).filter(contact => contact.kind !== 'group');
  if (!contacts.length) {
    ctx.toast('先去「通讯录」把角色加进来');
    return;
  }
  ctx.openSheet({
    title: '从谁的哪条时间线开始？',
    note: '一场就是一段独立的对话；同一个角色可以开很多场。',
    items: contacts.map(contact => ({
      label: contact.name,
      value: contact.id,
      icon: 'contacts',
      note: contact.signature || contact.note || '',
    })),
    onPick: (contactId) => {
      const contact = contactById(ctx.state, contactId);
      if (contact) openSceneForm(ctx, contact);
    },
  });
}

function openSceneForm(ctx, contact, scene = null) {
  const editing = Boolean(scene);
  ctx.openSheet({
    kind: 'form',
    title: editing ? `改这一场 · ${contact?.name || ''}` : `新开一场 · ${contact?.name || ''}`,
    fields: [
      {
        name: 'title',
        label: '这一场叫什么',
        placeholder: '比如：如果那天没下雨',
        value: editing ? parallelTitleOf(scene) : '',
        maxLength: 24,
      },
      {
        name: 'scene',
        type: 'textarea',
        label: '这一场从哪儿开始',
        placeholder: '想从哪种关系、哪句话、哪种情绪接下去？留空就从现在开始。',
        value: editing ? String(scene.scene || '') : '',
        maxLength: 2000,
      },
    ],
    confirm: editing ? '存下来' : '开始这一段',
    onForm: (values) => {
      const title = String(values.title || '').trim().slice(0, 24);
      const sceneText = String(values.scene || '').trim().slice(0, 2000);
      if (editing) {
        const live = ctx.state.chats[scene.id];
        if (!live) return;
        live.title = title || parallelTitleOf(live);
        live.scene = sceneText;
        ctx.save();
        ctx.rerender();
        ctx.toast('改好了');
        return;
      }
      const chat = addParallelChat(ctx.state, contact.id, { title, scene: sceneText });
      ctx.save();
      ctx.go('thread', { chatId: chat.id });
    },
  });
}

function openSceneMenu(ctx, chat) {
  const contact = contactById(ctx.state, chat.contactId);
  ctx.openSheet({
    title: parallelTitleOf(chat),
    note: contact ? `${contact.name} · 另一条时间线` : '',
    items: [
      { label: '改名 / 改这一场的设定', value: 'edit', icon: 'brush' },
      { label: '删掉这一场', value: 'delete', icon: 'trash', danger: true },
    ],
    onPick: (value) => {
      if (value === 'edit') {
        openSceneForm(ctx, contact, chat);
        return;
      }
      if (value !== 'delete') return;
      ctx.openSheet({
        title: `删掉「${parallelTitleOf(chat)}」？`,
        items: [{
          label: '确认删掉这一场',
          value: 'delete',
          icon: 'trash',
          danger: true,
          note: '只会删这一场的对话；原生聊天、角色卡和柏宝书记忆都不动。',
        }],
        onPick: (pick) => {
          if (pick !== 'delete') return;
          delete ctx.state.chats[chat.id];
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
    const scenes = parallelChatsOf(ctx.state);
    const order = [];
    const groups = new Map();
    for (const scene of scenes) {
      const contact = contactById(ctx.state, scene.contactId);
      const key = contact?.id || scene.contactId;
      if (!groups.has(key)) {
        groups.set(key, { contact, list: [] });
        order.push(key);
      }
      groups.get(key).list.push(scene);
    }

    const cards = order.map(key => {
      const group = groups.get(key);
      const name = group.contact?.name || '已删掉的角色';
      return `
        <div class="mp-group-label" style="margin-top:12px">${esc(name)} · ${group.list.length} 场</div>
        <div class="mp-group-box">
          ${group.list.map(scene => `
            <button class="mp-row" data-act="open-scene" data-chat="${scene.id}" data-hold="scene-menu" type="button">
              ${avatarHtml(group.contact?.name, group.contact?.avatar)}
              <div class="mp-row-main">
                <div class="mp-row-name">${esc(parallelTitleOf(scene))}</div>
                <div class="mp-row-sub">${esc(scenePreview(scene))}</div>
              </div>
              <div class="mp-row-side">
                <span>${scene.updatedAt ? shortText(scene.updatedAt) : ''}</span>
                <span class="mp-pill plain">${scene.messages?.length || 0} 条</span>
              </div>
            </button>`).join('')}
        </div>`;
    }).join('');

    return `
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <div class="mp-subtitle" style="margin-top:0;flex:1">平行时空 · 同一段关系，另一条时间线</div>
          <button class="mp-icon-btn" data-act="parallel-new" type="button" aria-label="新开一场">${icon('plus')}</button>
        </div>
        ${cards || '<div class="mp-empty">还没有开过场。<br>点右上角的「+」选一个角色，从这里开始的对话只留在这一场里。</div>'}
        <div class="mp-card-sub" style="color:var(--text-4);margin-top:14px">
          预设、接口、酒馆记忆和原生聊天一样；这一场里说的每句话只存在这台小手机里，不写回聊天，也不进未读。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'parallel-new') {
      openContactPicker(ctx);
      return true;
    }
    if (act === 'open-scene') {
      if (!ctx.state.chats[data.chat]) return true;
      ctx.go('thread', { chatId: data.chat });
      return true;
    }
    if (act === 'scene-menu') {
      const chat = ctx.state.chats[data.chat];
      if (!chat) return true;
      openSceneMenu(ctx, chat);
      return true;
    }
    return false;
  },
};

/** 供聊天页长按菜单复用：这一场的改名 / 改设定入口。 */
export function openParallelSceneForm(ctx, chat) {
  const contact = contactById(ctx.state, chat.contactId);
  openSceneForm(ctx, contact, chat);
}
