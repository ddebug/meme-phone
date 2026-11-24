import test from 'node:test';
import assert from 'node:assert/strict';

import {
  diaryFingerprint,
  diaryMessages,
  diaryContextMessages,
  diaryDayGroups,
  diaryDayStatuses,
  parseDiaryResponse,
  saveDiaryEntry,
  removeDiaryEntry,
  setDiaryUseOriginal,
  diaryContextMode,
  diaryEntryIsCurrent,
} from '../meme/diary.js';
import { DIARY_SKIP_THRESHOLD, normalize } from '../meme/data.js';
import { historyTranscript } from '../meme/reply-context.js';

const atOf = (date) => new Date(`${date}T12:00:00`).getTime();
const msg = (date, extra = {}) => ({ at: atOf(date), from: 'them', text: '聊了一句', ...extra });

test('指纹与对象键顺序无关，内容不同指纹不同', () => {
  const a = diaryFingerprint({ b: 1, a: [2, 3] });
  const b = diaryFingerprint({ a: [2, 3], b: 1 });
  assert.equal(a, b);
  assert.notEqual(diaryFingerprint({ b: 1, a: [2, 3] }), diaryFingerprint({ b: 1, a: [2, 4] }));
});

test('diaryMessages 排除被忽略和缺少时间戳的消息', () => {
  const chat = { messages: [
    msg('2026-11-10'),
    msg('2026-11-10', { excluded: true }),
    msg('2026-11-10', { at: NaN }),
    { role: 'system', content: '无 at' },
  ] };
  assert.equal(diaryMessages(chat).length, 1);
  assert.equal(diaryMessages(null).length, 0);
});

test('diaryContextMessages 开启截止时只到目标最后一天，关闭时保留全部未排除消息', () => {
  const chat = { messages: [
    msg('2026-11-09', { text: '前一天' }),
    msg('2026-11-10', { text: '目标日' }),
    msg('2026-11-11', { text: '后一天' }),
    msg('2026-11-10', { text: '被忽略', excluded: true }),
  ] };
  assert.deepEqual(
    diaryContextMessages(chat, ['2026-11-10'], true).map(item => item.text),
    ['前一天', '目标日'],
  );
  assert.deepEqual(
    diaryContextMessages(chat, ['2026-11-09', '2026-11-10'], true).map(item => item.text),
    ['前一天', '目标日'],
  );
  assert.deepEqual(
    diaryContextMessages(chat, ['2026-11-10'], false).map(item => item.text),
    ['前一天', '目标日', '后一天'],
  );
  assert.deepEqual(diaryContextMessages(null, [], true), []);
});

test('日记上下文截止开关默认开启，用户关掉后保持关闭', () => {
  assert.equal(normalize({}).diary.pastOnly, true);
  assert.equal(normalize({ diary: { pastOnly: false } }).diary.pastOnly, false);
});

test('diaryDayGroups 按本地日期分组并升序排列', () => {
  const chat = { messages: [
    msg('2026-11-10', { text: '第二条' }),
    msg('2026-11-09'),
    msg('2026-11-10'),
  ] };
  const groups = diaryDayGroups(chat);
  assert.deepEqual([...groups.keys()], ['2026-11-09', '2026-11-10']);
  assert.equal(groups.get('2026-11-10').length, 2);
});

test('parseDiaryResponse 解析合法 entries 并按日期升序', () => {
  const text = JSON.stringify({ entries: [
    { date: '2026-11-10', content: '十号的日记' },
    { date: '2026-11-09', content: '九号的日记' },
  ] });
  const out = parseDiaryResponse(text, ['2026-11-09', '2026-11-10']);
  assert.deepEqual(out, [
    { date: '2026-11-09', content: '九号的日记' },
    { date: '2026-11-10', content: '十号的日记' },
  ]);
});

test('parseDiaryResponse 容忍 ```json 包裹', () => {
  const text = '```json\n' + JSON.stringify({ entries: [{ date: '2026-11-10', content: '正文' }] }) + '\n```';
  const out = parseDiaryResponse(text, ['2026-11-10']);
  assert.equal(out[0].content, '正文');
});

