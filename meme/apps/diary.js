/**
 * meme-phone · 日记
 * 一天一格：日历标出写过/待写，正区是当天那一页。
 * 全局日记在 Dock；聊天设置里的「TA 的日记」按角色单独存一份。
 */

import { icon } from '../icons.js';
import { chatById, chatFor, contactById, dayKey, DIARY_SKIP_THRESHOLD } from '../data.js';
import { esc } from '../shell.js';
import {
  diaryContextMode, diaryDayGroups, diaryDayStatuses, diaryFingerprint, diaryParamsFingerprint,
  diaryRoleEntries, parseDiaryResponse, removeDiaryEntry, saveDiaryEntry, setDiaryUseOriginal,
} from '../diary.js';
import { diaryTranscriptForMessages, estimateTokens, serializeMessage } from '../reply-context.js';

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
  const busy = ctx.shell.diaryBusy === key;

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
        <button class="mp-btn" data-act="diary-gen" data-day="${key}" data-contact="${esc(contactId)}" type="button"${busy ? ' disabled' : ''}>${icon('spark')}${busy ? '正在写…' : contactId ? `让 ${esc(name)} 写这一天` : '让手机写这一天'}</button>
      </div>
    </div>`;
}

function renderPage(ctx, params = {}) {
  const contactId = String(params.contactId || '');
  if (contactId) return renderThreadPage(ctx, contactId);
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
      <div class="mp-subtitle" style="margin-top:0">${contactId ? `${esc(contact?.name || 'TA')}的日记 · 只记录这个角色和你的聊天` : '日记 · 写过的日子会有小圆点'}</div>
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

function handleDiary(ctx, act, data, event) {
  const contactId = String(data?.contact || '');
  if (contactId) return handleThreadDiary(ctx, act, data, event);
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

  if (act === 'diary-gen' || act === 'diary-gen-confirm') {
    const key = data.day;
    if (ctx.shell.diaryBusy === key) { ctx.toast('正在写这一天…'); return true; }
    if (act === 'diary-gen-confirm') ctx.closeSheet();

    if (act === 'diary-gen' && entries[key]?.text) {
      /* 已有正文：先确认再覆盖，不直接替换。 */
      ctx.openSheet({
        kind: 'panel',
        title: '重新生成会覆盖现有日记',
        doneLabel: '取消',
        render: () => `
          <div class="mp-diary-hero-text">${esc(entries[key].text)}</div>
          <div style="display:flex;gap:8px;margin-top:11px">
            <button class="mp-btn" data-act="diary-gen-confirm" data-day="${esc(key)}" data-contact="${esc(contactId)}" type="button">覆盖并重新生成</button>
          </div>`,
      });
      return true;
    }

    const contact = contactId ? contactById(ctx.state, contactId) : null;
    const chat = contactId ? chatFor(ctx.state, contactId) : null;
    ctx.shell.diaryBusy = key;
    ctx.rerender();
    ctx.toast(contactId ? '正在让 TA 写这一天…' : '正在写这一天…');
    Promise.resolve(ctx.ai.diary(ctx, contactId ? { day: key, chat, contact } : { day: key }))
      .then(text => {
        ctx.shell.diaryBusy = '';
        if (!text) { ctx.toast('模型没接通，先去设置里配 API'); ctx.rerender(); return; }
        const next = entriesFor(ctx, contactId);
        const entry = next[key] || { key, tags: [], auto: true, createdAt: 0, contactId };
        entry.text = text;
        entry.auto = true;
        entry.contactId = contactId;
        entry.createdAt = Date.now();
        entry.tags = contact ? [contact.name] : (entry.tags || []);
        next[key] = entry;
        ctx.save();
        ctx.toast('写好了');
        ctx.rerender();
      })
      .catch(() => {
        ctx.shell.diaryBusy = '';
        ctx.toast('写日记失败');
        ctx.rerender();
      });
    return true;
  }

  return false;
}

/* ------------------------------------------------------ 角色聊天日记 */

function threadState(ctx, contactId) {
  ctx.shell.threadDiary = ctx.shell.threadDiary || {};
  const store = ctx.shell.threadDiary;
  if (!store[contactId] || typeof store[contactId] !== 'object') {
    store[contactId] = { month: monthKey(new Date()), sel: dayKey(new Date()), selected: new Set() };
  }
  if (!(store[contactId].selected instanceof Set)) store[contactId].selected = new Set();
  return store[contactId];
}

function threadCalendar(ctx, contactId, statuses) {
  const st = threadState(ctx, contactId);
  const first = parseMonth(st.month);
  const lead = first.getDay();
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const today = dayKey(new Date());
  const map = new Map(statuses.map(item => [item.date, item]));
  const cells = ['<div class="mp-wd">日</div>', '<div class="mp-wd">一</div>', '<div class="mp-wd">二</div>', '<div class="mp-wd">三</div>', '<div class="mp-wd">四</div>', '<div class="mp-wd">五</div>', '<div class="mp-wd">六</div>'];
  for (let index = 0; index < lead; index += 1) cells.push('<span></span>');
  for (let day = 1; day <= days; day += 1) {
    const key = `${st.month}-${String(day).padStart(2, '0')}`;
    const row = map.get(key);
    const entry = row?.entry;
    const summarized = row?.status === 'summarized';
    const pending = row?.status === 'pending';
    const isSel = key === st.sel;
    const mark = summarized ? '<span class="mark"></span>'
      : pending ? '<span class="mark is-pending"></span>'
        : entry?.text ? '<span class="mark is-stale"></span>' : '';
    cells.push(`<button type="button" class="${isSel ? 'sel' : ''}${summarized ? ' has' : ''}${pending ? ' is-pending' : ''}${key === today ? ' today' : ''}" data-act="td-day" data-contact="${esc(contactId)}" data-day="${key}">${day}${mark}</button>`);
  }
  return `<div class="mp-cal">${cells.join('')}</div>`;
}

function formatTokens(text) {
  const count = estimateTokens(text);
  return count > 999 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function originalLine(state, contact, message) {
  const date = new Date(Number(message.at));
  const stamp = Number.isFinite(date.getTime()) ? `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '--:--';
  const who = message.from === 'me' ? (state.settings?.user?.name || '我') : contact?.name || 'TA';
  return `[${stamp}] ${who} · ${serializeMessage(message)}`;
}

