import test from 'node:test';
import assert from 'node:assert/strict';

import { parseBehaviorReply, parseMindLine } from '../meme/behavior.js';
import { serializeMessage } from '../meme/reply-context.js';
import {
  emptyState, normalize, pushMessage, defaultReplyItems, normalizeReplyItems,
  MESSAGE_INNER_MAX, MESSAGE_SUBTEXT_MAX,
} from '../meme/data.js';

test('[心里] / [潜台词] 挂在前一个气泡上，不单独成为一条', () => {
  const text = [
    '[消息]',
    '你今天吃饭了吗',
    '[心里]其实我想问的是昨晚那条消息为什么没回。',
    '[潜台词]我有点在意。',
    '问了也是白问。',
    '[/消息]',
  ].join('\n');
  const bubbles = parseBehaviorReply(text);
  assert.equal(bubbles.length, 2);
  assert.equal(bubbles[0].text, '你今天吃饭了吗');
  assert.match(bubbles[0].inner, /昨晚那条消息/);
  assert.equal(bubbles[0].subtext, '我有点在意。');
  assert.equal(bubbles[1].text, '问了也是白问。');
  assert.equal(bubbles[1].inner, undefined);
});

test('没有 [消息] 包裹时也能识别标注行', () => {
  const bubbles = parseBehaviorReply('在楼下\n[潜台词]我其实等了很久');
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].subtext, '我其实等了很久');
});

test('第一个气泡之前写的 [心里] 也归这一轮，不当成消息', () => {
  const bubbles = parseBehaviorReply('[心里]我在想什么\n你来了');
  assert.equal(bubbles.length, 1);
  assert.equal(bubbles[0].text, '你来了');
  assert.equal(bubbles[0].inner, '我在想什么');
});

test('心理活动一段一条：多处 [心里] 只留一条，挂在段首那个气泡上', () => {
  const text = [
    '[消息]',
    '到家了',
    '[心里]其实今天很累，但不想让她担心。',
    '[潜台词]我没事。',
    '路上买了点吃的',
    '[心里]第二句不该再写一遍。',
    '[/消息]',
  ].join('\n');
  const bubbles = parseBehaviorReply(text);
  assert.equal(bubbles.length, 2);
  assert.match(bubbles[0].inner, /今天很累/);
  assert.equal(bubbles[1].inner, undefined);
  assert.equal(bubbles.filter(item => item.inner).length, 1);
  /* 潜台词仍按气泡走：只挂在它上面那条 */
  assert.equal(bubbles[0].subtext, '我没事。');
  assert.equal(bubbles[1].subtext, undefined);
});

test('标注支持闭合写法，且按上限截断', () => {
  const long = '很'.repeat(400);
  const parsed = parseMindLine(`[心里]${long}[/心里]`);
  assert.equal(parsed.key, 'inner');
  assert.equal(parsed.value.length, MESSAGE_INNER_MAX);
  const sub = parseMindLine(`[潜台词]${long}`);
  assert.equal(sub.key, 'subtext');
  assert.equal(sub.value.length, MESSAGE_SUBTEXT_MAX);
  assert.equal(parseMindLine('[心里]   '), null);
});

test('pushMessage 记住两层含义，normalize 会裁掉超长和空白', () => {
  const state = emptyState();
  state.contacts.c1 = { id: 'c1', name: '沈砚', kind: 'char', signature: '' };
  state.chats.ch1 = { id: 'ch1', contactId: 'c1', messages: [], unread: 0, updatedAt: 0 };
  const entry = pushMessage(state, 'ch1', {
    from: 'them', text: '到楼下了', inner: '风好大', subtext: '我其实想见你',
  });
  assert.equal(entry.inner, '风好大');
  assert.equal(entry.subtext, '我其实想见你');

  const dirty = {
    ...state,
    chats: { ch1: { id: 'ch1', contactId: 'c1', messages: [
      { id: 'm1', from: 'them', text: 'hi', inner: `  ${'心'.repeat(400)}  `, subtext: '   ' },
    ] } },
  };
  const normalized = normalize(JSON.parse(JSON.stringify(dirty)));
  assert.equal(normalized.chats.ch1.messages[0].inner.length, MESSAGE_INNER_MAX);
  assert.equal('subtext' in normalized.chats.ch1.messages[0], false);
});

test('两层含义不进模型上下文，只保留气泡正文', () => {
  const line = serializeMessage({
    from: 'them', kind: 'text', text: '到楼下了', inner: '风好大', subtext: '我其实想见你',
  });
  assert.equal(line, '到楼下了');
  assert.match(serializeMessage({ from: 'them', text: '', kind: 'recalled' }), /^\[撤回\]/);
});

test('默认预设带「心理活动与潜台词」，老预设会被补上且不重复', () => {
  const items = defaultReplyItems();
  const mind = items.find(item => item.id === 'reply_item_mind');
  assert.ok(mind, '默认条目里要有心理活动与潜台词');
  assert.match(mind.content, /\[潜台词\]/);
  assert.equal(mind.deletable, false);

  const legacy = items.filter(item => item.id !== 'reply_item_mind').map(item => ({ ...item }));
  const patched = normalizeReplyItems(legacy, {});
  assert.equal(patched.filter(item => item.id === 'reply_item_mind').length, 1);

  const twice = normalizeReplyItems(patched, {});
  assert.equal(twice.filter(item => item.id === 'reply_item_mind').length, 1);
});
