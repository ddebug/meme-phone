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

let activeCardName = '';

function cardsOf(state) {
  return Array.isArray(state.characters) ? state.characters : [];
}

function findCard(state, name) {
  return cardsOf(state).find(card => card.name === name) || null;
}

/* 世界书扫描结果只放当前会话，不写进小手机的存档，避免酒馆那边改了还拿旧数据 */
function bookCache(ctx, card) {
  if (!ctx.shell.charBooks) ctx.shell.charBooks = {};
  return ctx.shell.charBooks[card.name] || null;
}

async function scanBooks(ctx, card, force = false) {
  const cached = bookCache(ctx, card);
  if (cached && !force && !cached.error) return cached;
  const reader = ctx.host?.readBooks;
  if (typeof reader !== 'function') {
    const demo = Array.isArray(card.demoBooks) ? card.demoBooks : [];
    ctx.shell.charBooks[card.name] = { books: demo, available: false, reason: '预览环境读不到酒馆世界书', loading: false };
    ctx.rerender();
    return ctx.shell.charBooks[card.name];
  }
  ctx.shell.charBooks[card.name] = { books: [], loading: true, error: '' };
  ctx.rerender();
  try {
    const result = await reader(card.name);
    const offline = !result?.available;
    const demo = offline && Array.isArray(card.demoBooks) ? card.demoBooks : [];
    ctx.shell.charBooks[card.name] = {
      books: result?.available && Array.isArray(result.books) ? result.books : demo,
      available: Boolean(result?.available),
      reason: demo.length ? '' : (offline ? '预览环境没有这个角色的演示世界书' : (result?.reason || '')),
      error: result?.available || demo.length || offline ? '' : (result?.reason || '读不到酒馆'),
      loading: false,
    };
  } catch (error) {
    ctx.shell.charBooks[card.name] = { books: [], error: error.message || '扫描失败', loading: false };
  }
  ctx.rerender();
  return ctx.shell.charBooks[card.name];
}

function ensureBooks(ctx, card) {
  const cache = bookCache(ctx, card);
  if (cache) return cache;
  ctx.shell.charBooks[card.name] = { books: [], loading: true };
  setTimeout(() => scanBooks(ctx, card, true), 0);
  return ctx.shell.charBooks[card.name];
}

function bookEntryRow(book, entry) {
  const keys = entry.keys?.length ? entry.keys.join('、') : '没有关键词';
  const preview = String(entry.content || '').replace(/\s+/g, ' ').slice(0, 72);
  const sub = [keys, entry.constant ? '常驻' : '', preview].filter(Boolean).join(' · ');
  return `
    <button class="mp-wi-row${entry.disabled ? ' is-off' : ''}" data-act="char-wi-toggle"
      data-book="${esc(book.name)}" data-uid="${esc(entry.uid)}" type="button" role="switch" aria-checked="${entry.disabled ? 'false' : 'true'}">
      <span class="mp-wi-main">
        <span class="mp-wi-name">${esc(entry.title)}</span>
        <span class="mp-wi-sub">${esc(sub)}</span>
      </span>
      <span class="mp-switch${entry.disabled ? '' : ' on'}"></span>
    </button>`;
}

function booksHtml(cache, cardName) {
  if (!cache || cache.loading) {
    return `<div class="mp-wi-note">正在扫描这个角色关联的世界书…</div>`;
  }
  if (cache.error) {
    return `<div class="mp-wi-note">${esc(cache.error)}<button class="mp-wi-retry" data-act="char-wi-scan" data-name="${esc(cardName)}" type="button">重试</button></div>`;
  }
  if (!cache.books.length) {
    return `<div class="mp-wi-note">${esc(cache.reason || '这个角色没有关联世界书。')}<button class="mp-wi-retry" data-act="char-wi-scan" data-name="${esc(cardName)}" type="button">重新扫描</button></div>`;
  }
  const total = cache.books.reduce((sum, book) => sum + book.entries.length, 0);
  const on = cache.books.reduce((sum, book) => sum + book.entries.filter(entry => !entry.disabled).length, 0);
  return `
    <div class="mp-wi-books">
      ${cache.available === false ? '<div class="mp-wi-note">预览里的演示世界书，真机上会读酒馆。</div>' : ''}
      ${cache.books.map(book => {
        const open = book.entries.filter(entry => !entry.disabled).length;
        return `
          <div class="mp-wi-book">
            <div class="mp-wi-book-head">
              <span class="mp-wi-book-name">${esc(book.name)}</span>
              <span class="mp-wi-book-count">${open}/${book.entries.length} 条开着</span>
            </div>
            ${book.error ? `<div class="mp-wi-note">${esc(book.error)}</div>` : ''}
            <div class="mp-card mp-wi-list">
              ${book.entries.length ? book.entries.map(entry => bookEntryRow(book, entry)).join('') : '<div class="mp-empty">这本世界书里没有条目。</div>'}
            </div>
          </div>`;
      }).join('')}
    </div>
    <div class="mp-wi-total">${cache.books.length} 本 · 共 ${total} 条，${on} 条开着。开关会直接写回酒馆世界书。</div>`;
}


function match(card, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [card.name, card.description, card.personality, card.scenario, (card.tags || []).join(' ')]
    .some(text => String(text || '').toLowerCase().includes(needle));
}

