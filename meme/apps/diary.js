/**
 * meme-phone · 日记
 * 一天一格：日历标出写过/待写，正区是当天那一页。
 * 全局日记在 Dock；聊天设置里的「TA 的日记」按角色单独存一份。
 */

import { icon } from '../icons.js';
import { chatById, chatFor, contactById, dayKey } from '../data.js';
import { esc } from '../shell.js';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function parseMonth(key) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function curMonth(ctx) {
  ctx.shell.diaryMonth = ctx.shell.diaryMonth || monthKey(new Date());
  return ctx.shell.diaryMonth;
}

function curDay(ctx) {
  return ctx.shell.diarySel || dayKey(new Date());
}

/** 全局日记和角色日记分开存，互不覆盖。 */
function entriesFor(ctx, contactId) {
  if (!contactId) return ctx.state.diary.entries;
  const diary = ctx.state.diary;
  if (!diary.contacts || typeof diary.contacts !== 'object') diary.contacts = {};
  if (!diary.contacts[contactId] || typeof diary.contacts[contactId] !== 'object') {
    diary.contacts[contactId] = {};
  }
  return diary.contacts[contactId];
}

function calendar(ctx, entries) {
  const month = curMonth(ctx);
  const first = parseMonth(month);
  const lead = first.getDay();
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = dayKey(new Date());
  const sel = curDay(ctx);

  const cells = ['<div class="mp-wd">日</div>', '<div class="mp-wd">一</div>', '<div class="mp-wd">二</div>', '<div class="mp-wd">三</div>', '<div class="mp-wd">四</div>', '<div class="mp-wd">五</div>', '<div class="mp-wd">六</div>'];
  for (let index = 0; index < lead; index += 1) cells.push('<span></span>');

  for (let day = 1; day <= days; day += 1) {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const entry = entries[key];
    const has = Boolean(entry && entry.text);
    const isToday = key === today;
    const isSel = key === sel;
    cells.push(`<button type="button" class="${isSel ? 'sel' : ''}${has ? ' has' : ''}${isToday ? ' today' : ''}" data-act="diary-day" data-day="${key}">${day}${has ? '<span class="mark"></span>' : ''}</button>`);
  }
  return `<div class="mp-cal">${cells.join('')}</div>`;
}

function hero(ctx, entries, contactId) {
  const name = contactId ? contactById(ctx.state, contactId)?.name || 'TA' : '';
  const key = curDay(ctx);
  const entry = entries[key];
  const isToday = key === dayKey(new Date());
  const label = isToday ? '今天' : `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`;
  const text = entry?.text || '';

  return `
    <div class="mp-diary-hero">
      <div class="mp-diary-hero-top">
        <span class="mp-diary-hero-date">${label}${entry?.auto ? ' · 自动生成' : ''}</span>
        <div style="display:flex;gap:6px">
          <button class="mp-btn ghost" data-act="diary-edit" data-day="${key}" data-contact="${esc(contactId)}" type="button">${icon('brush')}${text ? '改写' : '写一句'}</button>
        </div>
      </div>
      ${text
        ? `<div class="mp-diary-hero-text">${esc(text)}</div>`
        : `<div class="mp-diary-empty">这一格还空着。<br>可以手写一句，也可以让手机照着${contactId ? ` ${esc(name)} ` : '当天'}的聊天写。</div>`}
      <div style="display:flex;gap:6px;margin-top:11px;flex-wrap:wrap">
        ${(entry?.tags || []).map(tag => `<span class="mp-pill pink">${esc(tag)}</span>`).join('')}
        <button class="mp-btn" data-act="diary-gen" data-day="${key}" data-contact="${esc(contactId)}" type="button">${icon('spark')}${contactId ? `让 ${esc(name)} 写这一天` : '让手机写这一天'}</button>
      </div>
    </div>`;
}

