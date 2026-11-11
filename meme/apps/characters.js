/**
 * meme-phone · 查角色
 *
 * 把酒馆里的角色卡原样摊在手机上：描述、性格、场景、开场白、标签。
 * 只读，不动机器人本身；想聊就顺手存进通讯录。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml } from '../shell.js';
import { addContact, contactsOf } from '../data.js';

const SECTIONS = [
  ['描述', 'description'],
  ['性格', 'personality'],
  ['场景', 'scenario'],
  ['开场白', 'firstMes'],
  ['示例对话', 'example'],
  ['作者备注', 'creatorNotes'],
];

function cardsOf(state) {
  return Array.isArray(state.characters) ? state.characters : [];
}

function findCard(state, name) {
  return cardsOf(state).find(card => card.name === name) || null;
}

function match(card, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [card.name, card.description, card.personality, card.scenario, (card.tags || []).join(' ')]
    .some(text => String(text || '').toLowerCase().includes(needle));
}

function head(title, sub) {
  return `<div class="mp-title" style="margin-top:2px">${esc(title)}</div><div class="mp-subtitle">${esc(sub)}</div>`;
}

export const charactersApp = {
  id: 'app-characters',

  render(ctx) {
    const state = ctx.state;
    const cards = cardsOf(state);
    const query = ctx.shell.charQuery || '';
    const list = cards.filter(card => match(card, query));

    const rows = list.map(card => `
      <button class="mp-char-row" data-act="char-open" data-name="${esc(card.name)}" type="button">
        ${avatarHtml(card.name, card.avatarUrl, 'mp-avatar')}
        <span class="mp-user-main">
          <span class="mp-char-name">${esc(card.name)}</span>
          <span class="mp-char-sub">${esc((card.tags || []).slice(0, 3).join(' · ') || (card.description || '').slice(0, 26) || '没有标签')}</span>
        </span>
        ${icon('chevron')}
      </button>`).join('');

    return `
      <div class="mp-page-body">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <div class="mp-title" style="flex:1">查角色</div>
          <button class="mp-icon-btn" data-act="char-search" type="button" aria-label="搜索">${icon('search')}</button>
        </div>
        <div class="mp-subtitle">酒馆里的角色卡，按卡片原样看</div>

        <div class="mp-draw-state${state.charactersFromTavern ? ' is-on' : ''}">
          ${icon('contacts')}
          <span>${state.charactersFromTavern ? `已接酒馆 · ${cards.length} 张卡` : (cards.length ? '预览环境 · 下面是演示卡' : '还没拉到角色卡')}</span>
          <button class="mp-draw-state-btn" data-act="char-sync" type="button">同步</button>
        </div>

        ${query ? `<button class="mp-char-query" data-act="char-clear" type="button">搜：${esc(query)}<span>×</span></button>` : ''}

        <div class="mp-card mp-char-list">
          ${rows || `<div class="mp-empty">${query ? '没有匹配的角色。' : '还没有角色卡。接上酒馆后点「同步」。'}</div>`}
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const state = ctx.state;

    if (act === 'char-sync') {
      const reader = ctx.host?.readCards;
      if (typeof reader !== 'function') { ctx.toast('读不到角色卡'); return true; }
      reader().then(cards => {
        if (!cards.length) {
          state.charactersFromTavern = false;
          ctx.toast('没读到角色卡（预览环境下没有酒馆）');
          ctx.shell.rerender();
          return;
        }
        const previous = cardsOf(state);
        state.characters = cards.map(card => {
          const old = previous.find(item => item.name === card.name);
          return old?.description ? { ...card, description: old.description } : card;
        });
        state.charactersFromTavern = true;
        ctx.save();
        ctx.shell.rerender();
        ctx.toast(`拉到 ${cards.length} 张角色卡`);
      }).catch(error => ctx.toast(error.message || '同步失败'));
      return true;
    }

    if (act === 'char-search') {
      ctx.openSheet({
        kind: 'text', title: '找谁', value: ctx.shell.charQuery || '', confirm: '搜',
        placeholder: '名字、标签、设定里的一段话都行',
        onText: (text) => {
          ctx.shell.charQuery = String(text || '').trim();
          ctx.shell.rerender();
        },
      });
      return true;
    }

    if (act === 'char-clear') {
      ctx.shell.charQuery = '';
      ctx.shell.rerender();
      return true;
    }

    if (act === 'char-open') {
      const name = String(data?.name || '');
      if (name) ctx.go('character-card', { name });
      return true;
    }

    return false;
  },
};

export const characterApp = {
  id: 'character-card',

  render(ctx, params) {
    const state = ctx.state;
    const card = findCard(state, params?.name || '');
    if (!card) return '<div class="mp-page-body"><div class="mp-empty">这张卡不在了。</div></div>';

    const inContacts = contactsOf(state).some(contact => contact.name === card.name);

    const body = SECTIONS
      .filter(([, key]) => String(card[key] || '').trim())
      .map(([label, key]) => `
        <div class="mp-char-block">
          <div class="mp-char-label">${label}</div>
          <div class="mp-char-text">${esc(card[key]).replace(/\n/g, '<br>')}</div>
        </div>`).join('');

    const tags = (card.tags || []).map(tag => `<span class="mp-char-tag">${esc(tag)}</span>`).join('');

    return `
      <div class="mp-page-body">
        <div class="mp-user-hero">
          ${avatarHtml(card.name, card.avatarUrl, 'mp-avatar mp-user-hero-avatar')}
          <div class="mp-user-hero-name">${esc(card.name)}</div>
          <div class="mp-user-hero-sub">${esc([card.creator, card.version && `v${card.version}`].filter(Boolean).join(' · ') || '角色卡')}</div>
          ${tags ? `<div class="mp-char-tags">${tags}</div>` : ''}
        </div>

        ${body || '<div class="mp-empty">这张卡只有名字。</div>'}

        <div class="mp-user-actions">
          <button class="mp-btn${inContacts ? '' : ' accent'}" data-act="char-add" data-name="${esc(card.name)}" type="button">
            ${icon(inContacts ? 'contacts' : 'plus')}<span>${inContacts ? '已在通讯录' : '存进通讯录'}</span>
          </button>
        </div>
        <div class="mp-foot-note">只读卡片，不会改动酒馆里的角色。</div>
      </div>`;
  },

  handle(ctx, act, data) {
    const state = ctx.state;
    if (act === 'char-add') {
      const card = findCard(state, String(data?.name || ''));
      if (!card) return true;
      const exists = contactsOf(state).some(contact => contact.name === card.name);
      if (exists) { ctx.toast('通讯录里已经有了'); return true; }
      addContact(state, { name: card.name, avatar: card.avatarUrl, kind: 'char', tavernAvatar: card.avatar, signature: (card.tags || []).slice(0, 2).join(' · ') });
      ctx.save();
      ctx.toast('存进通讯录了');
      ctx.shell.rerender();
      return true;
    }
    return false;
  },
};
