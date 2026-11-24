import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalize } from '../meme/data.js';
import { settingsApp } from '../meme/apps/settings.js';

test('「默认进入聊天记录聊天」默认是开的，设置页里有这个开关', () => {
  const state = emptyState();
  assert.equal(state.settings.world.autoEnter, true);
  const html = settingsApp.render({ state, shell: { hostInfo: {} }, world: { list: () => [] } });
  assert.match(html, /默认进入聊天记录聊天/);
  assert.match(html, /set-toggle-world-auto/);
  /* 全局日记提示词入口已经去掉，只留聊天里的角色日记 */
  assert.doesNotMatch(html, /日记提示词/);
});

test('点一下开关会关掉并落盘，再点一下打开；normalize 保留用户选择', () => {
  const state = emptyState();
  const toasts = [];
  const ctx = {
    state,
    save: () => true,
    rerender: () => {},
    toast: message => toasts.push(message),
    world: { list: () => [] },
    shell: { hostInfo: {} },
  };

  assert.equal(settingsApp.handle(ctx, 'set-toggle-world-auto', {}), true);
  assert.equal(state.settings.world.autoEnter, false);
  assert.match(toasts.at(-1), /停在桌面/);

  assert.equal(settingsApp.handle(ctx, 'set-toggle-world-auto', {}), true);
  assert.equal(state.settings.world.autoEnter, true);

  const off = normalize({ settings: { world: { autoEnter: false } } });
  assert.equal(off.settings.world.autoEnter, false);
  const fresh = normalize({});
  assert.equal(fresh.settings.world.autoEnter, true);
});
