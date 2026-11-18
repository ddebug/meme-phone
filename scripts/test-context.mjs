/**
 * 回复预设上下文组装的纯逻辑验收（node scripts/test-context.mjs）。
 * 不碰 DOM，不连酒馆；用 demoState 验证开关、角色路由、世界书、去重、预算和排序。
 */

import {
  demoState, normalize, normalizeReplyContext, normalizeReplyItems, replyPresetFor, replyPresetsOf, chatsOf,
  extrasEnabledFor, theaterPrompt, splitTheaterBlocks, addExtrasEntry, defaultReplyItems, REPLY_INSTRUCTION_ID,
  THEATER_KINDS, normalizeTheaterKind, theaterKindById, theaterKindFor,
} from '../meme/data.js';
import { buildReplyMessages, estimateTokens, requestStats } from '../meme/reply-context.js';

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(`✗ ${message}`);
  passed += 1;
  console.log(`✓ ${message}`);
}

function stateWithPreset() {
  const state = demoState();
  const preset = replyPresetFor(state, null);
  return { state, preset, chat: chatsOf(state)[0], contact: state.contacts[chatsOf(state)[0].contactId] };
}

function contents(messages) {
  return messages.map(message => String(message.content || '')).join('\n\n');
}

function findItem(items, id) {
  return items.find(item => item.id === id);
}

/* 1. 默认预设：完整 24 条 + meme 三条上下文 + 单条格式兜底 */
{
  const items = defaultReplyItems();
  ok(items.length === 28, '默认条目共 28 条');
  ok(items.filter(item => item.kind === 'context').length === 9, '九类上下文都在');
  const labels = items.map(item => item.label);
  ['头部', 'QQ聊天任务', 'QQ聊天行为要求', '用户角色设定', '个签历史 - 用户个性签名',
    '角色档案 - 人设、历史记录、线下剧情等', '手机相关记录 - 占位符', '表情包库',
    '历史小手机消息', '历史酒馆消息', '收藏夹消息', '约定计划', '修改个性签名', '戳一戳消息',
    '撤回消息', '引用消息', '转账', '会员', '关注用户的消息细节', '时间信息',
    '用户当前操作提醒', '用户操作 - 本轮任务清单', '中文回复', '回复格式要求',
    'QQ 回复格式（原版）', '尾部'].forEach(label => {
    ok(labels.includes(label), `参考条目「${label}」已迁入`);
  });
  ok(items.find(item => item.id === 'reply_context_signature')?.enabled === true, '个签上下文默认开启');
  ok(items.find(item => item.id === 'reply_context_emoji')?.enabled === true, '表情包上下文默认开启');
  ok(items.find(item => item.id === 'reply_item_quote')?.enabled === false, '未接入的原版协议默认关闭');
}

/* 1.5 内置预设：回复指令是普通条目，不再单独存 text */
{
  const state = demoState();
  state.settings.reply.presets.forEach(preset => {
    ok(preset.items.some(item => item.id === REPLY_INSTRUCTION_ID), `「${preset.name}」的回复指令在条目列表里`);
    ok(!preset.text, `「${preset.name}」不再单独保存回复指令`);
  });
}

/* 2. 默认预设：九类上下文都在，世界书常驻 + 关键词命中 */
{
  const { state, chat, contact } = stateWithPreset();
  state.settings.profile.bio = '夜里也要好好吃饭';
  state.emoji = [{ id: 'e1', name: '抱抱', char: '🫂' }];
  const { messages, report } = await buildReplyMessages(state, chat, contact);
  const text = contents(messages);
  ok(report.items.some(item => item.id === 'reply_context_lorebook' && item.status === 'injected'), '人设世界书条目已注入');
  ok(text.includes('【人设世界书 · 夜班人物】'), '世界书标题带当前人设绑定的书名');
  ok(text.includes('【店长】'), '常驻条目无条件注入');
  ok(text.includes('【夜班】'), '关键词条目按最近聊天命中（便利店）');
  ok(!text.includes('【旧毛衣】'), '关闭的世界书条目不注入');
  ok(text.includes('【角色档案 · 沈砚】'), '角色档案按角色卡读取');
  ok(text.includes('【场景信息】'), '场景信息单独成条');
  ok(text.includes('【历史小手机消息】'), '聊天记录按条数注入');
  ok(text.includes('【我的个性签名】') && text.includes('夜里也要好好吃饭'), '个签按当前资料注入');
  ok(text.includes('【表情包库】') && text.includes('抱抱（🫂）'), '表情包库按当前面板注入');
  ok(messages[messages.length - 1].role === 'user', '最后一条聊天作为 user 消息');
}

