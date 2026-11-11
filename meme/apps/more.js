/**
 * meme-phone · 其余 App
 * 小剧场 / 钱包 / 收藏 / 表情 / 会员 / 计划 / 装扮 / 帮助
 */

import { icon, TINT } from '../icons.js';
import { esc, tintStyle, shortText, avatarHtml } from '../shell.js';
import { contactsOf, contactById, extrasOf } from '../data.js';

function head(title, sub) {
  return `<div class="mp-title" style="margin-top:2px">${esc(title)}</div><div class="mp-subtitle">${esc(sub)}</div>`;
}

/* --------------------------------------------------------- 小剧场 */

export const extrasApp = {
  id: 'extras', name: '小剧场', icon: 'theater',

  render(ctx, params) {
    const filter = params.contactId;
    const groups = contactsOf(ctx.state)
      .filter(contact => !filter || contact.id === filter)
      .map(contact => ({ contact, list: ctx.state.extras[contact.id] || [] }))
      .filter(group => group.list.length);

    const cards = groups.map(group => `
      <div class="mp-group-label" style="margin-top:12px">${esc(group.contact.name)} · ${group.list.length} 段</div>
      ${group.list.map(item => `
        <button class="mp-card" data-act="open-extra" data-contact="${group.contact.id}" data-extra="${item.id}" type="button" style="display:block;width:100%;text-align:left;border:0;font:inherit;cursor:pointer">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span class="mp-pill">${esc(item.date || '')}</span>
            <span style="font-size:13.5px;font-weight:600">${esc(item.title)}</span>
          </div>
          <div style="font-family:var(--font-serif);font-size:12.5px;line-height:1.7;color:var(--text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc((item.lines || []).join(' '))}</div>
        </button>`).join('')}`).join('');

    return `<div class="mp-page-body">${head('小剧场', '聊天之外的那些片段')}${cards || '<div class="mp-empty">还没有片段。<br>在会话里长按一句话，可以存成小剧场。</div>'}</div>`;
  },

  handle(ctx, act, data) {
    if (act === 'open-extra') {
      const contact = contactById(ctx.state, data.contact);
      const item = (ctx.state.extras[data.contact] || []).find(entry => entry.id === data.extra);
      if (!contact || !item) return true;
      ctx.openSheet({
        title: `${contact.name} · ${item.date || ''}`,
        items: [
          { label: '读这一段', value: 'read', icon: 'theater' },
          { label: '删掉这一段', value: 'delete', icon: 'trash', danger: true },
        ],
        onPick: (value) => {
          if (value === 'delete') {
            ctx.state.extras[data.contact] = (ctx.state.extras[data.contact] || []).filter(entry => entry.id !== item.id);
            ctx.save();
            ctx.rerender();
            ctx.toast('删掉了');
            return;
          }
          ctx.shell.extra = { contact, item };
          ctx.go('extra-detail', { contactId: data.contact, extraId: data.extra });
        },
      });
      return true;
    }
    return false;
  },
};

export const extraDetailApp = {
  id: 'extra-detail', name: '片段', icon: 'theater',

  render(ctx, params) {
    let ownerId = params.contactId;
    let item = (ctx.state.extras[ownerId] || []).find(entry => entry.id === params.extraId);
    if (!item && params.extraId) {
      for (const [contactId, list] of Object.entries(ctx.state.extras)) {
        const hit = (list || []).find(entry => entry.id === params.extraId);
        if (hit) { item = hit; ownerId = contactId; break; }
      }
    }
    const contact = contactById(ctx.state, ownerId);
    if (!item) return `<div class="mp-page-body"><div class="mp-empty">这一段不在了。</div></div>`;
    const sourceChat = item.chatId ? ctx.state.chats[item.chatId] : null;
    const source = sourceChat?.messages?.find(message => message.id === item.messageId);
    return `
      <div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button><span style="flex:1"></span></div>
      <div class="mp-page-body">
        <div class="mp-subtitle" style="margin-bottom:6px">${esc(contact?.name || '')} · ${esc(item.date || '')}</div>
        <div class="mp-title" style="font-size:24px;margin-bottom:14px">${esc(item.title)}</div>
        ${source ? `<div class="mp-extra-source">${icon('reply')}<span>${esc(source.text)}</span></div>` : ''}
        ${(item.lines || []).map(line => `
          <div style="font-family:var(--font-serif);font-size:14px;line-height:1.9;color:var(--text);margin-bottom:10px">${esc(line)}</div>`).join('')}
      </div>`;
  },
};

/* ------------------------------------------------------------ 钱包 */