/** 查角色列表：通讯录的「查角色」页签直接复用，不再单独占一个桌面 App。 */
export function charactersPanel(ctx) {
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
    <div class="mp-draw-state${state.charactersFromTavern ? ' is-on' : ''}">
      ${icon('contacts')}
      <span>${state.charactersFromTavern ? `已接酒馆 · ${cards.length} 张卡` : (cards.length ? '预览环境 · 下面是演示卡' : '还没拉到角色卡')}</span>
      <button class="mp-draw-state-btn" data-act="char-sync" type="button">同步</button>
    </div>

    ${query ? `<button class="mp-char-query" data-act="char-clear" type="button">搜：${esc(query)}<span>×</span></button>` : ''}

    <div class="mp-card mp-char-list">
      ${rows || `<div class="mp-empty">${query ? '没有匹配的角色。' : '还没有角色卡。接上酒馆后点「同步」。'}</div>`}
    </div>`;
}

export function charactersHandle(ctx, act, data) {
    const state = ctx.state;

    if (act === 'char-sync') {
      const reader = ctx.host?.readCards;
      if (typeof reader !== 'function') { ctx.toast('读不到角色卡'); return true; }
      reader().then(cards => {
        if (!cards.length) {
          state.charactersFromTavern = false;
          ctx.toast('没读到角色卡（预览环境下没有酒馆）');
          ctx.rerender();
          return;
        }
        const previous = cardsOf(state);
        state.characters = cards.map(card => {
          const old = previous.find(item => item.name === card.name);
          return old?.description ? { ...card, description: old.description } : card;
        });
        state.charactersFromTavern = true;
        ctx.save();
        ctx.rerender();
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
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'char-clear') {
      ctx.shell.charQuery = '';
      ctx.rerender();
      return true;
    }

    if (act === 'char-open') {
      const name = String(data?.name || '');
      if (name) {
        const card = findCard(state, name);
        ctx.go('character-card', { name });
        if (card) scanBooks(ctx, card);
      }
      return true;
    }

    if (act === 'char-wi-scan') {
      const card = findCard(state, String(data?.name || activeCardName || ''));
      if (card) scanBooks(ctx, card, true);
      else ctx.toast('这张卡不在了');
      return true;
    }

    if (act === 'char-wi-toggle') {
      const card = findCard(state, activeCardName);
      const cache = card ? bookCache(ctx, card) : null;
      const book = cache?.books?.find(item => item.name === String(data?.book || ''));
      const entry = book?.entries?.find(item => String(item.uid) === String(data?.uid || ''));
      if (!card || !book || !entry) { ctx.toast('这条目已经不在了，重新扫描一下'); return true; }
      if (entry.busy) return true;
      const next = !entry.disabled;
      const toggler = ctx.host?.toggleBookEntry;
      if (typeof toggler !== 'function') {
        entry.disabled = next;
        ctx.rerender();
        ctx.toast(`演示环境：已${next ? '关闭' : '开启'}「${entry.title}」`);
        return true;
      }
      entry.busy = true;
      entry.disabled = next;
      ctx.rerender();
      toggler(book.name, entry.uid, next).then(result => {
        entry.busy = false;
        if (!result?.ok) {
          entry.disabled = !next;
          ctx.toast(result?.reason || '没写进酒馆世界书');
        } else {
          ctx.toast(`已${next ? '关闭' : '开启'}「${entry.title}」`);
        }
        ctx.rerender();
      }).catch(error => {
        entry.busy = false;
        entry.disabled = !next;
        ctx.toast(error.message || '写入失败');
        ctx.rerender();
      });
      return true;
    }

    return false;
}

export const characterApp = {
  id: 'character-card',

  render(ctx, params) {
    const state = ctx.state;
    const card = findCard(state, params?.name || '');
    if (!card) return '<div class="mp-page-body"><div class="mp-empty">这张卡不在了。</div></div>';
    activeCardName = card.name;

    const inContacts = contactsOf(state).some(contact => contact.name === card.name);

    const body = SECTIONS
      .filter(([, key]) => String(card[key] || '').trim())
      .map(([label, key]) => `
        <div class="mp-char-block">
          <div class="mp-char-label">${label}</div>
          <div class="mp-char-text">${esc(card[key]).replace(/\n/g, '<br>')}</div>
        </div>`).join('');

    const tags = (card.tags || []).map(tag => `<span class="mp-char-tag">${esc(tag)}</span>`).join('');
    const bookState = ensureBooks(ctx, card);

    return `
      <div class="mp-page-body">
        <div class="mp-user-hero">
          ${avatarHtml(card.name, card.avatarUrl, 'mp-avatar mp-user-hero-avatar')}
          <div class="mp-user-hero-name">${esc(card.name)}</div>
          <div class="mp-user-hero-sub">${esc([card.creator, card.version && `v${card.version}`].filter(Boolean).join(' · ') || '角色卡')}</div>
          ${tags ? `<div class="mp-char-tags">${tags}</div>` : ''}
        </div>

        ${body || '<div class="mp-empty">这张卡只有名字。</div>'}

        <div class="mp-wi-head">
          <span class="mp-wi-title">关联世界书</span>
          <button class="mp-wi-scan" data-act="char-wi-scan" data-name="${esc(card.name)}" type="button">${icon('refresh')}<span>重新扫描</span></button>
        </div>
        ${booksHtml(bookState, card.name)}

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
      ctx.rerender();
      return true;
    }
    return false;
  },
};
