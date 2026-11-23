import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DIARY_PROMPT, normalize } from '../meme/data.js';

const LEGACY_LONG = `站在角色自己的视角写日记，第一人称“我”指日记作者，而不是用户。
根据角色资料和完整聊天历史保持角色的身份、语气及与用户的关系。
按指定日期分别写，每篇按时间顺序，标出大概几点。适度压缩重要事件、互动、感受和关系变化，不要逐句复述。
不强制保留用户原话；确有必要时可择要引用，但引用必须与原文一致，不伪造原话。
只记录聊天中能确认的事情。隔天转述的旧事要说明是当日回顾；不编造线下行动、关系或动机，不把猜测当成事实。
保持角色平时的语感，不要写成说明书。`;

const LEGACY_SHORT = '站在角色的第一人称写这一天的日记。按时间顺序，标上大概几点。保留有意思的原话，用引号引出来，不改字、不润色，错别字和语气词也保留。一天不超过 20 条聊天就不用总结。';

test('默认日记提示词锁定为当前口径，并带 500 字上限', () => {
  assert.equal(DEFAULT_DIARY_PROMPT, `站在角色自己的视角写日记，第一人称“我”指日记作者，而不是用户。
根据角色资料和完整聊天历史保持角色的身份、语气及与用户的关系。
按指定日期分别写，每篇按时间顺序，标出大概几点。适度压缩重要事件、互动、感受和关系变化，不要逐句复述。
尽量保留用户原话，尤其是她对我说的话和有感情的句子，不改字，不润色，不伪造原话。
只记录聊天中能确认的事情。隔天转述的旧事要说明是当日回顾；不编造线下行动、关系或动机，不把猜测当成事实。
保持角色平时的语感，不要写成说明书。
每一天的总结在 500 字以内`);
});

test('旧存档里没改过的内置默认，升级后换成新默认', () => {
  for (const prompt of [LEGACY_LONG, LEGACY_SHORT]) {
    assert.equal(normalize({ diary: { prompt } }).diary.prompt, DEFAULT_DIARY_PROMPT);
  }
});

test('用户自己改过的日记提示词原样保留', () => {
  const custom = '按我的写法记日记，只写当天发生的事。';
  assert.equal(normalize({ diary: { prompt: custom } }).diary.prompt, custom);
});
