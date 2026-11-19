#!/usr/bin/env node
/**
 * 存档体积与耗时基线（node scripts/bench-store.mjs）
 *
 * 只做三件事，给「要不要把图片搬到独立资产存储」一个数据依据：
 *   1. 1000 条文字的存档有多大、保存一次 JSON 要多久
 *   2. 加上 20 张 base64 图片后涨到多大、图片占几成
 *   3. normalize（读存档 + 补字段）耗时
 *
 * 合成数据，不读任何真实存档。
 */

import { demoState, normalize } from '../meme/data.js';

function message(index, withImage) {
  return {
    id: `m_${index}`,
    from: index % 2 ? 'them' : 'me',
    kind: 'text',
    at: Date.now() - (1000 - index) * 60_000,
    text: `第 ${index} 条：今天下班有点晚，路上买了杯热豆浆，回去慢慢说。`,
    ...(withImage ? { image: `data:image/png;base64,${'A'.repeat(120_000)}` } : {}),
  };
}

function build(count, images) {
  const state = demoState();
  const chat = Object.values(state.chats)[0];
  chat.messages = Array.from({ length: count }, (_, index) => message(index, index >= count - images));
  return state;
}

function measure(label, state) {
  const json = JSON.stringify({ format: 'meme-phone', revision: 1, meme: state });
  const saveStart = process.hrtime.bigint();
  JSON.stringify({ format: 'meme-phone', revision: 2, meme: state });
  const saveMs = Number(process.hrtime.bigint() - saveStart) / 1e6;
  const normalizeStart = process.hrtime.bigint();
  normalize(JSON.parse(json));
  const normalizeMs = Number(process.hrtime.bigint() - normalizeStart) / 1e6;
  const bytes = Buffer.byteLength(json, 'utf8');
  console.log(`${label}：${(bytes / 1024 / 1024).toFixed(2)} MB · 序列化 ${saveMs.toFixed(1)} ms · normalize ${normalizeMs.toFixed(1)} ms`);
  return bytes;
}

const textOnly = measure('1000 条纯文字', build(1000, 0));
const withImages = measure('1000 条 + 20 张图（base64 内嵌）', build(1000, 20));
const imageShare = (withImages - textOnly) / withImages;
console.log(`图片占存档 ${(imageShare * 100).toFixed(0)}%，平均每张 ${((withImages - textOnly) / 20 / 1024).toFixed(0)} KB`);
