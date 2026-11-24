/**
 * meme-phone · 旧双世界存档迁移
 *
 * 5ce6ce3 那一版是「整台手机双世界」：
 *   - 当前激活那台的数据放在顶层 contacts / chats / ...
 *   - Meta 快照放在 metaPhone.data
 *   - 每条同层小手机快照放在 worldPhones[id].data
 *   - phoneSurface / activeWorldId 记录当时停在哪一面
 *
 * 后来改成两个聊天 App 后，运行层只读顶层 chats，旧快照留在存档里没人读，
 * 用户升级后就会看到「聊天历史不见了」。这里在首次加载旧存档时把三份数据并回：
 *   - 顶层是同层小手机 → 顶层聊天补上 chat.world 标记；metaPhone.data 的聊天作为普通会话
 *   - 顶层是 Meta → 顶层保持普通会话；worldPhones[*].data 的聊天补上 chat.world
 *   - 联系人按 id 合并，重名不同人时给迁移过来的联系人换 id，并改掉对应 chat.contactId
 *
 * 只迁 contacts / chats。日记、小剧场、钱包等仍留原处，避免把多台手机的账混在一起。
 * 迁移完打上 legacyWorldsMerged，旧字段原样保留，不删除，方便用户回退版本。
 */

function isMap(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  if (value === undefined || value === null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function stripJsonl(value) {
  return String(value || '').replace(/\.jsonl$/i, '');
}

function uniqueKey(base, used) {
  let key = String(base || 'chat');
  let index = 2;
  while (used.has(key)) {
    key = `${base}_${index}`;
    index += 1;
  }
  return key;
}

function mergeContacts(target, source, prefix) {
  const remap = {};
  if (!isMap(source)) return remap;
  for (const [id, contact] of Object.entries(source)) {
    if (!id || !contact || typeof contact !== 'object') continue;
    if (!target[id]) {
      target[id] = clone(contact);
      remap[id] = id;
      continue;
    }
    const sameName = String(target[id].name || '') === String(contact.name || '');
    if (sameName) {
      remap[id] = id;
      continue;
    }
    const next = uniqueKey(`${prefix}_${id}`, new Set(Object.keys(target)));
    target[next] = clone(contact);
    remap[id] = next;
  }
  return remap;
}

function worldMetaOf(instance, chat) {
  return {
    kind: 'world',
    chatFile: stripJsonl(instance?.sourceChatFile),
    chatId: String(instance?.sourceChatId || ''),
    ownerName: String(instance?.ownerName || chat?.name || '这段聊天').slice(0, 40),
    ownerAvatar: String(instance?.ownerAvatar || ''),
    storyDate: String(instance?.storyDate || '第 1 天').slice(0, 30),
    origin: 'legacy-world',
    createdAt: Number(instance?.createdAt) || 0,
    queue: [],
    lastSyncAt: 0,
    lastSyncError: '',
  };
}

function isWorld(chat) {
  return chat?.world?.kind === 'world';
}

function hasWorldFile(state, instance) {
  const file = stripJsonl(instance?.sourceChatFile);
  if (!file) return false;
  return Object.values(state.chats || {}).some(chat => isWorld(chat) && stripJsonl(chat.world?.chatFile) === file);
}

function mergeChats(state, chats, remap, instance, {
  rename = true, asWorld = true, inPlace = false, skipNormalExisting = false,
} = {}) {
  if (!isMap(chats)) return 0;
  const used = new Set(Object.keys(state.chats || {}));
  let merged = 0;
  for (const [oldId, rawChat] of Object.entries(chats)) {
    if (!rawChat || typeof rawChat !== 'object') continue;
    let id = String(oldId);
    if (rename === 'always' || (rename === 'collision' && used.has(id))) {
      id = uniqueKey(`${instance?.id || 'legacy'}_${oldId}`, used);
    }
    /* 已经是普通会话的同一个 id：说明之前迁过，别再复制一份。 */
    if (skipNormalExisting && state.chats[id] && !isWorld(state.chats[id])) continue;
    const chat = inPlace ? rawChat : clone(rawChat);
    chat.id = id;
    if (chat.contactId && remap?.[chat.contactId]) chat.contactId = remap[chat.contactId];
    if (asWorld) {
      /* 已经带 world 标记的会话不再覆盖，避免把新版写回队列和同步时间冲掉。 */
      if (!isWorld(chat)) {
        chat.world = worldMetaOf(instance, chat);
        chat.worldPhoneId = String(instance?.id || '');
      }
    }
    state.chats[id] = chat;
    used.add(id);
    merged += 1;
  }
  return merged;
}

/**
 * 把旧双世界快照并进当前 state。返回是否真的做了迁移。
 * 已经是新结构（没有 metaPhone/worldPhones 数据）时不打标记，等以后真遇到旧存档再迁。
 */
export function migrateLegacyWorlds(raw, state) {
  if (!isMap(raw) || !isMap(state)) return false;
  if (raw.legacyWorldsMerged) return false;

  const metaData = isMap(raw.metaPhone?.data) ? raw.metaPhone.data : null;
  const worldPhones = isMap(raw.worldPhones) ? raw.worldPhones : {};
  const worldList = Object.entries(worldPhones)
    .filter(([, item]) => isMap(item?.data))
    .map(([key, instance]) => ({ key, instance }));
  if (!metaData && !worldList.length) return false;

  state.contacts = isMap(state.contacts) ? state.contacts : {};
  state.chats = isMap(state.chats) ? state.chats : {};

  const activeId = String(raw.activeWorldId || '');
  const activeEntry = activeId ? worldPhones[activeId] : null;
  const surfaceWorld = raw.phoneSurface === 'world' && isMap(activeEntry?.data);

  if (surfaceWorld) {
    /* 顶层就是当前这台同层小手机：直接给顶层聊天补 world 标记，不复制。 */
    mergeChats(state, state.chats, {}, activeEntry, {
      rename: false, asWorld: true, inPlace: true,
    });
    if (metaData) {
      const remap = mergeContacts(state.contacts, metaData.contacts, 'meta');
      mergeChats(state, metaData.chats, remap, null, {
        rename: 'collision', asWorld: false, skipNormalExisting: true,
      });
    }
  } else {
    /* 顶层是 Meta：保持普通会话，把每条同层小手机快照并进来。 */
    for (const { key, instance } of worldList) {
      if (hasWorldFile(state, instance)) continue;
      const prefix = `world_${key || instance.id || 'x'}`;
      const remap = mergeContacts(state.contacts, instance.data.contacts, prefix);
      mergeChats(state, instance.data.chats, remap, instance, { rename: 'always', asWorld: true });
    }
  }

  /* 顶层是同层小手机时，其它同层小手机快照也要并进来，不能只恢复当前那台。 */
  if (surfaceWorld) {
    for (const { key, instance } of worldList) {
      if (String(key) === activeId || String(instance.id || '') === activeId) continue;
      if (hasWorldFile(state, instance)) continue;
      const prefix = `world_${key || instance.id || 'x'}`;
      const remap = mergeContacts(state.contacts, instance.data.contacts, prefix);
      mergeChats(state, instance.data.chats, remap, instance, { rename: 'always', asWorld: true });
    }
  }

  state.legacyWorldsMerged = true;
  state.legacyWorldsMergedAt = Date.now();
  return true;
}

/* --------------------------------------------------------------- 日记 */

function mergeDiaryEntries(target, source) {
  if (!isMap(source)) return 0;
  let added = 0;
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry !== 'object') continue;
    const existing = target[key];
    /* 只补缺，不覆盖：同一天已经有正文就以当前这份为准，别让别的世界线把它冲掉。 */
    if (existing && String(existing.text || '').trim()) continue;
    if (!String(entry.text || '').trim() && existing) continue;
    target[key] = clone(entry);
    added += 1;
  }
  return added;
}

