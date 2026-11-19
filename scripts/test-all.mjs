#!/usr/bin/env node
/**
 * 一条命令跑完全部离线质量检查（npm test）
 *
 *   1. npm run check          语法 / 必备文件 / 预览产物是否最新
 *   2. node --test tests/…    单元与回归测试
 *   3. scripts/test-context   上下文组装的自检脚本
 *
 * 任何一步失败都整体失败——预览过期、测试失败不许被“其它都正常”盖掉。
 */

import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;

/* 显式列出测试文件，不依赖 shell 展开通配符 */
const testDir = path.join(ROOT, 'tests');
const testFiles = (await readdir(testDir))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => path.join('tests', name));

const steps = [
  { name: '自检（语法 / 必备文件 / 预览一致性）', cmd: NODE, args: ['scripts/check.mjs'] },
  { name: '单元与回归测试', cmd: NODE, args: ['--test', ...testFiles] },
  { name: '上下文组装自检', cmd: NODE, args: ['scripts/test-context.mjs'] },
];

function runStep(step) {
  return new Promise(resolve => {
    const child = spawn(step.cmd, step.args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => resolve({ ok: false, output: `${output}\n${error.message}` }));
    child.on('close', code => resolve({ ok: code === 0, output }));
  });
}

const failures = [];
for (const step of steps) {
  process.stdout.write(`\n=== ${step.name} ===\n`);
  const result = await runStep(step);
  const tail = result.output.trim().split('\n').slice(-14).join('\n');
  process.stdout.write(`${tail}\n`);
  process.stdout.write(result.ok ? '✓ 通过\n' : '✗ 失败\n');
  if (!result.ok) failures.push(step.name);
}

process.stdout.write('\n');
if (failures.length) {
  process.stdout.write(`整体失败：${failures.join('、')}\n`);
  process.exit(1);
}
process.stdout.write('整体通过：语法、必备文件、预览一致性、单元测试、上下文自检都正常。\n');
