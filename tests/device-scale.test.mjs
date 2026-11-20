import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDeviceScale, viewportForScale, isMobileViewport, deviceLayout } from '../meme/shell.js';

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

test('手机竖屏（窄且竖着）走窄屏规则，宽屏与横屏仍走桌面等比缩放', () => {
  for (const [w, h] of [[360, 640], [375, 667], [390, 844], [393, 852], [430, 932], [768, 900]]) {
    assert.equal(isMobileViewport(w, h), true, `${w}x${h} 应判为手机竖屏`);
  }
  for (const [w, h] of [[769, 900], [1024, 768], [1280, 900], [1440, 900], [844, 390]]) {
    assert.equal(isMobileViewport(w, h), false, `${w}x${h} 应判为非手机竖屏`);
  }
});

test('视口缺失或非法时不算手机竖屏，回退桌面缩放口径', () => {
  assert.equal(isMobileViewport(0, 844), false);
  assert.equal(isMobileViewport(390, 0), false);
  assert.equal(isMobileViewport(NaN, 844), false);
  assert.equal(isMobileViewport(undefined, undefined), false);
  assert.equal(isMobileViewport(null, null), false);
});

test('手机竖屏：缩放只由宽度决定，键盘弹起前后宽度完全不变', () => {
  const before = deviceLayout(390, 844, 844, true);
  const afterKeyboard = deviceLayout(390, 844, 508, true);
  assert.equal(afterKeyboard.scale, before.scale, '键盘弹起不应改变缩放');
  assert.equal(before.height, 844, '没有键盘时整机保持原始高度');
  assert.ok(afterKeyboard.height < 844, '键盘弹起后整机高度应缩短');
});

test('手机竖屏：打键盘后整机外框仍落在剩余可视区内，不会顶到键盘', () => {
  const avail = 508;
  const layout = deviceLayout(390, 844, avail, true);
  const visualHeight = (layout.height + 20) * layout.scale;
  assert.ok(visualHeight <= avail - 16 + 0.01, `整机视觉高 ${visualHeight} 应不超过 ${avail - 16}`);
});

test('手机竖屏：宽度放得下整个外壳，不横向溢出屏幕', () => {
  for (const w of [320, 360, 375, 390, 393, 430]) {
    const layout = deviceLayout(w, 900, 900, true);
    const visualWidth = (390 + 20) * layout.scale;
    assert.ok(visualWidth <= w + 0.01, `${w} 宽视口下整机视觉宽 ${visualWidth} 不应溢出`);
  }
});

test('桌面仍按宽高双项等比缩放，高度保持 844 不受键盘影响', () => {
  const wide = deviceLayout(1280, 900, 900, false);
  assert.equal(wide.scale, 1);
  assert.equal(wide.height, 844);
  const shortWin = deviceLayout(1280, 700, 700, false);
  assert.equal(Number(shortWin.scale.toFixed(4)), Number(((700 - 48) / 844).toFixed(4)));
  assert.equal(shortWin.height, 844);
});
