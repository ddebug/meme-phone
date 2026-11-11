/**
 * meme-phone · 柏宝书
 *
 * 柏宝书（ST-BaiBai-Book）是酒馆里的长期记忆引擎：自动摘要、总结、时间线、
 * 人物 / 物品 / 场景 / 悬念台账、向量召回。它的完整代码在仓库 baibai-book/ 里，
 * 这里通过它公开的只读接口 STBaiBaiBook 把记忆摊到手机上。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';

const TABS = [
  ['overview', '概览'],
  ['summary', '摘要'],
  ['npcs', '人物'],
  ['items', '物品'],
  ['scenes', '场景'],
  ['plans', '悬念'],
];

const AFFINITY_INNER = { '-2': '强烈反感', '-1': '不喜欢', 0: '无明显好恶', 1: '有好感', 2: '感情深厚' };
const AFFINITY_OUTER = { '-2': '明显敌对', '-1': '冷淡疏远', 0: '不明显', 1: '友善亲近', 2: '明显亲近' };

function api() {
  try {
    return globalThis.STBaiBaiBook || null;
  } catch (error) {
    return null;
  }
}

function call(name, fallback, ...args) {
  const book = api();
  if (!book || typeof book[name] !== 'function') return fallback;
  try {
    return book[name](...args) ?? fallback;
  } catch (error) {
    return fallback;
  }
}

/* 预览环境没有柏宝书，用一份演示数据把版面撑起来 */
function demoSnapshot() {
  return {
    chat: { characterName: '沈砚', length: 86 },
    coverage: { complete: true, missingAiFloors: [] },
    state: {
      time: '1988 年 9 月 29 日 傍晚',
      location: '杭州市滨江区某老小区-302室屋内',
      locationPath: ['杭州市', '滨江区某老小区', '302室屋内'],
      sceneFocus: { situation: '两个人在收拾刚搬进来的行李，雨还没停。' },
    },
    protagonist: {
      gender: '女',
      age: '24',
      identity: '旧书店店员',
      appearance: '齐肩黑发，右手虎口有一道浅疤。',
      outfit: '米色针织衫 + 深色长裤',
      condition: '有点感冒，嗓子发哑',
    },
    npcs: [{
      id: 'npc_1', name: '沈砚', gender: '男', age: '27',
      title: '旧书店老板', relation: '房东, 旧识',
      desc: '清瘦，常穿深色衬衫，左手戴一块停了的手表。',
      personality: '话少，但会记住别人随口提过的事。',
      outfit: '深灰衬衫，袖口卷到小臂',
      condition: '右手擦伤，贴了创可贴',
      important: true, follow: false, location: '302室屋内',
      affinityInner: 1, affinityOuter: 1,
      affinityNote: '主动留了伞，但嘴上说是顺手。',
    }],
    items: [
      { id: 'i1', name: '黄铜钥匙', desc: '302 室的备用钥匙，齿口有点磨损。', qty: 1, carried: true },
      { id: 'i2', name: '旧雨伞', desc: '沈砚借的，伞骨有一根歪了。', qty: 1, carried: true },
      { id: 'i3', name: '纸箱', desc: '装书的箱子，放在客厅角落。', qty: 3, carried: false, location: '302室屋内' },
    ],
    itemLog: [
      { name: '旧雨伞', kind: 'add', to: 1, time: '1988 年 9 月 29 日 傍晚' },
    ],
    scenes: [
      { id: 's1', name: '杭州市', path: ['杭州市'], parentId: '', desc: '' },
      { id: 's2', name: '滨江区某老小区', path: ['杭州市', '滨江区某老小区'], parentId: 's1', desc: '六层老楼，楼道灯是声控的。' },
      { id: 's3', name: '302室屋内', path: ['杭州市', '滨江区某老小区', '302室屋内'], parentId: 's2', desc: '两室一厅，朝北的窗关不严。' },
    ],
    plans: [
      { id: 'p1', kind: 'plan', status: 'open', content: '周末去旧货市场找一只同款表带。', createdTime: '1988/9/29' },
      { id: 'p2', kind: 'suspense', status: 'open', content: '沈砚的手表为什么停在三点十七分，他一直没说。', createdTime: '1988/9/29' },
      { id: 'p3', kind: 'plan', status: 'resolved', content: '把最后一箱书搬上楼。', createdTime: '1988/9/28', outcome: 'done' },
    ],
    lifeDetails: [
      { subject: 'user', text: '喝咖啡必须加两块糖。', topics: ['饮食'], tier: 'active' },
      { subject: '沈砚', text: '不吃香菜，会默默挑出来。', topics: ['饮食'], tier: 'active' },
    ],
  };
}