function threadHero(ctx, contact, chat, status, latestDate, busy) {
  const st = threadState(ctx, contact.id);
  const date = st.sel;
  const entry = status?.entry || null;
  const text = String(entry?.text || '').trim();
  const count = status?.messageCount || 0;
  const skipped = count <= DIARY_SKIP_THRESHOLD;
  const mode = diaryContextMode(ctx.state, chat, date, entry, status?.messages || [], latestDate);
  const label = date === dayKey(new Date()) ? '今天' : `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`;
  const originalTokens = status?.messages ? formatTokens(diaryTranscriptForMessages(ctx.state, chat, status.messages)) : '0';
  const summaryTokens = text ? formatTokens(text) : '';
  return `
    <div class="mp-diary-hero">
      <div class="mp-diary-hero-top">
        <span class="mp-diary-hero-date">${label} · ${count} 条 · ${status ? (skipped ? '不用整理' : status.status === 'summarized' ? '已整理' : '待整理') : '没有聊天'}</span>
        <div style="display:flex;gap:6px">
          <button class="mp-btn ghost" data-act="td-edit" data-contact="${esc(contact.id)}" data-date="${date}" type="button">${icon('brush')}${text ? '改写' : '写一句'}</button>
        </div>
      </div>
      ${text
        ? `<div class="mp-diary-hero-text">${esc(text)}</div>`
        : `<div class="mp-diary-empty">${skipped ? `这一天只有 ${count} 条聊天，${DIARY_SKIP_THRESHOLD} 条以内不整理。` : count ? `这一天有 ${count} 条聊天，还没有整理成日记。` : '这一天没有聊天记录。'}</div>`}
      <div class="mp-diary-meta"><span>上下文：${esc(mode)}</span><span>原文约 ${originalTokens} tk${summaryTokens ? ` · 日记约 ${summaryTokens} tk` : ''}</span></div>
      <div style="display:flex;gap:6px;margin-top:11px;flex-wrap:wrap">
        <button class="mp-btn" data-act="td-generate-one" data-contact="${esc(contact.id)}" data-date="${date}" type="button"${busy || skipped ? ' disabled' : ''}>${icon('spark')}${busy ? '正在整理…' : text ? '重写这一天' : '整理这一天'}</button>
        ${entry ? `<label class="mp-td-inline-check"><input type="checkbox" data-act="td-use-original" data-contact="${esc(contact.id)}" data-date="${date}"${entry.useOriginal ? ' checked' : ''}> 本日上下文用原文</label>` : ''}
        ${entry ? `<button class="mp-btn ghost" data-act="td-delete" data-contact="${esc(contact.id)}" data-date="${date}" type="button">${icon('trash')}<span>删日记</span></button>` : ''}
      </div>
      ${status?.messages?.length ? `<details class="mp-td-original"><summary>查看当天原文（${count} 条）</summary>${status.messages.map(message => `<div>${esc(originalLine(ctx.state, contact, message))}</div>`).join('')}</details>` : ''}
    </div>`;
}

