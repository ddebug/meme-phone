import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insetBox, isMobileViewport, deviceLayout } from '../meme/shell.js';

/* 安全区只做「往里收」：预览页/桌面 insets 全 0 时结果必须和以前逐项相同，
   否则所有既有视口基线都会被这条新逻辑带偏。 */

test('insets 全 0 时可视区矩形原样返回', () => {
  const box = { top: 0, left: 0, w: 390, h: 844 };
  assert.deepEqual(insetBox(box, { top: 0, right: 0, bottom: 0, left: 0 }), box);
});

test('insets 缺省按 0，空对象等价于零安全区', () => {
  assert.deepEqual(insetBox({ top: 0, left: 0, w: 390, h: 844 }, {}), { top: 0, left: 0, w: 390, h: 844 });
  assert.deepEqual(insetBox({ top: 0, left: 0, w: 390, h: 844 }, null), { top: 0, left: 0, w: 390, h: 844 });
});

test('竖屏 iPhone：顶部状态栏与底部 Home 条一起收进去', () => {
  const out = insetBox({ top: 0, left: 0, w: 390, h: 844 }, { top: 47, bottom: 34 });
  assert.deepEqual(out, { top: 47, left: 0, w: 390, h: 844 - 47 - 34 });
});

test('横屏：左右安全区同时收进去，宽高都不为负', () => {
  const out = insetBox({ top: 0, left: 0, w: 844, h: 390 }, { left: 47, right: 47, bottom: 21 });
  assert.deepEqual(out, { top: 0, left: 47, w: 844 - 94, h: 390 - 21 });
});

test('安全区比可视区还大时收成 0，不出负数', () => {
  const out = insetBox({ top: 0, left: 0, w: 100, h: 60 }, { top: 200, bottom: 200 });
  assert.equal(out.h, 0);
  assert.equal(out.w, 100);
});

test('键盘弹起后的可视区同样收安全区：高度继续单调缩短', () => {
  const base = insetBox({ top: 0, left: 0, w: 390, h: 844 }, { top: 47, bottom: 34 });
  const squeezed = insetBox({ top: 0, left: 0, w: 390, h: 508 }, { top: 47, bottom: 34 });
  assert.ok(squeezed.h < base.h);
  assert.equal(squeezed.w, base.w);
});

test('收完安全区仍按手机竖屏口径走：宽度定缩放、高度给键盘', () => {
  const insets = { top: 47, bottom: 34 };
  const box = insetBox({ top: 0, left: 0, w: 390, h: 844 }, insets);
  assert.equal(isMobileViewport(box.w, box.h), true);
  const layout = deviceLayout(box.w, box.h, box.h, true);
  const squeezed = deviceLayout(box.w, box.h, box.h - 336, true);
  assert.equal(squeezed.scale, layout.scale);
  assert.ok(squeezed.height < layout.height);
});
