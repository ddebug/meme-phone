import test from 'node:test';
import assert from 'node:assert/strict';

import {
  demoState, normalize, chatsOf, chatFor, unreadTotal, pushMessage,
  addTheater, theatersOf, theaterById, theaterTitleOf, defaultTheaterTitle,
  theaterMessage, theaterMessagesCount, contactForTavernCharacter,
} from '../meme/data.js';
import { readOpenTavernChat, branchReply, readTavernMemory, __resetHostScriptForTests } from '../meme/host.js';
import { parallelApp } from '../meme/apps/parallel.js';
import { parallelBranchApp } from '../meme/apps/branch.js';

function fakeHost(options = {}) {
  const listeners = new Map();
  const ctx = {
    chat: options.chat || [
      { is_user: false, name: '沈砚', mes: '楼下灯还亮着。', send_date: '2026-11-10T21:40:00.000Z' },
      { is_user: true, name: '颜', mes: '还在改表。', send_date: '2026-11-10T21:44:00.000Z' },
    ],
    characters: [{ name: '沈砚', avatar: 'shen.png', chat: '沈砚 - 2026-11-10@22h10m.jsonl' }],
    characterId: 0,
    name1: '颜',
    name2: '沈砚',
    chatId: 'demo-shen',
    getCurrentChatId: () => 'demo-shen',
    chatCompletionSettings: { preset_settings_openai: '默认预设' },
    eventTypes: { CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', CHAT_CHANGED: 'chat_changed' },
    eventSource: {
      on(name, fn) { listeners.set(name, fn); },
      removeListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
      emit(name, payload) {
        const fn = listeners.get(name);
        if (fn) fn(payload);
        return Promise.resolve();
      },
    },
    generateQuietPrompt: options.generateQuietPrompt || (async (args) => {
      assert.equal(args.quietPrompt, '', '分支生成不塞额外指令，纯靠聊天历史');
      ctx.sentFloors = ctx.chat.map(floor => floor.mes);
      ctx.eventSource.emit('chat_completion_prompt_ready', { chat: [{ role: 'system', content: '预设' }, { role: 'user', content: ctx.chat[ctx.chat.length - 1].mes }] });
      return '那我就在站台上陪你一会儿。';
    }),
    stopGeneration: () => {},
  };
  globalThis.SillyTavern = { getContext: () => ctx };
  __resetHostScriptForTests();
  return ctx;
}

test('平行时空：开一场默认叫「角色 · 分叉 N」，同名文件里往后累加', () => {
  const state = { theaters: {} };
  const file = '沈砚 - 2026-11-10@22h10m.jsonl';
  const first = addTheater(state, { contactId: 'c1', characterName: '沈砚', chatFile: file, forkFloor: 3, base: [{ is_user: false, mes: 'a' }] });
  const second = addTheater(state, { contactId: 'c1', characterName: '沈砚', chatFile: file, base: [] });
  assert.equal(first.title, '沈砚 · 分叉 1');
  assert.equal(first.autoTitle, true);
  assert.equal(second.title, '沈砚 · 分叉 2', '同一个聊天文件里的第二场自动接编号');
  assert.equal(defaultTheaterTitle(state, { characterName: '沈砚', chatFile: file }), '沈砚 · 分叉 3');
  assert.equal(theaterTitleOf({ title: '   ' }), '未命名的一场');

  const renamed = addTheater(state, { characterName: '江迟', chatFile: 'x.jsonl', title: '留下的那条短信' });
  assert.equal(renamed.title, '留下的那条短信');
  assert.equal(renamed.autoTitle, false);
});

test('平行时空：分支不进聊天列表、不算未读、chatFor 仍只认原生会话', () => {
  const state = demoState();
  const native = Object.values(state.chats)[0];
  const beforeChats = chatsOf(state).length;
  const beforeUnread = unreadTotal(state);
  addTheater(state, { contactId: native.contactId, characterName: '沈砚', chatFile: 'f.jsonl', base: [] });
  assert.equal(chatsOf(state).length, beforeChats);
  assert.equal(unreadTotal(state), beforeUnread);
  assert.equal(chatFor(state, native.contactId).id, native.id);
});

test('平行时空：按聊天文件分组与排序，最近改过的排前面', () => {
  const state = { theaters: {} };
  const a = addTheater(state, { characterName: 'A', chatFile: 'a.jsonl', updatedAt: 100 });
  const b = addTheater(state, { characterName: 'A', chatFile: 'a.jsonl', updatedAt: 300 });
  addTheater(state, { characterName: 'B', chatFile: 'b.jsonl', updatedAt: 200 });
  assert.deepEqual(theatersOf(state).map(item => item.id).sort(), [a.id, b.id, Object.values(state.theaters)[2].id].sort());
  assert.equal(theatersOf(state)[0].id, b.id);
  assert.equal(theatersOf(state, { chatFile: 'a.jsonl' }).length, 2);
  assert.equal(theaterById(state, b.id).id, b.id);
  assert.equal(theaterById(state, 'nope'), null);
});

test('平行时空：旧版塞在 chats 里的场景，升级时挪进 theaters 并从聊天列表里消失', () => {
  const next = normalize({
    chats: {
      s1: {
        id: 's1',
        contactId: 'c1',
        parallel: true,
        title: '如果那天没下雨',
        unread: 6,
        messages: [
          { from: 'me', text: '在吗', at: 1700000000000 },
          { from: 'them', text: '在。', at: 1700000080000 },
        ],
      },
    },
  });
  assert.equal(next.chats.s1, undefined, '旧场景不再混在聊天列表里');
  const theater = next.theaters.s1;
  assert.ok(theater, '挪进了 theaters');
  assert.equal(theater.title, '如果那天没下雨');
  assert.equal(theater.legacy, true);
  assert.equal(theater.messages.length, 2);
  assert.equal(theater.messages[0].is_user, true);
  assert.equal(theater.messages[1].mes, '在。');
});

test('平行时空：存档里的快照原样留着 extra（柏宝书的记忆叶子跟着楼层走）', () => {
  const next = normalize({
    theaters: {
      th1: {
        id: 'th1',
        characterName: '沈砚',
        chatFile: 'f.jsonl',
        title: '   ',
        forkFloor: 2,
        base: [
          { is_user: false, name: '沈砚', mes: '灯还亮着。', extra: { bbs_leaf: { id: 7 } } },
          { is_user: true, name: '颜', mes: '改完就睡。' },
        ],
        memory: { engine: 'baibai', text: '昨天便利店。' },
        messages: [{ is_user: false, name: '沈砚', mes: '我等你。', at: 1700000000000 }],
      },
    },
  });
  const theater = next.theaters.th1;
  assert.equal(theater.title, '未命名的一场');
  assert.equal(theater.snapshot, 'inline', '小份 base 仍然内联存着');
  assert.equal(theater.base[0].extra.bbs_leaf.id, 7);
  assert.equal(theater.memory.engine, 'baibai');
  assert.equal(theater.messages[0].at, 1700000000000);
  assert.equal(theaterMessagesCount(theater), 3);
});

test('平行时空：大份内联快照在升级时丢掉，只留分叉点（大聊天不把存档撑爆）', () => {
  const big = Array.from({ length: 900 }, (_, index) => ({
    is_user: index % 2 === 0,
    name: '沈砚',
    mes: `第 ${index} 楼：${'很长的一段。'.repeat(60)}`,
  }));
  const next = normalize({
    theaters: {
      th1: {
        id: 'th1',
        characterName: '沈砚',
        chatFile: 'big.jsonl',
        chatId: 'big-chat',
        forkFloor: 900,
        base: big,
        messages: [{ is_user: true, name: '颜', mes: '我开一条新时间线。' }],
      },
    },
  });
  const theater = next.theaters.th1;
  assert.equal(theater.snapshot, 'live');
  assert.equal(theater.base.length, 0, '不再把几十 MB 楼层留在存档里');
  assert.equal(theater.forkFloor, 900, '分叉点还在，生成时按它现取');
  assert.equal(theater.messages.length, 1);
});

test('平行时空：读当前聊天只回分叉点，不复制楼层', async () => {
  const ctx = fakeHost();
  const chat = await readOpenTavernChat();
  assert.equal(chat.available, true);
  assert.equal(chat.characterName, '沈砚');
  assert.equal(chat.chatFile, '沈砚 - 2026-11-10@22h10m.jsonl');
  assert.equal(chat.presetName, '默认预设');
  assert.equal(chat.chatId, 'demo-shen');
  assert.equal(chat.forkFloor, 2);
  assert.equal(chat.snapshot, 'live');
  assert.equal(chat.base.length, 0, '不复制整份聊天，大聊天也不会卡在开分支这一步');
  assert.equal(chat.memory.engine, '', '没装柏宝书时记忆注入口径为空，按酒馆默认读原文');
});

test('平行时空：生成期间把酒馆聊天临时换成「快照 + 这一场」，结束后原样放回', async () => {
  const ctx = fakeHost();
  const original = ctx.chat.slice();
  const base = [
    { is_user: false, name: '沈砚', mes: '楼下灯还亮着。' },
    { is_user: true, name: '颜', mes: '还在改表。' },
  ];
  const branch = [{ is_user: true, name: '颜', mes: '最后一班了？' }];
  const result = await branchReply({ base, branch, characterName: '沈砚' });

  assert.equal(result.text, '那我就在站台上陪你一会儿。');
  assert.equal(ctx.chat.length, original.length, '生成完把真实聊天放回去');
  assert.equal(ctx.chat[0].mes, original[0].mes);
  assert.equal(result.prompt.length, 2, '抓到了这次真正发出去的提示词');
});

test('平行时空：live 分叉点按 chatId + 楼层数从酒馆现取前 N 层', async () => {
  const ctx = fakeHost();
  const result = await branchReply({
    chatId: 'demo-shen',
    forkFloor: 1,
    branch: [{ is_user: true, name: '颜', mes: '最后一班了？' }],
    characterName: '沈砚',
  });
  assert.deepEqual(ctx.sentFloors, ['楼下灯还亮着。', '最后一班了？'], '只取分叉点之前的楼层，加上这一场新说的');
  assert.equal(ctx.chat.length, 2, '生成完把真实聊天放回去');
  assert.equal(ctx.chat[1].mes, '还在改表。');
  assert.equal(result.text, '那我就在站台上陪你一会儿。');
});

test('平行时空：换了聊天文件就不拿别的聊天凑数', async () => {
  const ctx = fakeHost();
  await assert.rejects(
    () => branchReply({ chatId: 'other-chat', forkFloor: 1, branch: [{ is_user: true, mes: '在吗' }] }),
    /另一个聊天文件/,
  );
  assert.equal(ctx.chat[1].mes, '还在改表。');
  await assert.rejects(
    () => branchReply({ chatId: 'demo-shen', forkFloor: 99, branch: [{ is_user: true, mes: '在吗' }] }),
    /对不上/,
  );
});

test('平行时空：几万楼的长聊天换 chat 也不会撑爆调用栈', async () => {
  const floors = Array.from({ length: 70000 }, (_, index) => ({
    is_user: index % 2 === 0, name: '沈砚', mes: `第 ${index} 楼`,
  }));
  const ctx = fakeHost({ chat: floors });
  const result = await branchReply({
    chatId: 'demo-shen',
    forkFloor: floors.length,
    branch: [{ is_user: true, name: '颜', mes: '再分一条线。' }],
    characterName: '沈砚',
  });
  assert.equal(ctx.sentFloors.length, 70001, '生成时临时装进分叉点 + 这一场');
  assert.equal(ctx.chat.length, floors.length, '结束后恢复原样');
  assert.equal(result.text, '那我就在站台上陪你一会儿。');
});

test('平行时空：生成失败也把酒馆聊天放回去，并且没有可用的生成接口时直接报错', async () => {
  const ctx = fakeHost({
    generateQuietPrompt: async () => { throw new Error('接口 502'); },
  });
  const original = ctx.chat.slice();
  await assert.rejects(
    () => branchReply({ base: [{ mes: 'a' }], branch: [{ mes: 'b' }] }),
    /502/,
  );
  assert.equal(ctx.chat.length, original.length);
  assert.equal(ctx.chat[0].mes, original[0].mes);

  globalThis.SillyTavern = { getContext: () => ({ chat: [] }) };
  __resetHostScriptForTests();
  await assert.rejects(() => branchReply({ base: [{ mes: 'a' }] }), /不可用/);
});

test('平行时空：有柏宝书就读它注入口径的总结当背景', () => {
  globalThis.STBaiBaiBook = {
    apiVersion: 1,
    getInjectedHistory: () => ({ relativeText: '昨天他在楼下等到十一点。', coverage: { complete: true, missingAiFloors: [] } }),
  };
  const memory = readTavernMemory();
  assert.equal(memory.engine, 'baibai');
  assert.equal(memory.text, '昨天他在楼下等到十一点。');
  globalThis.STBaiBaiBook = { apiVersion: 1, getInjectedHistory: () => { throw new Error('没打开聊天'); } };
  assert.deepEqual(readTavernMemory(), { engine: '', text: '', coverage: null });
  delete globalThis.STBaiBaiBook;
});

test('平行时空：酒馆角色按头像文件名认领联系人', () => {
  const state = demoState();
  const known = Object.values(state.contacts).find(contact => contact.name === '沈砚');
  assert.ok(known, '演示数据里有沈砚');
  const id = contactForTavernCharacter(state, { name: '沈砚', tavernAvatar: 'shen.png' });
  assert.equal(id, known.id);
  assert.equal(known.tavernAvatar, 'shen.png', '认领时把头像文件名补上');
  assert.equal(contactForTavernCharacter(state, { name: '沈砚', tavernAvatar: 'shen.png' }), id, '不会重复建联系人');
  const fresh = contactForTavernCharacter(state, { name: '新角色', tavernAvatar: 'new.png' });
  assert.ok(state.contacts[fresh]);
  assert.equal(state.contacts[fresh].tavernAvatar, 'new.png');
});

test('平行时空：几十 MB 的大聊天开一场后，存档里只多出一条小记录', async () => {
  const bigLine = '很长的一段聊天内容。'.repeat(140);
  const chat = Array.from({ length: 3000 }, (_, index) => ({
    is_user: index % 2 === 0,
    name: index % 2 === 0 ? '沈砚' : '颜',
    mes: `${index}｜${bigLine}`,
  }));
  const ctx = fakeHost({ chat });
  const host = await readOpenTavernChat();
  assert.equal(host.forkFloor, 3000, '只数楼层，不抄内容');

  const state = demoState();
  const theater = addTheater(state, {
    characterName: host.characterName,
    characterAvatar: host.characterAvatar,
    chatFile: host.chatFile,
    chatId: host.chatId,
    presetName: host.presetName,
    forkFloor: host.forkFloor,
    snapshot: host.snapshot,
    base: host.base,
    memory: host.memory,
  });
  assert.equal(theater.snapshot, 'live');
  assert.equal(theater.base.length, 0);
  const saved = JSON.stringify(theater);
  assert.ok(saved.length < 5000, `一场分支落盘只有 ${saved.length} 字符，不随聊天体积膨胀`);
  assert.ok(ctx.chat.length === 3000, '真实聊天没被动过');
});

test('平行时空：分支页的发送键只有发送/停止两态，不吃「唤醒」态', () => {
  const state = demoState();
  const ctx = {
    state,
    shell: { live: { inputValue: '' }, root: { querySelector: () => null } },
    save() {}, rerender() {}, toast() {}, go() {}, openSheet() {},
  };
  const theater = theatersOf(state)[0];
  const html = parallelBranchApp.render(ctx, { theaterId: theater.id });
  const send = html.match(/<button class="mp-send[^>]*>/)[0];
  assert.match(send, /is-text/, '空输入时仍是发送态');
  assert.doesNotMatch(send, /is-wake/, '分支页没有唤醒态');
  assert.match(send, /data-plain="1"/);
  assert.match(send, /data-act="branch-send"/);
});

test('平行时空：长按菜单三项，看背景能打开这一场的快照面板', () => {
  const state = demoState();
  const sheets = [];
  const ctx = {
    state,
    shell: { live: { inputValue: '' }, root: { querySelector: () => null } },
    save() {}, rerender() {}, toast() {}, go() {},
    openSheet(sheet) { sheets.push(sheet); },
  };
  const theater = theatersOf(state)[0];
  assert.equal(parallelApp.handle(ctx, 'branch-menu', { theater: theater.id }), true);
  assert.deepEqual(sheets[0].items.map(item => item.label), ['改名', '看背景', '删掉这一场']);
  sheets[0].onPick('context');
  const panel = sheets[1];
  assert.equal(panel.title, '这一场的背景');
  const html = panel.render();
  assert.match(html, /第 3 楼/, '说清接在哪个聊天文件的第几楼');
  assert.match(html, /快照 3 层/);
  assert.match(html, /重新开一场/, '提示酒馆后来继续聊的不会自动进来');
});
test('平行时空：分支消息存成酒馆形状，也带上展示用的时间', () => {
  const message = theaterMessage({ isUser: true, name: '颜', text: '晚安', at: 1700000000000 });
  assert.equal(message.is_user, true);
  assert.equal(message.mes, '晚安');
  assert.equal(message.at, 1700000000000);
  assert.match(message.send_date, /^2023-11-1\dT/);
  const stato = demoState();
  const theater = theatersOf(stato)[0];
  assert.ok(theater.messages.length, '演示数据里有一场已经说过话的分支');
  pushMessage(stato, Object.values(stato.chats)[0].id, { from: 'me', text: '原生聊天照常' });
});
