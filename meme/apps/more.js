/**
 * meme-phone · 其余 App
 * 小剧场 / 表情 / 计划 / 装扮 / 帮助
 */

import { icon, ICON_NAMES, ICON_LABELS, APP_ICON_TARGETS } from '../icons.js';
import { esc, tintStyle, chatAvatarHtml } from '../shell.js';
import { contactsOf, contactById, extrasOf, THEATER_KINDS, normalizeTheaterKind, theaterKindById, theaterKindFor, chatFor } from '../data.js';
import { appointmentById, completeAppointment, respondAppointment } from '../behavior-domains.js';
import { PIXEL_BUNNY } from '../theme-data.js';

/* --------------------------------------------------------- 小剧场 */

let extrasFilter = 'all';
let nsfwUnlockedId = '';

function extraKindOf(item) {
  return theaterKindById(item?.kind);
}

function extraSummary(item) {
  const kind = extraKindOf(item);
  if (kind.gate) return '18+ · 进入后确认';
  return String((item.lines || []).join(' ')).slice(0, 120);
}

export const extrasApp = {
  id: 'extras', name: '小剧场', icon: 'theater',

  render(ctx, params) {
    const filter = params.contactId;
    const groups = contactsOf(ctx.state)
      .filter(contact => !filter || contact.id === filter)
      .map(contact => ({
        contact,
        list: (ctx.state.extras[contact.id] || []).filter(item => extrasFilter === 'all' || extraKindOf(item).id === extrasFilter),
      }))
      .filter(group => group.list.length);

    const filters = [{ id: 'all', label: '全部', badge: '' }, ...THEATER_KINDS.map(kind => ({
      id: kind.id,
      label: kind.label,
      badge: kind.badge && kind.badge.toLowerCase() !== kind.label.toLowerCase() ? kind.badge : '',
    }))];
    const filterBar = `
      <div class="mp-extra-filters" role="tablist" aria-label="小剧场类型">
        ${filters.map(kind => `
          <button class="mp-extra-filter${extrasFilter === kind.id ? ' on' : ''}" data-act="extra-filter" data-kind="${kind.id}" type="button">
            ${kind.badge ? `<span class="mp-extra-filter-badge">${esc(kind.badge)}</span>` : ''}${esc(kind.label)}
          </button>`).join('')}
      </div>`;

    const cards = groups.map(group => `
      <div class="mp-group-label" style="margin-top:12px">${esc(group.contact.name)} · ${group.list.length} 段</div>
      ${group.list.map(item => {
        const kind = extraKindOf(item);
        return `
        <button class="mp-extra-card is-${kind.id}" data-act="open-extra" data-contact="${group.contact.id}" data-extra="${item.id}" type="button">
          <span class="mp-extra-card-bar"></span>
          <div class="mp-extra-card-main">
            <div class="mp-extra-card-meta">
              <span class="mp-extra-badge">${esc(kind.badge)}</span>
              <span class="mp-pill">${esc(item.date || '')}</span>
            </div>
            <div class="mp-extra-card-title">${esc(item.title)}</div>
            <div class="mp-extra-card-text">${esc(extraSummary(item))}</div>
          </div>
          <span class="mp-extra-card-chevron">${icon('chevron')}</span>
        </button>`;
      }).join('')}`).join('');

    return `<div class="mp-page-body">${filterBar}${cards || '<div class="mp-empty">这个类型还没有片段。<br>在加号菜单的「小剧场」里打开开关，聊完就会自动收到一段。</div>'}</div>`;
  },

  handle(ctx, act, data) {
    if (act === 'extra-filter') {
      extrasFilter = THEATER_KINDS.some(kind => kind.id === data.kind) ? data.kind : 'all';
      ctx.rerender();
      return true;
    }
    if (act === 'open-extra') {
      const contact = contactById(ctx.state, data.contact);
      const item = (ctx.state.extras[data.contact] || []).find(entry => entry.id === data.extra);
      if (!contact || !item) return true;
      const kind = extraKindOf(item);
      ctx.openSheet({
        title: `${contact.name} · ${item.date || ''}`,
        items: [
          { label: `读这一段 · ${kind.label}`, value: 'read', icon: kind.icon },
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

export const extrasSwitchApp = {
  id: 'extras-switch', name: '小剧场开关', icon: 'theater',

  render(ctx) {
    const contacts = contactsOf(ctx.state);
    const on = new Set(ctx.state.extrasOn || []);
    const allOn = contacts.length > 0 && contacts.every(contact => on.has(contact.id));
    const current = theaterKindById(theaterKindFor(ctx.state));

    const kindPicker = `
      <div class="mp-extra-kind-panel">
        <div class="mp-extra-kind-head">
          <div class="mp-extra-kind-title">这轮写哪种</div>
          <div class="mp-extra-kind-sub">开关只决定带不带；类型决定写哪一种小剧场</div>
        </div>
        <div class="mp-extra-kinds">
          ${THEATER_KINDS.map(kind => `
            <button class="mp-extra-kind${current.id === kind.id ? ' on' : ''} is-${kind.id}" data-act="extra-kind" data-kind="${kind.id}" type="button">
              ${kind.badge && kind.badge.toLowerCase() !== kind.label.toLowerCase() ? `<span class="mp-extra-kind-badge">${esc(kind.badge)}</span>` : ''}
              <span class="mp-extra-kind-label">${esc(kind.label)}</span>
            </button>`).join('')}
        </div>
      </div>`;

    const rows = contacts.map(contact => {
      const count = (ctx.state.extras[contact.id] || []).length;
      const enabled = on.has(contact.id);
      return `
        <button class="mp-row" data-act="extra-toggle" data-contact="${contact.id}" type="button" style="width:100%">
          ${chatAvatarHtml(contact)}
          <div class="mp-row-main">
            <div class="mp-row-name">${esc(contact.name)}</div>
            <div class="mp-row-sub">${count ? `${count} 段 · ` : ''}${enabled ? `这轮会带${esc(current.label)}小剧场` : '只聊天'}</div>
          </div>
          <span class="mp-switch${enabled ? ' on' : ''}"></span>
        </button>`;
    }).join('');

    return `
      <div class="mp-page-body">
        ${kindPicker}
        <button class="mp-row" data-act="extras-toggle-all" type="button" style="width:100%;margin-top:10px">
          <span class="mp-set-ico">${icon('theater')}</span>
          <div class="mp-row-main">
            <div class="mp-row-name">全部打开</div>
          </div>
          <span class="mp-switch${allOn ? ' on' : ''}"></span>
        </button>
        <div class="mp-group-box" style="margin-top:10px">${rows || '<div class="mp-empty">通讯录里还没有角色。</div>'}</div>
        <button class="mp-dress-link" data-act="open-extras" type="button" style="margin-top:14px">${icon('theater')}打开小剧场 App</button>
      </div>`;
  },

  handle(ctx, act, data) {
    const on = (ctx.state.extrasOn = Array.isArray(ctx.state.extrasOn) ? ctx.state.extrasOn : []);
    const contacts = contactsOf(ctx.state);

    if (act === 'extra-kind') {
      const kind = theaterKindById(data.kind);
      ctx.state.settings.theater = { ...(ctx.state.settings.theater || {}), kind: kind.id };
      ctx.save();
      ctx.rerender();
      ctx.toast(`这轮写${kind.label}小剧场`);
      return true;
    }

    if (act === 'extra-toggle') {
      const contact = contactById(ctx.state, data.contact);
      if (!contact) return true;
      const index = on.indexOf(contact.id);
      if (index >= 0) {
        on.splice(index, 1);
        ctx.toast(`「${contact.name}」只聊天，不带小剧场`);
      } else {
        on.push(contact.id);
        ctx.toast(`「${contact.name}」这轮会带小剧场`);
      }
      ctx.save();
      ctx.rerender();
      return true;
    }

    if (act === 'extras-toggle-all') {
      const allOn = contacts.length > 0 && contacts.every(contact => on.includes(contact.id));
      ctx.state.extrasOn = allOn ? [] : contacts.map(contact => contact.id);
      ctx.save();
      ctx.rerender();
      ctx.toast(allOn ? '所有角色都只聊天' : '所有角色这轮都会带小剧场');
      return true;
    }

    if (act === 'open-extras') {
      ctx.go('app-extras');
      return true;
    }

    return false;
  },
};

function extraSectionsFor(item) {
  if (Array.isArray(item?.sections) && item.sections.length) {
    return item.sections
      .map(section => ({
        title: String(section?.title || '').trim(),
        content: String(section?.content || '').trim(),
      }))
      .filter(section => section.title && section.content);
  }
  return (item?.lines || [])
    .map(line => String(line || '').trim())
    .filter(Boolean)
    .map(line => {
      const at = line.indexOf('：');
      return at > 0
        ? { title: line.slice(0, at).trim(), content: line.slice(at + 1).trim() }
        : { title: '片段', content: line };
    });
}

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
    const kind = extraKindOf(item);
    const sourceChat = item.chatId ? ctx.state.chats[item.chatId] : null;
    const source = sourceChat?.messages?.find(message => message.id === item.messageId);
    const nav = `<div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}</button><span style="flex:1"></span></div>`;

    if (kind.gate && nsfwUnlockedId !== item.id) {
      return `${nav}
        <div class="mp-page-body">
          <div class="mp-extra-detail is-${kind.page} is-gated" data-kind="${kind.id}">
            <div class="mp-extra-gate">
              <div class="mp-extra-gate-badge">${esc(kind.badge)}</div>
              <div class="mp-extra-gate-title">${esc(item.title)}</div>
              <div class="mp-extra-gate-meta">${esc(contact?.name || '')} · ${esc(item.date || '')}</div>
              <p class="mp-extra-gate-note">这段是成年角色之间克制的私密片段。确认后才会显示正文，内容只保留情绪、气氛和留白。</p>
              <button class="mp-btn accent mp-extra-gate-btn" data-act="extra-unlock" data-extra="${item.id}" type="button">我已成年，查看</button>
            </div>
          </div>
        </div>`;
    }

    const sections = extraSectionsFor(item);
    const coverRule = kind.id === 'daily'
      ? '<span class="mp-extra-paper-rule"></span>'
      : kind.id === 'meta'
        ? '<div class="mp-extra-console-bar"><span></span><span></span><span></span><b>META / NOTE</b></div>'
        : kind.id === 'dream'
          ? '<div class="mp-extra-dream-orb" aria-hidden="true"></div>'
          : '<div class="mp-extra-velvet-rule" aria-hidden="true"></div>';

    return `${nav}
      <div class="mp-page-body">
        <div class="mp-extra-detail is-${kind.page}" data-kind="${kind.id}">
          ${coverRule}
          <div class="mp-extra-cover">
            <div class="mp-extra-cover-top">
              <span class="mp-extra-badge">${esc(kind.badge)}</span>
              <span class="mp-extra-cover-date">${esc(item.date || '')}</span>
            </div>
            <div class="mp-extra-title">${esc(item.title)}</div>
            <div class="mp-extra-byline">${esc(contact?.name || '')} · ${esc(kind.sub)}</div>
          </div>
          ${source && !kind.gate ? `<div class="mp-extra-source">${icon('reply')}<span>${esc(source.text)}</span></div>` : ''}
          <div class="mp-extra-sections">
            ${sections.map((section, index) => `
              <section class="mp-extra-section">
                <div class="mp-extra-section-head">
                  <span class="mp-extra-section-index">${String(index + 1).padStart(2, '0')}</span>
                  <span class="mp-extra-section-title">${esc(section.title)}</span>
                </div>
                <div class="mp-extra-section-body">${esc(section.content)}</div>
              </section>`).join('')}
          </div>
          <div class="mp-extra-foot">${esc(kind.label)} 小剧场 · 只保存在本地</div>
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'extra-unlock') {
      nsfwUnlockedId = String(data.extra || '');
      ctx.rerender();
      return true;
    }
    return false;
  },
};

/* ------------------------------------------------------------ 表情 */

let emojiAdding = false;

export const emojiApp = {
  id: 'emoji', name: '表情', icon: 'smile',

  render(ctx) {
    const list = ctx.state.emoji;
    return `
      <div class="mp-page-body">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:9px">
          ${list.map(item => `
            <button class="mp-card" data-act="emoji-pick" data-id="${item.id}" type="button" style="margin:0;padding:12px 4px;text-align:center;border:0;font:inherit;cursor:pointer">
              <div style="font-size: calc(25px * var(--font-scale));line-height:1.2">${esc(item.char)}</div>
              <div style="font-size: calc(11px * var(--font-scale));color:var(--text-3);margin-top:5px">${esc(item.name)}</div>
            </button>`).join('')}
        </div>
        ${emojiAdding ? `
        <div class="mp-api-name-edit mp-emoji-form">
          <input class="mp-api-input" data-emoji-char type="text" maxlength="8" placeholder="表情字符">
          <input class="mp-api-input" data-emoji-name type="text" maxlength="8" placeholder="名字">
          <button class="mp-draw-side is-primary" data-act="emoji-add-save" type="button">保存</button>
          <button class="mp-draw-side" data-act="emoji-add-cancel" type="button">取消</button>
        </div>` : `<button class="mp-btn" data-act="emoji-add" type="button" style="margin-top:14px;width:100%">${icon('plus')}加一个</button>`}
      </div>`;
  },

  handle(ctx, act, data, event) {
    if (act === 'emoji-pick') {
      const item = ctx.state.emoji.find(entry => entry.id === data.id);
      if (!item) return true;
      navigator.clipboard?.writeText(item.char).then(() => ctx.toast(`复制了「${item.name}」`), () => ctx.toast(item.char));
      return true;
    }
    if (act === 'emoji-add') {
      emojiAdding = true;
      ctx.rerender();
      return true;
    }
    if (act === 'emoji-add-cancel') {
      emojiAdding = false;
      ctx.rerender();
      return true;
    }
    if (act === 'emoji-add-save') {
      const form = event?.target?.closest('.mp-emoji-form');
      const char = String(form?.querySelector('[data-emoji-char]')?.value || '').trim();
      const name = String(form?.querySelector('[data-emoji-name]')?.value || '').trim();
      if (!char) { ctx.toast('先写一个表情字符'); return true; }
      if (!Array.isArray(ctx.state.emoji)) ctx.state.emoji = [];
      ctx.state.emoji.push({
        id: 'e' + Date.now().toString(36),
        char: Array.from(char).slice(0, 2).join(''),
        name: name || '自定义',
      });
      emojiAdding = false;
      ctx.save();
      ctx.rerender();
      ctx.toast('表情加进列表了');
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
    const appointments = Object.values(ctx.state.appointments?.byContact || {})
      .flat()
      .filter(item => item && item.status !== 'cancelled')
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20)
      .map(item => ({ ...item, contact: contactById(ctx.state, item.contactId) }));
    const statusText = { pending: '等回应', accepted: '已接受', rejected: '已拒绝', completed: '已完成' };
    return `
      <div class="mp-page-body">
        <div class="mp-group">
          <div class="mp-group-label">和角色的约定 · ${appointments.length}</div>
          <div class="mp-group-box">
            ${appointments.length ? appointments.map(item => `
              <div class="mp-row" style="cursor:default">
                <div class="mp-row-main">
                  <div class="mp-row-name">${esc(item.title)}</div>
                  <div class="mp-row-sub">${esc(item.contact?.name || 'TA')} · ${esc(statusText[item.status] || item.status)}${item.story?.text ? ` · ${esc(item.story.text.slice(0, 18))}` : ''}</div>
                </div>
                <div class="mp-row-side">
                  ${item.status === 'pending' ? `<button class="mp-mini-btn" data-act="appointment-respond" data-contact="${item.contactId}" data-plan="${item.id}" data-accept="1" type="button">接受</button>` : ''}
                  ${item.status === 'accepted' ? `<button class="mp-mini-btn plain" data-act="appointment-complete" data-contact="${item.contactId}" data-plan="${item.id}" type="button">完成</button>` : ''}
                </div>
              </div>`).join('') : '<div class="mp-empty" style="padding:18px">还没有和角色约定过什么。</div>'}
          </div>
        </div>
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
    if (act === 'appointment-respond') {
      const result = respondAppointment(ctx.state, { contactId: data.contact, planId: data.plan, accept: data.accept === '1' });
      if (!result.ok) { ctx.toast(result.reason || '处理失败'); return true; }
      ctx.save();
      ctx.rerender();
      ctx.toast(result.plan.status === 'accepted' ? '约定已接受' : '已经拒绝');
      return true;
    }
    if (act === 'appointment-complete') {
      const plan = appointmentById(ctx.state, data.contact, data.plan);
      if (!plan) { ctx.toast('找不到这个约定'); return true; }
      const result = completeAppointment(ctx.state, {
        contactId: data.contact,
        planId: data.plan,
        story: { title: plan.title, text: `关于「${plan.title}」的那天，最后真的成行了。` },
      });
      if (!result.ok) { ctx.toast(result.reason || '处理失败'); return true; }
      ctx.save();
      ctx.rerender();
      ctx.toast('计划完成，故事也记下了');
      return true;
    }

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

const FONT_CHOICES = [
  { value: 'system', label: '系统', sample: 'Aa' },
  { value: 'rounded', label: '圆润', sample: '圆' },
  { value: 'serif', label: '宋体', sample: '宋' },
  { value: 'kai', label: '楷体', sample: '楷' },
];
const SIZE_CHOICES = [
  { value: 0.92, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.1, label: '大' },
  { value: 1.22, label: '特大' },
];
const LINE_CHOICES = [
  { value: 0.92, label: '紧凑' },
  { value: 1, label: '标准' },
  { value: 1.12, label: '宽松' },
];
const WEIGHT_CHOICES = [
  { value: 400, label: '常规' },
  { value: 500, label: '中黑' },
  { value: 600, label: '加粗' },
];

function dressOf(state) {
  if (!state.settings.dress || typeof state.settings.dress !== 'object') state.settings.dress = {};
  const dress = state.settings.dress;
  if (!dress.icons || typeof dress.icons !== 'object' || Array.isArray(dress.icons)) dress.icons = {};
  return dress;
}

function iconTarget(appId) {
  return APP_ICON_TARGETS.find(item => item.id === appId) || APP_ICON_TARGETS[0];
}

function iconShape(state, appId) {
  const custom = dressOf(state).icons[appId];
  return custom?.shape || iconTarget(appId).icon;
}

function iconImage(state, appId) {
  const image = dressOf(state).icons[appId]?.image;
  return typeof image === 'string' && image.startsWith('data:image/') ? image : '';
}

function choiceRow(act, items, current) {
  const options = items.map(item => `
    <option value="${esc(item.value)}"${String(current) === String(item.value) ? ' selected' : ''}>${esc(item.sample ? `${item.sample} · ${item.label}` : item.label)}</option>`).join('');
  return `<div class="mp-select-wrap"><select data-act="${act}">${options}</select>${icon('chevron')}</div>`;
}

function appTileMarkup(state, target, extraClass = '') {
  const image = iconImage(state, target.id);
  const shape = iconShape(state, target.id);
  const style = image
    ? ` style="background-image:url(&quot;${esc(image)}&quot;);background-size:cover;background-position:center"`
    : '';
  return `<span class="mp-dress-tile${image ? ' has-image' : ''}${extraClass ? ` ${extraClass}` : ''}"${style}>${image ? '' : icon(shape)}</span>`;
}

export const dressApp = {
  id: 'dress', name: '装扮', icon: 'brush',

  render(ctx) {
    const settings = ctx.state.settings;
    const dress = dressOf(ctx.state);
    const theme = ['default', 'frost', 'pixel'].includes(dress.theme) ? dress.theme : 'default';
    const themes = [
      { key: 'default', title: '晨光', preview: 'background:linear-gradient(150deg,#ffe3ef,#e4f7f0)' },
      { key: 'frost', title: '白色磨砂', preview: 'background:linear-gradient(145deg,rgba(230,230,230,.92),rgba(250,250,250,.76))' },
      { key: 'pixel', title: '像素小兔', preview: `background-image:url(&quot;${PIXEL_BUNNY.banner}&quot;);background-size:cover;background-position:center` },
    ];
    return `
      <div class="mp-page-body">
        <div class="mp-dress-hero">
          <div class="mp-dress-aa">Aa</div>
          <div class="mp-dress-hero-text">
            <b>${esc(FONT_CHOICES.find(item => item.value === (dress.font || 'system'))?.label || '系统')} · ${esc(String(Math.round((Number(dress.fontSize) || 1) * 100)))}%</b>
          </div>
        </div>

        <div class="mp-group-label" style="margin-top:14px">主题</div>
        <div class="mp-theme-row">
          ${themes.map(item => `
            <button class="mp-theme-card${theme === item.key ? ' is-on' : ''}" data-act="dress-theme" data-key="${item.key}" type="button">
              <span class="mp-theme-preview" data-kind="${item.key}" style="${item.preview}"></span>
              <span class="mp-theme-name">${esc(item.title)}</span>
            </button>`).join('')}
        </div>

        <div class="mp-group-label" style="margin-top:14px">明暗</div>
        <button class="mp-dress-toggle" data-act="dress-daynight" type="button">
          <span class="mp-set-ico">${icon(settings.theme === 'night' ? 'moon' : 'sun')}</span>
          <span class="mp-set-name">夜间模式</span>
          <span class="mp-switch${settings.theme === 'night' ? ' on' : ''}"></span>
        </button>

        <div class="mp-group-label" style="margin-top:14px">字体</div>
        ${choiceRow('dress-font', FONT_CHOICES, dress.font || 'system')}
        <div class="mp-group-label" style="margin-top:12px">字号</div>
        ${choiceRow('dress-size', SIZE_CHOICES, dress.fontSize || 1)}
        <div class="mp-group-label" style="margin-top:12px">行距</div>
        ${choiceRow('dress-line', LINE_CHOICES, dress.lineHeight || 1)}
        <div class="mp-group-label" style="margin-top:12px">字重</div>
        ${choiceRow('dress-weight', WEIGHT_CHOICES, dress.fontWeight || 400)}

        <div class="mp-group-label" style="margin-top:14px">灵动岛</div>
        <button class="mp-dress-toggle" data-act="dress-island" type="button">
          <span class="mp-set-ico">${icon('spark')}</span>
          <span class="mp-set-name">显示灵动岛</span>
          <span class="mp-switch${dress.island === 'hide' ? '' : ' on'}"></span>
        </button>

        <div class="mp-group-label" style="margin-top:14px">壁纸</div>
        <div class="mp-dress-wall-row">
          <button class="mp-dress-wall" data-act="dress-open-appearance" type="button">
            <span class="mp-dress-wall-swatch" style="background:${settings.customWall ? `url("${esc(settings.customWall)}") center / cover` : 'linear-gradient(150deg,#ffe3ef,#e4f7f0 55%,#efe6ff)'}"></span>
            <span>${settings.customWall ? '自定义' : '换背景'}</span>
          </button>
        </div>
        <button class="mp-dress-link" data-act="dress-open-appearance" type="button">${icon('image')}更多壁纸与自定义图片</button>

        <div class="mp-group-label" style="margin-top:14px">App 图标</div>
        <div class="mp-dress-app-grid">
          ${APP_ICON_TARGETS.map(target => `
            <button class="mp-dress-app" data-act="dress-icon-open" data-app="${target.id}" type="button">
              ${appTileMarkup(ctx.state, target)}
              <span>${esc(target.name)}</span>
            </button>`).join('')}
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    const settings = ctx.state.settings;
    const dress = dressOf(ctx.state);

    if (act === 'dress-daynight') {
      const next = settings.theme === 'night' ? 'day' : 'night';
      settings.theme = next;
      /* 图片壁纸跟着明暗一起走，免得夜里还铺一屏亮壁纸；自定义图不跟着换 */
      if (!['none', 'custom'].includes(settings.wallpaper)) settings.wallpaper = next;
      ctx.save();
      ctx.rerender();
      ctx.toast(next === 'night' ? '夜间玻璃已打开' : '换回日间玻璃');
      return true;
    }
    if (act === 'dress-theme') {
      const key = ['default', 'frost', 'pixel'].includes(data.key) ? data.key : 'default';
      dress.theme = key;
      if (key === 'pixel') {
        settings.theme = 'day';
        if (!['none', 'custom'].includes(settings.wallpaper)) settings.wallpaper = 'day';
      }
      ctx.save();
      ctx.rerender();
      ctx.toast(key === 'default' ? '恢复默认主题'
        : key === 'frost' ? '已换上「白色磨砂」聊天主题'
          : '已换上「像素小兔」桌面主题');
      return true;
    }
    if (act === 'dress-font') {
      dress.font = ['system', 'rounded', 'serif', 'kai'].includes(data.value) ? data.value : 'system';
    } else if (act === 'dress-size') {
      dress.fontSize = Math.max(0.85, Math.min(1.3, Number(data.value) || 1));
    } else if (act === 'dress-line') {
      dress.lineHeight = Math.max(0.9, Math.min(1.3, Number(data.value) || 1));
    } else if (act === 'dress-weight') {
      dress.fontWeight = [400, 500, 600].includes(Number(data.value)) ? Number(data.value) : 400;
    } else if (act === 'dress-island') {
      dress.island = dress.island === 'hide' ? 'show' : 'hide';
    } else if (act === 'dress-open-appearance') {
      ctx.go('app-appearance');
      return true;
    } else if (act === 'dress-icon-open') {
      ctx.go('app-icon', { app: data.app });
      return true;
    } else {
      return false;
    }

    ctx.save();
    ctx.rerender();
    return true;
  },
};

/* 单个 App 的图标选择器：桌面和 Dock 上所有 App 都走这里 */
export const iconPickerApp = {
  id: 'app-icon', name: 'App 图标', icon: 'brush',

  render(ctx, params) {
    const target = iconTarget(params.app);
    ctx.shell.live.iconTarget = target.id;
    const dress = dressOf(ctx.state);
    const custom = dress.icons[target.id] || {};
    const selected = custom.shape || target.icon;
    const image = iconImage(ctx.state, target.id);
    return `
      <div class="mp-nav"><button class="mp-back" data-act="back" type="button">${icon('back')}<span>返回</span></button><span style="flex:1"></span></div>
      <div class="mp-page-body">
        <div class="mp-icon-preview">
          ${appTileMarkup(ctx.state, target, 'is-big')}
          <div><b>${esc(target.name)}</b><span>${image ? '当前是自定义图片' : '当前是内置图形'}</span></div>
        </div>

        <div class="mp-group-label" style="margin-top:14px">内置图形</div>
        <div class="mp-icon-grid">
          ${ICON_NAMES.map(name => `
            <button class="mp-icon-choice${selected === name && !image ? ' is-on' : ''}" data-act="icon-shape" data-shape="${name}" type="button" title="${esc(ICON_LABELS[name] || name)}">
              ${icon(name)}<span>${esc(ICON_LABELS[name] || name)}</span>
            </button>`).join('')}
        </div>

        <div class="mp-group-label" style="margin-top:14px">自定义图片</div>
        <div class="mp-icon-actions">
          <button class="mp-btn" data-act="icon-upload" type="button">${icon('image')}<span style="margin-left:6px">从相片选一张</span></button>
          ${image ? `<button class="mp-btn" data-act="icon-clear-image" type="button">用回内置图形</button>` : ''}
        </div>
        <button class="mp-dress-link" data-act="icon-reset" type="button">${icon('refresh')}恢复这个 App 的默认图标</button>
        <input id="mpIconFile" data-app="${target.id}" type="file" accept="image/*" style="display:none">
      </div>`;
  },

  handle(ctx, act, data) {
    const appId = ctx.shell.live.iconTarget || data.app;
    if (!appId) return false;
    const dress = dressOf(ctx.state);
    const target = iconTarget(appId);

    if (act === 'icon-shape') {
      if (!ICON_NAMES.includes(data.shape)) return true;
      dress.icons[appId] = { shape: data.shape };
      ctx.save();
      ctx.rerender();
      ctx.toast(`换成「${ICON_LABELS[data.shape] || data.shape}」`);
      return true;
    }
    if (act === 'icon-upload') {
      document.getElementById('mpIconFile')?.click();
      return true;
    }
    if (act === 'icon-clear-image') {
      if (dress.icons[appId]) delete dress.icons[appId].image;
      if (!dress.icons[appId]?.shape) delete dress.icons[appId];
      ctx.save();
      ctx.rerender();
      ctx.toast('用回内置图形');
      return true;
    }
    if (act === 'icon-reset') {
      delete dress.icons[appId];
      ctx.save();
      ctx.rerender();
      ctx.toast(`${target.name}恢复默认图标`);
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
        <div class="mp-card" style="font-size: calc(12.5px * var(--font-scale));line-height: calc(1.95 * var(--line-scale));color:var(--text-2)">
          <b style="color:var(--text)">桌面</b><br>
          左上是大字时钟和昨日日记，点它进日记。<br>
          下面两行是图标，最底下一排是每天都要用的四个：聊天、通讯录、日记、设置。
        </div>
        <div class="mp-card" style="font-size: calc(12.5px * var(--font-scale));line-height: calc(1.95 * var(--line-scale));color:var(--text-2)">
          <b style="color:var(--text)">聊天</b><br>
          长按一句话：引用、复制、把这条存进小剧场、让 TA 重说、删除。<br>
          加号里的「小剧场」：按角色开关这轮要不要带小剧场，内容只进小剧场 App。
          输入框空着点发送，不是发空消息，是让 TA 主动开口。
        </div>
        <div class="mp-card" style="font-size: calc(12.5px * var(--font-scale));line-height: calc(1.95 * var(--line-scale));color:var(--text-2)">
          <b style="color:var(--text)">日记</b><br>
          一天一格。写过的那天底下有个小圆点。<br>
          点「让手机写这一天」，它会翻当天的聊天，用第一人称写成一段。
        </div>
        <div class="mp-card" style="font-size: calc(12.5px * var(--font-scale));line-height: calc(1.95 * var(--line-scale));color:var(--text-2)">
          <b style="color:var(--text)">备份</b><br>
          设置 → 数据 → 导出备份。换设备或重装前先点一下。
        </div>
      </div>`;
  },
};