test('parseDiaryResponse 对数量不符 / 重复 / 非目标日期 / 空正文 / 非 JSON 一律抛错', () => {
  const ok = { entries: [{ date: '2026-11-10', content: '正文' }] };
  assert.throws(() => parseDiaryResponse(JSON.stringify({ entries: [] }), ['2026-11-10']));
  assert.throws(() => parseDiaryResponse(JSON.stringify({ entries: [ok.entries[0], ok.entries[0]] }), ['2026-11-10']));
  assert.throws(() => parseDiaryResponse(JSON.stringify({ entries: [{ date: '2026-11-11', content: '正文' }] }), ['2026-11-10']));
  assert.throws(() => parseDiaryResponse(JSON.stringify({ entries: [{ date: '2026-11-10', content: '  ' }] }), ['2026-11-10']));
  assert.throws(() => parseDiaryResponse('不是 JSON', ['2026-11-10']));
});

test('saveDiaryEntry 合法保存，无效日期或空正文抛错', () => {
  const state = { diary: { entries: {}, contacts: {} } };
  const entry = saveDiaryEntry(state, 'c1', { date: '2026-11-10', content: '写好了', tags: ['日常'] });
  assert.equal(entry.text, '写好了');
  assert.deepEqual(entry.tags, ['日常']);
  assert.throws(() => saveDiaryEntry(state, 'c1', { date: '11/10', content: 'x' }));
  assert.throws(() => saveDiaryEntry(state, 'c1', { date: '2026-11-10', content: '' }));
});

test('saveDiaryEntry 保留旧的 useOriginal 与 tags', () => {
  const state = { diary: { entries: {}, contacts: { c1: {} } } };
  saveDiaryEntry(state, 'c1', { date: '2026-11-10', content: '旧文', tags: ['旧'] });
  setDiaryUseOriginal(state, 'c1', '2026-11-10', true);
  saveDiaryEntry(state, 'c1', { date: '2026-11-10', content: '新文' });
  const entry = state.diary.contacts.c1['2026-11-10'];
  assert.equal(entry.useOriginal, true);
  assert.deepEqual(entry.tags, ['旧']);
});

test('removeDiaryEntry 存在返回 true，不存在返回 false', () => {
  const state = { diary: { entries: {}, contacts: { c1: { '2026-11-10': { text: 'x' } } } } };
  assert.equal(removeDiaryEntry(state, 'c1', '2026-11-10'), true);
  assert.equal(removeDiaryEntry(state, 'c1', '2026-11-10'), false);
});

test('diaryContextMode 各分支口径', () => {
  const base = { diary: { enabled: true } };
  assert.equal(diaryContextMode({ diary: { enabled: false } }, {}, '2026-11-10', { text: 'x' }, [], ''), '原文 · 日记替换已关闭');
  assert.equal(diaryContextMode(base, {}, '2026-11-10', { text: 'x', useOriginal: true }, [], ''), '原文 · 本日已切回');
  assert.equal(diaryContextMode(base, {}, '2026-11-10', { text: 'x' }, [], '2026-11-10'), '原文 · 最近一天');
  assert.equal(diaryContextMode(base, {}, '2026-11-10', {}, [], ''), '原文 · 还没有日记');
  assert.equal(diaryContextMode(base, {}, '2026-11-10', { text: 'x' }, [], ''), '原文 · 日记待更新');
});

test('diaryEntryIsCurrent：消息超阈值且原文/参数指纹一致才视为现行', () => {
  const dayMessages = Array.from({ length: DIARY_SKIP_THRESHOLD + 1 }, (_, i) => msg('2026-11-10', { text: `m${i}` }));
  const state = { contacts: {}, settings: { user: {} }, users: [], diary: { prompt: '' } };
  const chat = { contactId: 'c1' };
  const fingerprint = diaryFingerprint(dayMessages);
  const current = { text: '日记', sourceFingerprint: fingerprint };
  assert.equal(diaryEntryIsCurrent(state, chat, current, dayMessages), true);
  assert.equal(diaryEntryIsCurrent(state, chat, { text: '日记', sourceFingerprint: 'x' }, dayMessages), false);
  const short = dayMessages.slice(0, DIARY_SKIP_THRESHOLD);
  assert.equal(diaryEntryIsCurrent(state, chat, current, short), false);
});

