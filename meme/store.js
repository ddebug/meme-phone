/**
 * meme-phone · 存储
 *
 * 两种落盘位置：
 *   1. 酒馆里：/user/files/meme-phone.json（GET 读，/api/files/upload 写，写完回读校验）
 *   2. 单独打开预览页：localStorage
 *
 * 只有一处写入口（flush），保存失败会留在 dirty 状态并抛错，绝不静默丢数据。
 */

const DEFAULT_FILE = 'meme-phone.json';
const LS_KEY = 'meme-phone-state';

function utf8ToBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function createStore(options = {}) {
  const {
    fileName = DEFAULT_FILE,
    useLocalStorage = false,
    getHeaders = async () => ({}),
    fetchImpl = (...args) => globalThis.fetch(...args),
    onStatus = () => {},
    debounceMs = 700,
  } = options;

  let state = null;
  let dirty = false;
  let saving = false;
  let lastError = null;
  let timer = 0;
  let revision = '';

  function status() {
    return { ready: Boolean(state), dirty, saving, error: lastError, path: useLocalStorage ? `localStorage:${LS_KEY}` : `/user/files/${fileName}` };
  }

  function emit() { try { onStatus(status()); } catch { /* 状态广播不该影响主流程 */ } }

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

  return {
    status,

    /** 只读一次；失败不覆盖任何已有数据。 */
    async init() {
      try {
        const remote = await readRemote();
        revision = remote?.revision || '';
        state = remote?.meme || remote || null;
        lastError = null;
      } catch (error) {
        state = null;
        lastError = error.message || String(error);
        emit();
        throw error;
      }
      emit();
      return state;
    },

    get() { return state; },

    replace(next) { state = next; dirty = true; emit(); },

    /** 标记改动并排队落盘。返回的 promise 在真正写完时 resolve。 */
    touch() {
      dirty = true;
      emit();
      return new Promise((resolve, reject) => {
        const flushNow = () => { flush().then(resolve, reject); };
        clearTimeout(timer);
        timer = setTimeout(flushNow, debounceMs);
      });
    },

    async flush() {
      if (!state || !dirty) return state;
      if (saving) return state;
      saving = true;
      emit();
      const payload = { format: 'meme-phone', revision: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, meme: state };
      try {
        await writeRemote(payload);
        revision = payload.revision;
        dirty = false;
        lastError = null;
      } catch (error) {
        lastError = error.message || String(error);
        throw error;
      } finally {
        saving = false;
        emit();
      }
      return state;
    },

    /** 导出当前内存状态（设置面板与「设置 → 数据」共用）。 */
    exportJson() {
      return JSON.stringify(state, null, 2);
    },
  };
}
