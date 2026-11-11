/**
 * meme-phone · 酒馆总结（原柏宝书）
 *
 * 柏宝书（ST-BaiBai-Book）是酒馆里的长期记忆引擎：自动摘要、总结、时间线、
 * 人物 / 物品 / 场景 / 悬念台账、向量召回。它的完整代码在仓库 baibai-book/ 里，
 * 这里通过它公开的只读接口 STBaiBaiBook 把记忆摊到手机上。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import { bookApi, readSummaries, summaryApiPresets, applySummaryApi, clearSummaryApi, backfillSummaries } from '../book.js';

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
  return bookApi();
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

function snapshotOf() {
  return call('getSnapshot', null) || (api() ? null : demoSnapshot());
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
  if (!snap) return emptyPage('还没接到酒馆总结', '在酒馆里装上酒馆总结后，这里会自动出现它的记忆。');
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
      kv('性别', [hero.gender, hero.age ? `${hero.age} 岁` : ''].filter(Boolean).join(' · ')),
      kv('外貌', hero.appearance),
      kv('着装', hero.outfit),
      kv('状态', hero.condition),
    ].join('') || '<div class="mp-empty">还没记到主角的档案。</div>')}

    ${section('聊到哪了', `<div class="mp-bk-quiet">第 ${esc(snap.chat?.length ?? 0)} 楼 · ${esc(snap.chat?.characterName || '未打开聊天')}</div>`)}
  `;
}

function summaryPage(ctx) {
  const skipFirst = Boolean(ctx.state.settings.summary?.skipFirstFloor);
  const data = readSummaries({ skipFirstFloor: skipFirst });
  const nodes = data.nodes || [];
  const expanded = ctx.shell.bookNode || '';
  const rows = nodes.slice().reverse().map(node => {
    const open = expanded === node.id;
    const floorLabel = node.floorStart != null
      ? `第 ${node.floorStart}${node.floorEnd != null && node.floorEnd !== node.floorStart ? `–${node.floorEnd}` : ''} 楼`
      : '';
    const sub = [node.kind === 'comp' ? '合并总结' : '单楼摘要', floorLabel].filter(Boolean).join(' · ');
    const preview = !open && node.text ? node.text.replace(/\s+/g, ' ').slice(0, 72) : '';
    return `<div class="mp-bk-node${open ? ' is-open' : ''}">
      <button class="mp-bk-node-head" data-act="bk-node" data-id="${esc(node.id)}" type="button">
        <span class="mp-bk-node-level">L${esc(node.level)}</span>
        <span class="mp-bk-node-main">
          <span class="mp-bk-node-title">${esc(node.timeLabel || '未标时间')}</span>
          <span class="mp-bk-node-sub">${esc(sub)}</span>
          ${preview ? `<span class="mp-bk-node-preview">${esc(preview)}${node.text.length > 72 ? '…' : ''}</span>` : ''}
        </span>
        ${icon('chevron')}
      </button>
      ${open ? `<div class="mp-bk-node-text">${esc(node.text)}</div>` : ''}
    </div>`;
  }).join('');

  const coverage = data.coverage || {};
  const first = data.firstText
    ? section('首楼原文（已关掉首楼总结）', `<div class="mp-bk-first">${esc(data.firstText)}</div>`)
    : '';

  return `
    ${coverage.complete === false
      ? `<div class="mp-bk-warn">第 ${esc((coverage.missingAiFloors || []).join('、') || '?')} 楼还没有摘要，点上方「补摘要」补齐。</div>` : ''}
    ${first}
    ${section('所有总结', rows || `<div class="mp-empty">${skipFirst ? '除了首楼还没有别的总结。' : '还没有总结，酒馆里聊起来之后会自动生成。'}</div>`, `<span class="mp-bk-count">${nodes.length} 条</span>`)}
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
    const connected = Boolean(api());
    const summary = ctx.state.settings.summary || {};
    const presets = summaryApiPresets(ctx.state);
    const activePreset = presets.find(item => item.id === summary.apiId);
    const apiLabel = activePreset ? (activePreset.name || '手机接口') : '跟随自带';
    const missing = (snap?.coverage?.missingAiFloors || []).length;
    const busy = Boolean(ctx.shell.bookBusy);

    const body = tab === 'summary'
      ? summaryPage(ctx)
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
          <div class="mp-title" style="flex:1">酒馆总结</div>
          <button class="mp-icon-btn" data-act="bk-refresh" type="button" aria-label="刷新">${icon('refresh')}</button>
        </div>
        <div class="mp-subtitle">酒馆里的所有总结 · 摘要 / 人物 / 物品 / 场景 / 悬念</div>

        <div class="mp-bk-bar">
          <button class="mp-bk-bar-btn" data-act="bk-settings" type="button">
            ${icon('code')}<span>接口 · ${esc(apiLabel)}</span>${icon('chevron')}
          </button>
          <button class="mp-bk-bar-btn${missing ? ' is-warn' : ''}" data-act="bk-backfill" type="button">
            ${icon('refresh')}<span>${busy ? '补摘要中…' : `补摘要${missing ? ` · ${missing} 楼` : ''}`}</span>
          </button>
        </div>

        <div class="mp-draw-state${connected ? ' is-on' : ''}">
          ${icon('spark')}
          <span>${connected ? `已接酒馆总结 · 第 ${esc(snap?.chat?.length ?? 0)} 楼` : '预览环境 · 下面是演示记忆'}</span>
          <button class="mp-draw-state-btn" data-act="bk-settings" type="button">设置</button>
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

    if (act === 'bk-settings') {
      ctx.go('book-settings');
      return true;
    }

    if (act === 'bk-backfill') {
      if (ctx.shell.bookBusy) {
        ctx.toast('正在补，等这一批跑完');
        return true;
      }
      const bridgeReady = Boolean(globalThis.__STBaiBaiBookPhoneApi?.backfill);
      if (!bridgeReady) {
        ctx.toast('酒馆总结还没加载，装好并刷新酒馆后再补');
        return true;
      }
      ctx.shell.bookBusy = true;
      ctx.rerender();
      ctx.toast('开始补摘要，跑完后自动刷新');
      backfillSummaries().then(result => {
        ctx.shell.bookBusy = false;
        ctx.rerender();
        if (result?.error) ctx.toast(`补摘要失败：${result.error}`);
        else if (!result || !result.total) ctx.toast('没有待补的楼层');
        else ctx.toast(result.cancelled ? `已取消 · 补完 ${result.done}/${result.total} 楼` : `补完 ${result.done}/${result.total} 楼`);
      });
      return true;
    }

    if (act === 'bk-refresh') {
      const ok = Boolean(api());
      ctx.rerender();
      ctx.toast(ok ? '酒馆总结已刷新' : '预览里没有酒馆总结，装到酒馆后才会读到真数据');
      return true;
    }

    return false;
  },
};

/* ------------------------------------------------------ 酒馆总结 · 设置 */

