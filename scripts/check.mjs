#!/usr/bin/env node
/**
 * meme-phone 轻量自检（npm run check）
 *
 * 只查三件能靠脚本查出来的事：
 *   1. 所有 JS 语法能过（按 module 解析）
 *   2. 扩展清单、入口、打包产物这些必备文件都在，manifest 是合法 JSON
 *   3. preview.html 比 meme/ 下的源码新——不然双击看到的是旧界面
 *
 * 不查样式、不查渲染、不联网，也不替代真机点一遍。
 */

import { readdir, readFile, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['baibai-book', 'ref', '_qa', 'node_modules', '.git', 'docs', 'shots']);

const problems = [];
const notes = [];

async function listFiles(dir, filter) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...await listFiles(path.join(dir, entry.name), filter));
    } else if (filter(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/* 1. 语法：node --check 只认 .mjs，所以借一个临时副本 */
async function checkSyntax(files) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'meme-check-'));
  try {
    for (const file of files) {
      const copy = path.join(tmp, `${path.basename(file, path.extname(file))}-${Math.random().toString(36).slice(2)}.mjs`);
      await writeFile(copy, await readFile(file, 'utf8'));
      try {
        await run(process.execPath, ['--check', copy]);
      } catch (error) {
        const detail = String(error.stderr || error.message || '')
          .split('\n')
          .filter(Boolean)
          .slice(0, 4)
          .join(' / ');
        problems.push(`语法错误：${path.relative(ROOT, file)} → ${detail}`);
      } finally {
        await rm(copy, { force: true });
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/* 2. 必备文件 + manifest */
async function checkFiles() {
  const required = ['manifest.json', 'index.js', 'style.css', 'preview.html', 'meme/index.js', 'meme/shell.js', 'meme/data.js', 'meme/store.js'];
  for (const rel of required) {
    try {
      await stat(path.join(ROOT, rel));
    } catch {
      problems.push(`缺少文件：${rel}`);
    }
  }
  let manifest = null;
  try {
    manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
  } catch (error) {
    problems.push(`manifest.json 读不出来：${error.message}`);
  }
  if (manifest) {
    for (const key of ['display_name', 'js', 'css']) {
      if (!manifest[key]) problems.push(`manifest.json 少了 ${key}`);
    }
    for (const key of ['js', 'css']) {
      if (manifest[key]) {
        try {
          await stat(path.join(ROOT, manifest[key]));
        } catch {
          problems.push(`manifest.json 指向的 ${manifest[key]} 不存在`);
        }
      }
    }
  }
}

/* 3. preview.html 是不是比源码旧：按 preview.stamp.json 里的指纹逐个比对，不依赖 mtime */
async function checkPreviewFresh() {
  const stampPath = path.join(ROOT, 'preview.stamp.json');
  let stamp = null;
  try {
    stamp = JSON.parse(await readFile(stampPath, 'utf8'));
  } catch {
    problems.push('没有 preview.stamp.json（或读不出来），跑一下 python scripts/build_preview.py');
    return;
  }
  const files = stamp?.files && typeof stamp.files === 'object' ? stamp.files : null;
  if (!files) {
    problems.push('preview.stamp.json 格式不对，跑一下 python scripts/build_preview.py 重新生成');
    return;
  }
  const stale = [];
  for (const [rel, digest] of Object.entries(files)) {
    try {
      const now = await readFile(path.join(ROOT, rel));
      const actual = createHash('sha256').update(now).digest('hex');
      if (actual !== digest) stale.push(rel);
    } catch {
      stale.push(`${rel}（文件读不出来）`);
    }
  }
  if (stale.length) {
    problems.push(`preview.html 与源码不一致（${stale.slice(0, 5).join('、')}${stale.length > 5 ? ' 等' : ''}），先跑 python scripts/build_preview.py 再提交`);
  }
}

/* 4. import 路径能不能解析：只走真实入口可达的模块图，未接入的草稿文件不参与 */
async function checkImports() {
  const entry = path.join(ROOT, 'meme', 'index.js');
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    let source = '';
    try {
      source = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const specs = [...source.matchAll(/from\s*['"](\.[^'"]+)['"]/g)].map(match => match[1]);
    for (const spec of specs) {
      const target = path.resolve(path.dirname(file), spec);
      let ok = true;
      try {
        await stat(target);
      } catch {
        ok = false;
        problems.push(`import 路径解析不到：${path.relative(ROOT, file)} → ${spec}`);
      }
      if (ok && target.endsWith('.js') && !seen.has(target)) queue.push(target);
    }
  }
}

async function main() {
  const jsFiles = [
    path.join(ROOT, 'index.js'),
    ...await listFiles(path.join(ROOT, 'meme'), name => name.endsWith('.js')),
    ...await listFiles(path.join(ROOT, 'scripts'), name => name.endsWith('.mjs')),
  ];
  await checkSyntax(jsFiles);
  await checkFiles();
  await checkPreviewFresh();
  await checkImports();

  console.log(`检查了 ${jsFiles.length} 个 JS 文件`);
  for (const note of notes) console.log(`· ${note}`);
  for (const problem of problems) console.log(`✗ ${problem}`);
  if (problems.length) {
    console.log(`\n${problems.length} 处问题`);
    process.exit(1);
  }
  console.log('✓ 语法、必备文件、导入路径、预览一致性都正常');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