export const walletApp = {
  id: 'wallet', name: '钱包', icon: 'wallet',

  render(ctx) {
    const wallet = ctx.state.wallet;
    const ledger = wallet.ledger || [];
    return `
      <div class="mp-page-body">
        ${head('钱包', '记着花在谁身上的钱')}
        <div class="mp-wallet-card">
          <div class="mp-wallet-label">余额</div>
          <div class="mp-wallet-amount">¥ ${wallet.balance.toFixed(0)}</div>
          <div class="mp-wallet-foot">最近一笔 ${ledger[0] ? esc(ledger[0].title) : '还没有'}</div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          <button class="mp-btn accent" data-act="wallet-add" type="button" style="flex:1">${icon('plus')}记一笔</button>
          <button class="mp-btn" data-act="wallet-topup" type="button" style="flex:1">${icon('wallet')}充值</button>
        </div>
        <div class="mp-group-label">流水</div>
        ${ledger.map(item => `
          <div class="mp-row" style="cursor:default">
            <div class="mp-row-main">
              <div class="mp-row-name">${esc(item.title)}</div>
              <div class="mp-row-sub">${esc(item.date || '')}</div>
            </div>
            <div class="mp-row-side"><span style="font-size:13px;color:${item.amount > 0 ? 'var(--ok)' : 'var(--text)'}">${item.amount > 0 ? '+' : ''}${item.amount}</span></div>
          </div>`).join('') || '<div class="mp-empty">还没有流水。</div>'}
      </div>`;
  },

  handle(ctx, act) {
    if (act === 'wallet-add') {
      ctx.openSheet({
        kind: 'text', title: '记一笔：标题 金额', value: '', placeholder: '夜宵 -32', confirm: '记下',
        onText: (text) => {
          const raw = String(text || '').trim();
          if (!raw) return;
          const match = raw.match(/^(.*?)(-?\d+(?:\.\d+)?)$/);
          const title = match ? match[1].trim() : raw;
          const amount = match ? Number(match[2]) : 0;
          ctx.state.wallet.ledger.unshift({ id: 'l' + Date.now().toString(36), title, amount, date: new Date().toISOString().slice(0, 10) });
          ctx.state.wallet.balance += amount;
          ctx.save();
          ctx.rerender();
          ctx.toast('记好了');
        },
      });
      return true;
    }
    if (act === 'wallet-topup') {
      ctx.openSheet({
        title: '充值多少',
        items: [100, 500, 1000].map(value => ({ label: `¥ ${value}`, value: String(value) })),
        onPick: (value) => {
          ctx.state.wallet.balance += Number(value);
          ctx.state.wallet.ledger.unshift({ id: 'l' + Date.now().toString(36), title: '充值', amount: Number(value), date: new Date().toISOString().slice(0, 10) });
          ctx.save();
          ctx.rerender();
          ctx.toast(`充了 ¥${value}`);
        },
      });
      return true;
    }
    return false;
  },
};

/* ------------------------------------------------------------ 收藏 */

export const favoritesApp = {
  id: 'favorites', name: '收藏', icon: 'bookmark',

  render(ctx) {
    const list = ctx.state.favorites;
    return `
      <div class="mp-page-body">
        ${head('收藏', `${list.length} 句留着的话`)}
        ${list.map(item => {
    const contact = contactById(ctx.state, item.contactId);
    return `
          <div class="mp-card">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:7px">
              ${avatarHtml(contact?.name || '?', contact?.avatar, 'mp-avatar mp-avatar-sm')}
              <span style="font-size:12px;color:var(--text-2);flex:1">${esc(contact?.name || '不知道是谁')}</span>
              <span style="font-size:10.5px;color:var(--text-4)">${shortText(item.at)}</span>
            </div>
            <div style="font-family:var(--font-serif);font-size:13.5px;line-height:1.78;color:var(--text)">${esc(item.text)}</div>
            <div style="display:flex;gap:7px;margin-top:9px">
              <button class="mp-btn ghost" data-act="fav-copy" data-id="${item.id}" type="button">${icon('copy')}复制</button>
              <button class="mp-btn ghost" data-act="fav-del" data-id="${item.id}" type="button">${icon('trash')}删掉</button>
            </div>
          </div>`;
  }).join('') || '<div class="mp-empty">还没有收藏。<br>长按会话里的一句话就能收藏。</div>'}
      </div>`;
  },

  handle(ctx, act, data) {
    const item = ctx.state.favorites.find(entry => entry.id === data.id);
    if (!item) return false;
    if (act === 'fav-copy') {
      navigator.clipboard?.writeText(item.text).then(() => ctx.toast('已复制'), () => ctx.toast('复制失败'));
      return true;
    }
    if (act === 'fav-del') {
      ctx.state.favorites = ctx.state.favorites.filter(entry => entry.id !== data.id);
      ctx.save();
      ctx.rerender();
      ctx.toast('删掉了');
      return true;
    }
    return false;
  },
};

