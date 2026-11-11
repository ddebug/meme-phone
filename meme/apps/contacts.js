/**
 * meme-phone · 通讯录
 */

import { icon } from '../icons.js';
import { contactsOf, contactById, chatFor, chatById, lastMessage, addContact, syncTavernContacts } from '../data.js';
import { avatarHtml, esc, shortText } from '../shell.js';

function groupOf(contact) {
  if (contact.kind === 'group') return '群聊';
  if (contact.kind === 'char') return '酒馆角色';
  return '自己加的';
}

export const contactsApp = {
  id: 'contacts', name: '通讯录', icon: 'contacts',

  render(ctx) {
    const contacts = contactsOf(ctx.state);
    const groups = ['酒馆角色', '群聊', '自己加的'];
    const body = groups.map(group => {
      const list = contacts.filter(contact => groupOf(contact) === group);
      if (!list.length) return '';
      return `
        <div class="mp-group-label" style="margin-top:12px">${group} · ${list.length}</div>
        ${list.map(contact => `
          <button class="mp-row" data-act="open-contact" data-contact="${contact.id}" type="button">
            ${avatarHtml(contact.name, contact.avatar)}
            <div class="mp-row-main">
              <div class="mp-row-name">${esc(contact.name)}</div>
              <div class="mp-row-sub">${esc(contact.signature || (contact.kind === 'group' ? `${contact.members?.length || 0} 人` : '还没有签名'))}</div>
            </div>
            <div class="mp-row-side"><span class="mp-dot"></span></div>
          </button>`).join('')}`;
    }).join('');

    return `
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <div class="mp-title" style="flex:1">通讯录</div>
          <button class="mp-icon-btn" data-act="contact-lookup" type="button" aria-label="查角色">${icon('search')}</button>
          <button class="mp-icon-btn" data-act="contact-add" type="button" aria-label="添加">${icon('plus')}</button>
        </div>
        <div class="mp-subtitle">${contacts.length} 位 · 只有在这里的人才会出现在聊天里</div>
        ${body || '<div class="mp-empty">通讯录还是空的。<br>点右上角，把酒馆里的角色同步过来。</div>'}
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'contact-lookup') {
      ctx.go('app-characters');
      return true;
    }

    if (act === 'open-contact') {
      ctx.go('contact', { contactId: data.contact });
      return true;
    }

    if (act === 'contact-add') {
      ctx.openSheet({
        title: '加一个新的人',
        items: [
          { label: '从酒馆同步角色', value: 'sync', icon: 'contacts' },
          { label: '手动写一个名字', value: 'manual', icon: 'plus' },
          { label: '建一个群聊', value: 'group', icon: 'chat' },
        ],
        onPick: async (value) => {
          if (value === 'sync') {
            ctx.toast('正在读酒馆角色…');
            const list = await ctx.host.readCharacters();
            if (!list.length) { ctx.toast('没读到角色（预览环境下没有酒馆）'); return; }
            const created = syncTavernContacts(ctx.state, list);
            ctx.save();
            ctx.toast(created ? `同步了 ${created} 位` : '已经是最新的');
            ctx.shell.rerender();
          }
          if (value === 'manual') {
            ctx.openSheet({
              kind: 'text', title: '名字', value: '', placeholder: '比如：楼下的猫', confirm: '加进来',
              onText: (text) => {
                const name = String(text || '').trim();
                if (!name) return;
                addContact(ctx.state, { name, kind: 'custom' });
                ctx.save();
                ctx.toast('加好了');
                ctx.shell.rerender();
              },
            });
          }
          if (value === 'group') {
            ctx.openSheet({
              kind: 'text', title: '群名', value: '', placeholder: '比如：周末局', confirm: '建群',
              onText: (text) => {
                const name = String(text || '').trim();
                if (!name) return;
                const members = contactsOf(ctx.state).filter(item => item.kind !== 'group').slice(0, 3).map(item => item.id);
                addContact(ctx.state, { name, kind: 'group', members });
                ctx.save();
                ctx.toast('群建好了');
                ctx.shell.rerender();
              },
            });
          }
        },
      });
      return true;
    }

    return false;
  },
};

export const contactApp = {
  id: 'contact', name: '资料', icon: 'contacts',

  render(ctx, params) {
    const contact = contactById(ctx.state, params.contactId);
    if (!contact) {
      return `<div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button></div><div class="mp-page-body"><div class="mp-empty">这个人不在了。</div></div>`;
    }
    const chats = Object.values(ctx.state.chats).filter(chat => chat.contactId === contact.id);
    const favorites = ctx.state.favorites.filter(item => item.contactId === contact.id);
    const extras = ctx.state.extras[contact.id] || [];
    const last = chats[0] ? lastMessage(chats[0]) : null;

    const rows = chats.map(chat => `
      <button class="mp-row" data-act="open-thread" data-chat="${chat.id}" type="button">
        <div class="mp-row-main">
          <div class="mp-row-name">${chat.kind === 'group' ? '群聊' : '和 TA 的会话'}</div>
          <div class="mp-row-sub">${esc(lastMessage(chat)?.text || '还没有消息')}</div>
        </div>
        <div class="mp-row-side"><span>${chat.updatedAt ? shortText(chat.updatedAt) : ''}</span></div>
      </button>`).join('');

    return `
      <div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button><span style="flex:1"></span>
        <button class="mp-icon-btn" data-act="contact-more" data-contact="${contact.id}" type="button">${icon('more')}</button>
      </div>
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:14px;padding:4px 4px 18px">
          ${avatarHtml(contact.name, contact.avatar, 'mp-avatar lg')}
          <div style="flex:1;min-width:0">
            <div style="font-size:20px;font-weight:600;letter-spacing:-.02em">${esc(contact.name)}</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:3px">${esc(contact.signature || '还没有签名')}</div>
            <div style="display:flex;gap:5px;margin-top:7px">
              <span class="mp-pill">${groupOf(contact)}</span>
              ${last ? `<span class="mp-pill plain">${shortText(last.at)}说过话</span>` : ''}
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="mp-btn accent" data-act="contact-chat" data-contact="${contact.id}" type="button" style="flex:1">${icon('chat')}发消息</button>
          <button class="mp-btn" data-act="contact-extras" data-contact="${contact.id}" type="button" style="flex:1">${icon('theater')}小剧场 ${extras.length || ''}</button>
        </div>
        ${rows}
        <div class="mp-group-label" style="margin-top:16px">收藏了 TA 的 ${favorites.length} 句</div>
        ${favorites.slice(0, 3).map(item => `
          <div class="mp-card" style="font-family:var(--font-serif);font-size:13px;line-height:1.7;color:var(--text-2)">${esc(item.text)}</div>`).join('') || '<div class="mp-empty" style="padding:16px 0">还没有收藏。</div>'}
      </div>`;
  },

  handle(ctx, act, data) {
    const contact = contactById(ctx.state, data.contact);

    if (act === 'open-thread') {
      const chat = chatById(ctx.state, data.chat);
      if (chat) chat.unread = 0;
      ctx.save();
      ctx.go('thread', { chatId: data.chat });
      return true;
    }

    if (act === 'contact-chat') {
      const chat = chatFor(ctx.state, data.contact);
      ctx.save();
      ctx.go('thread', { chatId: chat.id });
      return true;
    }

    if (act === 'contact-extras') {
      ctx.go('app-extras', { contactId: data.contact });
      return true;
    }

    if (act === 'contact-more') {
      if (!contact) return true;
      ctx.openSheet({
        title: contact.name,
        items: [
          { label: '改个备注', value: 'rename', icon: 'brush' },
          { label: '换一句签名', value: 'sign', icon: 'reply' },
          { label: '从通讯录里删掉', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'rename') {
            ctx.openSheet({
              kind: 'text', title: '名字', value: contact.name, confirm: '改好',
              onText: (text) => {
                contact.name = String(text || '').trim() || contact.name;
                ctx.save();
                ctx.shell.rerender();
              },
            });
          }
          if (value === 'sign') {
            ctx.openSheet({
              kind: 'text', title: '签名', value: contact.signature || '', placeholder: '一句就好', confirm: '存下',
              onText: (text) => {
                contact.signature = String(text || '').trim();
                ctx.save();
                ctx.shell.rerender();
              },
            });
          }
          if (value === 'delete') {
            delete ctx.state.contacts[contact.id];
            for (const chat of Object.values(ctx.state.chats)) {
              if (chat.contactId === contact.id) delete ctx.state.chats[chat.id];
            }
            ctx.save();
            ctx.toast('已删掉');
            ctx.home();
          }
        },
      });
      return true;
    }

    return false;
  },
};