test('historyTranscript：旧日期用现行日记替换原文，最近一天仍发原文', () => {
  const oldMsgs = Array.from({ length: DIARY_SKIP_THRESHOLD + 1 }, (_, i) =>
    msg('2026-11-09', { id: `o${i}`, text: `旧话说${i}` }));
  const newMsg = msg('2026-11-10', { id: 'n1', from: 'me', text: '今天的话' });
  const chat = { contactId: 'c1', messages: [...oldMsgs, newMsg] };
  const groups = diaryDayGroups(chat);
  const entry = { text: '九号日记正文', sourceFingerprint: diaryFingerprint(groups.get('2026-11-09')) };
  const state = { contacts: {}, settings: { user: {} }, users: [], diary: { enabled: true, contacts: { c1: { '2026-11-09': entry } } } };

  const replaced = historyTranscript(state, chat, 50);
  assert.match(replaced, /九号日记正文/);
  assert.doesNotMatch(replaced, /旧话说0/);
  assert.match(replaced, /今天的话/);

  const keptOriginal = historyTranscript(state, chat, 50, { diary: false });
  assert.match(keptOriginal, /旧话说0/);
});

test('diaryDayStatuses：跳过、待整理、已整理按原文指纹判定', () => {
  const oldMessages = Array.from({ length: DIARY_SKIP_THRESHOLD + 1 }, (_, i) => msg('2026-11-09', { id: `o${i}`, text: `旧${i}` }));
  const shortMessages = Array.from({ length: DIARY_SKIP_THRESHOLD }, (_, i) => msg('2026-11-10', { id: `s${i}`, text: `短${i}` }));
  const state = { contacts: { c1: { name: '沈砚' } }, settings: { user: { name: '我' } }, users: [], characters: [], diary: { prompt: 'p', contacts: { c1: {} } } };
  const chat = { contactId: 'c1', messages: [...oldMessages, ...shortMessages] };
  assert.equal(diaryDayStatuses(state, chat)[0].status, 'pending');
  assert.equal(diaryDayStatuses(state, chat)[1].status, 'skipped');
  state.diary.contacts.c1['2026-11-09'] = { text: '整理好了', sourceFingerprint: diaryFingerprint(oldMessages) };
  assert.equal(diaryDayStatuses(state, chat)[0].status, 'summarized');
});

test('historyTranscript：旧日期已整理时替换原文，最近一天保持原文', () => {
  const oldMessages = Array.from({ length: DIARY_SKIP_THRESHOLD + 1 }, (_, i) => msg('2026-11-09', { id: `o${i}`, text: `旧日原话${i}` }));
  const latest = msg('2026-11-10', { id: 'new', text: '最近一句' });
  const state = {
    contacts: { c1: { name: '沈砚' } },
    settings: { user: { name: '我' } },
    users: [],
    characters: [],
    diary: {
      enabled: true,
      prompt: '',
      contacts: { c1: { '2026-11-09': { text: '这一天的日记', sourceFingerprint: diaryFingerprint(oldMessages) } } },
    },
  };
  const chat = { contactId: 'c1', messages: [...oldMessages, latest] };
  const text = historyTranscript(state, chat, 30);
  assert.ok(text.includes('[日记 2026-11-09]'));
  assert.ok(text.includes('这一天的日记'));
  assert.ok(!text.includes('旧日原话0'));
  assert.ok(text.includes('最近一句'));

  state.diary.contacts.c1['2026-11-09'].useOriginal = true;
  assert.ok(historyTranscript(state, chat, 30).includes('旧日原话0'));

  state.diary.enabled = false;
  assert.ok(historyTranscript(state, chat, 30).includes('旧日原话0'));
});


