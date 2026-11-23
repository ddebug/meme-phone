import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyState, proactivePromptFor } from '../meme/data.js';
import { DEFAULT_PROACTIVE_PROMPT, PROACTIVE_PROMPT_MAX_LENGTH } from '../meme/preset-defaults.js';
import { settingsApp } from '../meme/apps/settings.js';

// 只使用内存中的假 ctx；不挂宿主、不读存档、不调用生成接口。
function makeCtx(prompt = '') {
  const calls = { saves: 0, clears: 0, renders: 0, sheets: [], toasts: [] };
  const state = emptyState();
  state.settings.proactive.prompt = prompt;
  const ctx = {
    state,
    shell: { hostInfo: {}, sheet: null },
    ai: { clearPreview() { calls.clears += 1; } },
    openSheet(sheet) { this.shell.sheet = sheet; calls.sheets.push(sheet); },
    closeSheet() { this.shell.sheet = null; },
    async save() { calls.saves += 1; return true; },
    rerender() { calls.renders += 1; },
    toast(message) { calls.toasts.push(message); },
  };
  return { ctx, calls };
}

function openEditor(ctx) {
  assert.equal(settingsApp.handle(ctx, 'set-proactive-prompt'), true);
  assert.equal(ctx.shell.sheet.kind, 'form');
  return ctx.shell.sheet;
}

function submitForm(ctx, sheet, prompt) {
  ctx.closeSheet(); // 与 shell 的 sheet-form-ok 一样，先关闭再调用 onForm。
  return sheet.onForm({ prompt });
}

function openReset(ctx) {
  assert.equal(settingsApp.handle(ctx, 'set-proactive-prompt-reset'), true);
  return ctx.shell.sheet;
}

function pick(ctx, sheet, value) {
  ctx.closeSheet();
  return sheet.onPick(value);
}