function mergeDiary(target, source) {
  if (!isMap(source) || !isMap(source.contacts)) return 0;
  target.contacts = isMap(target.contacts) ? target.contacts : {};
  let added = 0;
  for (const [contactId, map] of Object.entries(source.contacts)) {
    if (!contactId || !isMap(map)) continue;
    if (!isMap(target.contacts[contactId])) {
      target.contacts[contactId] = clone(map);
      added += Object.keys(map).length;
    } else {
      added += mergeDiaryEntries(target.contacts[contactId], map);
    }
  }
  return added;
}

/**
 * 旧双世界存档里，角色日记也跟着世界线各存一份（diary.contacts[contactId]）。
 * 新结构只保留聊天里的角色日记，不再恢复全局日记；这里只把缺的角色日期补进来，
 * 同一天已有正文的不覆盖。单独打 legacyDiaryMerged，已经迁过聊天的存档也会再跑一次。
 */
export function migrateLegacyDiaries(raw, state) {
  if (!isMap(raw) || !isMap(state)) return false;
  if (raw.legacyDiaryMerged) return false;

  const sources = [];
  if (isMap(raw.metaPhone?.data?.diary)) sources.push(raw.metaPhone.data.diary);
  for (const item of Object.values(isMap(raw.worldPhones) ? raw.worldPhones : {})) {
    if (isMap(item?.data?.diary)) sources.push(item.data.diary);
  }
  if (!sources.length) return false;

  state.diary = isMap(state.diary) ? state.diary : { entries: {}, contacts: {} };
  sources.forEach(source => mergeDiary(state.diary, source));

  state.legacyDiaryMerged = true;
  state.legacyDiaryMergedAt = Date.now();
  return true;
}

