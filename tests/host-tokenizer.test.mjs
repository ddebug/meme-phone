import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countTextTokens, __resetHostScriptForTests } from '../meme/host.js';

test('countTextTokens 优先用酒馆分词器，缺失时退回 null', async () => {
  const previous = globalThis.SillyTavern;
  try {
    __resetHostScriptForTests();
    globalThis.SillyTavern = {
      getContext: () => ({ getTokenCountAsync: async text => [...String(text || '')].length }),
    };
    assert.equal(await countTextTokens('ab😀'), 3);

    __resetHostScriptForTests();
    globalThis.SillyTavern = { getContext: () => ({}) };
    assert.equal(await countTextTokens('abc'), null);
  } finally {
    if (previous === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = previous;
    __resetHostScriptForTests();
  }
});
