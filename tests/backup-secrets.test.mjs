import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState, stripSecrets } from '../meme/data.js';

function seededState() {
  const state = emptyState();
  state.settings.api.presets[0].key = 'sk-chat-secret';
  state.settings.api.presets[0].model = 'chat-model';
  state.settings.image.custom.key = 'img-secret';
  state.settings.image.custom.model = 'img-model';
  state.contacts.c1 = { id: 'c1', name: '沈砚', kind: 'char', signature: '' };
  return state;
}

test('备份脱敏：默认导出清空接口 Key，保留模型/地址/联系人等非凭据内容', () => {
  const stripped = stripSecrets(seededState());
  assert.equal(stripped.settings.api.presets[0].key, '');
  assert.equal(stripped.settings.image.custom.key, '');
  assert.equal(stripped.settings.api.presets[0].model, 'chat-model');
  assert.equal(stripped.settings.image.custom.model, 'img-model');
  assert.equal(stripped.contacts.c1.name, '沈砚');
});

test('备份脱敏：不改动原始状态，需要显式包含 Key 时才保留凭据', () => {
  const state = seededState();
  stripSecrets(state);
  assert.equal(state.settings.api.presets[0].key, 'sk-chat-secret');
  assert.equal(state.settings.image.custom.key, 'img-secret');
});
