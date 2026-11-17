import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatExport,
  parseChatTransferText,
  mergeChatHistory,
  MEME_CHAT_FORMAT,
  ACSUS_CHAT_FORMAT,
} from '../meme/chat-transfer.js';

const contact = { id: 'char_shen', name: '沈砚' };
const chat = {
  id: 'ch_shen',
  contactId: 'char_shen',
  updatedAt: 130,
  messages: [
    { id: 'm2', from: 'them', text: '第二条', at: 20, kind: 'text' },
    { id: 'm1', from: 'me', text: '第一条', at: 10, kind: 'text', pending: true },
  ],
};

test('meme 导出包含角色、会话和消息，并去掉 pending', () => {
  const pack = createChatExport({ chat, contact });
  assert.equal(pack.format, MEME_CHAT_FORMAT);
  assert.equal(pack.version, 1);
  assert.equal(pack.character.id, 'char_shen');
  assert.equal(pack.character.name, '沈砚');
  assert.equal(pack.character.chatId, 'ch_shen');
  assert.equal(pack.messageCount, 2);
  assert.equal(pack.messages.find(item => item.id === 'm1').pending, undefined);
  assert.equal(pack.messages.find(item => item.id === 'm2').text, '第二条');
});

test('meme 导出包可以原样解析', () => {
  const pack = createChatExport({ chat, contact });
  const parsed = parseChatTransferText(JSON.stringify(pack));
  assert.equal(parsed.source, 'meme');
  assert.equal(parsed.messages.length, 2);
  assert.equal(parsed.messages.find(item => item.id === 'm1').from, 'me');
});

test('合并按 ID 去重并按时间稳定排序', () => {
  const current = [
    { id: 'b', from: 'them', text: 'B', at: 20 },
    { id: 'a', from: 'me', text: 'A', at: 10 },
  ];
  const imported = [
    { id: 'c', from: 'them', text: 'C', at: 30 },
    { id: 'a', from: 'me', text: '重复', at: 10 },
  ];
  const merged = mergeChatHistory(current, imported);
  assert.equal(merged.addedCount, 1);
  assert.equal(merged.skippedCount, 1);
  assert.deepEqual(merged.messages.map(item => item.id), ['a', 'b', 'c']);
});

test('ac sus 文本消息会转成 meme 的 from / at / kind', () => {
  const pack = {
    format: ACSUS_CHAT_FORMAT,
    version: 1,
    exportedAt: '2026-11-17T10:00:00.000Z',
    character: { id: 'char_shen', name: '沈砚', avatar: '' },
    messageCount: 2,
    messages: [
      { id: 'acsus_a', sender: 'user', type: 'text', content: '你好', time: 1763300000 },
      { id: 'acsus_b', sender: 'contact', type: 'text', content: '在的', time: 1763300001 },
    ],
  };
  const parsed = parseChatTransferText(JSON.stringify(pack));
  assert.equal(parsed.source, 'acsus');
  assert.equal(parsed.messages[0].from, 'me');
  assert.equal(parsed.messages[1].from, 'them');
  assert.equal(parsed.messages[0].at, 1763300000000);
  assert.equal(parsed.messages[0].kind, 'text');
});

test('ac sus 表情、图片和引用会被保留或降级成可读文本', () => {
  const pack = {
    format: ACSUS_CHAT_FORMAT,
    version: 1,
    exportedAt: '2026-11-17T10:00:00.000Z',
    character: { id: 'char_shen', name: '沈砚' },
    messageCount: 3,
    messages: [
      { id: 'e1', sender: 'contact', type: 'emoji', content: '笑', emojiName: '笑', time: 1763300000 },
      { id: 'i1', sender: 'contact', type: 'image', content: '[图片]', imageUrl: '/user/files/a.png', time: 1763300001 },
      {
        id: 'q1', sender: 'user', type: 'quote', replyContent: '收到', time: 1763300002,
        quotedMessage: { sender: 'contact', content: '晚安' },
      },
    ],
  };
  const parsed = parseChatTransferText(JSON.stringify(pack));
  assert.equal(parsed.messages[0].kind, 'emoji');
  assert.equal(parsed.messages[0].emoji, '笑');
  assert.equal(parsed.messages[1].kind, 'image');
  assert.equal(parsed.messages[1].image, '/user/files/a.png');
  assert.equal(parsed.messages[2].quote.text, '晚安');
  assert.equal(parsed.messages[2].quote.from, 'them');
});

test('不支持的格式、无效发送者和数量不一致都会被拒绝', () => {
  assert.throws(() => parseChatTransferText(JSON.stringify({ format: 'other', messages: [] })), /不是聊天记录导出文件/);
  assert.throws(() => parseChatTransferText(JSON.stringify({
    format: MEME_CHAT_FORMAT, version: 1, character: contact, messageCount: 1,
    messages: [{ id: 'x', from: 'ghost', text: '', at: 1 }],
  })), /发送者无效/);
  assert.throws(() => parseChatTransferText(JSON.stringify({
    format: MEME_CHAT_FORMAT, version: 1, character: contact, messageCount: 2,
    messages: [{ id: 'x', from: 'me', text: '', at: 1 }],
  })), /messageCount 不一致/);
});