function threadDayRows(ctx, contactId, chat, statuses, latestDate, busy) {
  const st = threadState(ctx, contactId);
  const available = new Set(statuses.filter(item => item.status !== 'skipped').map(item => item.date));
  st.selected = new Set([...st.selected].filter(date => available.has(date)));
  const pending = statuses.filter(item => item.status === 'pending');
  const rows = statuses.slice().reverse().map(item => {
    const entry = item.entry;
    const text = String(entry?.text || '').trim();
    const mode = diaryContextMode(ctx.state, chat, item.date, entry, item.messages, latestDate);
    const stateLabel = item.status === 'skipped' ? `${DIARY_SKIP_THRESHOLD} 条以内` : item.status === 'summarized' ? '已整理' : '待整理';
    const originalTokens = formatTokens(diaryTranscriptForMessages(ctx.state, chat, item.messages));
    const summaryTokens = text ? formatTokens(text) : '';
    const disabled = busy || item.status === 'skipped';
    return `
      <div class="mp-td-row">
        <input class="mp-td-check" type="checkbox" data-act="td-select" data-contact="${esc(contactId)}" data-date="${item.date}"${st.selected.has(item.date) ? ' checked' : ''}${item.status === 'skipped' ? ' disabled' : ''} aria-label="选择 ${item.date}">
        <div class="mp-td-main">
          <div class="mp-td-title">${Number(item.date.slice(5, 7))}月${Number(item.date.slice(8, 10))}日 <span class="mp-td-badge ${item.status}">${stateLabel}</span></div>
          <div class="mp-td-sub">${item.messageCount} 条 · ${esc(mode)} · 原文约 ${originalTokens} tk${summaryTokens ? ` · 日记约 ${summaryTokens} tk` : ''}</div>
        </div>
        <button class="mp-btn ghost" data-act="td-generate-one" data-contact="${esc(contactId)}" data-date="${item.date}" type="button"${disabled ? ' disabled' : ''}>${busy ? '整理中…' : text ? '重写' : '整理'}</button>
      </div>`;
  }).join('');
  return `
    <div class="mp-group-label" style="margin-top:16px">按日期整理</div>
    <div class="mp-td-actions">
      <button class="mp-btn" data-act="td-generate-selected" data-contact="${esc(contactId)}" type="button"${busy || !st.selected.size ? ' disabled' : ''}>${icon('spark')}整理勾选（${st.selected.size} 天）</button>
      <button class="mp-btn ghost" data-act="td-generate-pending" data-contact="${esc(contactId)}" type="button"${busy || !pending.length ? ' disabled' : ''}>全部待整理（${pending.length} 天）</button>
    </div>
    <div class="mp-td-note">选中的日期共用一次模型请求。生成会读取这个角色全部未排除的聊天记录，${DIARY_SKIP_THRESHOLD} 条以内的日期跳过。</div>
    <div class="mp-td-list">${rows || '<div class="mp-empty">这个角色还没有聊天记录。</div>'}</div>`;
}

