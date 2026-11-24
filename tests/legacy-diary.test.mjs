import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../meme/data.js';
import { migrateLegacyDiaries } from '../meme/legacy-world.js';

function diary(entries = {}, contacts = {}) {
  return { enabled: true, prompt: '', pastOnly: true, entries, contacts };
}

function entry(text, createdAt = 0) {
  return { key: '', text, tags: [], auto: false, createdAt };
}

test('旧双世界存档：metaPhone 和 worldPhones 里缺的日记日期都会补回来', () => {
  const raw = {
    version: 3,
    contacts: {},
    chats: {},
    diary: diary(),
    legacyWorldsMerged: true, /* 聊天已经迁过，日记仍要单独跑 */
    metaPhone: {
      data: {
        diary: diary({
          '2026-11-01': entry('Meta 线的日记', 1),
        }),
      },
    },
    worldPhones: {
      w1: {
        data: {
          diary: diary({
            '2026-11-01': entry('里世界同一天的日记', 9),
            '2026-11-03': entry('里世界的另一天', 3),
          }),
        },
      },
    },
  };
  const state = normalize(raw);
  assert.equal(Object.keys(state.diary.entries).length, 0);

  const changed = migrateLegacyDiaries(raw, state);
  assert.equal(changed, true);
  assert.equal(Object.keys(state.diary.entries).length, 2);
  assert.equal(state.diary.entries['2026-11-01'].text, 'Meta 线的日记');
  assert.equal(state.diary.entries['2026-11-03'].text, '里世界的另一天');
  assert.equal(state.legacyDiaryMerged, true);
});

test('同一天已经有正文就不覆盖，只补空日期', () => {
  const raw = {
    version: 3,
    contacts: {},
    chats: {},
    diary: diary({ '2026-11-02': entry('当前这份', 5) }),
    worldPhones: {
      w1: { data: { diary: diary({ '2026-11-02': entry('别的世界线', 99), '2026-11-04': entry('补进来的', 1) }) } },
    },
  };
  const state = normalize(raw);
  const changed = migrateLegacyDiaries(raw, state);
  assert.equal(changed, true);
  assert.equal(state.diary.entries['2026-11-02'].text, '当前这份');
  assert.equal(state.diary.entries['2026-11-04'].text, '补进来的');
});

test('角色日记按联系人合并，缺的联系人整份补进来', () => {
  const raw = {
    version: 3,
    contacts: {},
    chats: {},
    diary: diary({}, {}),
    metaPhone: {
      data: {
        diary: diary({}, {
          c1: { '2026-11-01': entry('角色 A 的 Meta 日记') },
        }),
      },
    },
    worldPhones: {
      w1: {
        data: {
          diary: diary({}, {
            c1: { '2026-11-01': entry('角色 A 的里世界日记', 9), '2026-11-02': entry('角色 A 的另一天', 2) },
            c2: { '2026-11-05': entry('角色 B 的日记') },
          }),
        },
      },
    },
  };
  const state = normalize(raw);
  migrateLegacyDiaries(raw, state);
  assert.equal(state.diary.contacts.c1['2026-11-01'].text, '角色 A 的 Meta 日记');
  assert.equal(state.diary.contacts.c1['2026-11-02'].text, '角色 A 的另一天');
  assert.equal(state.diary.contacts.c2['2026-11-05'].text, '角色 B 的日记');
});

test('没有旧日记快照不动存档；迁移只做一次', () => {
  const fresh = { version: 3, contacts: {}, chats: {}, diary: diary() };
  const state = normalize(fresh);
  assert.equal(migrateLegacyDiaries(fresh, state), false);
  assert.equal(state.legacyDiaryMerged, undefined);

  const raw = {
    version: 3,
    contacts: {},
    chats: {},
    diary: diary(),
    metaPhone: { data: { diary: diary({ '2026-11-01': entry('旧日记') }) } },
  };
  const first = normalize(raw);
  assert.equal(migrateLegacyDiaries(raw, first), true);
  const persisted = JSON.parse(JSON.stringify(first));
  assert.equal(migrateLegacyDiaries(persisted, normalize(persisted)), false);
  assert.equal(Object.keys(normalize(persisted).diary.entries).length, 1);
});
