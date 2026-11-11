/**
 * meme-phone · 查 TA 的手机
 *
 * 打开某个联系人自己的那台手机：聊天、通讯录、朋友圈。
 * 默认按角色卡在本地拼一份（立刻能看）；接上酒馆模型后可以「现编」一份更像 TA 的。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml, shortText } from '../shell.js';
import { contactById } from '../data.js';
const ROLE_LINES = {
  family: ['吃饭了没', '别老熬夜', '周末回不回来', '钱够不够用', '你爸又念叨你了'],
  work: ['图纸改完了吗', '明早八点的会', '老板刚在群里点名了', '这版还得再改一次', '下班了吗'],
  friend: ['出来喝一杯', '在老地方等你', '刚看到个特别好笑的东西', '你上次说的那家店我去了', '睡不着'],
  group: ['今晚谁还在', '楼下集合', '我先撤了', '别@全体了', '这周六定不定'],
};

const SELF_LINES = ['好，我知道了', '等我一下', '马上', '今天有点累', '晚点说', '在忙，回头聊'];

const PHOTO_LINES = ['在楼下便利店坐了一会儿，风比昨天凉。', '今天的云很低，像要压到楼顶。', '收工，路口的灯刚好亮了。'];
const COMMENTS = [['阿泽', '这张拍得不错'], ['小满', '又在加班？'], ['妈妈', '早点睡']];

function hash(text) {
  let value = 0;
  const source = String(text || '');
  for (let i = 0; i < source.length; i += 1) value = (value * 31 + source.charCodeAt(i)) % 99991;
  return value;
}

function pick(list, seed, offset = 0) {
  return list[(seed + offset) % list.length];
}

function clockLabel(minutesAgo) {
  const date = new Date(Date.now() - minutesAgo * 60000);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** 本地生成一份：够看，不联网。 */
export function buildLocal(contact, card) {
  const seed = hash(contact.name);

  const ownLine = (card?.firstMes || '').split('\n')[0].trim();
  const place = (card?.scenario || '').split(/[。；]/)[0].trim();

  const peers = [
    { id: 'p1', name: '妈妈', tag: '家人', kind: 'family' },
    { id: 'p2', name: contact.kind === 'group' ? '群里的老周' : '老同学 阿泽', tag: '朋友', kind: 'friend' },
    { id: 'p3', name: contact.kind === 'group' ? '同事 小满' : '同事 小满', tag: '同事', kind: 'work' },
    { id: 'p4', name: '三号工地群', tag: '群聊', kind: 'group', group: true },
  ];

  const chats = peers.map((peer, index) => {
    const pool = ROLE_LINES[peer.kind] || ROLE_LINES.friend;
    const base = index * 26;
    const msgs = [];
    const push = (me, text, ago) => { if (text) msgs.push({ me, text, at: clockLabel(ago) }); };
    push(false, pick(pool, seed, index), base + 180);
    push(true, pick(SELF_LINES, seed, index + 2), base + 150);
    push(false, pick(pool, seed, index + 3), base + 40);
    if (index === 2) push(false, ownLine, base + 12);
    if (index === 1) push(false, place, base + 12);
    push(true, pick(SELF_LINES, seed, index + 4), base + 6);
    push(false, pick(pool, seed, index + 5), base + 2);
    return {
      id: peer.id,
      peer: peer.name,
      tag: peer.tag,
      group: Boolean(peer.group),
      unread: index === 3 ? 2 : 0,
      msgs,
    };
  });

  const roster = [
    { name: '妈妈', note: '每周三打电话' },
    { name: '老同学 阿泽', note: '上次见面是夏天' },
    { name: '同事 小满', note: '同层工位' },
    { name: '三号工地群', note: '9 人' },
    { name: '外卖 王师傅', note: '送到就走' },
    { name: '楼下便利店', note: '常去' },
  ];

  const moments = [
    {
      text: photoText(seed, 0),
      at: clockLabel(240),
      likes: 6 + (seed % 9),
      comments: COMMENT_SET(seed, 0),
    },
    {
      text: photoText(seed, 1),
      at: clockLabel(1500),
      likes: 11 + (seed % 7),
      comments: COMMENT_SET(seed, 1),
    },
    {
      text: ownLine || '今天没什么想说的。',
      at: clockLabel(4300),
      likes: 3 + (seed % 5),
      comments: COMMENT_SET(seed, 2),
    },
  ];

  return { at: Date.now(), chats, contacts: roster, moments };
}

function photoText(seed, offset) {
  return pick(PHOTO_LINES, seed, offset);
}

function COMMENT_SET(seed, offset) {
  return [0, 1].map(step => {
    const [who, text] = COMMENTS[(seed + offset + step) % COMMENTS.length];
    return { who, text };
  });
}

export function ensureLookup(state, contact) {
  if (!state.lookups) state.lookups = {};
  if (state.lookups[contact.id]) return state.lookups[contact.id];
  const card = (state.characters || []).find(item => item.name === contact.name) || null;
  state.lookups[contact.id] = buildLocal(contact, card);
  return state.lookups[contact.id];
}

function tabsHtml(active) {
  const tabs = [
    ['chat', '聊天', 'chat'],
    ['roster', '通讯录', 'contacts'],
    ['moments', '朋友圈', 'spark'],
  ];
  return `<div class="mp-cp-tabs">${tabs.map(([key, label, ico]) => `
    <button class="mp-cp-tab${active === key ? ' is-on' : ''}" data-act="cp-tab" data-tab="${key}" type="button">
      ${icon(ico)}<span>${label}</span>
    </button>`).join('')}</div>`;
}

