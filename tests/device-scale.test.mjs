import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeDeviceScale } from '../meme/shell.js';

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
