import assert from 'node:assert/strict';
import { test } from 'node:test';
import { memoryPresetTitle, memoryModeLabel, memoryEffectiveSummary } from '../meme/memory.js';

test('有自定义方案名时原样保留', () => {
  assert.equal(memoryPresetTitle({ name: '我的方案', mode: 'auto' }), '我的方案');
});

test('旧存档占位名「默认」按读法兜底成只用总结', () => {
  assert.equal(memoryPresetTitle({ name: '默认', mode: 'summary' }), '只用总结');
});

test('旧存档占位名「自动」按读法兜底成只看原文', () => {
  assert.equal(memoryPresetTitle({ name: '自动', mode: 'recent' }), '只看原文');
});

test('无名且未指定读法时兜底总结优先', () => {
  assert.equal(memoryPresetTitle({ mode: 'auto' }), '总结优先');
  assert.equal(memoryPresetTitle(null), '总结优先');
});

test('memoryModeLabel 未知模式兜底总结优先', () => {
  assert.equal(memoryModeLabel('bogus'), '总结优先');
  assert.equal(memoryModeLabel('recent'), '只看原文');
});

test('实际生效摘要按手机读法和方案模式计算', () => {
  const state = { settings: { memory: { readMode: 'summary', byContact: {} } } };
  assert.equal(
    memoryEffectiveSummary(state, 'c1', { mode: 'auto', floors: 10 }),
    '有总结看总结，没有就看最近 10 层原文',
  );
  assert.equal(
    memoryEffectiveSummary({ settings: { memory: { readMode: 'recent' } } }, 'c1', { mode: 'auto', floors: 12 }),
    '只看最近 12 层原文',
  );
});

test('角色单独切过读法时，实际生效摘要优先用角色设置', () => {
  const state = { settings: { memory: { readMode: 'summary', byContact: { c1: 'recent' } } } };
  assert.equal(
    memoryEffectiveSummary(state, 'c1', { mode: 'summary', floors: 5, skipFirstFloor: true }),
    '只看最近 5 层原文 · 首楼用原文',
  );
});