/* ------------------------------------------------------------ 表情 */

export const emojiApp = {
  id: 'emoji', name: '表情', icon: 'smile',

  render(ctx) {
    const list = ctx.state.emoji;
    return `
      <div class="mp-page-body">
        ${head('表情', '点一下就能贴到输入框')}
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px">
          ${list.map(item => `
            <button class="mp-card" data-act="emoji-pick" data-id="${item.id}" type="button" style="margin:0;padding:12px 4px;text-align:center;border:0;font:inherit;cursor:pointer">
              <div style="font-size:25px;line-height:1.2">${esc(item.char)}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:5px">${esc(item.name)}</div>
            </button>`).join('')}
        </div>
        <button class="mp-btn" data-act="emoji-add" type="button" style="margin-top:14px;width:100%">${icon('plus')}加一个</button>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'emoji-pick') {
      const item = ctx.state.emoji.find(entry => entry.id === data.id);
      if (!item) return true;
      navigator.clipboard?.writeText(item.char).then(() => ctx.toast(`复制了「${item.name}」`), () => ctx.toast(item.char));
      return true;
    }
    if (act === 'emoji-add') {
      ctx.toast('这个先留着：表情库下一步接自定义上传');
      return true;
    }
    return false;
  },
};

/* ------------------------------------------------------------ 会员 */

export const membershipApp = {
  id: 'membership', name: '会员', icon: 'crown',

  render(ctx) {
    const membership = ctx.state.membership;
    return `
      <div class="mp-page-body">
        ${head('会员', '只影响装扮与主动消息次数')}
        <div class="mp-card" style="background:linear-gradient(150deg,#fdf3ff,#fff0f6 60%,#fff6ea);padding:18px 16px">
          <div style="display:flex;align-items:center;gap:9px">
            <span style="width:34px;height:34px;border-radius:11px;display:grid;place-items:center;${tintStyle('crown')}">${icon('crown')}</span>
            <div>
              <div style="font-size:15px;font-weight:600">${membership.plan || '还没开通'}</div>
              <div style="font-size:11px;color:rgba(86,66,108,.72)">${membership.until ? `有效期到 ${esc(membership.until)}` : '开通后可以多存一些片段'}</div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="mp-btn accent" data-act="member-open" type="button" style="flex:1">开通月卡</button>
          <button class="mp-btn" data-act="member-close" type="button" style="flex:1">取消</button>
        </div>
        <div class="mp-group-label" style="margin-top:16px">包含</div>
        <div class="mp-card" style="font-size:12.5px;line-height:2;color:var(--text-2)">
          · 小剧场不限段数<br>
          · 每天主动消息上限翻倍<br>
          · 装扮里的图标与壁纸全解锁
        </div>
      </div>`;
  },

  handle(ctx, act) {
    if (act === 'member-open') {
      const until = new Date();
      until.setMonth(until.getMonth() + 1);
      ctx.state.membership = { plan: '月卡', until: until.toISOString().slice(0, 10) };
      ctx.save();
      ctx.rerender();
      ctx.toast('月卡已开通');
      return true;
    }
    if (act === 'member-close') {
      ctx.state.membership = { plan: '', until: '' };
      ctx.save();
      ctx.rerender();
      ctx.toast('已取消');
      return true;
    }
    return false;
  },
};

/* ------------------------------------------------------------ 计划 */

export const plansApp = {
  id: 'plans', name: '计划', icon: 'plan',

  render(ctx) {
    const plans = ctx.state.plans;
    return `
      <div class="mp-page-body">
        ${head('计划', '要一起做的事')}
        ${plans.map((plan, index) => `
          <div class="mp-row" style="cursor:default">
            <span style="width:26px;height:26px;border-radius:9px;display:grid;place-items:center;flex:0 0 auto;${plan.done ? tintStyle('plan') : 'background:rgba(43,41,55,.05)'}">
              <button data-act="plan-toggle" data-index="${index}" type="button" style="border:0;background:none;padding:0;cursor:pointer;color:${plan.done ? '#fff' : 'var(--text-3)'}">${icon('plan')}</button>
            </span>
            <div class="mp-row-main">
              <div class="mp-row-name" style="${plan.done ? 'text-decoration:line-through;color:var(--text-3)' : ''}">${esc(plan.title)}</div>
              <div class="mp-row-sub">${esc(plan.detail || '')}</div>
            </div>
            <div class="mp-row-side"><span>${esc(plan.date || '')}</span></div>
          </div>`).join('') || '<div class="mp-empty">还没有计划。</div>'}
        <button class="mp-btn" data-act="plan-add" type="button" style="margin-top:12px;width:100%">${icon('plus')}加一条</button>
      </div>`;
  },

  handle(ctx, act, data, event) {
    if (act === 'plan-toggle') {
      event?.stopPropagation?.();
      const plan = ctx.state.plans[Number(data.index)];
      if (!plan) return true;
      plan.done = !plan.done;
      ctx.save();
      ctx.rerender();
      return true;
    }
    if (act === 'plan-add') {
      ctx.openSheet({
        kind: 'text', title: '要做什么', value: '', placeholder: '周三晚上空出来', confirm: '加进来',
        onText: (text) => {
          const title = String(text || '').trim();
          if (!title) return;
          ctx.state.plans.push({ id: 'p' + Date.now().toString(36), title, detail: '', done: false, date: new Date().toISOString().slice(0, 10) });
          ctx.save();
          ctx.rerender();
          ctx.toast('加好了');
        },
      });
      return true;
    }
    return false;
  },
};

/* ------------------------------------------------------------ 装扮 */

export const dressApp = {
  id: 'dress', name: '装扮', icon: 'brush',

  render(ctx) {
    const current = ctx.state.settings.dress?.wallpaper || 'default';
    const options = [
      { key: 'default', title: '晨光', value: 'url("../assets/wallpaper-day.jpg")', preview: 'linear-gradient(150deg,#ffe3ef,#e4f7f0)' },
      { key: 'night', title: '夜色', value: 'url("../assets/wallpaper-night.jpg")', preview: 'linear-gradient(150deg,#1a1f2b,#0a0c11)' },
      { key: 'plain', title: '柔光', value: 'linear-gradient(160deg,#fdf1f7,#eef7fb 55%,#eafaf3)', preview: 'linear-gradient(160deg,#fdf1f7,#eafaf3)' },
    ];
    return `
      <div class="mp-page-body">
        ${head('装扮', '壁纸与图标')}
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px">
          ${options.map(option => `
            <button data-act="dress-wall" data-key="${option.key}" data-value="${option.value}" type="button"
              style="border:0;padding:0;background:none;cursor:pointer">
              <span style="display:block;height:96px;border-radius:16px;background:${option.preview};box-shadow:var(--shadow-s);border:2px solid ${current === option.key ? 'var(--accent)' : 'transparent'}"></span>
              <span style="display:block;font-size:11px;color:var(--text-3);margin-top:5px">${option.title}</span>
            </button>`).join('')}
        </div>
        <div class="mp-group-label" style="margin-top:16px">图标</div>
        <div class="mp-card" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;justify-items:center">
          ${['chat', 'contacts', 'diary', 'settings', 'theater', 'wallet', 'bookmark', 'smile'].map(key => `
            <span class="mp-glass-ico" style="width:46px;height:46px;border-radius:14px">${icon(key)}</span>`).join('')}
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'dress-wall') {
      ctx.state.settings.dress = { ...(ctx.state.settings.dress || {}), wallpaper: data.key };
      ctx.setWallpaper(data.value);
      ctx.save();
      ctx.rerender();
      ctx.toast('换好了');
      return true;
    }
    return false;
  },
};