function renderThreadPage(ctx, contactId) {
  const state = ctx.state;
  const contact = contactById(state, contactId);
  if (!contact) return '<div class="mp-page-body"><div class="mp-empty">这个联系人已经删掉了。</div></div>';
  const chat = chatFor(state, contactId);
  if (!chat) return '<div class="mp-page-body"><div class="mp-empty">这个角色还没有聊天。</div></div>';
  const st = threadState(ctx, contactId);
  const statuses = diaryDayStatuses(state, chat);
  const latestDate = statuses.length ? statuses[statuses.length - 1].date : '';
  if (!statuses.some(item => item.date === st.sel) && statuses.length) {
    st.sel = latestDate;
    if (st.month !== latestDate.slice(0, 7)) st.month = latestDate.slice(0, 7);
  }
  const selected = statuses.find(item => item.date === st.sel) || null;
  const enabled = state.diary?.enabled !== false;
  const busy = ctx.shell.threadDiaryBusy === contactId;
  if (!statuses.length) {
    return `
      <div class="mp-page-body">
        <div class="mp-subtitle" style="margin-top:0">${esc(contact.name)}的日记 · 按天整理聊天，只在这个角色里保存</div>
        <div class="mp-group-box" style="margin-top:10px">
          <button class="mp-set-row" data-act="td-toggle-replace" type="button">
            <span class="mp-set-ico">${icon('book')}</span>
            <span class="mp-set-name">用日记替换聊天<small>${enabled ? '现在开启：旧日期用日记替换原文；最近一天仍读原文' : '现在关闭：聊天上下文全部读原文'}</small></span>
            <span class="mp-switch${enabled ? ' on' : ''}"></span>
          </button>
        </div>
        <div class="mp-td-toolbar">
          <button class="mp-btn ghost" data-act="td-prompt" type="button">${icon('brush')}日记提示词</button>
        </div>
        <div class="mp-empty">这个角色还没有聊天记录。先聊过几天，再回来按日期整理。</div>
      </div>`;
  }
  const target = parseMonth(st.month);
  return `
    <div class="mp-page-body">
      <div class="mp-subtitle" style="margin-top:0">${esc(contact.name)}的日记 · 按天整理聊天，只在这个角色里保存</div>
      <div class="mp-group-box" style="margin-top:10px">
        <button class="mp-set-row" data-act="td-toggle-replace" type="button">
          <span class="mp-set-ico">${icon('book')}</span>
          <span class="mp-set-name">用日记替换聊天<small>${enabled ? '现在开启：旧日期用日记替换原文；最近一天仍读原文' : '现在关闭：聊天上下文全部读原文'}</small></span>
          <span class="mp-switch${enabled ? ' on' : ''}"></span>
        </button>
      </div>
      <div class="mp-td-toolbar">
        <button class="mp-btn ghost" data-act="td-prompt" type="button">${icon('brush')}日记提示词</button>
        <span class="mp-td-toolbar-note">${statuses.filter(item => item.status === 'pending').length} 天待整理</span>
      </div>
      <div class="mp-month-bar">
        <button class="mp-icon-btn" data-act="td-prev" data-contact="${esc(contactId)}" type="button" aria-label="上个月">${icon('back')}</button>
        <span class="mp-month">${target.getFullYear()} 年 ${target.getMonth() + 1} 月</span>
        <button class="mp-icon-btn" data-act="td-next" data-contact="${esc(contactId)}" type="button" aria-label="下个月" style="transform:rotate(180deg)">${icon('back')}</button>
      </div>
      ${threadCalendar(ctx, contactId, statuses)}
      ${threadHero(ctx, contact, chat, selected, latestDate, busy)}
      ${threadDayRows(ctx, contactId, chat, statuses, latestDate, busy)}
    </div>`;
}

