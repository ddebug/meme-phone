import test from 'node:test';
import assert from 'node:assert/strict';

import { canStartHomeSwipe, isHomeSwipeHit } from '../meme/shell.js';

test('上滑回桌面：只在手机底部一小段起手（触摸 64px / 鼠标 96px）', () => {
  assert.equal(canStartHomeSwipe({ pointerType: 'touch', screenHeight: 844, fromBottom: 820 }), true, '底部 24px 处可以起手');
  assert.equal(canStartHomeSwipe({ pointerType: 'touch', screenHeight: 844, fromBottom: 760 }), false, '过了 64px 就不算');
  assert.equal(canStartHomeSwipe({ pointerType: 'mouse', screenHeight: 844, fromBottom: 800 }), true);
  assert.equal(canStartHomeSwipe({ pointerType: 'mouse', screenHeight: 844, fromBottom: 740 }), false, '鼠标要更贴底');
  assert.equal(canStartHomeSwipe({ screenHeight: 0, fromBottom: 0 }), false, '没量到屏幕高度时不武装');
});

test('上滑回桌面：起点在滚动列表/输入区时从不接管（滚聊天不会退出）', () => {
  assert.equal(canStartHomeSwipe({ pointerType: 'touch', screenHeight: 844, fromBottom: 820, onScrollable: true }), false, '消息列表里上滑是滚动');
  assert.equal(canStartHomeSwipe({ pointerType: 'mouse', screenHeight: 844, fromBottom: 830, onScrollable: true }), false);
});

test('上滑回桌面：要够快、向上、不歪', () => {
  assert.equal(isHomeSwipeHit({ pointerType: 'mouse', dx: 12, dy: -70, dt: 240 }), true);
  assert.equal(isHomeSwipeHit({ pointerType: 'mouse', dx: 12, dy: -50, dt: 240 }), false, '滑得不够多');
  assert.equal(isHomeSwipeHit({ pointerType: 'mouse', dx: 120, dy: -80, dt: 240 }), false, '横向歪太多');
  assert.equal(isHomeSwipeHit({ pointerType: 'mouse', dx: 0, dy: -80, dt: 900 }), false, '拖太久算慢滑');
  assert.equal(isHomeSwipeHit({ pointerType: 'touch', dx: 0, dy: -95, dt: 300 }), true);
  assert.equal(isHomeSwipeHit({ pointerType: 'touch', dx: 0, dy: -80, dt: 300 }), false, '触摸要滑得更长');
});