/* ------------------------------------------------------------ 帮助 */

export const helpApp = {
  id: 'help', name: '帮助', icon: 'help',

  render() {
    return `
      <div class="mp-page-body">
        ${head('帮助', '三分钟就能上手')}
        <div class="mp-card" style="font-size:12.5px;line-height:1.95;color:var(--text-2)">
          <b style="color:var(--text)">桌面</b><br>
          左上是大字时钟和昨日日记，点它进日记。<br>
          下面两行是图标，最底下一排是每天都要用的四个：聊天、通讯录、日记、设置。
        </div>
        <div class="mp-card" style="font-size:12.5px;line-height:1.95;color:var(--text-2)">
          <b style="color:var(--text)">聊天</b><br>
          长按一句话：引用、复制、收藏、让 TA 重说、删除。<br>
          输入框空着点发送，不是发空消息，是让 TA 主动开口。
        </div>
        <div class="mp-card" style="font-size:12.5px;line-height:1.95;color:var(--text-2)">
          <b style="color:var(--text)">日记</b><br>
          一天一格。写过的那天底下有个小圆点。<br>
          点「让手机写这一天」，它会翻当天的聊天，用第一人称写成一段。
        </div>
        <div class="mp-card" style="font-size:12.5px;line-height:1.95;color:var(--text-2)">
          <b style="color:var(--text)">备份</b><br>
          设置 → 数据 → 导出备份。换设备或重装前先点一下。
        </div>
      </div>`;
  },
};
