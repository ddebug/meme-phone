import test from 'node:test';
import assert from 'node:assert/strict';

import {
  demoState, normalize, addParallelChat, parallelChatsOf, chatsOf, chatFor, unreadTotal,
  originChatFor, isParallelChat, parallelTitleOf, pushMessage,
} from '../meme/data.js';
import { parallelBackground, buildReplyMessages } from '../meme/reply-context.js';

function nativeChatOf(state) {
  const chat = Object.values(state.chats).find(item => !item.parallel && item.messages?.length);
  assert.ok(chat, '演示数据里应该有一场原生聊天');
  return chat;
}

test('平行时空：可以给同一个角色开多场，但不进聊天列表、不算未读', () => {
  const state = demoState();
  const native = nativeChatOf(state);
  const before = chatsOf(state).length;
  const beforeScenes = parallelChatsOf(state).length;
  const beforeOwn = parallelChatsOf(state).filter(item => item.contactId === native.contactId).length;

  const first = addParallelChat(state, native.contactId, { title: '如果那天没下雨', scene: '从车站的雨里接下去。' });
  const second = addParallelChat(state, native.contactId, { title: '留下的那条短信' });
  second.updatedAt = Math.max(Date.now(), ...parallelChatsOf(state).map(item => item.updatedAt || 0)) + 1000;

  assert.equal(isParallelChat(first), true);
  assert.equal(first.title, '如果那天没下雨');
  assert.equal(first.muted, true);
  assert.equal(first.unread, 0);
  assert.equal(chatsOf(state).length, before, '场景不占聊天列表');
  assert.equal(parallelChatsOf(state).length, beforeScenes + 2);
  assert.equal(parallelChatsOf(state)[0].id, second.id, '最近改过的一场排在前面');
  assert.ok(parallelChatsOf(state).find(item => item.id === first.id), '同一个角色的两场都在');
  assert.equal(parallelChatsOf(state).filter(item => item.contactId === native.contactId).length, beforeOwn + 2, '一个角色可以开多场');
  assert.equal(chatFor(state, native.contactId).id, native.id, 'chatFor 仍然只认原生会话');

  const totalBefore = unreadTotal(state);
  pushMessage(state, first.id, { from: 'them', text: '这句只留在剧场里' });
  assert.equal(first.messages.length, 1);
  assert.equal(first.unread, 1, '会话自己的未读照常记');
  assert.equal(unreadTotal(state), totalBefore, '剧场不叠加到聊天角标');
});

test('平行时空：预设 / 接口 / 记忆跟着这个角色的原生聊天抄一份', () => {
  const state = demoState();
  const native = nativeChatOf(state);
  native.llmPresetId = 'api_local';
  native.memoryPresetId = 'mem_summary';
  native.replyPresetId = 'reply_natural';
  native.history = { phoneLimit: 40, tavernMode: 'recent', tavernFloors: 6 };

  const scene = addParallelChat(state, native.contactId, { title: '照原本那套来' });
  assert.equal(scene.llmPresetId, 'api_local');
  assert.equal(scene.memoryPresetId, 'mem_summary');
  assert.equal(scene.replyPresetId, 'reply_natural');
  assert.deepEqual(scene.history, { phoneLimit: 40, tavernMode: 'recent', tavernFloors: 6 });
  assert.equal(native.messages.length > 0, true, '原生聊天本身不动');
});

test('平行时空：标题为空时有兜底名字，删掉角色只影响原生清理', () => {
  const state = demoState();
  const native = nativeChatOf(state);
  const scene = addParallelChat(state, native.contactId, { title: '   ' });
  assert.equal(parallelTitleOf(scene), '未命名的一场');
  assert.equal(scene.messages.length, 0);
});

test('平行时空：旧存档 normalize 补名字，并把未读 / 免打扰口径固定住', () => {
  const next = normalize({
    chats: {
      s1: {
        id: 's1',
        contactId: 'c1',
        parallel: true,
        title: '   ',
        scene: '这一场从深夜的便利店开始。',
        unread: 6,
        muted: false,
        pinned: true,
        messages: [{ from: 'me', text: '在吗', at: 1700000000000 }],
      },
    },
  });
  const scene = next.chats.s1;
  assert.equal(scene.parallel, true);
  assert.equal(scene.title, '未命名的一场');
  assert.equal(scene.scene, '这一场从深夜的便利店开始。');
  assert.equal(scene.unread, 0);
  assert.equal(scene.muted, true);
  assert.equal(scene.pinned, false);
  assert.equal(scene.messages.length, 1);
  assert.equal(scene.messages[0].id, 's1_m0');
});

test('平行时空：背景带上这一场的设定和原生聊天最近几条，并明确不复述', () => {
  const state = demoState();
  const native = nativeChatOf(state);
  const scene = addParallelChat(state, native.contactId, {
    title: '没有寄出的那封信',
    scene: '从他把信塞回抽屉那一刻开始。',
  });
  const contact = state.contacts[native.contactId];
  const text = parallelBackground(state, scene, contact);

  assert.match(text, /【平行时空 · 没有寄出的那封信】/);
  assert.match(text, /这一场的设定：从他把信塞回抽屉那一刻开始。/);
  assert.match(text, /原生聊天/);
  assert.match(text, /不要提到“小剧场”“平行时空”“另一个时刻”|不要提到“小剧场”“平行时空”“另一个时空”/);
  const last = native.messages[native.messages.length - 1];
  assert.ok(text.includes(String(last.text || '').trim()), '原生聊天最近几条要能当背景看到');
  assert.equal(parallelBackground(state, native, contact), '', '原生聊天本身不生成这段背景');
});

test('平行时空：走同一套组装，但原生聊天的原文只当背景，不当成本场历史', async () => {
  const state = demoState();
  const native = nativeChatOf(state);
  const contact = state.contacts[native.contactId];
  const scene = addParallelChat(state, native.contactId, { title: '如果那天没下雨', scene: '从站台开始。' });
  pushMessage(state, scene.id, { from: 'me', text: '剧场里的第一句', at: 1800000000000 });

  const built = await buildReplyMessages(state, scene, contact, {
    extraPrompt: parallelBackground(state, scene, contact),
    memoryText: '',
  });
  const contents = built.messages.map(message => String(message.content || '')).join('\n');
  assert.match(contents, /剧场里的第一句/, '本场最后一条要作为这一轮输入');
  assert.match(contents, /【平行时空 · 如果那天没下雨】/);
  const theater = built.messages.filter(message => message.group === 'theater');
  assert.equal(theater.length, 1);
  assert.equal(theater[0].source, '小剧场');
  assert.equal(originChatFor(state, native.contactId).id, native.id);
});