function renderPage(ctx, params = {}) {
  const contactId = String(params.contactId || '');
  const contact = contactId ? contactById(ctx.state, contactId) : null;
  const entries = entriesFor(ctx, contactId);
  const month = curMonth(ctx);
  const target = parseMonth(month);
  const recent = Object.values(entries)
    .filter(item => item && item.text)
    .sort((a, b) => (a.key < b.key ? 1 : -1))
    .slice(0, 5);

  const list = recent.map(item => `
    <div class="mp-diary-card" data-act="diary-day" data-day="${item.key}">
      <div class="mp-diary-head">
        <span style="font-size: calc(12px * var(--font-scale));color:var(--text-3)">${Number(item.key.slice(5, 7))}月${Number(item.key.slice(8, 10))}日</span>
        ${(item.tags || []).slice(0, 2).map(tag => `<span class="mp-pill plain">${esc(tag)}</span>`).join('')}
      </div>
      <div style="font-family:var(--font-serif);font-size: calc(13px * var(--font-scale));line-height: calc(1.72 * var(--line-scale));color:var(--text-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(item.text)}</div>
    </div>`).join('');

  return `
    <div class="mp-page-body">
      <div class="mp-title">${contactId ? `${esc(contact?.name || 'TA')}的日记` : '日记'}</div>
      <div class="mp-subtitle">${contactId ? '只记录这个角色和你的聊天' : '写过的日子会有小圆点'}</div>
      <div class="mp-month-bar">
        <button class="mp-icon-btn" data-act="diary-prev" data-contact="${esc(contactId)}" type="button" aria-label="上个月">${icon('back')}</button>
        <span class="mp-month">${target.getFullYear()} 年 ${target.getMonth() + 1} 月</span>
        <button class="mp-icon-btn" data-act="diary-next" data-contact="${esc(contactId)}" type="button" aria-label="下个月" style="transform:rotate(180deg)">${icon('back')}</button>
      </div>
      ${calendar(ctx, entries)}
      ${hero(ctx, entries, contactId)}
      <div class="mp-group-label" style="margin-top:16px">最近写过的</div>
      ${list || '<div class="mp-empty">还没有写过日记。</div>'}
    </div>`;
}

function handleDiary(ctx, act, data) {
  const contactId = String(data?.contact || '');
  const entries = entriesFor(ctx, contactId);

  if (act === 'diary-prev' || act === 'diary-next') {
    const target = parseMonth(curMonth(ctx));
    target.setMonth(target.getMonth() + (act === 'diary-prev' ? -1 : 1));
    ctx.shell.diaryMonth = monthKey(target);
    ctx.shell.diarySel = dayKey(target);
    ctx.rerender();
    return true;
  }

  if (act === 'diary-day') {
    ctx.shell.diarySel = data.day;
    ctx.rerender();
    return true;
  }

  if (act === 'diary-edit') {
    const key = data.day;
    const current = entries[key]?.text || '';
    ctx.openSheet({
      kind: 'text',
      title: `写 ${Number(key.slice(5, 7))} 月 ${Number(key.slice(8, 10))} 日`,
      value: current,
      placeholder: '今天发生了什么…',
      confirm: '存下来',
      onText: (text) => {
        const entry = entries[key] || { key, tags: [], auto: false, createdAt: 0, contactId };
        entry.text = String(text || '').trim();
        entry.createdAt = Date.now();
        entry.contactId = contactId;
        entries[key] = entry;
        ctx.save();
        ctx.toast(entry.text ? '写好了' : '空白的一天');
        ctx.rerender();
      },
    });
    return true;
  }

  if (act === 'diary-gen') {
    const key = data.day;
    const contact = contactId ? contactById(ctx.state, contactId) : null;
    const chat = contactId ? chatFor(ctx.state, contactId) : null;
    ctx.toast(contactId ? '正在让 TA 写这一天…' : '正在写这一天…');
    Promise.resolve(ctx.ai.diary(ctx, contactId ? { day: key, chat, contact } : { day: key }))
      .then(text => {
        if (!text) { ctx.toast('模型没接通，先去设置里配 API'); return; }
        const entry = entries[key] || { key, tags: [], auto: true, createdAt: 0, contactId };
        entry.text = text;
        entry.auto = true;
        entry.contactId = contactId;
        entry.createdAt = Date.now();
        entry.tags = contact ? [contact.name] : (entry.tags || []);
        entries[key] = entry;
        ctx.save();
        ctx.toast('写好了');
        ctx.rerender();
      })
      .catch(() => ctx.toast('写日记失败'));
    return true;
  }

  return false;
}

export const diaryApp = {
  id: 'diary', name: '日记', icon: 'diary',
  render(ctx) { return renderPage(ctx); },
  handle(ctx, act, data) { return handleDiary(ctx, act, data); },
};

/** 聊天设置里的角色日记页。 */
export const threadDiaryApp = {
  id: 'thread-diary', name: '角色日记', icon: 'diary',
  render(ctx, params = {}) {
    const contactId = params.contactId || chatById(ctx.state, params.chatId)?.contactId || '';
    return renderPage(ctx, { contactId });
  },
  handle(ctx, act, data) { return handleDiary(ctx, act, data); },
};