function setRow({ iconName, title, sub, act, toggle, value, dataId }) {
  return `
    <button class="mp-set-row" data-act="${act}"${dataId ? ` data-id="${esc(dataId)}"` : ''} type="button">
      <span class="mp-set-ico">${icon(iconName)}</span>
      <span class="mp-set-name">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
      ${toggle !== undefined
        ? `<span class="mp-switch${toggle ? ' on' : ''}"></span>`
        : value ? `<span class="mp-set-value">${esc(value)}</span>` : `<span style="color:var(--text-4)">${icon('chevron')}</span>`}
    </button>`;
}

export const bookSettingsApp = {
  id: 'book-settings',

  render(ctx) {
    const summary = ctx.state.settings.summary || {};
    const skip = Boolean(summary.skipFirstFloor);
    const presets = summaryApiPresets(ctx.state);
    const activeId = summary.apiId || '';

    const apiRows = presets.map(preset => setRow({
      iconName: 'code',
      title: preset.name || '未命名接口',
      sub: [preset.model, preset.url].filter(Boolean).join(' · ').slice(0, 48),
      act: 'bks-api',
      value: activeId === preset.id ? '使用中' : '',
      dataId: preset.id,
    })).join('');

    return `
      <div class="mp-page-body mp-bk">
        <div class="mp-title" style="margin-top:2px">总结设置</div>
        <div class="mp-subtitle">首楼开关 · 总结走哪套接口（主界面「接口」也进这里）</div>

        <div class="mp-group" style="margin-top:14px">
          <div class="mp-group-label">首楼</div>
          <div class="mp-group-box">
            ${setRow({
              iconName: 'bookmark',
              title: '首楼不总结，显示原文',
              sub: skip ? '首楼的总结已关掉，摘要页直接给原文' : '默认把首楼也总结进摘要',
              act: 'bks-first',
              toggle: skip,
            })}
          </div>
        </div>

        <div class="mp-group" style="margin-top:14px">
          <div class="mp-group-label">总结接口</div>
          <div class="mp-group-box">
            ${setRow({
              iconName: 'book',
              title: '跟随酒馆总结自带设置',
              sub: '用酒馆总结自己配的副 API',
              act: 'bks-api-auto',
              value: activeId ? '' : '使用中',
            })}
            ${apiRows || ''}
          </div>
          ${presets.length ? '' : '<div class="mp-empty" style="padding:18px 4px 0">还没存接口。先去「接口」里加一套地址 + 模型，再回来选。</div>'}
        </div>

        <div class="mp-bk-note">选了手机接口后，酒馆总结的摘要与总结两个任务都会走这条渠道；以后在「接口」里改了同一套预设，再点一次它就同步过去。</div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'bks-first') {
      const summary = ctx.state.settings.summary || (ctx.state.settings.summary = {});
      summary.skipFirstFloor = !summary.skipFirstFloor;
      ctx.save();
      ctx.rerender();
      ctx.toast(summary.skipFirstFloor ? '首楼改为显示原文' : '首楼恢复总结');
      return true;
    }

    if (act === 'bks-api') {
      const preset = summaryApiPresets(ctx.state).find(item => item.id === data.id);
      if (!preset) return true;
      const summary = ctx.state.settings.summary || (ctx.state.settings.summary = {});
      const ok = applySummaryApi(preset);
      if (!ok) {
        ctx.toast('酒馆总结还没加载，装好并刷新酒馆后再选');
        return true;
      }
      summary.apiId = preset.id;
      ctx.save();
      ctx.rerender();
      ctx.toast(`总结接口已切到「${preset.name || '手机接口'}」`);
      return true;
    }

    if (act === 'bks-api-auto') {
      const summary = ctx.state.settings.summary || (ctx.state.settings.summary = {});
      clearSummaryApi();
      summary.apiId = '';
      ctx.save();
      ctx.rerender();
      ctx.toast('已跟随酒馆总结自带设置');
      return true;
    }

    return false;
  },
};
