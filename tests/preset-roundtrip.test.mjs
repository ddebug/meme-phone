import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeImportedPreset } from '../meme/apps/presets.js';

const external = {
  id: 'p1',
  name: '测试预设',
  text: '主回复文案要原样保留',
  context: { historyLimit: 12 },
  groups: [{ id: 'g_chat', name: '聊天行为', kind: 'chat' }],
  items: [
    {
      id: 'i1', label: '角色限制', role: 'system', kind: 'chat',
      content: '只说中文，口语化', enabled: true, editable: true, deletable: true,
      group: 'g_chat', order: 1, characters: ['沈砚'],
    },
    {
      id: 'i2', label: '其他软件', role: 'system', kind: 'app', app: 'music',
      content: '别写进聊天', enabled: false, group: 'group_app', order: 2,
    },
  ],
};

test('C3：导入预设保留主文案 text，不被清空', () => {
  const out = normalizeImportedPreset(external, 0, new Set());
  assert.equal(out.text, '主回复文案要原样保留');
  assert.equal(out.name, '测试预设');
});

test('C3：条目的角色/启用/可编辑/其他软件字段往返保留，旧的适用角色字段被丢弃', () => {
  const out = normalizeImportedPreset(external, 0, new Set());
  const me = out.items.find(item => item.id === 'i1');
  assert.equal(me.role, 'system');
  assert.equal(me.enabled, true);
  assert.equal(me.editable, true);
  assert.equal(me.deletable, true);
  assert.equal(me.characters, undefined);
  assert.equal(me.content, '只说中文，口语化');

  const app = out.items.find(item => item.id === 'i2');
  assert.equal(app.kind, 'app');
  assert.equal(app.app, 'music');
  assert.equal(app.enabled, false);
  assert.equal(app.content, '别写进聊天');

  assert.ok(me.order < app.order, '聊天条目排在其他软件条目之前');
});