/* 2. 关闭角色档案：消息和报告同时消失 */
{
  const { state, preset, chat, contact } = stateWithPreset();
  const items = normalizeReplyItems(preset.items, preset.context);
  findItem(items, 'reply_context_character').enabled = false;
  preset.items = items;
  const { messages, report } = await buildReplyMessages(state, chat, contact);
  ok(!contents(messages).includes('【角色档案'), '关闭后预览里没有角色档案');
  ok(report.items.some(item => item.id === 'reply_context_character' && item.status === 'disabled'), '报告标记为已关闭');
}

/* 3. 按角色卡路由：只对江迟生效的条目，在沈砚会话里不注入 */
{
  const { state, preset, chat, contact } = stateWithPreset();
  const items = normalizeReplyItems(preset.items, preset.context);
  findItem(items, 'reply_context_character').characters = ['江迟'];
  preset.items = items;

  const shen = await buildReplyMessages(state, chat, contact);
  ok(!contents(shen.messages).includes('【角色档案 · 沈砚】'), '别的角色会话不注入');
  ok(shen.report.items.some(item => item.id === 'reply_context_character' && item.status === 'other-character'), '报告说明是角色路由拦下');

  const jiangChat = chatsOf(state).find(item => state.contacts[item.contactId]?.name === '江迟');
  const jiang = await buildReplyMessages(state, jiangChat, state.contacts[jiangChat.contactId]);
  ok(contents(jiang.messages).includes('【角色档案 · 江迟】'), '指定角色的一对一会话正常注入');
}

/* 4. 群聊只注入公共条目 */
{
  const { state, preset, chat, contact } = stateWithPreset();
  const items = normalizeReplyItems(preset.items, preset.context);
  findItem(items, 'reply_context_character').characters = ['沈砚'];
  preset.items = items;
  const group = chatsOf(state).find(item => item.kind === 'group');
  const result = await buildReplyMessages(state, group, state.contacts[group.contactId]);
  ok(!contents(result.messages).includes('【角色档案'), '群聊不注入具体角色条目');
  ok(result.report.items.some(item => item.id === 'reply_context_character' && item.status === 'other-character'), '群聊被角色路由拦下');
}

/* 5. 去重：同内容条目只进一次 */
{
  const { state, preset, chat, contact } = stateWithPreset();
  const items = normalizeReplyItems(preset.items, preset.context);
  const chinese = findItem(items, 'reply_item_chinese');
  items.push({ ...chinese, id: 'item_dup', label: '重复中文', order: chinese.order + 0.1 });
  preset.items = items;
  const { messages, report } = await buildReplyMessages(state, chat, contact);
  const count = contents(messages).split(chinese.content).length - 1;
  ok(count === 1, '相同内容不重复注入');
  ok(report.items.some(item => item.id === 'item_dup' && item.status === 'duplicate'), '报告标记重复');
}

/* 6. 预算：超出部分不注入，报告给出原因 */
{
  const { state, preset, chat, contact } = stateWithPreset();
  const context = normalizeReplyContext(preset.context);
  context.charBudget = 2000;
  preset.context = context;
  const items = normalizeReplyItems(preset.items, context);
  items.push({
    id: 'item_big', label: '超长条目', role: 'system', kind: 'chat', auto: '', app: '', characters: [],
    content: '长'.repeat(1600), enabled: true, editable: true, deletable: true, order: 99.1,
  });
  items.push({
    id: 'item_big2', label: '又一条超长', role: 'system', kind: 'chat', auto: '', app: '', characters: [],
    content: '更'.repeat(1600), enabled: true, editable: true, deletable: true, order: 99.2,
  });
  preset.items = items;
  const { report } = await buildReplyMessages(state, chat, contact);
  ok(report.items.some(item => item.status === 'over-budget'), '超出整套预算的条目不注入');
  ok(report.charUsed <= report.charBudget, '实际占用不超过预算');
}

/* 7. 排序：order 决定消息先后 */
{
  const { state, preset, chat, contact } = stateWithPreset();
  const items = normalizeReplyItems(preset.items, preset.context);
  const footer = findItem(items, 'reply_item_footer');
  footer.order = 0;
  preset.items = items;
  const { messages } = await buildReplyMessages(state, chat, contact);
  const firstItem = messages.find(message => message.role === 'user' && !message.content.includes('：'));
  ok(firstItem?.source === '尾部', '排序后尾部条目排到最前');
}

/* 8. 旧预设兼容：没有新条目时自动补 lorebook / scene，且默认开启 */
{
  const legacy = [
    { id: 'reply_context_character', auto: 'character', label: '角色档案', kind: 'context', enabled: true, order: 0 },
    { id: 'reply_item_custom', label: '自定义', kind: 'chat', content: '在吗', enabled: true, order: 1 },
  ];
  const items = normalizeReplyItems(legacy, {});
  ok(!!findItem(items, 'reply_context_lorebook'), '旧预设补上人设世界书条目');
  ok(!!findItem(items, 'reply_context_scene'), '旧预设补上场景条目');
  ok(findItem(items, 'reply_context_lorebook').enabled === true, '补上的条目默认开启');
  ok(findItem(items, 'reply_item_custom').characters.length === 0, '旧条目默认适用全部角色');
}