function demoHistory() {
  return {
    coverage: { complete: false, missingAiFloors: [38] },
    relativeText: [
      '【1988 年 9 月 28 日 下午】搬家前一晚，主角把最后一箱书留在楼下，先上来打扫 302 室。',
      '【昨天】沈砚敲门送伞，说楼道的灯坏了，顺手把备用钥匙给了主角。',
      '【今天傍晚】雨没停，两人一起拆箱。沈砚的右手擦伤，说是搬书划的，手表停在三点十七分。',
    ].join('\n\n'),
    nodes: [
      { id: 'h3', kind: 'leaf', level: 1, text: '雨夜拆箱，沈砚送来备用钥匙与旧伞，手表停在三点十七分。', timeLabel: '今天傍晚', floorStart: 84, floorEnd: 86 },
      { id: 'h2', kind: 'comp', level: 2, text: '搬家前后两天：打扫 302 室、借伞、拆箱，沈砚持续帮忙但话很少。', timeLabel: '最近两天', floorStart: 78, floorEnd: 86 },
    ],
  };
}

function snapshotOf() {
  return call('getSnapshot', null) || (api() ? null : demoSnapshot());
}

function historyOf() {
  return call('getHistory', null) || (api() ? null : demoHistory());
}

/* ------------------------------------------------------------ 小组件 */