async function runThreadGeneration(ctx, contactId, dates) {
  const state = ctx.state;
  const chat = chatFor(state, contactId);
  const contact = contactById(state, contactId);
  if (!chat || !contact) { ctx.toast('找不到这个角色的聊天'); return; }
  if (ctx.shell.threadDiaryBusy === contactId) { ctx.toast('正在整理这个角色的日记'); return; }
  const uniqueDates = [...new Set(dates)].filter(Boolean).sort();
  if (!uniqueDates.length) { ctx.toast('没有勾选日期'); return; }
  const prompt = state.diary.prompt || '';
  const snapshot = JSON.stringify(chat.messages || []);
  ctx.shell.threadDiaryBusy = contactId;
  ctx.rerender();
  ctx.toast(`正在整理 ${uniqueDates.length} 天…`);
  try {
    const raw = await ctx.ai.diaryBatch(ctx, { chat, contact, dates: uniqueDates });
    const parsed = parseDiaryResponse(raw, uniqueDates);
    if (JSON.stringify(chat.messages || []) !== snapshot || (state.diary.prompt || '') !== prompt) {
      throw new Error('生成期间聊天或日记提示词发生了变化，本轮结果没有保存');
    }
    const groups = diaryDayGroups(chat);
    const paramsFingerprint = diaryParamsFingerprint(state, chat);
    for (const item of parsed) {
      const messages = groups.get(item.date) || [];
      saveDiaryEntry(state, contactId, {
        date: item.date,
        content: item.content,
        auto: true,
        tags: [contact.name],
        fromTime: messages[0]?.at || null,
        toTime: messages[messages.length - 1]?.at || null,
        messageCount: messages.length,
        sourceFingerprint: diaryFingerprint(messages),
        paramsFingerprint,
      });
    }
    state.diary.lastGenerated = new Date().toISOString();
    ctx.save();
    ctx.toast(`整理好了 ${parsed.length} 天`);
  } catch (error) {
    ctx.toast(error?.message || '日记生成失败');
  } finally {
    ctx.shell.threadDiaryBusy = '';
    ctx.rerender();
  }
}

function requestThreadGeneration(ctx, contactId, dates) {
  const state = ctx.state;
  const entries = diaryRoleEntries(state, contactId);
  const clean = [...new Set(dates.filter(Boolean))].sort();
  if (!clean.length) { ctx.toast('没有可整理的日期'); return; }
  const overwritten = clean.filter(date => entries[date]?.text);
  if (!overwritten.length) { runThreadGeneration(ctx, contactId, clean); return; }
  ctx.openSheet({
    kind: 'panel',
    title: '覆盖已有日记',
    render: () => `
      <div class="mp-td-note">会重写 ${overwritten.length} 天已有日记，原始聊天不会删除。所有目标日期共用一次请求。</div>
      <div class="mp-diary-hero-text" style="margin-top:10px">${overwritten.map(date => esc(date)).join('、')}</div>
      <button class="mp-btn" data-act="td-generate-run" data-contact="${esc(contactId)}" data-dates="${esc(clean.join(','))}" type="button" style="margin-top:12px">覆盖并开始整理</button>`,
  });
}

