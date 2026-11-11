/**
 * meme-phone · 日记
 * 一天一格：日历标出写过/待写，正区是当天那一页。
 */

import { icon } from '../icons.js';
import { chatsOf, contactById, dayKey, latestDiary } from '../data.js';
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

function calendar(ctx) {
  const month = curMonth(ctx);
  const first = parseMonth(month);
  const lead = first.getDay();
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = dayKey(new Date());
  const sel = curDay(ctx);
  const entries = ctx.state.diary.entries;

  const cells = ['<div class="mp-wd">日</div>', '<div class="mp-wd">一</div>', '<div class="mp-wd">二</div>', '<div class="mp-wd">三</div>', '<div class="mp-wd">四</div>', '<div class="mp-wd">五</div>', '<div class="mp-wd">六</div>'];
  for (let index = 0; index < lead; index += 1) cells.push('<span></span>');

  for (let day = 1; day <= days; day += 1) {
    const key = `${month}-${String(day).padStart(2, '0')}`;
    const entry = entries[key];
    const has = Boolean(entry && entry.text);
    const classes = ['mp-cal-cell'];
    const isToday = key === today;
    const isSel = key === sel;
    cells.push(`<button type="button" class="${isSel ? 'sel' : ''}${has ? ' has' : ''}${isToday ? ' today' : ''}" data-act="diary-day" data-day="${key}">${day}${has ? '<span class="mark"></span>' : ''}</button>`);
  }
  return `<div class="mp-cal">${cells.join('')}</div>`;
}

function hero(ctx) {
  const key = curDay(ctx);
  const entry = ctx.state.diary.entries[key];
  const isToday = key === dayKey(new Date());
  const label = isToday ? '今天' : `${Number(key.slice(5, 7))}月${Number(key.slice(8, 10))}日`;
  const text = entry?.text || '';

  return `
    <div class="mp-diary-hero">
      <div class="mp-diary-hero-top">
        <span class="mp-diary-hero-date">${label}${entry?.auto ? ' · 自动生成' : ''}</span>
        <div style="display:flex;gap:6px">
          <button class="mp-btn ghost" data-act="diary-edit" data-day="${key}" type="button">${icon('brush')}${text ? '改写' : '写一句'}</button>
        </div>
      </div>
      ${text
        ? `<div class="mp-diary-hero-text">${esc(text)}</div>`
        : '<div class="mp-diary-empty">这一格还空着。<br>可以手写一句，也可以让手机照着当天的聊天写。</div>'}
      <div style="display:flex;gap:6px;margin-top:11px;flex-wrap:wrap">
        ${(entry?.tags || []).map(tag => `<span class="mp-pill pink">${esc(tag)}</span>`).join('')}
        <button class="mp-btn" data-act="diary-gen" data-day="${key}" type="button">${icon('spark')}让手机写这一天</button>
      </div>
    </div>`;
}

export const diaryApp = {
  id: 'diary', name: '日记', icon: 'diary',

  render(ctx) {
    const month = curMonth(ctx);
    const target = parseMonth(month);
    const entries = Object.values(ctx.state.diary.entries)
      .filter(item => item.text)
      .sort((a, b) => (a.key < b.key ? 1 : -1))
      .slice(0, 5);

    const list = entries.map(item => `
      <div class="mp-diary-card" data-act="diary-day" data-day="${item.key}">
        <div class="mp-diary-head">
          <span style="font-size:12px;color:var(--text-3)">${Number(item.key.slice(5, 7))}月${Number(item.key.slice(8, 10))}日</span>
          ${(item.tags || []).slice(0, 2).map(tag => `<span class="mp-pill plain">${esc(tag)}</span>`).join('')}
        </div>
        <div style="font-family:var(--font-serif);font-size:13px;line-height:1.72;color:var(--text-2);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(item.text)}</div>
      </div>`).join('');

    return `
      <div class="mp-page-body">
        <div class="mp-title">日记</div>
        <div class="mp-subtitle">写过的日子会有小圆点</div>
        <div class="mp-month-bar">
          <button class="mp-icon-btn" data-act="diary-prev" type="button" aria-label="上个月">${icon('back')}</button>
          <span class="mp-month">${target.getFullYear()} 年 ${target.getMonth() + 1} 月</span>
          <button class="mp-icon-btn" data-act="diary-next" type="button" aria-label="下个月" style="transform:rotate(180deg)">${icon('back')}</button>
        </div>
        ${calendar(ctx)}
        ${hero(ctx)}
        <div class="mp-group-label" style="margin-top:16px">最近写过的</div>
        ${list || '<div class="mp-empty">还没有写过日记。</div>'}
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'diary-prev' || act === 'diary-next') {
      const target = parseMonth(curMonth(ctx));
      target.setMonth(target.getMonth() + (act === 'diary-prev' ? -1 : 1));
      ctx.shell.diaryMonth = monthKey(target);
      ctx.shell.diarySel = dayKey(target);
      ctx.shell.rerender();
      return true;
    }

    if (act === 'diary-day') {
      ctx.shell.diarySel = data.day;
      ctx.shell.rerender();
      return true;
    }

    if (act === 'diary-edit') {
      const key = data.day;
      const current = ctx.state.diary.entries[key]?.text || '';
      ctx.openSheet({
        kind: 'text',
        title: `写 ${Number(key.slice(5, 7))} 月 ${Number(key.slice(8, 10))} 日`,
        value: current,
        placeholder: '今天发生了什么…',
        confirm: '存下来',
        onText: (text) => {
          const entry = ctx.state.diary.entries[key] || { key, tags: [], auto: false, createdAt: 0 };
          entry.text = String(text || '').trim();
          entry.createdAt = Date.now();
          ctx.state.diary.entries[key] = entry;
          ctx.save();
          ctx.toast(entry.text ? '写好了' : '空白的一天');
          ctx.shell.rerender();
        },
      });
      return true;
    }

    if (act === 'diary-gen') {
      const key = data.day;
      ctx.toast('正在写这一天…');
      Promise.resolve(ctx.ai.diary(ctx, { day: key }))
        .then(text => {
          if (!text) { ctx.toast('模型没接通，先去设置里配 API'); return; }
          const entry = ctx.state.diary.entries[key] || { key, tags: [], auto: true, createdAt: 0 };
          entry.text = text;
          entry.auto = true;
          entry.createdAt = Date.now();
          ctx.state.diary.entries[key] = entry;
          ctx.save();
          ctx.toast('写好了');
          ctx.shell.rerender();
        })
        .catch(() => ctx.toast('写日记失败'));
      return true;
    }

    return false;
  },
};