function statCard(value, label) {
  return `<div class="mp-bk-stat"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

function kv(label, value) {
  if (!value) return '';
  return `<div class="mp-bk-kv"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function tag(text, tone = '') {
  return `<span class="mp-bk-tag${tone ? ` is-${tone}` : ''}">${esc(text)}</span>`;
}

function section(title, body, extra = '') {
  if (!body) return '';
  return `<div class="mp-bk-section">
    <div class="mp-bk-section-head"><span>${esc(title)}</span>${extra}</div>
    ${body}
  </div>`;
}

/* ------------------------------------------------------------ 各分页 */

function overviewPage(snap) {
  if (!snap) return emptyPage('还没接到柏宝书', '在酒馆里装上柏宝书扩展后，这里会自动出现它的记忆。');
  const state = snap.state || {};
  const hero = snap.protagonist || {};
  const coverage = snap.coverage || {};
  const place = (state.locationPath && state.locationPath.length ? state.locationPath.join(' / ') : state.location) || '地点未记录';

  return `
    <div class="mp-bk-hero">
      <div class="mp-bk-hero-row">
        <div class="mp-bk-hero-time">${icon('clock')}<span>${esc(state.time || '故事时间未记录')}</span></div>
        ${coverage.complete === false ? tag('有缺楼', 'warn') : ''}
      </div>
      <div class="mp-bk-hero-place">${icon('pin')}<span>${esc(place)}</span></div>
      ${state.sceneFocus?.situation ? `<div class="mp-bk-hero-focus">${esc(state.sceneFocus.situation)}</div>` : ''}
    </div>

    <div class="mp-bk-stats">
      ${statCard((snap.npcs || []).length, '人物')}
      ${statCard((snap.items || []).length, '物品')}
      ${statCard((snap.scenes || []).length, '地点')}
      ${statCard((snap.plans || []).filter(plan => plan.status === 'open').length, '未了')}
    </div>

    ${section('主角', [
      kv('身份', hero.identity),
      kv('性别 · 年龄', [hero.gender, hero.age].filter(Boolean).join(' · ')),
      kv('外貌', hero.appearance),
      kv('着装', hero.outfit),
      kv('状态', hero.condition),
    ].join('') || '<div class="mp-empty">还没记到主角的档案。</div>')}

    ${section('聊到哪了', `<div class="mp-bk-quiet">第 ${esc(snap.chat?.length ?? 0)} 楼 · ${esc(snap.chat?.characterName || '未打开聊天')}</div>`)}
  `;
}

function summaryPage(history) {
  if (!history) return emptyPage('还没有摘要', '柏宝书会在每轮回复后自动整理这一楼的剧情。');
  const nodes = history.nodes || [];
  const expanded = this?.shell?.bookNode || '';
  const rows = nodes.slice().reverse().map(node => {
    const open = expanded === node.id;
    return `<div class="mp-bk-node${open ? ' is-open' : ''}">
      <button class="mp-bk-node-head" data-act="bk-node" data-id="${esc(node.id)}" type="button">
        <span class="mp-bk-node-level">L${esc(node.level)}</span>
        <span class="mp-bk-node-main">
          <span class="mp-bk-node-title">${esc(node.timeLabel || (node.floorStart != null ? `第 ${node.floorStart}–${node.floorEnd} 楼` : '摘要'))}</span>
          <span class="mp-bk-node-sub">${esc(node.kind === 'comp' ? '总结' : '单楼摘要')}${node.timeStart ? ` · ${esc(node.timeStart)}` : ''}</span>
        </span>
        ${icon('chevron')}
      </button>
      ${open ? `<div class="mp-bk-node-text">${esc(node.text)}</div>` : ''}
    </div>`;
  }).join('');

  const coverage = history.coverage || {};
  const body = (history.relativeText || '').split(/\n{2,}/).filter(Boolean)
    .map(part => `<p class="mp-bk-para">${esc(part)}</p>`).join('');

  return `
    ${coverage.complete === false
      ? `<div class="mp-bk-warn">第 ${esc((coverage.missingAiFloors || []).join('、') || '?')} 楼还没有摘要，这段历史不完整。</div>` : ''}
    ${section('压缩后的历史', body || '<div class="mp-empty">还没有攒出可以压缩的历史。</div>')}
    ${section('摘要节点', rows || '<div class="mp-empty">还没有节点。</div>', `<span class="mp-bk-count">${nodes.length}</span>`)}
  `;
}

function npcsPage(snap) {
  const list = snap?.npcs || [];
  if (!list.length) return emptyPage('还没有登场人物', '剧情里出现过的角色会被自动记进名册。');
  const lives = snap.lifeDetails || [];
  const cards = list.map(npc => {
    const inner = npc.affinityInner == null ? '未知' : AFFINITY_INNER[npc.affinityInner] || '未知';
    const outer = npc.affinityOuter == null ? '未知' : AFFINITY_OUTER[npc.affinityOuter] || '未知';
    const notes = lives.filter(item => (item.subject || 'user') === npc.name);
    return `<div class="mp-bk-card">
      <div class="mp-bk-card-head">
        <div>
          <div class="mp-bk-name">${esc(npc.name)}</div>
          <div class="mp-bk-role">${esc([npc.title, npc.relation].filter(Boolean).join(' · ') || '身份未记录')}</div>
        </div>
        <div class="mp-bk-tags">
          ${npc.important ? tag('主要', 'key') : ''}
          ${npc.follow ? tag('随行') : (npc.location ? tag(npc.location) : '')}
        </div>
      </div>
      <div class="mp-bk-meta">${[npc.gender, npc.age ? `${npc.age} 岁` : ''].filter(Boolean).map(esc).join(' · ')}</div>
      ${kv('外貌', npc.desc)}
      ${kv('性格', npc.personality)}
      ${kv('此刻', [npc.outfit, npc.condition].filter(Boolean).join(' / '))}
      <div class="mp-bk-affinity">
        <span>内心好感 · ${esc(inner)}</span>
        <span>外在态度 · ${esc(outer)}</span>
      </div>
      ${npc.affinityNote ? `<div class="mp-bk-quiet">${esc(npc.affinityNote)}</div>` : ''}
      ${notes.length ? `<div class="mp-bk-life">${notes.map(item => `<span>· ${esc(item.text)}</span>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  return cards;
}

function itemsPage(snap) {
  const items = snap?.items || [];
  const logs = snap?.itemLog || [];
  if (!items.length) return emptyPage('还没有物品', '获得、消耗、放在哪，都会记进这本台账。');
  const rows = items.map(item => `
    <div class="mp-bk-row">
      <div class="mp-bk-row-main">
        <span class="mp-bk-row-name">${esc(item.name)}${item.qty != null ? ` × ${esc(item.qty)}` : ''}</span>
        <span class="mp-bk-row-sub">${esc(item.desc || (item.carried === false ? `存放在 ${item.location || '某处'}` : '随身带着'))}</span>
      </div>
      ${item.carried === false ? tag('存放') : tag('随身')}
    </div>`).join('');
  const logRows = logs.slice(-6).reverse().map(log => `
    <div class="mp-bk-log">
      <span>${esc(log.time || '时间未记')}</span>
      <b>${esc(log.name)}</b>
      <span>${log.kind === 'add' ? '获得' : log.kind === 'remove' ? '失去' : '变动'}${log.to != null ? ` → ${log.to}` : ''}</span>
    </div>`).join('');
  return `${rows}${section('变动日志', logRows || '<div class="mp-empty">还没有变动。</div>')}`;
}

function scenesPage(snap) {
  const scenes = snap?.scenes || [];
  if (!scenes.length) return emptyPage('还没有地点', '去过的地方会按由大到小排成一棵地图树。');
  const rows = scenes.map(scene => {
    const depth = Math.max(0, (scene.path || []).length - 1);
    return `<div class="mp-bk-scene" style="--depth:${Math.min(depth, 3)}">
      <span class="mp-bk-scene-dot"></span>
      <div class="mp-bk-scene-main">
        <span class="mp-bk-scene-name">${esc(scene.name)}</span>
        <span class="mp-bk-scene-sub">${esc((scene.path || []).join(' / '))}${scene.desc ? ` · ${esc(scene.desc)}` : ''}</span>
      </div>
    </div>`;
  }).join('');
  return `<div class="mp-bk-tree">${rows}</div>`;
}

function plansPage(snap) {
  const plans = snap?.plans || [];
  if (!plans.length) return emptyPage('还没有计划与悬念', '约定、伏笔、没解开的谜题，都会被记在这里。');
  const groups = [
    ['open', '还没了结'],
    ['resolved', '已了结'],
  ];
  return groups.map(([status, label]) => {
    const list = plans.filter(plan => plan.status === status);
    if (!list.length) return '';
    return section(label, list.map(plan => `
      <div class="mp-bk-plan${status === 'resolved' ? ' is-done' : ''}">
        <div class="mp-bk-plan-head">
          ${tag(plan.kind === 'suspense' ? '悬念' : '计划', plan.kind === 'suspense' ? 'warn' : '')}
          <span class="mp-bk-plan-time">${esc(plan.createdTime || '')}${plan.targetTime ? ` → ${esc(plan.targetTime)}` : ''}</span>
        </div>
        <div class="mp-bk-plan-text">${esc(plan.content)}</div>
        ${plan.resolvedReason ? `<div class="mp-bk-quiet">${esc(plan.resolvedReason)}</div>` : ''}
      </div>`).join(''), `<span class="mp-bk-count">${list.length}</span>`);
  }).join('');
}

function emptyPage(title, sub) {
  return `<div class="mp-bk-empty">
    <div class="mp-bk-empty-ic">${icon('bookmark')}</div>
    <div class="mp-bk-empty-title">${esc(title)}</div>
    <div class="mp-bk-empty-sub">${esc(sub)}</div>
  </div>`;
}

/* ------------------------------------------------------------ App */

let subscribed = false;

function watchChanges(ctx) {
  if (subscribed) return;
  const book = api();
  if (!book || typeof book.subscribe !== 'function') return;
  try {
    subscribed = true;
    book.subscribe(() => {
      const entry = ctx.shell?.stack?.[ctx.shell.stack.length - 1];
      if (entry && entry.view === 'app-book') ctx.rerender();
    });
  } catch (error) {
    subscribed = false;
  }
}

export const bookApp = {
  id: 'app-book',

  render(ctx) {
    watchChanges(ctx);
    const tab = ctx.shell.bookTab || 'overview';
    const snap = snapshotOf();
    const history = historyOf();
    const connected = Boolean(api());

    const body = tab === 'summary'
      ? summaryPage.call(ctx, history)
      : tab === 'npcs' ? npcsPage(snap)
        : tab === 'items' ? itemsPage(snap)
          : tab === 'scenes' ? scenesPage(snap)
            : tab === 'plans' ? plansPage(snap)
              : overviewPage(snap);

    const tabs = TABS.map(([value, label]) => `
      <button class="mp-bk-tab${tab === value ? ' is-on' : ''}" data-act="bk-tab" data-tab="${value}" type="button">${esc(label)}</button>`).join('');

    return `
      <div class="mp-page-body mp-bk">
        <div style="display:flex;align-items:center;gap:8px;margin-top:2px">
          <div class="mp-title" style="flex:1">柏宝书</div>
          <button class="mp-icon-btn" data-act="bk-refresh" type="button" aria-label="刷新">${icon('refresh')}</button>
        </div>
        <div class="mp-subtitle">长期记忆引擎 · 摘要 / 人物 / 物品 / 场景 / 悬念</div>

        <div class="mp-draw-state${connected ? ' is-on' : ''}">
          ${icon('spark')}
          <span>${connected ? `已接柏宝书 · 第 ${esc(snap?.chat?.length ?? 0)} 楼` : '预览环境 · 下面是演示记忆'}</span>
          <button class="mp-draw-state-btn" data-act="bk-refresh" type="button">刷新</button>
        </div>

        <div class="mp-bk-tabs">${tabs}</div>
        <div class="mp-bk-body">${body}</div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'bk-tab') {
      ctx.shell.bookTab = data.tab || 'overview';
      ctx.shell.bookNode = '';
      ctx.rerender();
      return true;
    }

    if (act === 'bk-node') {
      ctx.shell.bookNode = ctx.shell.bookNode === data.id ? '' : String(data.id || '');
      ctx.rerender();
      return true;
    }

    if (act === 'bk-refresh') {
      const ok = Boolean(api());
      ctx.rerender();
      ctx.toast(ok ? '柏宝书数据已刷新' : '预览里没有柏宝书，装到酒馆后才会读到真数据');
      return true;
    }

    return false;
  },
};
