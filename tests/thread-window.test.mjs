import assert from 'node:assert/strict';
import { test } from 'node:test';
import { THREAD_PAGE, threadWindow } from '../meme/apps/chat.js';

function messages(count) {
  return Array.from({ length: count }, (_, index) => ({ id: `m${index}`, text: `第 ${index} 条` }));
}

test('聊天显示窗口：只渲染最近一页，起始下标指向更早的部分', () => {
  const list = messages(500);
  const { startIndex, visible } = threadWindow(list);
  assert.equal(visible.length, THREAD_PAGE);
  assert.equal(startIndex, 500 - THREAD_PAGE);
  assert.equal(visible[visible.length - 1].id, 'm499');
});

test('聊天显示窗口：消息不足一页时全部渲染，没有加载更早入口', () => {
  const list = messages(12);
  const { startIndex, visible } = threadWindow(list);
  assert.equal(startIndex, 0);
  assert.equal(visible.length, 12);
});

test('聊天显示窗口：往上翻一页后多出更早的消息，最新一条不变', () => {
  const list = messages(500);
  const first = threadWindow(list, THREAD_PAGE);
  const next = threadWindow(list, THREAD_PAGE * 2);
  assert.equal(next.startIndex, 500 - THREAD_PAGE * 2);
  assert.equal(next.visible.length, THREAD_PAGE * 2);
  assert.equal(next.visible[next.visible.length - 1].id, 'm499');
  assert.ok(next.startIndex < first.startIndex);
});