/* 9. 预设之间互不覆盖：改一套的条目不影响另一套 */
{
  const state = demoState();
  const list = replyPresetsOf(state);
  ok(list.length >= 1, '演示数据至少有一套预设');
  const first = list[0];
  const second = { ...first, id: 'reply_copy', name: '副本', items: normalizeReplyItems(first.items, first.context), context: { ...first.context } };
  state.settings.reply.presets.push(second);
  findItem(normalizeReplyItems(second.items, second.context), 'reply_context_character').enabled = false;
  second.items = normalizeReplyItems(second.items, second.context);
  ok(findItem(normalizeReplyItems(first.items, first.context), 'reply_context_character').enabled === true, '改副本不影响原预设');
}

/* 10. 小剧场开关：默认不请，打开后提示词进上下文 */
{
  const { state, chat, contact } = stateWithPreset();
  ok(extrasEnabledFor(state, contact.id) === false, '小剧场默认关闭');
  state.extrasOn = [contact.id];
  ok(extrasEnabledFor(state, contact.id) === true, '打开后按角色生效');
  ok(theaterKindFor(state) === 'daily', '小剧场类型默认是日常');
  const prompt = theaterPrompt(contact.name);
  const { messages } = await buildReplyMessages(state, chat, contact, { extraPrompt: prompt });
  const theater = messages.find(message => message.source === '小剧场');
  ok(!!theater, '打开后小剧场提示词进了上下文');
  ok(theater.content.includes('<phone-extras>'), '提示词带返回协议');
  ok(messages[messages.length - 1].role === 'user', '小剧场提示词在最后一条聊天之前');
  const lastPresetAt = messages.reduce((last, message, index) => (message.id ? index : last), -1);
  ok(messages.indexOf(theater) > lastPresetAt, '小剧场排在全部预设条目之后');
}

/* 类型：四种 id、非法值回退、不同提示词、设置归一化 */
{
  ok(THEATER_KINDS.length === 4, '内置四种小剧场类型');
  ok(THEATER_KINDS.every(kind => ['daily', 'meta', 'dream', 'nsfw'].includes(kind.id)), '类型 id 完整');
  ok(normalizeTheaterKind('meta') === 'meta', '合法类型保留');
  ok(normalizeTheaterKind('adult') === 'daily', '非法类型回退日常');
  ok(theaterKindById('dream').page === 'dream', '类型带自己的页面模板');
  const metaPrompt = theaterPrompt('沈砚', 'meta');
  ok(metaPrompt.includes('Meta') && metaPrompt.includes('吐槽'), 'Meta 提示词单独生成');
  const nsfwPrompt = theaterPrompt('沈砚', 'nsfw');
  ok(nsfwPrompt.includes('不写露骨性行为') && nsfwPrompt.includes('成年角色'), 'NSFW 提示词保持克制边界');
  const state = demoState();
  state.settings.theater.kind = 'nsfw';
  ok(theaterKindFor(state) === 'nsfw', '当前类型从 settings 读取');
  const normalized = normalize(state);
  ok(normalized.settings.theater.kind === 'nsfw', '类型写入 settings.theater.kind');
  normalized.settings.theater.kind = 'bad';
  ok(theaterKindFor(normalize(normalized)) === 'daily', '存档里的非法类型回退日常');
}

/* 11. 返回解析：块要从聊天里摘掉，角色对不上不存 */
{
  const raw = '今晚有点冷。\n<phone-extras>{"role":"沈砚","sections":[{"title":"心理活动","content":"他把手插回口袋。"},{"title":"小彩蛋","content":"路灯下多等了两分钟。"}]}</phone-extras>';
  const split = splitTheaterBlocks(raw, '沈砚');
  ok(split.text === '今晚有点冷。', '聊天只留正文');
  ok(split.sections.length === 2, '两节小剧场解析出来');
  ok(splitTheaterBlocks(raw, '江迟').sections.length === 0, '角色对不上不存');
  const broken = splitTheaterBlocks('好。<phone-extras>{"role":"沈砚"', '沈砚');
  ok(!broken.text.includes('phone-extras'), '没闭合的块也不会留在聊天里');
}

