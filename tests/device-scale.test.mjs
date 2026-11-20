import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDeviceScale, viewportForScale } from '../meme/shell.js';

test('视口充足时整机不放大，缩放封顶 1', () => {
  assert.equal(computeDeviceScale(1200, 900), 1);
});

test('宽度受限时按宽度等比缩小', () => {
  assert.equal(Number(computeDeviceScale(300, 900).toFixed(4)), Number((252 / 390).toFixed(4)));
});

test('高度受限时按高度等比缩小，并有 0.45 下限', () => {
  const tallFit = (600 - 48) / 844;
  assert.equal(Number(computeDeviceScale(1200, 600).toFixed(4)), Number(tallFit.toFixed(4)));
  assert.equal(computeDeviceScale(1200, 200), 0.45);
});

test('视口缺失或为 0 时兜底 1，不缩成看不见', () => {
  assert.equal(computeDeviceScale(0, 0), 1);
  assert.equal(computeDeviceScale(undefined, undefined), 1);
});

test('打字期间保留基准视口，不被键盘压矮后的尺寸带偏', () => {
  const base = { w: 1200, h: 900 };
  const squeezed = { w: 1200, h: 520 };
  assert.deepEqual(viewportForScale(base, squeezed, true), base);
});

test('非聚焦时采纳新视口，响应真实的窗口拖动 / 旋转', () => {
  const base = { w: 1200, h: 900 };
  const next = { w: 800, h: 700 };
  assert.deepEqual(viewportForScale(base, next, false), next);
});

test('基准缺失时回退新视口，不抛空', () => {
  const next = { w: 800, h: 700 };
  assert.deepEqual(viewportForScale(null, next, true), next);
});

test('按基准视口算缩放：键盘压矮时整机不跟着缩小', () => {
  const base = { w: 1200, h: 900 };
  const squeezed = { w: 1200, h: 520 };
  const used = viewportForScale(base, squeezed, true);
  assert.equal(computeDeviceScale(used.w, used.h), 1);
  /* 若错误地采用被压视口，高度方向会把整机缩到 0.55 上下 */
  assert.notEqual(computeDeviceScale(squeezed.w, squeezed.h), 1);
});
