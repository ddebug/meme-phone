import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createChatExport,
  parseChatTransferText,
  mergeChatHistory,
  mergeDiaryEntries,
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

const diaryEntries = {
  '2026-11-16': {
    date: '2026-11-16', text: '傍晚一起吃了面。', tags: ['日常'], auto: true,
    useOriginal: false, sourceFingerprint: 'src-a', paramsFingerprint: 'param-a',
    fromTime: 1000, toTime: 2000, messageCount: 12, createdAt: 1700, updatedAt: 1701,
  },
  '2026-11-15': {
    date: '2026-11-15', text: '下午聊了很久。', tags: [], auto: false,
    useOriginal: true, sourceFingerprint: 'src-b', paramsFingerprint: '',
    fromTime: null, toTime: null, messageCount: 8, createdAt: 1600, updatedAt: 1602,
  },
};

test('导出把该角色名下的日记一并打包，按日期升序并清洗字段', () => {
  const pack = createChatExport({ chat, contact, diaryEntries });
  assert.equal(pack.diaryCount, 2);
  assert.deepEqual(pack.diary.map(item => item.date), ['2026-11-15', '2026-11-16']);
  const first = pack.diary[0];
  assert.equal(first.text, '下午聊了很久。');
  assert.equal(first.auto, false);
  assert.equal(first.useOriginal, true);
  assert.equal(first.sourceFingerprint, 'src-b');
  assert.equal(first.messageCount, 8);
  assert.equal(first.contactId, '');
});

test('日记随导出包原样解析，并归到导入角色名下', () => {
  const pack = createChatExport({ chat, contact, diaryEntries });
  const parsed = parseChatTransferText(JSON.stringify(pack));
  assert.equal(parsed.diary.length, 2);
  const entry = parsed.diary.find(item => item.date === '2026-11-16');
  assert.equal(entry.contactId, 'char_shen');
  assert.equal(entry.text, '傍晚一起吃了面。');
  assert.deepEqual(entry.tags, ['日常']);
});

test('合并日记按日期去重：已有日期不覆盖，新日期补上并挂到目标角色', () => {
  const current = {
    '2026-11-16': { date: '2026-11-16', text: '旧正文', contactId: 'char_shen' },
  };
  const imported = [
    { date: '2026-11-16', text: '导入正文', contactId: 'old_id' },
    { date: '2026-11-15', text: '新日记', tags: [], auto: true },
  ];
  const merged = mergeDiaryEntries(current, imported, 'char_shen');
  assert.equal(merged.addedCount, 1);
  assert.equal(merged.skippedCount, 1);
  assert.equal(current['2026-11-16'].text, '旧正文');
  assert.equal(current['2026-11-15'].text, '新日记');
  assert.equal(current['2026-11-15'].contactId, 'char_shen');
  assert.equal(current['2026-11-15'].key, '2026-11-15');
});

test('旧导出包没有日记字段时按空日记解析；日记数量不一致或日期非法会被拒绝', () => {
  const legacy = {
    format: MEME_CHAT_FORMAT, version: 1, exportedAt: '2026-11-17T10:00:00.000Z',
    character: contact, messageCount: 1,
    messages: [{ id: 'x', from: 'me', text: '一条', at: 1 }],
  };
  const parsed = parseChatTransferText(JSON.stringify(legacy));
  assert.deepEqual(parsed.diary, []);

  assert.throws(() => parseChatTransferText(JSON.stringify({
    ...legacy, diary: [{ date: '11-15', text: '坏日期' }], diaryCount: 1,
  })), /日记第 1 条日期无效/);

  assert.throws(() => parseChatTransferText(JSON.stringify({
    ...legacy, diary: [{ date: '2026-11-15', text: '一篇' }], diaryCount: 2,
  })), /diaryCount 不一致/);
});
