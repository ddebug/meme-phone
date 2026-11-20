#!/usr/bin/env node
/**
 * 真实酒馆宿主自检：自启一个 headless Edge（带 CDP），点开小手机，验四件事。
 *
 *   [1] 扩展在宿主里挂载出 #meme-phone
 *   [2] 手机在视口里居中（fixed 包含块没塌陷）
 *   [3] 聊天框敲多行字，整机尺寸不变（历史上"打字时窗口变小"的复发防护）
 *   [4] 能进聊天页（view=app-chat）
 *
 * 用法：npm run host-check [-- --host=http://127.0.0.1:8000/] [-- --shot=out.png] [-- --keep]
 *
 * 为什么要阻断外网：宿主启动会去拉 raw.githubusercontent.com 的扩展清单和
 * huggingface.co 的 tokenizer，本机这些请求会一直挂着不返回；headless 等网络空闲
 * 永远等不到（--screenshot 直接卡死），初始化流程也被拖住。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const argOf = n => {
  const hit = process.argv.find(a => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : null;
};
const HOST = argOf('host') || 'http://127.0.0.1:8000/';
const SHOT = argOf('shot');
const KEEP = process.argv.includes('--keep');
const PORT = Number(argOf('port') || 9339);
const EDGE = argOf('edge') || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PROFILE = path.join(tmpdir(), 'meme-phone-hostcheck');
const BLOCK = ['*raw.githubusercontent.com*', '*huggingface.co*'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};

async function cdpReady() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return r.json();
    } catch {}
    await sleep(250);
  }
  return null;
}

class Cdp {
  constructor(wsUrl) {
    this.seq = 0; this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id); this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
      }
    };
  }
  ready() { return new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('WS 失败')); }); }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(method + ' 超时')); }, 20000);
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

/* 宿主没起就早点说清楚，别让人对着 CDP 超时发呆 */
try {
  await fetch(HOST, { method: 'HEAD' });
} catch {
  console.error(`连不上宿主 ${HOST}：先在 SillyTavern 目录跑 node server.js`);
  process.exit(2);
}

let edgeProc = null;
if (!(await cdpReady())) {
  if (!existsSync(EDGE)) {
    console.error(`找不到 Edge：${EDGE}（可用 --edge=<path> 指定）`);
    process.exit(2);
  }
  mkdirSync(PROFILE, { recursive: true });
  edgeProc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', `--remote-debugging-port=${PORT}`, '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`, '--no-first-run', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });
}
const version = await cdpReady();
if (!version) {
  console.error('CDP 没起来');
  edgeProc?.kill();
  process.exit(2);
}
console.log(`宿主 ${HOST} · 浏览器 ${version.Browser}`);

const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
const cdp = new Cdp(created.webSocketDebuggerUrl);
await cdp.ready();
await cdp.send('Page.enable');
await cdp.send('Network.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.setBlockedURLs', { urls: BLOCK });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 1000, deviceScaleFactor: 1, mobile: false });

const evaluate = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};

await cdp.send('Page.navigate', { url: HOST });
let ready = false;
for (let i = 0; i < 60; i += 1) {
  try {
    if (await evaluate("!!document.getElementById('meme-phone-qr-button')")) { ready = true; break; }
  } catch {}
  await sleep(500);
}
check('宿主加载出扩展入口', ready, ready ? '' : '30s 内没等到 #meme-phone-qr-button');
if (!ready) {
  cdp.close(); edgeProc?.kill(); process.exit(1);
}

await evaluate("document.getElementById('meme-phone-qr-button').click()");
await sleep(3000);

const mounted = await evaluate(`(()=>{
  const n = document.getElementById('meme-phone');
  if (!n) return null;
  const d = n.querySelector('.mp-device');
  const r = d ? d.getBoundingClientRect() : null;
  return {
    cls: n.className,
    theme: n.dataset.mpTheme || '',
    hasDevice: !!d,
    w: r ? Math.round(r.width) : 0,
    h: r ? Math.round(r.height) : 0,
    top: r ? Math.round(r.top) : 0,
    left: r ? Math.round(r.left) : 0,
    vw: innerWidth,
    vh: innerHeight,
  };
})()`);

check('挂载 #meme-phone 与 .mp-device', !!(mounted && mounted.hasDevice), mounted ? `${mounted.cls} theme=${mounted.theme}` : '没有 #meme-phone');

if (mounted && mounted.hasDevice) {
  const cx = Math.abs(mounted.left + mounted.w / 2 - mounted.vw / 2) <= 2;
  const cy = Math.abs(mounted.top + mounted.h / 2 - mounted.vh / 2) <= 2;
  check('手机整体居中（fixed 包含块没塌陷）', cx && cy,
    `rect=${mounted.w}x${mounted.h} top=${mounted.top} left=${mounted.left} 视口=${mounted.vw}x${mounted.vh}`);

  const before = { w: mounted.w, h: mounted.h };
  await evaluate(`(() => {
    const ta = document.getElementById('send_textarea');
    if (!ta) return 'no-textarea';
    ta.focus();
    ta.value = '第一行\\n第二行\\n第三行\\n第四行';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await sleep(1200);
  const after = await evaluate(`(()=>{
    const d = document.querySelector('#meme-phone .mp-device');
    const r = d.getBoundingClientRect();
    const ta = document.getElementById('send_textarea');
    return { w: Math.round(r.width), h: Math.round(r.height), taH: ta ? Math.round(ta.getBoundingClientRect().height) : -1 };
  })()`);
  check('聊天框敲四行字后整机尺寸不变', after.w === before.w && after.h === before.h,
    `${before.w}x${before.h} -> ${after.w}x${after.h}（输入框 ${after.taH}px）`);

  await evaluate("document.querySelector('#meme-phone .mp-dock .mp-tile').click()");
  await sleep(1200);
  const view = await evaluate(`(()=>{
    const p = document.querySelector('#meme-phone .mp-page');
    return p ? (p.dataset.view || p.className) : 'none';
  })()`);
  check('点 dock 第一个图标进入聊天页', String(view).includes('app-chat'), `view=${view}`);
}

if (SHOT) {
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(SHOT, Buffer.from(s.data, 'base64'));
  console.log(`截图: ${SHOT}`);
}

cdp.close();
await fetch(`http://127.0.0.1:${PORT}/json/close/${created.id}`).catch(() => {});
if (edgeProc && !KEEP) edgeProc.kill();

const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 项通过`);
process.exit(failed ? 1 : 0);