test('设置有独立主动开口分组；沉默参考只在此组，默认不显示恢复入口', () => {
  const { ctx } = makeCtx();
  const html = settingsApp.render(ctx);
  const groupStart = html.indexOf('<div class="mp-group-label">主动开口</div>');
  const groupEnd = html.indexOf('<div class="mp-group-label">', groupStart + 1);
  const group = html.slice(groupStart, groupEnd);
  assert.ok(groupStart >= 0);
  assert.match(group, /data-act="set-proactive-prompt"/);
  assert.match(group, /mp-set-value">默认</);
  assert.match(group, /主动开口提示词/);
  assert.match(group, /空发送时参考沉默多久/);
  assert.match(group, /data-act="set-idle"/);
  assert.equal((html.match(/data-act="set-idle"/g) || []).length, 1);
  assert.doesNotMatch(html.slice(html.indexOf('高级与帮助')), /data-act="set-idle"/);
  assert.doesNotMatch(html, /data-act="set-proactive-prompt-reset"/);
  assert.match(html, /data-app="presets"/, '回复预设入口保持原样');
});

test('自定义提示词显示自定义与恢复入口，默认全文和空白都视为默认', () => {
  const { ctx } = makeCtx('主动问候');
  const html = settingsApp.render(ctx);
  assert.match(html, /data-act="set-proactive-prompt"[\s\S]*?mp-set-value">自定义</);
  assert.match(html, /data-act="set-proactive-prompt-reset"/);
  for (const prompt of ['', ' \n\t ', DEFAULT_PROACTIVE_PROMPT]) {
    ctx.state.settings.proactive.prompt = prompt;
    assert.doesNotMatch(settingsApp.render(ctx), /data-act="set-proactive-prompt-reset"/);
  }
});

test('编辑复用 form textarea，展示有效默认全文、4000上限和五种变量说明', () => {
  const { ctx, calls } = makeCtx();
  const sheet = openEditor(ctx);
  assert.match(sheet.title, /默认/);
  assert.equal(sheet.fields.length, 1);
  const field = sheet.fields[0];
  assert.equal(field.name, 'prompt');
  assert.equal(field.type, 'textarea');
  assert.equal(field.value, DEFAULT_PROACTIVE_PROMPT);
  assert.equal(field.value, proactivePromptFor(ctx.state));
  assert.equal(field.maxLength, 4000);
  assert.equal(field.maxLength, PROACTIVE_PROMPT_MAX_LENGTH);
  for (const token of ['{{char}}', '{{user}}', '{{当前时间}}', '{{间隔时长}}', '{{沉默阈值}}']) {
    assert.ok(field.hint.includes(token), `${token} 有说明`);
  }
  assert.match(field.hint, /最近一条用户消息距今/);
  assert.match(field.hint, /缺失.*未知/);
  assert.match(field.hint, /沉默阈值仅作参考/);
  assert.match(field.hint, /不会新增定时消息/);
  assert.match(field.hint, /留空保存即恢复默认/);
  assert.equal(calls.saves, 0);
});

test('编辑自定义全文；取消既不修改也不保存、不清预览', () => {
  const original = '按 {{char}} 的语气主动聊近况\n不要替 {{user}} 发言';
  const { ctx, calls } = makeCtx(original);
  const before = structuredClone(ctx.state);
  const sheet = openEditor(ctx);
  assert.match(sheet.title, /自定义/);
  assert.equal(sheet.fields[0].value, original);
  ctx.closeSheet();
  assert.deepEqual(ctx.state, before);
  assert.equal(calls.saves, 0);
  assert.equal(calls.clears, 0);
  assert.deepEqual(calls.toasts, []);
});

test('保存先 trim 并只更新 prompt，不改变回复预设、沉默参考和其它字段', async () => {
  const { ctx, calls } = makeCtx();
  ctx.state.settings.proactive.enabled = false;
  ctx.state.settings.proactive.idleMinutes = 240;
  ctx.state.settings.proactive.dailyCount = 9;
  const before = structuredClone(ctx.state);
  await submitForm(ctx, openEditor(ctx), ' \n自定义 {{char}} → {{user}}\n ');
  const expected = structuredClone(before);
  expected.settings.proactive.prompt = '自定义 {{char}} → {{user}}';
  assert.deepEqual(ctx.state, expected);
  assert.equal(calls.saves, 1);
  assert.equal(calls.clears, 1);
  assert.equal(calls.renders, 1);
  assert.deepEqual(calls.toasts, ['主动开口提示词已保存']);
});

test('保存等待 ctx.save 完成，不能提前提示成功', async () => {
  const { ctx, calls } = makeCtx();
  let resolveSave;
  ctx.save = () => { calls.saves += 1; return new Promise(resolve => { resolveSave = resolve; }); };
  const saving = submitForm(ctx, openEditor(ctx), '等保存结束');
  assert.equal(calls.saves, 1);
  assert.equal(ctx.state.settings.proactive.prompt, '等保存结束');
  assert.equal(calls.clears, 1);
  assert.deepEqual(calls.toasts, []);
  assert.equal(calls.renders, 0);
  resolveSave(true);
  await saving;
  assert.deepEqual(calls.toasts, ['主动开口提示词已保存']);
  assert.equal(calls.renders, 1);
});

test('保存回调使用当前 ctx.state，不改打开编辑器时的旧对象', async () => {
  const { ctx, calls } = makeCtx('旧对象');
  const sheet = openEditor(ctx);
  const oldState = ctx.state;
  ctx.state = emptyState();
  ctx.state.settings.proactive.idleMinutes = 60;
  await submitForm(ctx, sheet, '当前对象');
  assert.equal(oldState.settings.proactive.prompt, '旧对象');
  assert.equal(ctx.state.settings.proactive.prompt, '当前对象');
  assert.equal(ctx.state.settings.proactive.idleMinutes, 60);
  assert.equal(calls.saves, 1);
});

test('保存空白或默认全文都写入空字符串，并重新展示有效默认全文', async () => {
  for (const input of [' \n\t ', DEFAULT_PROACTIVE_PROMPT, ` \n${DEFAULT_PROACTIVE_PROMPT}\n `]) {
    const { ctx, calls } = makeCtx('旧的自定义');
    await submitForm(ctx, openEditor(ctx), input);
    assert.equal(ctx.state.settings.proactive.prompt, '');
    assert.equal(calls.clears, 1);
    assert.equal(calls.saves, 1);
    assert.deepEqual(calls.toasts, ['已使用默认主动开口提示词']);
    assert.equal(openEditor(ctx).fields[0].value, DEFAULT_PROACTIVE_PROMPT);
    assert.doesNotMatch(settingsApp.render(ctx), /data-act="set-proactive-prompt-reset"/);
  }
});

test('即使回调绕过 textarea 上限，保存仍最多4000字', async () => {
  const { ctx } = makeCtx();
  await submitForm(ctx, openEditor(ctx), ` ${'字'.repeat(4005)} `);
  assert.equal(ctx.state.settings.proactive.prompt, '字'.repeat(4000));
});

test('默认内容原样保存仍存默认标记；没有变化不清预览缓存', async () => {
  const { ctx, calls } = makeCtx();
  const sheet = openEditor(ctx);
  await submitForm(ctx, sheet, sheet.fields[0].value);
  assert.equal(ctx.state.settings.proactive.prompt, '');
  assert.equal(calls.saves, 1);
  assert.equal(calls.clears, 0);
});

test('ctx.save 返回非false的旧式成功值也可保存，ai清缓存方法允许缺失', async () => {
  const { ctx, calls } = makeCtx();
  delete ctx.ai;
  ctx.save = async () => { calls.saves += 1; };
  await submitForm(ctx, openEditor(ctx), '新提示词');
  assert.equal(calls.saves, 1);
  assert.deepEqual(calls.toasts, ['主动开口提示词已保存']);
});

test('保存返回false仅保留失败提示，重新打开原始草稿，不能假成功且可重试', async () => {
  const { ctx, calls } = makeCtx('旧提示词');
  ctx.save = async () => { calls.saves += 1; ctx.toast('保存失败'); return false; };
  const draft = ' \n新的 {{char}} 主动开口草稿\n ';
  await submitForm(ctx, openEditor(ctx), draft);
  assert.equal(ctx.state.settings.proactive.prompt, draft.trim(), '内存中的 dirty 内容不回滚');
  assert.equal(calls.saves, 1, '失败不自动重试保存');
  assert.equal(calls.clears, 1);
  assert.equal(calls.renders, 0);
  assert.deepEqual(calls.toasts, ['保存失败']);
  assert.equal(ctx.shell.sheet.fields[0].value, draft, '包括首尾空白的原草稿还在');
  ctx.save = async () => { calls.saves += 1; return true; };
  await submitForm(ctx, ctx.shell.sheet, draft);
  assert.equal(calls.saves, 2);
  assert.deepEqual(calls.toasts, ['保存失败', '主动开口提示词已保存']);
});

test('保存抛错同样保留草稿并报失败，不产生未处理拒绝或成功提示', async () => {
  const { ctx, calls } = makeCtx();
  ctx.save = async () => { calls.saves += 1; throw new Error('保存失败：离线测试'); };
  await submitForm(ctx, openEditor(ctx), '待重试');
  assert.equal(calls.saves, 1);
  assert.deepEqual(calls.toasts, ['保存失败：离线测试']);
  assert.equal(ctx.shell.sheet.fields[0].value, '待重试');
});

test('恢复默认必须确认；取消不会动当前提示词', async () => {
  const { ctx, calls } = makeCtx('保留我的内容');
  const before = structuredClone(ctx.state);
  const sheet = openReset(ctx);
  assert.match(sheet.title, /恢复默认/);
  assert.equal(sheet.items.length, 1);
  assert.match(sheet.items[0].note, /沉默参考和其他设置都不变/);
  assert.deepEqual(ctx.state, before);
  ctx.closeSheet();
  assert.deepEqual(ctx.state, before);
  assert.equal(calls.saves, 0);
  const next = openReset(ctx);
  await pick(ctx, next, 'cancel');
  assert.deepEqual(ctx.state, before);
  assert.equal(calls.saves, 0);
  assert.equal(calls.clears, 0);
});

test('恢复默认只清当前对象的prompt，保存完成才报成功，其它设置完整保留', async () => {
  const { ctx, calls } = makeCtx('打开时的旧提示词');
  const sheet = openReset(ctx);
  const oldState = ctx.state;
  ctx.state = emptyState();
  ctx.state.settings.proactive = { enabled: false, idleMinutes: 60, dailyCount: 7, prompt: '当前自定义' };
  const before = structuredClone(ctx.state);
  let resolveSave;
  ctx.save = () => { calls.saves += 1; return new Promise(resolve => { resolveSave = resolve; }); };
  const saving = pick(ctx, sheet, sheet.items[0].value);
  assert.deepEqual(calls.toasts, []);
  assert.equal(calls.clears, 1);
  assert.equal(calls.saves, 1);
  resolveSave(true);
  await saving;
  before.settings.proactive.prompt = '';
  assert.deepEqual(ctx.state, before);
  assert.equal(oldState.settings.proactive.prompt, '打开时的旧提示词');
  assert.deepEqual(calls.toasts, ['已恢复默认主动开口提示词']);
  assert.doesNotMatch(settingsApp.render(ctx), /data-act="set-proactive-prompt-reset"/);
});

test('恢复默认保存失败不报成功，保留dirty默认内容并重新打开编辑器供重试', async () => {
  const { ctx, calls } = makeCtx('自定义');
  ctx.save = async () => { calls.saves += 1; ctx.toast('保存失败'); return false; };
  const sheet = openReset(ctx);
  await pick(ctx, sheet, sheet.items[0].value);
  assert.equal(ctx.state.settings.proactive.prompt, '');
  assert.equal(calls.saves, 1);
  assert.equal(calls.clears, 1);
  assert.deepEqual(calls.toasts, ['保存失败']);
  assert.equal(ctx.shell.sheet.kind, 'form');
  assert.equal(ctx.shell.sheet.fields[0].value, DEFAULT_PROACTIVE_PROMPT);
});

test('默认状态下即使直接调用恢复动作也不会打开确认或保存', () => {
  const { ctx, calls } = makeCtx();
  assert.equal(settingsApp.handle(ctx, 'set-proactive-prompt-reset'), true);
  assert.equal(ctx.shell.sheet, null);
  assert.equal(calls.saves, 0);
});

test('沉默参考回调也使用当前对象、保留prompt并清预览，不新增定时器', async () => {
  const { ctx, calls } = makeCtx('旧对象');
  const oldState = ctx.state;
  assert.equal(settingsApp.handle(ctx, 'set-idle'), true);
  const sheet = ctx.shell.sheet;
  assert.deepEqual(sheet.items.map(item => item.value), ['30', '60', '120', '240']);
  ctx.state = emptyState();
  ctx.state.settings.proactive.prompt = '当前内容';
  await pick(ctx, sheet, '60');
  assert.equal(oldState.settings.proactive.idleMinutes, 120);
  assert.equal(ctx.state.settings.proactive.idleMinutes, 60);
  assert.equal(ctx.state.settings.proactive.prompt, '当前内容');
  assert.equal(calls.saves, 1);
  assert.equal(calls.clears, 1);
  assert.equal(calls.renders, 1);
  assert.deepEqual(calls.toasts, []);
});
