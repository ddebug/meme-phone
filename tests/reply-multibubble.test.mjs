import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyState, normalize, chatFor, pushMessage, REPLY_INSTRUCTION_ID } from '../meme/data.js';
import { LEGACY_SINGLE_REPLY_FORMAT, LEGACY_NATURAL_REPLY_INSTRUCTION, NATURAL_REPLY_INSTRUCTION, MULTI_BUBBLE_REPLY_FORMAT } from '../meme/preset-defaults.js';
import { buildReplyMessages, replyLead, proactiveLead } from '../meme/reply-context.js';
import { parseBehaviorReply } from '../meme/behavior.js';
import { threadApp, __resetGenerationsForTests } from '../meme/apps/chat.js';

function fixture() {
  const state = emptyState();
  state.contacts.c1 = { id: 'c1', name: '沈砚', kind: 'char' };
  const chat = chatFor(state, 'c1');
  return { state, chat, contact: state.contacts.c1, preset: state.settings.reply.presets[0] };
}

function oldBuiltin() {
  const data = fixture();
  data.preset.items.find(item => item.id === 'reply_item_format').content = LEGACY_SINGLE_REPLY_FORMAT;
  data.preset.items.find(item => item.id === REPLY_INSTRUCTION_ID).content = LEGACY_NATURAL_REPLY_INSTRUCTION;
  return data;
}

function assertMultiBubblePrompt(messages) {
  const text = messages.map(item => item.content).join('\n');
  assert.match(text, /一行一个气泡/);
  assert.ok(text.includes('[消息]') && text.includes('[/消息]'));
  assert.ok(!text.includes(LEGACY_SINGLE_REPLY_FORMAT));
  assert.ok(!text.includes(LEGACY_NATURAL_REPLY_INSTRUCTION));
  assert.doesNotMatch(text, /只说一条消息|主动发一条/);
}

test('多气泡：新建预设及普通回复开头不再互相冲突', async () => {
  const { state, chat, contact } = fixture();
  pushMessage(state, chat.id, { from: 'me', text: '今天怎么样' });
  const result = await buildReplyMessages(state, chat, contact, { memoryText: '', lead: replyLead(contact) });
  assertMultiBubblePrompt(result.messages);
});

test('多气泡：主动开口预览与占位消息也不限制为一条', async () => {
  const { state, chat, contact } = fixture();
  const result = await buildReplyMessages(state, chat, contact, { memoryText: '', proactive: true, lead: proactiveLead(state, contact) });
  assertMultiBubblePrompt(result.messages);
});

test('多气泡：旧内置原样格式/回复指令安全迁移且幂等', () => {
  const { state, preset } = oldBuiltin();
  const oldFormat = preset.items.find(item => item.id === 'reply_item_format');
  oldFormat.enabled = false;
  oldFormat.characters = ['沈砚'];
  const oldOrder = oldFormat.order;
  const rebuilt = normalize(state);
  const items = rebuilt.settings.reply.presets[0].items;
  const format = items.find(item => item.id === 'reply_item_format');
  assert.equal(format.content, MULTI_BUBBLE_REPLY_FORMAT);
  assert.equal(format.enabled, false);
  assert.equal(format.order, oldOrder);
  assert.deepEqual(format.characters, ['沈砚']);
  assert.equal(items.find(item => item.id === REPLY_INSTRUCTION_ID).content, NATURAL_REPLY_INSTRUCTION);
  assert.deepEqual(normalize(rebuilt).settings.reply, rebuilt.settings.reply);
});

test('多气泡：旧text字段中的默认回复指令也会迁移', () => {
  const { state, preset } = oldBuiltin();
  preset.items = preset.items.filter(item => item.id !== REPLY_INSTRUCTION_ID);
  preset.text = LEGACY_NATURAL_REPLY_INSTRUCTION;
  const rebuilt = normalize(state).settings.reply.presets[0];
  assert.equal(rebuilt.text, '');
  assert.equal(rebuilt.items.find(item => item.id === REPLY_INSTRUCTION_ID).content, NATURAL_REPLY_INSTRUCTION);
});

test('多气泡：内置预设中用户改过的文字不被覆盖', () => {
  const { state, preset } = oldBuiltin();
  preset.items.find(item => item.id === 'reply_item_format').content = '我定制的格式：只用一句话';
  preset.items.find(item => item.id === REPLY_INSTRUCTION_ID).content = '保留我的回复风格';
  const items = normalize(state).settings.reply.presets[0].items;
  assert.equal(items.find(item => item.id === 'reply_item_format').content, '我定制的格式：只用一句话');
  assert.equal(items.find(item => item.id === REPLY_INSTRUCTION_ID).content, '保留我的回复风格');
});

