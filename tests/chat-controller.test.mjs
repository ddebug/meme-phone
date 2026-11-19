import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import {
  startGeneration, generationValid, finishGeneration, cancelGeneration,
  __resetGenerationsForTests,
} from '../meme/apps/chat.js';

function makeCtx(epoch = 1, chats = ['c1']) {
  return { epoch: () => epoch, state: { chats: Object.fromEntries(chats.map(id => [id, {}])) } };
}

afterEach(() => __resetGenerationsForTests());

test('B1：同一会话已有在途任务时，第二次启动被拒绝（不重复请求）', () => {
  const ctx = makeCtx();
  const first = startGeneration(ctx, 'c1', 'reply');
  const second = startGeneration(ctx, 'c1', 'proactive');
  assert.ok(first);
  assert.equal(second, null);
});

test('B1：不同会话互不阻塞，可以并行', () => {
  const ctx = makeCtx(1, ['c1', 'c2']);
  const t1 = startGeneration(ctx, 'c1', 'reply');
  const t2 = startGeneration(ctx, 'c2', 'proactive');
  assert.ok(t1 && t2);
  assert.notEqual(t1.reqId, t2.reqId);
});

test('B1：状态代次变更后，旧任务失效（导入 / 清空后不能再提交）', () => {
  const ctx1 = makeCtx(1);
  const task = startGeneration(ctx1, 'c1', 'reply');
  assert.equal(generationValid(ctx1, task, 'c1'), true);
  const ctx2 = makeCtx(2);
  assert.equal(generationValid(ctx2, task, 'c1'), false);
});

test('B1：会话被删除后，旧任务失效', () => {
  const ctx = makeCtx(1, ['c1']);
  const task = startGeneration(ctx, 'c1', 'reply');
  assert.equal(generationValid(ctx, task, 'c1'), true);
  const gone = makeCtx(1, ['c2']);
  assert.equal(generationValid(gone, task, 'c1'), false);
});

test('B1：取消后任务失效，且不承诺中止网络（仅忽略结果）', () => {
  const ctx = makeCtx();
  const task = startGeneration(ctx, 'c1', 'reply');
  cancelGeneration('c1', 'chat-cleared');
  assert.equal(generationValid(ctx, task, 'c1'), false);
});

test('B1：任务结束后同一会话可再次启动', () => {
  const ctx = makeCtx();
  const t1 = startGeneration(ctx, 'c1', 'reply');
  finishGeneration('c1');
  const t2 = startGeneration(ctx, 'c1', 'reply');
  assert.ok(t2);
  assert.notEqual(t1.reqId, t2.reqId);
});