/* 12. 存进 App：新条目在最前，带来源消息、类型和分节 */
{
  const state = demoState();
  const chat = chatsOf(state)[0];
  const before = (state.extras[chat.contactId] || []).length;
  const entry = addExtrasEntry(state, chat.contactId, [{ title: '心理活动', content: '一句' }], {
    chatId: chat.id, messageId: 'm_test', kind: 'meta',
  });
  ok(!!entry && entry.lines[0] === '心理活动：一句', '小剧场存成 App 条目');
  ok(entry.kind === 'meta', '条目保留小剧场类型');
  ok(entry.sections[0].title === '心理活动' && entry.sections[0].content === '一句', '条目保留原始分节');
  ok(state.extras[chat.contactId].length === before + 1, '条目数加一');
  ok(state.extras[chat.contactId][0].id === entry.id, '新条目排在最前');
  ok(entry.messageId === 'm_test' && entry.chatId === chat.id, '条目记住来源消息');
}

/* 13. 旧条目兼容：没有类型/分节时补日常，并从 lines 还原 */
{
  const state = demoState();
  const contactId = chatsOf(state)[0].contactId;
  state.extras[contactId] = [{
    id: 'x_old', title: '旧片段', date: '2026-11-01', lines: ['心理活动：把手插回口袋。', '小彩蛋：多等了两分钟。'],
  }];
  const normalized = normalize(state);
  const entry = normalized.extras[contactId][0];
  ok(entry.kind === 'daily', '旧条目默认补成日常');
  ok(entry.sections.length === 2 && entry.sections[0].title === '心理活动', '旧条目从 lines 还原分节');
  ok(entry.lines.length === 2, '旧条目保留原 lines');
}

/* 内置「自然发消息」仍是旧 13 条时，首次读取升级为完整默认；自建预设不动 */
{
  const legacyIds = [
    'reply_item_phone_task', 'reply_item_behavior', 'reply_context_user',
    'reply_context_character', 'reply_context_lorebook', 'reply_context_memory',
    'reply_context_scene', 'reply_context_history', 'reply_context_time',
    'reply_item_detail', 'reply_item_chinese', 'reply_item_format', 'reply_item_footer',
  ];
  const state = demoState();
  state.settings.reply.presets = [
    { id: 'reply_natural', name: '自然', text: '旧回复指令', context: {}, items: legacyIds.map((id, index) => ({ id, order: index })) },
    { id: 'reply_mine', name: '自建', text: '自建指令', context: {}, items: [{ id: 'reply_item_custom', label: '自定义', content: '保留我', order: 0 }] },
  ];
  state.settings.reply.activeId = 'reply_natural';
  const merged = normalize(state);
  const builtIn = merged.settings.reply.presets.find(preset => preset.id === 'reply_natural');
  const mine = merged.settings.reply.presets.find(preset => preset.id === 'reply_mine');
  const builtInMain = builtIn.items.find(item => item.id === REPLY_INSTRUCTION_ID);
  const mineMain = mine.items.find(item => item.id === REPLY_INSTRUCTION_ID);
  ok(builtIn.items.length === 29, '旧内置预设升级为 29 条');
  ok(builtInMain?.content === '旧回复指令', '旧回复指令迁进普通条目');
  ok(!builtIn.text, '旧内置预设不再单独存回复指令');
  ok(mine.items.some(item => item.id === 'reply_item_custom'), '用户自建预设不被覆盖');
  ok(mineMain?.content === '自建指令', '用户自建预设的回复指令也迁进条目');
}

/* 13. token 估算：中文按字、英文按 4 字符 */
{
  ok(estimateTokens('你好') === 2, '中文两字约 2 tk');
  ok(estimateTokens('abcd') === 1, '四个英文约 1 tk');
  ok(estimateTokens('abcde') === 2, '英文超过四个向上取整');
}

/* 14. 请求构成统计：分组、总数、可排除最后一条 */
{
  const messages = [
    { role: 'system', content: '你好', source: '回复要求' },
    { role: 'user', content: 'hello world', source: '最后一条聊天' },
  ];
  const stats = requestStats(messages);
  ok(stats.rows.length === 2, '逐条统计两条');
  ok(stats.groups.some(group => group.key === 'rule') && stats.groups.some(group => group.key === 'turn'), '规则与本条分组都在');
  ok(stats.total > 0 && stats.total === stats.rows.reduce((sum, row) => sum + row.tokens, 0), '总数等于逐条之和');

  const { state, chat, contact } = stateWithPreset();
  const omitted = await buildReplyMessages(state, chat, contact, { memoryText: '', omitLastUser: true });
  ok(!omitted.messages.some(message => message.source === '最后一条聊天'), 'omitLastUser 后不带最后一条');
  const normal = await buildReplyMessages(state, chat, contact, { memoryText: '' });
  ok(normal.messages.some(message => message.source === '最后一条聊天'), '默认组装仍带最后一条');
}

console.log(`\n${passed} 项通过`);
