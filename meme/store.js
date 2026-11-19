/**
 * meme-phone · 存储
 *
 * 两种落盘位置：
 *   1. 酒馆里：/user/files/meme-phone.json（GET 读，/api/files/upload 写，写完回读校验）
 *   2. 单独打开预览页：localStorage
 *
 * 只有一处写入口。可靠性口径：
 *   - 单写者队列：同一时刻只有一轮持久化在跑；保存期间又被改动，写完后自动再存一版。
 *   - changeSeq / savedSeq：每次改动领一个序号，等待者等到覆盖自己序号的那轮保存才结束。
 *   - 写入用不可变快照，不把仍在变动的 live state 直接序列化进请求。
 *   - 失败保留 dirty 与当前内存，不清用户编辑；可重试、可导出备份。
 *   - 状态区分：待保存 / 保存中 / 已保存 / 失败 / 结果不确定。
 *
 * 多标签边界：宿主文件接口没有提供条件写入（按 revision 比较再覆盖），
 * 这里只能靠写完回读校验；无法在提交前排除另一标签刚好同时写同一文件。
 * 因此不宣称“GET 回读”解决了所有竞争，真出现双写时以回读到的远端为准并提示不确定。
 */

const DEFAULT_FILE = 'meme-phone.json';
const LS_KEY = 'meme-phone-state';

import { stripSecrets } from './data.js';

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function genRevision() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStore(options = {}) {
  const {
    fileName = DEFAULT_FILE,
    useLocalStorage = false,
    getHeaders = async () => ({}),
    fetchImpl = (...args) => globalThis.fetch(...args),
    onStatus = () => {},
  } = options;

  let state = null;
  let dirty = false;
  let saving = false;
  let savePromise = null;
  let lastError = null;
  let uncertain = false;
  let revision = '';
  /* changeSeq：领号的改动序号；savedSeq：已确认落盘到的序号。 */
  let changeSeq = 0;
  let savedSeq = 0;
  let waiters = [];

  function status() {
    return {
      ready: Boolean(state),
      dirty,
      saving,
      error: lastError,
      uncertain,
      changeSeq,
      savedSeq,
      path: useLocalStorage ? `localStorage:${LS_KEY}` : `/user/files/${fileName}`,
    };
  }

  function emit() { try { onStatus(status()); } catch { /* 状态广播不该影响主流程 */ } }

  function settleWaiters(error, persistedSeq = 0) {
    const due = [];
    const rest = [];
    for (const waiter of waiters) {
      if (error || waiter.seq <= persistedSeq) due.push(waiter);
      else rest.push(waiter);
    }
    waiters = rest;
    for (const waiter of due) {
      if (error) waiter.reject(error);
      else waiter.resolve();
    }
  }

  async function readRemote() {
    if (useLocalStorage) {
      const raw = globalThis.localStorage?.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    }
    const response = await fetchImpl(`/user/files/${encodeURIComponent(fileName)}`, {
      method: 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`读取失败 HTTP ${response.status}`);
    const text = await response.text();
    if (!text.trim()) return null;
    return JSON.parse(text);
  }

  async function writeRemote(payload) {
    if (useLocalStorage) {
      globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(payload));
      return;
    }
    const headers = new Headers(await getHeaders());
    headers.set('Content-Type', 'application/json');
    const response = await fetchImpl('/api/files/upload', {
      method: 'POST', credentials: 'same-origin', headers,
      body: JSON.stringify({ name: fileName, data: utf8ToBase64(JSON.stringify(payload)) }),
    });
    if (!response.ok) throw new Error(`保存未确认 HTTP ${response.status}（请先导出备份，刷新后再试）`);
    const readback = await readRemote();
    if (!readback || readback.revision !== payload.revision) {
      throw new Error('回读校验不一致（保存结果不确定，请先导出备份，刷新后再试）');
    }
  }

  /* 单 worker 循环：同一时刻只有一轮持久化在跑；保存期间又有改动，本轮结束后按序号再存一版。 */
  async function worker() {
    saving = true;
    emit();
    try {
      while (state && dirty) {
        const snapshotSeq = changeSeq;
        /* 落盘的是此刻的不可变快照：写入过程中 live state 再怎么改，也不会混进这一版请求。 */
        const payload = { format: 'meme-phone', revision: genRevision(), meme: clone(state) };
        try {
          await writeRemote(payload);
          revision = payload.revision;
          savedSeq = changeSeq;
          lastError = null;
          settleWaiters(null, savedSeq);
        } catch (error) {
          lastError = error.message || String(error);
          uncertain = /回读|不确定/.test(lastError);
          /* 保留 dirty 与内存内容；等待者收到失败，但编辑不会被清掉，下次 touch/flush 会重试。 */
          settleWaiters(new Error(lastError));
          break;
        }
        /* 这一轮保存期间又有新改动：序号对不上，继续存下一版；否则收尾清掉 dirty。 */
        if (changeSeq === snapshotSeq) {
          dirty = false;
          break;
        }
      }
    } finally {
      saving = false;
      emit();
      if (state && dirty) schedule();
    }
  }

  function schedule() {
    if (saving || savePromise) return;
    savePromise = worker().finally(() => { savePromise = null; });
  }

  const api = {
    status,

    /** 只读一次；失败不覆盖任何已有数据。 */
    async init() {
      try {
        const remote = await readRemote();
        revision = remote?.revision || '';
        state = remote?.meme || remote || null;
        changeSeq = 0;
        savedSeq = 0;
        lastError = null;
        uncertain = false;
      } catch (error) {
        state = null;
        lastError = error.message || String(error);
        uncertain = true;
        emit();
        throw error;
      }
      emit();
      return state;
    },

    get() { return state; },

    /** 整份替换状态（导入 / 清空）。旧等待者按“状态已替换”结算，避免旧保存结果绑到新状态上。 */
    replace(next) {
      settleWaiters(new Error('状态已替换'));
      state = next;
      dirty = true;
      changeSeq += 1;
      uncertain = false;
      emit();
      schedule();
    },

    /** 标记改动并排队落盘。返回的 promise 等到覆盖本次改动序号的保存成功才 resolve。 */
    touch() {
      dirty = true;
      const seq = ++changeSeq;
      emit();
      const promise = new Promise((resolve, reject) => {
        waiters.push({ seq, resolve, reject });
      });
      schedule();
      return promise;
    },

    /** 立即把当前版本落盘；失败抛错并保留 dirty。可作为重试入口。 */
    async flush() {
      if (!state) return state;
      if (!dirty) return state;
      schedule();
      await savePromise;
      if (lastError) throw new Error(lastError);
      return state;
    },

    /** 失败后手动重试一轮。 */
    retry() {
      return api.flush();
    },

    /** 导出当前内存状态；默认剔除接口 Key，includeKeys=true 才带上凭据。 */
    exportJson(includeKeys = false) {
      const snapshot = includeKeys ? state : stripSecrets(state);
      return JSON.stringify(snapshot, null, 2);
    },
  };

  return api;
}
