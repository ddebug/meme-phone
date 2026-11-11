/**
 * meme-phone · 用户管理
 *
 * 把酒馆里的用户（persona）整份拉进来，在这里改名字和设定，再写回酒馆。
 * 小手机可以跟着酒馆的当前用户走，也可以自己钉住一个人。
 */

import { icon } from '../icons.js';
import { esc, avatarHtml } from '../shell.js';

function head(title, sub) {
  return `<div class="mp-title" style="margin-top:2px">${esc(title)}</div><div class="mp-subtitle">${esc(sub)}</div>`;
}

function usersOf(state) {
  return Array.isArray(state.users) ? state.users : [];
}

function userByKey(state, key) {
  return usersOf(state).find(item => item.key === key) || null;
}

function activeUser(state) {
  const mode = state.settings.userMode === 'pin' ? 'pin' : 'follow';
  const pinned = userByKey(state, state.settings.pinnedUser);
  if (mode === 'pin' && pinned) return pinned;
  return userByKey(state, state.settings.user.key) || null;
}

function applyUser(state, user) {
  if (!user) return;
  state.settings.user.name = user.name || '我';
  state.settings.user.key = user.key || '';
  if (user.avatarUrl) state.settings.user.avatar = user.avatarUrl;
}

/* ----------------------------------------------------- 名单 */

export const userListApp = {
  id: 'app-user',

  render(ctx) {
    const state = ctx.state;
    const users = usersOf(state);
    const mode = state.settings.userMode === 'pin' ? 'pin' : 'follow';
    const pinned = userByKey(state, state.settings.pinnedUser);
    const following = userByKey(state, state.settings.user.key);
    const fromTavern = Boolean(state.usersFromTavern);

    const rows = users.map(user => {
      const isActive = mode === 'pin' ? user.key === pinned?.key : user.key === following?.key;
      return `
        <button class="mp-user-row" data-act="user-open" data-key="${esc(user.key || '')}" type="button">
          ${avatarHtml(user.name, user.avatarUrl, 'mp-avatar')}
          <span class="mp-user-main">
            <span class="mp-user-name">${esc(user.name || '未命名')}${isActive ? '<span class="mp-user-tag">在用</span>' : ''}${user.dirty ? '<span class="mp-user-tag is-dirty">待同步</span>' : ''}</span>
            <span class="mp-user-desc">${esc(user.description || '还没有设定')}</span>
          </span>
          ${icon('chevron')}
        </button>`;
    }).join('');

    return `
      <div class="mp-page-body">
        ${head('用户', '跟酒馆同一份名单，改完写回酒馆')}

        <div class="mp-draw-state${fromTavern ? ' is-on' : ''}">
          ${icon('contacts')}
          <span>${fromTavern ? `已接酒馆 · ${users.length} 位用户` : (users.length ? `预览环境 · 下面是演示名单` : '还没拉到名单')}</span>
          <button class="mp-draw-state-btn" data-act="user-sync" type="button">同步</button>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">小手机用谁</div>
          <div class="mp-group-box">
            <button class="mp-set-row${mode === 'follow' ? ' is-on' : ''}" data-act="user-mode" data-mode="follow" type="button">
              <span class="mp-set-ico">${icon('refresh')}</span>
              <span class="mp-set-name">跟随酒馆切换<small>酒馆换用户，小手机也跟着换</small></span>
              <span class="mp-roles-radio${mode === 'follow' ? ' is-on' : ''}"></span>
            </button>
            <button class="mp-set-row${mode === 'pin' ? ' is-on' : ''}" data-act="user-mode" data-mode="pin" type="button">
              <span class="mp-set-ico">${icon('pin')}</span>
              <span class="mp-set-name">固定一位<small>${esc(pinned ? `${pinned.name} · 酒馆换人也不跟着动` : '挑一个人钉在这里')}</small></span>
              <span class="mp-roles-radio${mode === 'pin' ? ' is-on' : ''}"></span>
            </button>
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">名单</div>
          <div class="mp-card mp-user-list">
            ${rows || '<div class="mp-empty">还没有用户。接上酒馆后点「同步」，或者在酒馆里先建一个。</div>'}
          </div>
        </div>

        <div class="mp-foot-note">名字和设定都存在酒馆里，这里只是换个地方改。</div>
      </div>`;
  },

  handle(ctx, act, data) {
    const state = ctx.state;

    if (act === 'user-sync') {
      const sync = ctx.host?.syncUsers;
      if (typeof sync !== 'function') { ctx.toast('拉不到名单'); return true; }
      sync().then(result => {
        ctx.save();
        ctx.rerender();
        ctx.toast(result?.available ? `拉到 ${result.list.length} 位用户` : '没接上酒馆，先用演示名单看界面');
      }).catch(error => ctx.toast(error.message || '同步失败'));
      return true;
    }

    if (act === 'user-mode') {
      const wanted = data?.mode === 'pin' ? 'pin' : 'follow';
      if (wanted === 'pin' && !usersOf(state).length) { ctx.toast('名单是空的，先同步'); return true; }
      if (wanted === 'pin') {
        const list = usersOf(state);
        if (list.length === 1) {
          state.settings.userMode = 'pin';
          state.settings.pinnedUser = list[0].key;
          applyUser(state, list[0]);
          ctx.save();
          ctx.toast(`固定成 ${list[0].name}`);
          ctx.rerender();
          return true;
        }
        ctx.openSheet({
          title: '固定哪一位',
          items: list.map(user => ({ label: user.name, value: user.key })),
          onPick: (key) => {
            const user = userByKey(state, key);
            state.settings.userMode = 'pin';
            state.settings.pinnedUser = key;
            applyUser(state, user);
            ctx.save();
            ctx.toast(`固定成 ${user?.name || '这位'}`);
            ctx.rerender();
          },
        });
        return true;
      }
      state.settings.userMode = 'follow';
      applyUser(state, userByKey(state, state.settings.user.key));
      ctx.save();
      ctx.toast('跟着酒馆走');
      ctx.rerender();
      return true;
    }

    if (act === 'user-open') {
      const key = String(data?.key || '');
      if (key) ctx.go('user-item', { key });
      else ctx.toast('这条没有对应的酒馆用户');
      return true;
    }

    if (act === 'user-use') {
      const key = String(data?.key || '');
      const user = userByKey(state, key);
      if (!user) return true;
      state.settings.userMode = 'pin';
      state.settings.pinnedUser = key;
      applyUser(state, user);
      ctx.save();
      ctx.toast(`小手机现在用 ${user.name}`);
      ctx.rerender();
      return true;
    }

    return false;
  },
};

