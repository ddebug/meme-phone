/**
 * meme-phone · 聊天
 * 两个页面：会话列表（app-chat）与单人会话（thread）。
 */

import { icon } from '../icons.js';
import {
  chatsOf, chatById, lastMessage, contactById, pushMessage, chatFor, unreadTotal, contactsOf,
  wakeAllowed, messagePreview,
  apiPresetsOf, memoryPresetsOf, memoryPresetFor,
  replyPresetsOf, replyPresetFor, normalizeReplyItems,
} from '../data.js';
import { memoryPresetSummary } from '../memory.js';
import { avatarHtml, esc, shortText, timeText } from '../shell.js';

const REPLY_POOL = {
  沈砚: ['到楼下了，风比刚才小一点。', '你先忙，我在便利店坐着。', '记得吃点东西，别又是咖啡。', '刚看到你窗户还亮着。'],
  江迟: ['那首歌我存下来了。', '下次你在车上再放一次。', '今天听了一下午，副歌有点上头。'],
  林小满: ['雨好像小了一点。', '你带伞了吗。', '我这边刚停，云还很厚。'],
  顾南风: ['书店这本我觉得你会喜欢。', '封面是深蓝色的，摸起来有点粗。', '要给你留着吗。'],
};

function poolFor(contact) {
  return REPLY_POOL[contact?.name] || ['嗯，我在。', '刚看到消息。', '你说吧，我听着。'];
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

/* 聊天设置页：行样式沿用全局设置页，不另造一套 */
function chatSetRow(chatId, { iconName, title, sub, act, toggle, value, danger }) {
  return `
    <button class="mp-set-row${danger ? ' is-danger' : ''}" data-act="${act}" data-chat="${esc(chatId)}" type="button">
      <span class="mp-set-ico">${icon(iconName)}</span>
      <span class="mp-set-name">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${toggle !== undefined
        ? `<span class="mp-switch${toggle ? ' on' : ''}"></span>`
        : value ? `<span class="mp-set-value">${esc(value)}</span>` : ''}
      ${toggle === undefined ? `<span style="color:var(--text-4)">${icon('chevron')}</span>` : ''}
    </button>`;
}

function saveMessageExtra(ctx, chat, contact, message) {
  const list = (ctx.state.extras[chat.contactId] = ctx.state.extras[chat.contactId] || []);
  const item = {
    id: 'x' + Date.now().toString(36),
    title: (message.text || '这一条').slice(0, 12),
    date: new Date(message.at || Date.now()).toLocaleDateString('sv-SE'),
    lines: [message.text || ''],
    messageId: message.id,
    chatId: chat.id,
  };
  list.unshift(item);
  ctx.save();
  return item;
}

function openMessageExtra(ctx, chat, contact, message) {
  const extras = (ctx.state.extras[chat.contactId] || [])
    .filter(item => item.messageId === message.id);
  if (extras.length === 1) {
    ctx.go('extra-detail', { contactId: chat.contactId, extraId: extras[0].id });
    return;
  }
  if (extras.length > 1) {
    ctx.openSheet({
      title: '这条消息的小剧场',
      items: extras.map(item => ({ label: item.title, value: item.id, icon: 'theater' })),
      onPick: (value) => ctx.go('extra-detail', { contactId: chat.contactId, extraId: value }),
    });
    return;
  }
  ctx.openSheet({
    title: '这条消息还没有小剧场',
    items: [
      { label: '把这条存成小剧场', value: 'save', icon: 'theater' },
      { label: '看 TA 的全部小剧场', value: 'all', icon: 'book' },
    ],
    onPick: (value) => {
      if (value === 'save') {
        const item = saveMessageExtra(ctx, chat, contact, message);
        ctx.toast('已存进小剧场');
        ctx.go('extra-detail', { contactId: chat.contactId, extraId: item.id });
      }
      if (value === 'all') ctx.go('app-extras', { contactId: chat.contactId });
    },
  });
}

function settingsBody(ctx, chatId) {
  const state = ctx.state;
  const chat = chatById(state, chatId);
  if (!chat) return `<div class="mp-page-body"><div class="mp-empty">这个会话已经不在了。</div></div>`;
  const contact = contactById(state, chat.contactId);
  const card = (state.characters || []).find(item => item.name === contact?.name);
  const count = chat.messages?.length || 0;
  const mode = contact?.kind === 'group' ? '群聊' : contact?.kind === 'char' ? '酒馆角色' : '单聊';
  const status = [mode, `${count} 条消息`, chat.pinned ? '置顶' : '', chat.muted ? '免打扰' : ''].filter(Boolean).join(' · ');
  const presets = apiPresetsOf(state);
  const ownPreset = presets.find(item => item.id === chat.llmPresetId) || null;
  const globalPreset = presets.find(item => item.id === state.settings.api?.activeChat) || presets[0] || null;
  const llmSub = ownPreset
    ? `只对这个会话 · ${ownPreset.name || '未命名方案'}`
    : `跟随手机 · ${globalPreset?.name || '酒馆 API'}`;
  const memoryPresets = memoryPresetsOf(state);
  const ownMemory = memoryPresets.find(item => item.id === chat.memoryPresetId) || null;
  const globalMemory = memoryPresetFor(state, null);
  const memorySub = ownMemory
    ? `只对这个会话 · ${memoryPresetSummary(ownMemory)}`
    : `跟随手机 · ${memoryPresetSummary(globalMemory)}`;
  const replyPresets = replyPresetsOf(state);
  const ownReply = replyPresets.find(item => item.id === chat.replyPresetId) || null;
  const globalReply = replyPresetFor(state, null);
  const activeReply = ownReply || globalReply;
  const replyItems = normalizeReplyItems(activeReply?.items, activeReply?.context);
  const replyItemCount = replyItems.filter(item => item.kind === 'chat').length;
  const replyAppCount = replyItems.filter(item => item.kind === 'app').length;
  const injectedCount = replyItems.filter(item => item.kind === 'context' && item.enabled).length;
  const replySub = `${ownReply ? `只对这个会话 · ${ownReply.name || '未命名'}` : `跟随手机 · ${globalReply?.name || '默认回复方式'}`} · ${replyItemCount} 条聊天提示${replyAppCount ? ` · ${replyAppCount} 条其他软件` : ''} · ${injectedCount ? `注入 ${injectedCount} 段` : '不注入上下文'}`;
  const wakeSub = chat.wake === undefined
    ? `跟随手机设置 · ${state.settings.chat?.wake === false ? '关' : '开'}`
    : (chat.wake ? '这个会话单独开着' : '这个会话单独关掉');

  return `
    <div class="mp-page-body">
      <div class="mp-subtitle" style="margin-top:0">聊天设置 · 只改这个会话的开关和引用；角色卡、世界书是全局的，改会写到酒馆</div>

      <div class="mp-chat-set-head">
        ${avatarHtml(contact?.name || '?', contact?.avatar)}
        <div class="mp-chat-set-main">
          <div class="mp-chat-set-name">${esc(contact?.name || '这个会话')}</div>
          <div class="mp-chat-set-sub">${esc(status)}</div>
        </div>
        ${chat.pinned ? `<span class="mp-pill">置顶</span>` : ''}
      </div>

      <div class="mp-group" style="margin-top:16px">
        <div class="mp-group-label">聊天</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, { iconName: 'pin', title: '置顶聊天', sub: chat.pinned ? '已固定在会话列表最上面' : '让这个会话排在前面', act: 'ts-toggle-pin', toggle: chat.pinned })}
          ${chatSetRow(chat.id, { iconName: 'bell', title: '消息免打扰', sub: chat.muted ? '新消息不显示未读角标' : '这个会话的新消息照常计数', act: 'ts-toggle-mute', toggle: chat.muted })}
          ${chatSetRow(chat.id, {
            iconName: 'chat', title: '空着发送 = 让 TA 主动开口',
            sub: wakeSub, act: 'ts-toggle-wake',
            value: chat.wake === undefined ? '跟随' : (chat.wake ? '开' : '关'),
          })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">模型</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, {
            iconName: 'spark', title: '这个聊天的 LLM',
            sub: llmSub, act: 'ts-llm', value: ownPreset ? '单独' : '跟随',
          })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">回复</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, {
            iconName: 'reply', title: '回复预设',
            sub: replySub, act: 'ts-reply', value: ownReply ? '单独' : '跟随',
          })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">上下文</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, {
            iconName: 'book', title: '酒馆记忆',
            sub: memorySub, act: 'ts-memory', value: ownMemory ? '单独' : '跟随',
          })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">这个角色</div>
        <div class="mp-group-box">
          ${card
            ? chatSetRow(chat.id, { iconName: 'contacts', title: '角色设定与世界书', sub: '角色卡正文只读；世界书开关会写回酒馆，影响所有会话', act: 'ts-open-character' })
            : chatSetRow(chat.id, { iconName: 'search', title: '去查角色', sub: '还没同步这张角色卡', act: 'ts-open-characters' })}
          ${chatSetRow(chat.id, { iconName: 'diary', title: 'TA 的日记', sub: '按天记录这个角色和你的聊天', act: 'ts-diary' })}
          ${chatSetRow(chat.id, { iconName: 'theater', title: '看 TA 的小剧场', sub: '这个角色存下来的片段', act: 'ts-extras' })}
        </div>
      </div>

      <div class="mp-group">
        <div class="mp-group-label">记录</div>
        <div class="mp-group-box">
          ${chatSetRow(chat.id, { iconName: 'trash', title: '清空这个会话的消息', sub: '只删聊天记录，联系人和角色卡都还在', act: 'ts-clear', danger: true })}
          ${chatSetRow(chat.id, { iconName: 'close', title: '删除这个会话', sub: '连同会话设置一起删掉', act: 'ts-delete', danger: true })}
        </div>
      </div>
    </div>`;
}


/* ------------------------------------------------------ 会话列表 */

function listBody(ctx) {
  const state = ctx.state;
  const chats = chatsOf(state).filter(chat => chat.messages.length || chat.unread);

  const rows = chats.map(chat => {
    const contact = contactById(state, chat.contactId);
    if (!contact) return '';
    const message = lastMessage(chat);
    const preview = message
      ? `${message.from === 'me' ? '我：' : ''}${messagePreview(message)}`
      : '还没有消息，说点什么吧。';
    return `
      <button class="mp-row" data-act="open-thread" data-chat="${chat.id}" data-hold="chat-menu" type="button">
        ${avatarHtml(contact.name, contact.avatar)}
        <div class="mp-row-main">
          <div class="mp-row-name">
            ${esc(contact.name)}
            ${chat.pinned ? `<span class="mp-pill plain">${icon('pin')}</span>` : ''}
            ${contact.kind === 'group' ? '<span class="mp-pill plain">群</span>' : ''}
          </div>
          <div class="mp-row-sub">${esc(preview)}</div>
        </div>
        <div class="mp-row-side">
          <span>${chat.updatedAt ? shortText(chat.updatedAt) : ''}</span>
          ${chat.unread && !chat.muted ? `<span class="mp-badge-count">${chat.unread > 99 ? '99+' : chat.unread}</span>` : ''}
        </div>
      </button>`;
  }).join('');

  return `
    <div class="mp-page-body">
      <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
        <span style="flex:1"></span>
        <button class="mp-icon-btn" data-act="chat-new" type="button" aria-label="新建会话">${icon('plus')}</button>
      </div>
      <div class="mp-subtitle">聊天 · ${chats.length} 个会话 · ${unreadTotal(state)} 条未读</div>
      ${rows || '<div class="mp-empty">还没有会话。<br>先去「通讯录」把角色加进来。</div>'}
    </div>`;
}

/* --------------------------------------------------------- 会话页 */

function threadBody(ctx, chatId) {
  const state = ctx.state;
  const chat = chatById(state, chatId);
  if (!chat) return `${nav(ctx)}<div class="mp-page-body"><div class="mp-empty">这个会话已经不在了。</div></div>`;
  const contact = contactById(state, chat.contactId);
  const messages = chat.messages || [];
  const quote = ctx.shell.quote?.[chatId] || null;

  const blocks = [];
  let lastAt = 0;
  const speakerName = (message) => {
    const speaker = message.speaker ? contactById(state, message.speaker) : null;
    return speaker?.name || contact?.name || 'TA';
  };
  for (const message of messages) {
    const startGroup = message.at - lastAt > 30 * 60 * 1000;
    if (message.kind === 'system' || message.from === 'system' || message.kind === 'recalled' || message.kind === 'poke') {
      if (startGroup) {
        blocks.push(`<div class="mp-time">${timeText(message.at)}</div>`);
        lastAt = message.at;
      }
      if (message.kind === 'recalled') {
        blocks.push(`<div class="mp-sys is-recall">${message.from === 'me' ? '你撤回了一条消息' : `${esc(speakerName(message))}撤回了一条消息`}</div>`);
      } else if (message.kind === 'poke') {
        blocks.push(`<div class="mp-sys is-poke">${message.from === 'me' ? `你拍了拍「${esc(contact?.name || 'TA')}」` : `「${esc(contact?.name || 'TA')}」拍了拍你`}</div>`);
      } else {
        blocks.push(`<div class="mp-sys">${esc(message.text)}</div>`);
      }
      continue;
    }
    if (startGroup) {
      blocks.push(`<div class="mp-time">${timeText(message.at)}</div>`);
      lastAt = message.at;
    }
    const me = message.from === 'me';
    const speaker = message.speaker ? contactById(state, message.speaker) : null;
    const bubble = message.image
      ? `<button class="mp-bubble mp-bubble-photo" data-act="view-photo" data-chat="${chat.id}" data-msg="${message.id}" type="button"><img src="${esc(message.image)}" alt="照片"></button>`
      : message.emoji
        ? `<div class="mp-bubble mp-bubble-emoji">${esc(message.emoji)}</div>`
        : message.forward
          ? `<div class="mp-bubble mp-bubble-forward"><div class="mp-forward-head">${icon('forward')}<span>转发的消息</span></div><div class="mp-forward-text">${esc(message.forward.text || '')}</div>${message.forward.from ? `<div class="mp-forward-src">来自 ${esc(message.forward.from)}</div>` : ''}</div>`
          : `<div class="mp-bubble">${esc(message.text)}</div>`;
    blocks.push(`
      <div class="mp-msg${me ? ' me' : ''}" data-hold="message-menu" data-chat="${chat.id}" data-msg="${message.id}">
        ${me
          ? avatarHtml(state.settings.user.name, state.settings.user.avatar)
          : `<button class="mp-avatar-btn" data-act="avatar-extra" data-chat="${chat.id}" data-msg="${message.id}" type="button" aria-label="看 TA 的小剧场">${avatarHtml(speaker?.name || contact?.name, speaker?.avatar || contact?.avatar)}</button>`}
        <div class="mp-msg-body">
          ${message.quote ? `<div class="mp-quote-line">${icon('reply')}<span>${esc(message.quote.text)}</span></div>` : ''}
          ${bubble}
          <div class="mp-msg-meta">
            ${message.proactive ? '<span class="mp-tag-proactive">主动开口</span>' : ''}
            ${speaker ? `<span>${esc(speaker.name)}</span>` : ''}
            <span>${startGroup ? '' : timeText(message.at)}</span>
          </div>
        </div>
      </div>`);
  }

  if (chat.typing) {
    blocks.push(`<div class="mp-msg">${avatarHtml(contact?.name, contact?.avatar)}<div class="mp-msg-body"><div class="mp-typing"><i></i><i></i><i></i></div></div></div>`);
  }

  return `
    <div class="mp-thread">
      <div class="mp-thread-head">
        <button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        ${avatarHtml(contact?.name, contact?.avatar)}
        <div style="flex:1;min-width:0">
          <div class="mp-thread-name">${esc(contact?.name || '')}</div>
          <div class="mp-thread-status"><span class="mp-dot"></span>${esc(contact?.signature || '在线')}</div>
        </div>
        <button class="mp-icon-btn" data-act="thread-settings" data-chat="${chat.id}" type="button" aria-label="聊天设置">${icon('settings')}</button>
      </div>
      <div class="mp-messages" id="mpMessages">${blocks.join('')}</div>
      <div class="mp-composer">
        <div class="mp-composer-tip">${wakeAllowed(ctx.state, chat) ? '空着发出去，TA 会主动开口' : '空发送已关掉，去聊天设置里打开'}</div>
        ${quote ? `
        <div class="mp-quote-chip">
          <span style="color:var(--accent-deep)">${icon('reply')}</span>
          <span class="mp-quote-chip-text">${esc(quote.text)}</span>
          <button class="mp-sq-btn" data-act="clear-quote" data-chat="${chat.id}" type="button" style="width:26px;height:26px">${icon('close')}</button>
        </div>` : ''}
        <div class="mp-composer-row">
          <button class="mp-sq-btn" data-act="composer-plus" data-chat="${chat.id}" type="button" aria-label="更多">${icon('plus')}</button>
          <div class="mp-compose-box">
            <input type="text" placeholder="发消息…" value="${esc(ctx.shell.live.inputValue || '')}" aria-label="输入消息">
          </div>
          <button class="mp-send" data-act="send" data-chat="${chat.id}" type="button" aria-label="发送">${icon('send')}</button>
        </div>
        <input id="mpMsgPhoto" type="file" accept="image/*" data-chat="${chat.id}" style="position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0">
      </div>
    </div>`;
}

function nav(ctx, right = '') {
  return `<div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button><span style="flex:1"></span>${right}</div>`;
}

/* --------------------------------------------------------- 发送逻辑 */

function scrollToBottom(ctx) {
  const box = ctx.shell.root.querySelector('.mp-messages');
  if (box) box.scrollTop = box.scrollHeight;
  ctx.shell.scroller = null;
}

function doSend(ctx, chatId) {
  const input = ctx.shell.root.querySelector('.mp-compose-box input');
  const text = (input?.value || '').trim();
  const chat = chatById(ctx.state, chatId);
  if (!chat) return;
  const contact = contactById(ctx.state, chat.contactId);

  if (!text) {
    if (!wakeAllowed(ctx.state, chat)) {
      ctx.toast(ctx.state.settings?.proactive?.enabled === false
        ? '设置里关掉了主动开口'
        : (ctx.state.settings?.chat?.wake === false ? '设置里关掉了空发送' : '这个会话的空发送已经关掉了'));
      return;
    }
    wake(ctx, chat, contact);
    return;
  }

  pushMessage(ctx.state, chatId, { from: 'me', text, quote: ctx.shell.quote?.[chatId] || null });
  chat.draft = '';
  chat.unread = 0;
  if (ctx.shell.quote) delete ctx.shell.quote[chatId];
  ctx.shell.live = { inputValue: '', focus: true };
  ctx.save();
  ctx.rerender();
  scrollToBottom(ctx);
  reply(ctx, chat, contact);
}

function reply(ctx, chat, contact, replaceId = '') {
  chat.typing = true;
  ctx.rerender();
  scrollToBottom(ctx);

  const delay = 900 + Math.random() * 700;
  setTimeout(async () => {
    let text = '';
    try {
      text = await ctx.ai.reply(ctx, chat, contact, pick(poolFor(contact)));
    } catch {
      text = '';
    }
    chat.typing = false;
    if (text) {
      const index = replaceId ? chat.messages.findIndex(item => item.id === replaceId) : -1;
      if (index >= 0) {
        /* 重新生成：新内容回来后才覆盖原来那条，生成失败时原消息还在 */
        chat.messages[index] = { ...chat.messages[index], text, at: Date.now() };
        chat.updatedAt = chat.messages[index].at;
      } else {
        pushMessage(ctx.state, chat.id, { from: 'them', text });
      }
    } else if (replaceId) {
      ctx.toast('这次没生成出来，原来那条留着了');
    }
    ctx.save();
    ctx.rerender();
    scrollToBottom(ctx);
  }, delay);
}

function wake(ctx, chat, contact) {
  if (chat.typing) return;
  chat.typing = true;
  ctx.rerender();
  scrollToBottom(ctx);
  ctx.toast('让 TA 主动开口…');

  setTimeout(async () => {
    let text = '';
    try {
      text = await ctx.ai.proactive(ctx, chat, contact, pick(poolFor(contact)));
    } catch {
      text = '';
    }
    chat.typing = false;
    if (text) {
      pushMessage(ctx.state, chat.id, { from: 'them', text, proactive: true, kind: 'proactive' });
      chat.unread = Math.max(chat.unread, 0);
    } else {
      ctx.toast('模型没接通，先在设置里选一个 API');
    }
    ctx.save();
    ctx.rerender();
    scrollToBottom(ctx);
  }, 1500);
}

/* ------------------------------------------------------------ 导出 */

export const chatApp = {
  id: 'chat', name: '聊天', icon: 'chat',

  render(ctx) {
    return listBody(ctx);
  },

  handle(ctx, act, data) {
    if (act === 'open-thread') {
      const chat = chatById(ctx.state, data.chat);
      if (chat) chat.unread = 0;
      ctx.save();
      ctx.shell.live = { inputValue: chat?.draft || '', focus: false };
      ctx.go('thread', { chatId: data.chat });
      setTimeout(() => scrollToBottom(ctx), 30);
      return true;
    }

    if (act === 'chat-new') {
      const contacts = contactsOf(ctx.state);
      ctx.openSheet({
        title: '和谁聊天',
        items: contacts.slice(0, 8).map(contact => ({ label: contact.name, value: contact.id, icon: 'contacts' })),
        onPick: (contactId) => {
          const contact = contactById(ctx.state, contactId);
          if (!contact) return;
          chatFor(ctx.state, contactId);
          ctx.save();
          ctx.go('thread', { chatId: chatFor(ctx.state, contactId).id });
        },
      });
      return true;
    }

    if (act === 'chat-menu') {
      const chat = chatById(ctx.state, data.chat);
      const contact = chat && contactById(ctx.state, chat.contactId);
      if (!chat) return true;
      ctx.openSheet({
        title: contact?.name || '',
        items: [
          { label: chat.pinned ? '取消置顶' : '置顶这个会话', value: 'pin', icon: 'pin' },
          { label: chat.muted ? '打开消息提醒' : '消息免打扰', value: 'mute', icon: 'bell' },
          { label: '删除这个会话', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'pin') chat.pinned = !chat.pinned;
          if (value === 'mute') chat.muted = !chat.muted;
          if (value === 'delete') {
            ctx.openSheet({
              title: `删除和「${contact?.name || 'TA'}」的会话？`,
              items: [{ label: '确认删除会话', value: 'delete', icon: 'trash', danger: true, note: '会删掉这段聊天记录和会话设置；联系人、角色卡和酒馆数据都不动。' }],
              onPick: (pick) => {
                if (pick !== 'delete') return;
                delete ctx.state.chats[chat.id];
                ctx.save();
                ctx.rerender();
                ctx.toast('会话已删除');
              },
            });
            return;
          }
          ctx.save();
          ctx.rerender();
        },
      });
      return true;
    }

    return false;
  },
};

export const threadSettingsApp = {
  id: 'thread-settings', name: '聊天设置', icon: 'settings',

  render(ctx, params) {
    return settingsBody(ctx, params.chatId);
  },

  handle(ctx, act, data) {
    const chatId = String(data?.chat || '');
    const chat = chatById(ctx.state, chatId);
    if (!chat) {
      if (act.startsWith('ts-')) { ctx.toast('这个会话已经不在了'); return true; }
      return false;
    }
    const contact = contactById(ctx.state, chat.contactId);

    if (act === 'ts-toggle-pin') {
      chat.pinned = !chat.pinned;
      ctx.save();
      ctx.rerender();
      ctx.toast(chat.pinned ? '已置顶这个会话' : '已取消置顶');
      return true;
    }

    if (act === 'ts-toggle-mute') {
      chat.muted = !chat.muted;
      ctx.save();
      ctx.rerender();
      ctx.toast(chat.muted ? '这个会话不再显示未读角标' : '恢复未读角标');
      return true;
    }

    if (act === 'ts-toggle-wake') {
      chat.wake = chat.wake === undefined ? true : (chat.wake ? false : undefined);
      ctx.save();
      ctx.rerender();
      ctx.toast(chat.wake === undefined
        ? '这个会话恢复跟随手机设置'
        : (chat.wake ? '这个会话空发送可以触发主动开口' : '这个会话空发送已关掉'));
      return true;
    }

    if (act === 'ts-llm') {
      const presets = apiPresetsOf(ctx.state);
      const globalPreset = presets.find(item => item.id === ctx.state.settings.api?.activeChat) || presets[0] || null;
      ctx.openSheet({
        title: '这个聊天的 LLM',
        items: [
          { label: '跟随手机', value: 'follow', note: `现在用「${globalPreset?.name || '酒馆 API'}」` },
          ...presets.map(item => ({
            label: item.name || '未命名方案',
            value: item.id,
            note: [item.model, item.url].filter(Boolean).join(' · ') || '借酒馆自己的模型',
          })),
        ],
        onPick: (value) => {
          if (value === 'follow') {
            chat.llmPresetId = '';
            ctx.save();
            ctx.rerender();
            ctx.toast('已跟随手机的 LLM 方案');
            return;
          }
          const preset = presets.find(item => item.id === value);
          if (!preset) return;
          chat.llmPresetId = preset.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`这个会话改用「${preset.name || '未命名方案'}」`);
        },
      });
      return true;
    }

    if (act === 'ts-reply') {
      const presets = replyPresetsOf(ctx.state);
      const globalPreset = replyPresetFor(ctx.state, null);
      ctx.openSheet({
        title: '这个会话怎么回消息',
        items: [
          { label: '跟随手机', value: 'follow', note: `现在用「${globalPreset?.name || '默认'}」` },
          ...presets.map(item => ({
            label: item.name || '未命名预设',
            value: item.id,
            note: String(item.text || '').slice(0, 38) || '空指令',
          })),
          { label: '管理回复预设', value: 'manage', note: '新建、改指令、设为手机默认' },
        ],
        onPick: (value) => {
          if (value === 'follow') {
            chat.replyPresetId = '';
            ctx.save();
            ctx.rerender();
            ctx.toast('这个会话已跟随手机的回复预设');
            return;
          }
          if (value === 'manage') {
            ctx.go('app-presets');
            return;
          }
          const preset = presets.find(item => item.id === value);
          if (!preset) return;
          chat.replyPresetId = preset.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`这个会话改用「${preset.name || '未命名预设'}」`);
        },
      });
      return true;
    }

    if (act === 'ts-memory') {
      const presets = memoryPresetsOf(ctx.state);
      const globalPreset = memoryPresetFor(ctx.state, null);
      ctx.openSheet({
        title: '酒馆记忆',
        items: [
          { label: '跟随手机', value: 'follow', note: `现在用「${globalPreset?.name || '默认'}」` },
          ...presets.map(item => ({
            label: item.name,
            value: item.id,
            note: memoryPresetSummary(item),
          })),
          { label: '管理记忆方案', value: 'manage', note: '新建、改名、改层数' },
        ],
        onPick: (value) => {
          if (value === 'follow') {
            chat.memoryPresetId = '';
            ctx.save();
            ctx.rerender();
            ctx.toast('已跟随手机的酒馆记忆');
            return;
          }
          if (value === 'manage') {
            ctx.go('memory-presets');
            return;
          }
          const preset = presets.find(item => item.id === value);
          if (!preset) return;
          chat.memoryPresetId = preset.id;
          ctx.save();
          ctx.rerender();
          ctx.toast(`这个会话改用「${preset.name}」`);
        },
      });
      return true;
    }

    if (act === 'ts-open-character') {
      const card = (ctx.state.characters || []).find(item => item.name === contact?.name);
      if (card) ctx.go('character-card', { name: card.name });
      else ctx.go('app-contacts', { tab: 'cards' });
      return true;
    }

    if (act === 'ts-open-characters') { ctx.go('app-contacts', { tab: 'cards' }); return true; }

    if (act === 'ts-diary') { ctx.go('thread-diary', { chatId: chat.id }); return true; }

    if (act === 'ts-extras') { ctx.go('app-extras', { contactId: chat.contactId }); return true; }

    if (act === 'ts-clear') {
      ctx.openSheet({
        title: '清空这个会话的消息？',
        items: [{ label: '清空聊天记录', value: 'clear', icon: 'trash', danger: true }],
        onPick: (value) => {
          if (value !== 'clear') return;
          chat.messages = [];
          chat.unread = 0;
          chat.typing = false;
          ctx.save();
          ctx.toast('聊天记录已清空');
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'ts-delete') {
      ctx.openSheet({
        title: '删除这个会话？',
        items: [{ label: '连同会话设置一起删除', value: 'delete', icon: 'trash', danger: true }],
        onPick: (value) => {
          if (value !== 'delete') return;
          delete ctx.state.chats[chat.id];
          ctx.save();
          ctx.home();
          ctx.go('app-chat');
          ctx.toast('会话已删除');
        },
      });
      return true;
    }

    return false;
  },
};


export const threadApp = {
  id: 'thread', name: '会话', icon: 'chat',

  render(ctx, params) {
    return threadBody(ctx, params.chatId);
  },

  handle(ctx, act, data) {
    const chatId = data.chat;

    if (act === 'thread-settings') {
      if (chatById(ctx.state, chatId)) ctx.go('thread-settings', { chatId });
      return true;
    }

    if (act === 'send') { doSend(ctx, chatId); return true; }

    if (act === 'clear-quote') {
      if (ctx.shell.quote) delete ctx.shell.quote[chatId];
      ctx.rerender();
      return true;
    }

    if (act === 'composer-plus') {
      ctx.openSheet({
        title: '加点什么',
        items: [
          { label: '照片', value: 'photo', icon: 'image', note: '从相册选一张，压小了再存进手机' },
          { label: '表情', value: 'emoji', icon: 'smile', note: '发一个大表情，不是文字里的贴图' },
          { label: '戳一戳', value: 'poke', icon: 'spark', note: '在聊天里留一行「你拍了拍 TA」' },
          { label: '引用最近一条', value: 'quote', icon: 'reply' },
          { label: '存成小剧场', value: 'extra', icon: 'theater' },
        ],
        onPick: (value) => {
          const chat = chatById(ctx.state, chatId);
          if (!chat) return;
          if (value === 'photo') {
            const picker = ctx.shell.root.querySelector('#mpMsgPhoto');
            if (picker) {
              try { picker.click(); } catch (error) { ctx.toast('相册打不开，换一张试试'); }
            } else {
              ctx.toast('相册没准备好，再点一次');
            }
            return;
          }
          if (value === 'emoji') {
            const list = Array.isArray(ctx.state.emoji) ? ctx.state.emoji : [];
            ctx.openSheet({
              title: '发哪个表情',
              items: list.slice(0, 12).map(item => ({ label: `${item.char} ${item.name || ''}`.trim(), value: item.char, note: '点上就发出去' })),
              onPick: (char) => {
                if (!char) return;
                pushMessage(ctx.state, chat.id, { from: 'me', kind: 'emoji', emoji: char, text: char });
                chat.unread = 0;
                ctx.save();
                ctx.rerender();
                scrollToBottom(ctx);
                reply(ctx, chat, contactById(ctx.state, chat.contactId));
              },
            });
          }
          if (value === 'poke') {
            pushMessage(ctx.state, chat.id, { from: 'me', kind: 'poke', text: '' });
            ctx.save();
            ctx.rerender();
            scrollToBottom(ctx);
          }
          if (value === 'quote') {
            const last = lastMessage(chat);
            if (!last) { ctx.toast('还没有可引用的消息'); return; }
            ctx.shell.quote = ctx.shell.quote || {};
            ctx.shell.quote[chatId] = { text: messagePreview(last), from: last.from };
            ctx.rerender();
          }
          if (value === 'extra') {
            const last = lastMessage(chat);
            const contact = contactById(ctx.state, chat.contactId);
            if (!last || !contact) { ctx.toast('还没有内容'); return; }
            saveMessageExtra(ctx, chat, contact, last);
            ctx.toast('已存进小剧场');
          }
        },
      });
      return true;
    }

    if (act === 'avatar-extra') {
      const chat = chatById(ctx.state, chatId);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const contact = contactById(ctx.state, chat.contactId);
      openMessageExtra(ctx, chat, contact, message);
      return true;
    }

    if (act === 'thread-more') {
      const chat = chatById(ctx.state, chatId);
      if (!chat) return true;
      const contact = contactById(ctx.state, chat.contactId);
      ctx.openSheet({
        title: contact?.name || '',
        items: [
          { label: '看 TA 的小剧场', value: 'extras', icon: 'theater' },
          { label: '清空这个会话的消息', value: 'clear', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'extras') ctx.go('app-extras', { contactId: chat.contactId });
          if (value === 'clear') {
            ctx.openSheet({
              title: `清空「${contact?.name || 'TA'}」的聊天记录？`,
              items: [{ label: '确认清空消息', value: 'clear', icon: 'trash', danger: true, note: '聊天记录会全部删掉，会话设置和联系人保留，不能恢复。' }],
              onPick: (pick) => {
                if (pick !== 'clear') return;
                chat.messages = [];
                chat.unread = 0;
                ctx.save();
                ctx.rerender();
                ctx.toast('已清空');
              },
            });
          }
        },
      });
      return true;
    }

    if (act === 'message-menu') {
      const chat = chatById(ctx.state, data.chat);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (!chat || !message) return true;
      const contact = contactById(ctx.state, chat.contactId);
      const mine = message.from === 'me';
      const recallable = mine && message.kind !== 'recalled' && Date.now() - message.at < 2 * 60 * 1000;
      ctx.openSheet({
        title: '',
        items: [
          { label: '引用这条回复', value: 'quote', icon: 'reply' },
          ...(message.text ? [{ label: '复制文字', value: 'copy', icon: 'copy' }] : []),
          { label: '收藏这条', value: 'favorite', icon: 'bookmark', note: '存进「收藏」，删了聊天也还在' },
          { label: '转发给…', value: 'forward', icon: 'forward' },
          ...(recallable ? [{ label: '撤回这条', value: 'recall', icon: 'refresh', note: '两分钟内可以撤回' }] : []),
          { label: '存成小剧场', value: 'extra', icon: 'theater' },
          { label: '让 TA 重新说一次', value: 'regen', icon: 'refresh' },
          { label: '删除这条', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'quote') {
            ctx.shell.quote = ctx.shell.quote || {};
            ctx.shell.quote[chat.id] = { text: messagePreview(message), from: message.from };
            ctx.rerender();
          }
          if (value === 'copy') {
            navigator.clipboard?.writeText(message.text).then(() => ctx.toast('已复制'), () => ctx.toast('复制失败'));
          }
          if (value === 'favorite') {
            const favorites = (ctx.state.favorites = ctx.state.favorites || []);
            favorites.unshift({
              id: 'f' + Date.now().toString(36),
              chatId: chat.id,
              contactName: contact?.name || 'TA',
              from: message.from,
              text: messagePreview(message),
              image: message.image || '',
              at: message.at || Date.now(),
            });
            ctx.save();
            ctx.toast('已收进收藏');
          }
          if (value === 'forward') {
            const targets = contactsOf(ctx.state).filter(item => item.id !== chat.contactId);
            ctx.openSheet({
              title: '转发给谁',
              items: targets.slice(0, 10).map(item => ({ label: item.name, value: item.id, icon: 'contacts' })),
              onPick: (targetId) => {
                const target = contactsOf(ctx.state).find(item => item.id === targetId);
                if (!target) return;
                const targetChat = chatFor(ctx.state, target.id);
                pushMessage(ctx.state, targetChat.id, {
                  from: 'me',
                  kind: 'forwarded',
                  text: '',
                  forward: { text: messagePreview(message), from: contact?.name || 'TA' },
                });
                ctx.save();
                ctx.toast(`已转发给「${target.name}」`);
              },
            });
          }
          if (value === 'recall') {
            message.kind = 'recalled';
            message.text = '';
            message.image = '';
            message.emoji = '';
            message.forward = null;
            ctx.save();
            ctx.rerender();
            ctx.toast('已撤回');
          }
          if (value === 'extra') {
            saveMessageExtra(ctx, chat, contact, message);
            ctx.toast('已存进小剧场');
          }
          if (value === 'regen') {
            reply(ctx, chat, contact, message.id);
          }
          if (value === 'delete') {
            ctx.openSheet({
              title: '删除这一条消息？',
              items: [{ label: '确认删除这条', value: 'delete', icon: 'trash', danger: true, note: '只删这一条，不影响其他聊天记录；不能恢复。' }],
              onPick: (pick) => {
                if (pick !== 'delete') return;
                chat.messages = chat.messages.filter(item => item.id !== message.id);
                ctx.save();
                ctx.rerender();
                ctx.toast('已删除');
              },
            });
          }
        },
      });
      return true;
    }

    if (act === 'view-photo') {
      const chat = chatById(ctx.state, data.chat);
      const message = chat?.messages.find(item => item.id === data.msg);
      if (message?.image) ctx.go('photo-view', { src: message.image });
      return true;
    }

    return false;
  },
};