test('多气泡：用户自建/复制预设不自动改写', () => {
  const { state, preset } = oldBuiltin();
  preset.id = 'reply_mine';
  state.settings.reply.activeId = preset.id;
  const rebuilt = normalize(state).settings.reply.presets[0];
  assert.equal(rebuilt.items.find(item => item.id === 'reply_item_format').content, LEGACY_SINGLE_REPLY_FORMAT);
  assert.equal(rebuilt.items.find(item => item.id === REPLY_INSTRUCTION_ID).content, LEGACY_NATURAL_REPLY_INSTRUCTION);
});

test('多气泡：参考版角色外层和消息标记正确拆分，不把协议显示为正文', () => {
  const bubbles = parseBehaviorReply('[角色-沈砚]\r\n[消息]\r\n刚忙完\r\n\r\n你吃饭了吗\r\n[/消息]');
  assert.deepEqual(bubbles.map(item => item.text), ['刚忙完', '你吃饭了吗']);
  assert.ok(bubbles.every(item => item.kind === 'text'));
});

test('多气泡：一条自然回应仍允许，旧版未标记段落不强行按标点拆开', () => {
  assert.equal(parseBehaviorReply('[消息]\n嗯，知道啦\n[/消息]').length, 1);
  const paragraph = '第一段\n第二段';
  assert.deepEqual(parseBehaviorReply(paragraph).map(item => item.text), [paragraph]);
  assert.deepEqual(parseBehaviorReply('[不发]'), []);
});

test('多气泡：混合行为保留气泡顺序且继续遵守会话开关', () => {
  const source = '[消息]\n给你买杯奶茶\n[转账]12|奶茶\n[表情]小狗歪头\n[/消息]';
  const open = parseBehaviorReply(source, { allowed: { transfer: true } });
  assert.deepEqual(open.map(item => item.kind), ['text', 'transfer', 'emoji']);
  const closed = parseBehaviorReply(source, { allowed: { transfer: false } });
  assert.deepEqual(closed.map(item => item.kind), ['text', 'text', 'emoji']);
  assert.equal(closed[1].behavior, null);
});

function controllerFixture(t, replyText, inputText = '') {
  const data = fixture();
  const queue = [];
  t.mock.method(globalThis, 'setTimeout', callback => { queue.push(callback); return queue.length; });
  t.mock.method(globalThis, 'fetch', () => { throw new Error('NETWORK_DISABLED'); });
  t.after(() => __resetGenerationsForTests());
  const input = { value: inputText };
  const box = { scrollTop: 0, scrollHeight: 0 };
  let calls = 0;
  const ctx = {
    state: data.state, epoch: () => 1,
    shell: { root: { querySelector: selector => selector === '.mp-compose-box input' ? input : box }, live: {} },
    save: async () => true, rerender() {}, toast() {},
    ai: {
      proactive: async () => { calls++; return replyText; },
      reply: async () => { calls++; return { bubbles: parseBehaviorReply(replyText), text: replyText }; },
    },
  };
  return { ...data, ctx, queue, callCount: () => calls };
}

test('多气泡：主动开口一轮请求落库为两条，属于同一轮且刷新可保留', async t => {
  const { ctx, chat, queue, callCount } = controllerFixture(t, '[消息]\n刚看到一家新店\n周末要不要一起去\n[/消息]');
  threadApp.handle(ctx, 'send', { chat: chat.id });
  queue.shift()();
  await new Promise(setImmediate);
  assert.equal(callCount(), 1);
  assert.deepEqual(chat.messages.map(item => item.text), ['刚看到一家新店', '周末要不要一起去']);
  assert.ok(chat.messages.every(item => item.kind === 'proactive' && item.from === 'them'));
  assert.equal(new Set(chat.messages.map(item => item.turnId)).size, 1);
  assert.ok(chat.messages[0].turnId);
  assert.equal(normalize(ctx.state).chats[chat.id].messages.length, 2);
});

test('多气泡：主动不发占位不会存成聊天正文', async t => {
  const { ctx, chat, queue } = controllerFixture(t, '[不发]');
  threadApp.handle(ctx, 'send', { chat: chat.id });
  queue.shift()();
  await new Promise(setImmediate);
  assert.equal(chat.messages.length, 0);
});

test('多气泡：普通回复一轮请求可落库三条，不依赖三次模型调用', async t => {
  const { ctx, chat, queue, callCount } = controllerFixture(t, '[消息]\n到家了\n路上买了点吃的\n你呢\n[/消息]', '你到家了吗');
  threadApp.handle(ctx, 'send', { chat: chat.id });
  queue.shift()();
  await new Promise(setImmediate);
  assert.equal(callCount(), 1);
  const replies = chat.messages.filter(item => item.from === 'them');
  assert.deepEqual(replies.map(item => item.text), ['到家了', '路上买了点吃的', '你呢']);
  assert.equal(new Set(replies.map(item => item.turnId)).size, 1);
});