/* ----------------------------------------------------- 单个人 */

export const userEditApp = {
  id: 'user-item',

  render(ctx, params) {
    const state = ctx.state;
    const user = userByKey(state, params?.key || '');
    if (!user) return '<div class="mp-page-body"><div class="mp-empty">这个人不在了。</div></div>';

    const isCurrent = state.settings.userMode === 'pin'
      ? state.settings.pinnedUser === user.key
      : state.settings.user.key === user.key;

    return `
      <div class="mp-page-body">
        <div class="mp-user-hero">
          ${avatarHtml(user.name, user.avatarUrl, 'mp-avatar mp-user-hero-avatar')}
          <div class="mp-user-hero-name">${esc(user.name || '未命名')}</div>
          <div class="mp-user-hero-sub">${isCurrent ? '小手机正在用这个人' : '酒馆里的用户'}</div>
        </div>

        <div class="mp-group">
          <div class="mp-group-box">
            <button class="mp-set-row" data-act="user-name" data-key="${esc(user.key)}" type="button">
              <span class="mp-set-ico">${icon('contacts')}</span>
              <span class="mp-set-name">名字</span>
              <span class="mp-set-value">${esc(user.name || '未填')}</span>
              ${icon('chevron')}
            </button>
            <button class="mp-set-row" data-act="user-desc" data-key="${esc(user.key)}" type="button">
              <span class="mp-set-ico">${icon('diary')}</span>
              <span class="mp-set-name">设定<small>${esc((user.description || '').slice(0, 26) || '还没有设定')}</small></span>
              ${icon('chevron')}
            </button>
            <div class="mp-set-row is-static">
              <span class="mp-set-ico">${icon('image')}</span>
              <span class="mp-set-name">头像<small>${user.avatarUrl ? '跟酒馆用同一张' : '酒馆里这一位还没设头像'}</small></span>
            </div>
          </div>
        </div>

        <div class="mp-user-actions">
          <button class="mp-btn" data-act="user-use" data-key="${esc(user.key)}" type="button">${icon('pin')}<span>${isCurrent ? '正在用这位' : '小手机用这位'}</span></button>
          <button class="mp-btn accent" data-act="user-save" data-key="${esc(user.key)}" type="button">${icon('refresh')}<span>写回酒馆</span></button>
        </div>

        <div class="mp-foot-note">${user.dirty ? '改过了，还没写回酒馆。' : '改动会同时修改酒馆里的这一位用户。'}</div>
      </div>`;
  },

  handle(ctx, act, data) {
    const state = ctx.state;
    const key = String(data?.key || '');
    const user = userByKey(state, key);

    if (act === 'user-name') {
      if (!user) return true;
      ctx.openSheet({
        kind: 'text', title: '叫什么', value: user.name, confirm: '改好',
        onText: (text) => {
          user.name = String(text || '').trim() || user.name;
          user.dirty = true;
          if (state.settings.user.key === key) state.settings.user.name = user.name;
          ctx.save();
          ctx.toast('改好了，记得写回酒馆');
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'user-desc') {
      if (!user) return true;
      ctx.openSheet({
        kind: 'text', title: '设定', value: user.description, confirm: '改好',
        placeholder: '写这个人是谁、怎么说话、跟你的关系……',
        onText: (text) => {
          user.description = String(text || '').trim();
          user.dirty = true;
          ctx.save();
          ctx.toast('改好了，记得写回酒馆');
          ctx.rerender();
        },
      });
      return true;
    }

    if (act === 'user-save') {
      if (!user) return true;
      const writer = ctx.host?.writeUser;
      if (typeof writer !== 'function') { ctx.toast('没接上酒馆，改不了酒馆那一边'); return true; }
      writer({ key, name: user.name, description: user.description }).then(() => {
        user.dirty = false;
        ctx.save();
        ctx.rerender();
        ctx.toast('已经写回酒馆');
      }).catch(error => ctx.toast(error.message || '写回失败'));
      return true;
    }

    if (act === 'user-use') {
      if (!user) return true;
      state.settings.userMode = 'pin';
      state.settings.pinnedUser = key;
      applyUser(state, user);
      ctx.save();
      ctx.toast(`小手机现在用 ${user.name}`);
      ctx.rerender();
      return true;
    }

    return false;
  },
};