function handleThreadDiary(ctx, act, data, event) {
  const state = ctx.state;
  const contactId = String(data?.contact || '');
  if (!contactId) return false;
  const chat = chatFor(state, contactId);
  const contact = contactById(state, contactId);
  if (!chat || !contact) return false;
  const st = threadState(ctx, contactId);

  if (act === 'td-prev' || act === 'td-next') {
    const target = parseMonth(st.month);
    target.setMonth(target.getMonth() + (act === 'td-prev' ? -1 : 1));
    st.month = monthKey(target);
    st.sel = dayKey(target);
    ctx.rerender();
    return true;
  }
  if (act === 'td-day') {
    st.sel = String(data.day || st.sel);
    ctx.rerender();
    return true;
  }
  if (act === 'td-select') {
    const date = String(data.date || '');
    if (event?.target?.checked) st.selected.add(date); else st.selected.delete(date);
    ctx.rerender();
    return true;
  }
  if (act === 'td-toggle-replace') {
    state.diary.enabled = state.diary.enabled === false;
    ctx.save();
    ctx.rerender();
    ctx.toast(state.diary.enabled ? '旧日期会用日记替换原文；最近一天仍读原文' : '日记替换已关闭，聊天上下文全部读原文');
    return true;
  }
  if (act === 'td-prompt') {
    ctx.openSheet({
      kind: 'text',
      title: '日记怎么写',
      value: state.diary.prompt || '',
      placeholder: '给模型的日记写作要求…',
      confirm: '存下',
      onText: (text) => {
        state.diary.prompt = String(text || '').trim() || state.diary.prompt;
        ctx.save();
        ctx.rerender();
        ctx.toast('日记提示词已保存；旧日记会标成待整理，重新整理后生效');
      },
    });
    return true;
  }
  if (act === 'td-edit') {
    const date = String(data.date || st.sel);
    const entry = diaryRoleEntries(state, contactId)[date];
    ctx.openSheet({
      kind: 'text',
      title: `写 ${date}`,
      value: entry?.text || '',
      placeholder: '这一天发生了什么…',
      confirm: '存下来',
      onText: (text) => {
        const content = String(text || '').trim();
        if (!content) { ctx.toast('正文为空，没有保存'); return; }
        const dayMessages = diaryDayGroups(chat).get(date) || [];
        saveDiaryEntry(state, contactId, {
          date,
          content,
          auto: false,
          tags: entry?.tags || [contact.name],
          sourceFingerprint: dayMessages.length > DIARY_SKIP_THRESHOLD ? diaryFingerprint(dayMessages) : '',
          paramsFingerprint: diaryParamsFingerprint(state, chat),
          fromTime: dayMessages[0]?.at ?? null,
          toTime: dayMessages[dayMessages.length - 1]?.at ?? null,
          messageCount: dayMessages.length || null,
        });
        ctx.save();
        ctx.rerender();
        ctx.toast('日记已保存；原始聊天没有改动');
      },
    });
    return true;
  }
  if (act === 'td-use-original') {
    const date = String(data.date || '');
    const checked = Boolean(event?.target?.checked);
    try { setDiaryUseOriginal(state, contactId, date, checked); }
    catch (error) { ctx.toast(error.message); return true; }
    ctx.save();
    ctx.rerender();
    ctx.toast(checked ? '这一天发送时改用原文，日记保留' : '这一天允许用日记替换原文');
    return true;
  }
  if (act === 'td-delete') {
    const date = String(data.date || st.sel);
    ctx.openSheet({
      kind: 'panel',
      title: '删除这篇日记',
      render: () => `
        <div class="mp-td-note">删除 ${esc(date)} 的日记？原始聊天不会删除。</div>
        <button class="mp-btn" data-act="td-delete-run" data-contact="${esc(contactId)}" data-date="${esc(date)}" type="button" style="margin-top:12px;background:#e46b7a">${icon('trash')}<span>删除日记</span></button>`,
    });
    return true;
  }
  if (act === 'td-delete-run') {
    const date = String(data.date || '');
    ctx.closeSheet();
    removeDiaryEntry(state, contactId, date);
    ctx.save();
    ctx.rerender();
    ctx.toast('日记已删除，原始聊天保留');
    return true;
  }
  if (act === 'td-generate-one') {
    requestThreadGeneration(ctx, contactId, [String(data.date || st.sel)]);
    return true;
  }
  if (act === 'td-generate-selected') {
    requestThreadGeneration(ctx, contactId, [...st.selected]);
    return true;
  }
  if (act === 'td-generate-pending') {
    requestThreadGeneration(ctx, contactId, diaryDayStatuses(state, chat).filter(item => item.status === 'pending').map(item => item.date));
    return true;
  }
  if (act === 'td-generate-run') {
    const dates = String(data.dates || '').split(',').map(item => item.trim()).filter(Boolean);
    ctx.closeSheet();
    runThreadGeneration(ctx, contactId, dates);
    return true;
  }
  return false;
}

export const diaryApp = {
  id: 'diary', name: '日记', icon: 'diary',
  render(ctx) { return renderPage(ctx); },
  handle(ctx, act, data, event) { return handleDiary(ctx, act, data, event); },
};

/** 聊天设置里的角色日记页。 */
export const threadDiaryApp = {
  id: 'thread-diary', name: '角色日记', icon: 'diary',
  render(ctx, params = {}) {
    const contactId = params.contactId || chatById(ctx.state, params.chatId)?.contactId || '';
    return renderPage(ctx, { contactId });
  },
  handle(ctx, act, data, event) { return handleDiary(ctx, act, data, event); },
};
