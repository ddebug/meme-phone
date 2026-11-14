/**
 * 回复预设上下文组装的纯逻辑验收（node scripts/test-context.mjs）。
 * 不碰 DOM，不连酒馆；用 demoState 验证开关、角色路由、世界书、去重、预算和排序。
 */

import {
  demoState, normalizeReplyContext, normalizeReplyItems, replyPresetFor, replyPresetsOf, chatsOf,
  extrasEnabledFor, theaterPrompt, splitTheaterBlocks, addExtrasEntry,
} from '../meme/data.js';
import { buildReplyMessages } from '../meme/reply-context.js';

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

/* 1. 默认预设：七类上下文都在，世界书常驻 + 关键词命中 */
{
  const { state, chat, contact } = stateWithPreset();
  const { messages, report } = await buildReplyMessages(state, chat, contact);
  const text = contents(messages);
  ok(report.items.some(item => item.id === 'reply_context_lorebook' && item.status === 'injected'), '人设世界书条目已注入');
  ok(text.includes('【人设世界书 · 夜班人物】'), '世界书标题带当前人设绑定的书名');
  ok(text.includes('【店长】'), '常驻条目无条件注入');
  ok(text.includes('【夜班】'), '关键词条目按最近聊天命中（便利店）');
  ok(!text.includes('【旧毛衣】'), '关闭的世界书条目不注入');
  ok(text.includes('【角色档案 · 沈砚】'), '角色档案按角色卡读取');
  ok(text.includes('【场景信息】'), '场景信息单独成条');
  ok(text.includes('【手机聊天记录】'), '聊天记录按条数注入');
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
  const count = contents(messages).split('角色必须用中文回复。').length - 1;
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
  const prompt = theaterPrompt(contact.name);
  const { messages } = await buildReplyMessages(state, chat, contact, { extraPrompt: prompt });
  const theater = messages.find(message => message.source === '小剧场');
  ok(!!theater, '打开后小剧场提示词进了上下文');
  ok(theater.content.includes('<phone-extras>'), '提示词带返回协议');
  ok(messages[messages.length - 1].role === 'user', '小剧场提示词在最后一条聊天之前');
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

/* 12. 存进 App：新条目在最前，带来源消息 */
{
  const state = demoState();
  const chat = chatsOf(state)[0];
  const before = (state.extras[chat.contactId] || []).length;
  const entry = addExtrasEntry(state, chat.contactId, [{ title: '心理活动', content: '一句' }], { chatId: chat.id, messageId: 'm_test' });
  ok(!!entry && entry.lines[0] === '心理活动：一句', '小剧场存成 App 条目');
  ok(state.extras[chat.contactId].length === before + 1, '条目数加一');
  ok(state.extras[chat.contactId][0].id === entry.id, '新条目排在最前');
  ok(entry.messageId === 'm_test' && entry.chatId === chat.id, '条目记住来源消息');
}

console.log(`\n${passed} 项通过`);
