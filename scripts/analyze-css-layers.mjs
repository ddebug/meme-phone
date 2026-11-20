#!/usr/bin/env node
/**
 * CSS 跨层归位安全判定（只读）。
 *
 * 目的：找出散落在非 themes 段里的 data-mp-theme / data-mp-skin 覆盖，
 * 判断"移到最近的 themes 段末尾"会不会改变层叠结果，输出 可移动 / 保留 清单。
 *
 * 判据（保守）：
 *   把选择器里的主题/皮肤属性与 .mp-root 前缀去掉得到"归一化键"。
 *   若目标位置之后存在同键规则，移动后两条规则的先后会反转；
 *   两者特异性相同就谁在后谁赢，结果会变 → 保留。
 *   没有同键规则的才允许移动（移动只改变位置，不改变覆盖关系）。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_DIR = path.join(ROOT, 'meme', 'css');
const THEME_RE = /data-mp-(?:theme|skin)\s*=/;

const order = JSON.parse(await readFile(path.join(CSS_DIR, 'order.json'), 'utf8')).files;

/** 顶层规则切分：@media/@keyframes 整块算一条，普通规则到匹配的 } 为止。 */
function parseRules(text) {
  const rules = [];
  let index = 0;
  let line = 1;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) {
      if (text[index] === '\n') line += 1;
      index += 1;
    }
    if (index >= text.length) break;
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      const chunk = text.slice(index, end === -1 ? text.length : end + 2);
      line += (chunk.match(/\n/g) || []).length;
      index += chunk.length;
      continue;
    }
    const braceAt = text.indexOf('{', index);
    if (braceAt === -1) break;
    const selector = text.slice(index, braceAt).trim();
    let depth = 0;
    let cursor = braceAt;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}') {
        depth -= 1;
        if (depth === 0) { cursor += 1; break; }
      }
    }
    const body = text.slice(braceAt, cursor);
    if (selector.startsWith('@media')) {
      /* @media 内部规则逐条展开：条件块会改变生效上下文，必须单独看 */
      const inner = parseRules(body.slice(1, -1));
      for (const item of inner) {
        rules.push({ ...item, startLine: line + item.startLine, media: selector, atRule: true });
      }
      line += (text.slice(index, cursor).match(/\n/g) || []).length;
      index = cursor;
      continue;
    }
    rules.push({ startLine: line, selector, body, atRule: selector.startsWith('@') });
    line += (text.slice(index, cursor).match(/\n/g) || []).length;
    index = cursor;
  }
  return rules;
}

function normKey(selector) {
  return selector
    .replace(/\[data-mp-(?:theme|skin)="[^"]*"\]/g, '')
    .replace(/\[data-mp-(?:theme|skin)\]/g, '')
    .replace(/\.mp-root\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const segments = [];
for (let i = 0; i < order.length; i += 1) {
  const name = order[i];
  const text = await readFile(path.join(CSS_DIR, name), 'utf8');
  const rules = parseRules(text).map(r => ({ ...r, file: name, index: i }));
  segments.push({ name, index: i, rules });
}

const layerOf = name => name.split('-')[0];
const candidates = [];
for (const segment of segments) {
  if (layerOf(segment.name) === 'themes') continue;
  for (const rule of segment.rules) {
    if (!THEME_RE.test(rule.selector)) continue;
    if (rule.media) { candidates.push({ ...rule, mediaBound: true }); continue; }
    if (rule.atRule) continue;
    candidates.push(rule);
  }
}

/* 源之后最近的一个 themes 段作为理论目标（段里有 @media 也算，插到文件末尾即可） */
const targetThemes = candidate => {
  for (let i = candidate.index + 1; i < segments.length; i += 1) {
    const seg = segments[i];
    if (layerOf(seg.name) === 'themes') return seg;
  }
  return null;
};

const movable = [];
const blocked = [];
for (const rule of candidates) {
  if (rule.mediaBound) {
    blocked.push({ rule, reason: '在 @media 内，移动需重建条件块，不自动处理' });
    continue;
  }
  const key = normKey(rule.selector);
  const target = targetThemes(rule);
  if (!target) {
    blocked.push({ rule, reason: '后面没有可用的 themes 段' });
    continue;
  }
  const conflicts = [];
  for (const segment of segments) {
    /* 插入点在目标段末尾：目标段自己的规则（含 @media 内的）也在插入点之前，必须一起比 */
    if (segment.index < target.index) continue;
    for (const other of segment.rules) {
      if (other.atRule && !other.media) continue;
      if (!THEME_RE.test(other.selector)) continue;
      if (normKey(other.selector) === key) {
        conflicts.push(`${other.file}:${other.startLine}${other.media ? ' (@media)' : ''}`);
      }
    }
  }
  if (conflicts.length) blocked.push({ rule, reason: `目标之后还有同键规则（${conflicts.slice(0, 3).join('、')}）` });
  else movable.push({ rule, target: target.name });
}

const show = item => `${item.rule.file}:${item.rule.startLine}  ${item.rule.selector}`;
console.log(`扫描 ${segments.length} 个段，非 themes 段里的主题/皮肤覆盖 ${candidates.length} 条\n`);
console.log(`可移动（到最近 themes 段末尾，层叠不变）：${movable.length} 条`);
for (const item of movable) console.log(`  ${show(item)}  → ${item.target}`);
console.log(`\n保留（移动会改变层叠）：${blocked.length} 条`);
const reasons = {};
for (const item of blocked) {
  const kind = item.reason.split('（')[0];
  (reasons[kind] = reasons[kind] || []).push(show(item));
}
for (const [kind, list] of Object.entries(reasons)) {
  console.log(`  ${kind}：${list.length} 条`);
  for (const line of list.slice(0, 8)) console.log(`    ${line}`);
  if (list.length > 8) console.log(`    … 另有 ${list.length - 8} 条`);
}