export const charPhoneApp = {
  id: 'p-charphone',

  render(ctx, params) {
    const contact = contactById(ctx.state, params?.contactId);
    if (!contact) return '<div class="mp-page-body"><div class="mp-empty">这个人不在了。</div></div>';

    const data = ensureLookup(ctx.state, contact);
    const tab = ctx.shell.cpTab || 'chat';
    const generating = ctx.shell.cpBusy;

    const head = `
      <div class="mp-cp-head">
        ${avatarHtml(contact.name, contact.avatar, 'mp-avatar')}
        <div class="mp-cp-head-main">
          <div class="mp-cp-head-name">${esc(contact.name)} 的手机</div>
          <div class="mp-cp-head-sub">只能看，动了会被发现</div>
        </div>
        <button class="mp-icon-btn" data-act="cp-gen" data-contact="${contact.id}" type="button" aria-label="生成">${icon('spark')}</button>
      </div>`;

    const body = tab === 'roster'
      ? `<div class="mp-card mp-cp-roster">${data.contacts.map(item => `
          <div class="mp-user-row is-static-row">
            ${avatarHtml(item.name, '', 'mp-avatar')}
            <span class="mp-user-main">
              <span class="mp-user-name">${esc(item.name)}</span>
              <span class="mp-user-desc">${esc(item.note || '')}</span>
            </span>
          </div>`).join('')}</div>`
      : tab === 'moments'
        ? `<div class="mp-cp-feed">${data.moments.map(item => `
            <div class="mp-cp-moment">
              <div class="mp-cp-moment-text">${esc(item.text)}</div>
              <div class="mp-cp-moment-meta">${esc(item.at)} · ${item.likes} 赞</div>
              ${(item.comments || []).map(comment => `
                <div class="mp-cp-comment"><b>${esc(comment.who)}</b>${esc(comment.text)}</div>`).join('')}
            </div>`).join('')}</div>`
        : `<div class="mp-card mp-cp-chats">${data.chats.map(chat => {
            const last = chat.msgs[chat.msgs.length - 1];
            return `<button class="mp-cp-chat" data-act="cp-open-chat" data-contact="${contact.id}" data-peer="${chat.id}" type="button">
              ${avatarHtml(chat.peer, '', 'mp-avatar')}
              <span class="mp-user-main">
                <span class="mp-user-name">${esc(chat.peer)}${chat.group ? '<i class="mp-cp-count">群</i>' : ''}</span>
                <span class="mp-user-desc">${esc(last?.text || '')}</span>
              </span>
              <span class="mp-cp-side">${esc(last?.at || '')}${chat.unread ? `<i class="mp-cp-dot">${chat.unread}</i>` : ''}</span>
            </button>`;
          }).join('')}</div>`;

    return `
      <div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
        <span class="mp-cp-badge">${generating ? '正在现编…' : 'TA 的手机'}</span>
      </div>
      <div class="mp-page-body">
        ${head}
        <div class="mp-cp-shell">
          ${tabsHtml(tab)}
          ${body}
        </div>
        <div class="mp-foot-note">这些是 TA 手机里的东西，看过就往回走；点右上角可以让模型现编一份。</div>
      </div>`;
  },

  handle(ctx, act, data) {
    const contact = contactById(ctx.state, data?.contact);

    if (act === 'cp-tab') {
      ctx.shell.cpTab = data.tab;
      ctx.shell.rerender();
      return true;
    }

    if (act === 'cp-open-chat') {
      ctx.go('p-chatphone', { contactId: data.contact, peer: data.peer });
      return true;
    }

    if (act === 'cp-gen') {
      if (!contact) return true;
      if (typeof ctx.ai?.lookup !== 'function') { ctx.toast('这个环境生成不了'); return true; }
      ctx.shell.cpBusy = true;
      ctx.shell.rerender();
      const local = ensureLookup(ctx.state, contact);
      Promise.resolve()
        .then(() => ctx.ai.lookup(ctx, contact, local))
        .then(result => {
          if (result) ctx.state.lookups[contact.id] = { ...result, at: Date.now() };
          ctx.save();
          ctx.shell.cpBusy = false;
          ctx.shell.rerender();
          ctx.toast(result ? '这份是现编的' : '没生成出来，先看本地这份');
        })
        .catch(error => {
          ctx.shell.cpBusy = false;
          ctx.shell.rerender();
          ctx.toast(error.message || '生成失败');
        });
      return true;
    }

    return false;
  },
};

export const charPhoneThreadApp = {
  id: 'p-chatphone',

  render(ctx, params) {
    const contact = contactById(ctx.state, params?.contactId);
    const data = contact ? ensureLookup(ctx.state, contact) : null;
    const chat = data?.chats.find(item => item.id === params?.peer);
    if (!contact || !chat) return '<div class="mp-page-body"><div class="mp-empty">这段对话不在了。</div></div>';

    const bubbles = chat.msgs.map(msg => `
      <div class="mp-cp-bubble-row${msg.me ? ' is-me' : ''}">
        ${msg.me ? '' : avatarHtml(chat.peer, '', 'mp-avatar')}
        <div class="mp-cp-bubble">${esc(msg.text)}<span class="mp-cp-time">${esc(msg.at)}</span></div>
      </div>`).join('');

    return `
      <div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button>
        <span style="flex:1"></span>
        <span class="mp-cp-badge">${esc(contact.name)} 的手机 · ${esc(chat.peer)}</span>
      </div>
      <div class="mp-page-body">
        <div class="mp-cp-thread-head">${esc(chat.peer)}${chat.group ? ` · ${chat.tag}` : ''}</div>
        <div class="mp-cp-thread">${bubbles}</div>
        <div class="mp-foot-note">只读，回不去的话往左上角点。</div>
      </div>`;
  },

  handle() {
    return false;
  },
};
