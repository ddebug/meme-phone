/**
 * meme-phone · 音乐
 * 歌单导入：网易云读公开歌单；汽水走官方歌单接口，拿全曲目后按歌名匹配可播版本。
 * 播放用一个常驻 Audio，页面重绘不会把正在放的歌打断。
 *
 * 音源坏了会自动换源：先试歌单自带的地址，再按「歌名 + 歌手」在网易云 / QQ音乐 / 酷狗
 * 逐个找可直接播放的链接，真的出声了才算换源成功，不会把不能播的地址写回歌单。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';
import { newId } from '../data.js';

const MUSIC_API = 'https://api.i-meto.com/meting/api';
const GD_API = 'https://music-api.gdstudio.xyz/api.php';
const READER_API = 'https://r.jina.ai/';
const ALLOWED_LINKS = ['music.163.com', '163cn.tv', 'qishui.douyin.com', 'music.douyin.com', 'api.qishui.com'];

/* 换源顺序：先歌单原来的地址，再按歌名到各家找。
   gdstudio 给的是网易云直链，比 meting 的转发地址更容易出声，所以放前面 */
const FALLBACK_SOURCES = [
  { id: 'netease', kind: 'gdstudio' },
  { id: 'netease', kind: 'meting' },
  { id: 'tencent', kind: 'meting' },
  { id: 'kugou', kind: 'meting' },
];
const SOURCE_LABEL = { netease: '网易云', tencent: 'QQ音乐', kugou: '酷狗', kuwo: '酷我', qishui: '汽水' };
const PLAY_TIMEOUT = 9000;

let audio = null;
let playing = false;
let current = null;
let queue = [];
let queueIndex = 0;
let queuePlaylistId = '';
let loadToken = 0;
let lastCtx = null;
let attemptDepth = 0;   // >0 表示正在试音源，此时 audio 的 error 不当作播放故障
let recovering = false; // 播放中途断了正在换源
let deadCandidates = []; // 这首已经断过的地址，同一轮里不再回头试，免得两个坏源来回跳

function musicOf(state) {
  if (!state.music || typeof state.music !== 'object') state.music = {};
  if (!Array.isArray(state.music.playlists)) state.music.playlists = [];
  if (!state.music.current || typeof state.music.current !== 'object') state.music.current = null;
  return state.music;
}

function secureUrl(url) {
  return String(url || '').replace(/^http:\/\//i, 'https://');
}

function jsonText(value) {
  try { return JSON.parse(`"${value}"`); } catch { return value; }
}

function fmtTime(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

/* ------------------------------------------------------------ 换源 */

function sourceLabel(id) {
  return SOURCE_LABEL[id] || '在线音源';
}

function normText(value) {
  return String(value == null ? '' : value)
    .toLowerCase()
    .replace(/[\s\-—_·・.,，。!！?？'"“”‘’()[\]【】]/g, '');
}

function searchKeyword(track) {
  const artist = String(track.artist || '').split(/[,，、/]/)[0].trim();
  return `${track.title || ''} ${artist}`.trim();
}

/** 按「歌名像 + 歌手像」排序，宁可少找几个源，也不把别的歌当成换源结果 */
function rankHits(list, track, titleKey = 'title', artistKey = 'author') {
  const wantTitle = normText(track.title);
  const wantArtist = normText(String(track.artist || '').split(/[,，、/]/)[0]);
  if (!wantTitle) return [];
  const scored = list.map((item, index) => {
    const title = normText(item && item[titleKey]);
    const rawArtist = item ? item[artistKey] : '';
    const artistText = normText(Array.isArray(rawArtist) ? rawArtist.join('') : rawArtist);
    let score = 0;
    if (title && title === wantTitle) score += 5;
    else if (title && (title.indexOf(wantTitle) >= 0 || wantTitle.indexOf(title) >= 0)) score += 2;
    if (wantArtist && artistText && artistText.indexOf(wantArtist) >= 0) score += 3;
    return { item, score, index };
  }).filter(entry => entry.item && entry.score >= 2);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(entry => entry.item);
}

function songIdFromUrl(url) {
  const match = String(url || '').match(/[?&]id=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function metingCandidates(spec, keyword, track) {
  const list = await fetchJson(`${MUSIC_API}?server=${encodeURIComponent(spec.id)}&type=search&id=${encodeURIComponent(keyword)}`);
  if (!Array.isArray(list)) return [];
  return rankHits(list, track)
    .slice(0, 2)
    .filter(hit => hit && hit.url)
    .map(hit => {
      const url = secureUrl(hit.url);
      return { url, via: spec.id, key: `${spec.id}:${songIdFromUrl(url) || url}` };
    });
}

async function gdstudioCandidates(spec, keyword, track) {
  const list = await fetchJson(`${GD_API}?types=search&count=6&source=${encodeURIComponent(spec.id)}&name=${encodeURIComponent(keyword)}`);
  if (!Array.isArray(list)) return [];
  const hits = rankHits(list, track, 'name', 'artist').slice(0, 2);
  const found = [];
  for (const hit of hits) {
    const id = String(hit.url_id || hit.id || '');
    if (!id) continue;
    try {
      const info = await fetchJson(`${GD_API}?types=url&id=${encodeURIComponent(id)}&source=${encodeURIComponent(spec.id)}`);
      if (info && info.url) found.push({ url: secureUrl(info.url), via: spec.id, key: `${spec.id}:${id}` });
    } catch { /* 这条拿不到播放地址，换下一条 */ }
  }
  return found;
}

/** 依次吐候选地址：歌单原有的 → 网易云直链 → 网易云 → QQ音乐 → 酷狗；同一首歌只试一次 */
async function* sourceCandidates(track, skip = []) {
  const seen = new Set();
  (skip || []).forEach(item => { const url = secureUrl(item); if (url) seen.add(url); });
  const cached = secureUrl(track.url);
  if (cached && !seen.has(cached)) {
    seen.add(cached);
    yield { url: cached, via: track.playVia || track.via || '', cached: true };
  }
  const keyword = searchKeyword(track);
  if (!keyword) return;
  for (const spec of FALLBACK_SOURCES) {
    let found = [];
    try {
      found = spec.kind === 'gdstudio'
        ? await gdstudioCandidates(spec, keyword, track)
        : await metingCandidates(spec, keyword, track);
    } catch { continue; }
    for (const item of found) {
      const url = secureUrl(item.url);
      if (!url) continue;
      const key = item.key || url;
      if (seen.has(url) || seen.has(key)) continue;
      seen.add(url);
      seen.add(key);
      yield { url, via: item.via || spec.id, cached: false };
    }
  }
}

/** 真正开始出声才算这个音源可用；404 / 版权 / 格式不对都会在超时前失败 */
function trySource(player, url, timeout = PLAY_TIMEOUT) {
  return new Promise(resolve => {
    let settled = false;
    let timer = 0;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      player.removeEventListener('error', onError);
      player.removeEventListener('playing', onPlaying);
      resolve(ok);
    };
    const onError = () => finish(false);
    const onPlaying = () => finish(true);
    timer = setTimeout(() => finish(false), timeout);
    player.addEventListener('error', onError);
    player.addEventListener('playing', onPlaying);
    try {
      player.src = url;
      const started = player.play();
      if (started && typeof started.then === 'function') {
        started.then(() => finish(true)).catch(error => {
          /* 被浏览器自动播放策略拦住不是音源的问题，别把它当成换源失败 */
          if (error && error.name === 'NotAllowedError') finish(true);
        });
      }
    } catch {
      finish(false);
    }
  });
}

function trackSourceTag(track) {
  if (track.dead) return '暂无可播源';
  const playing = track.playVia || track.via || '';
  const label = SOURCE_LABEL[playing] || '';
  if (!label) return '';
  const swapped = Boolean(track.swapped) || Boolean(track.via && playing && track.via !== playing);
  return swapped ? `${label}·换源` : label;
}

function trackFromState(state) {
  if (current) return current;
  const saved = state?.music?.current;
  if (!saved) return null;
  const playlist = (state.music.playlists || []).find(item => item.id === saved.playlistId);
  const track = playlist?.tracks?.find(item => item.id === saved.trackId);
  if (!track) return null;
  return { ...track, trackId: track.id, playlistId: playlist.id, playlistName: playlist.name };
}

function setCurrent(track, playlist) {
  current = { ...track, trackId: track.id, playlistId: playlist?.id || '', playlistName: playlist?.name || '' };
  playing = Boolean(audio && !audio.paused);
}

function paintProgress() {
  const node = document.getElementById('mpMusicBar');
  const time = document.getElementById('mpMusicTime');
  if (!node || !audio) return;
  const duration = Number(audio.duration) || 0;
  const now = Number(audio.currentTime) || 0;
  const pct = duration ? Math.min(100, now / duration * 100) : 0;
  node.style.width = `${pct}%`;
  if (time) time.textContent = `${fmtTime(now)} / ${duration ? fmtTime(duration) : '--:--'}`;
}

function paintPlayState() {
  playing = Boolean(audio && !audio.paused);
  document.querySelectorAll('[data-music-label]').forEach(node => {
    node.textContent = playing ? '暂停' : '播放';
  });
  document.querySelectorAll('[data-music-icon]').forEach(node => {
    node.innerHTML = icon(playing ? 'pause' : 'play');
  });
  paintProgress();
}

function ensureAudio() {
  if (audio) return audio;
  audio = new Audio();
  audio.preload = 'none';
  audio.addEventListener('timeupdate', paintProgress);
  audio.addEventListener('durationchange', paintProgress);
  audio.addEventListener('play', paintPlayState);
  audio.addEventListener('pause', paintPlayState);
  audio.addEventListener('ended', () => {
    playing = false;
    playNextByQueue();
  });
  audio.addEventListener('error', () => {
    playing = false;
    paintPlayState();
    if (!audio.src) return;            // 手动停止时清空了 src，不算故障
    if (attemptDepth > 0) return;      // 正在试音源，由换源流程决定下一条
    if (current) current.dead = true;
    if (typeof audio.__ctxToast === 'function') audio.__ctxToast('音源断了，正在自动换源…');
    recoverCurrent();
  });
  return audio;
}

export function stopMusic() {
  loadToken += 1;   // 让还在跑的换源流程立刻作废
  recovering = false;
  deadCandidates = [];
  if (audio) {
    try { audio.pause(); } catch { /* 忽略 */ }
    try { audio.removeAttribute('src'); audio.load(); } catch { /* 忽略 */ }
  }
  playing = false;
  current = null;
  queue = [];
  queueIndex = 0;
  queuePlaylistId = '';
}

function abortAfter(ms) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), ms);
  return { controller, done: () => clearTimeout(timer) };
}

async function fetchText(url, timeout = 22000) {
  const gate = abortAfter(timeout);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      signal: gate.controller?.signal,
    });
    if (!res.ok) throw new Error(`读取失败（${res.status}）`);
    return await res.text();
  } finally {
    gate.done();
  }
}

async function fetchJson(url) {
  const text = await fetchText(url, 16000);
  try { return JSON.parse(text); } catch { throw new Error('歌单返回格式不对'); }
}

function allowedLink(link) {
  try {
    const host = new URL(link).hostname;
    return ALLOWED_LINKS.some(item => host === item || host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

async function readPage(link) {
  if (!allowedLink(link)) throw new Error('只支持网易云或汽水的歌单链接');
  return fetchText(`${READER_API}${link}`, 26000);
}

async function resolveNeteaseId(text) {
  const raw = text.trim();
  if (/^\d{5,}$/.test(raw)) return raw;
  const idMatch = raw.match(/[?&]id=([0-9]{5,})/) || raw.match(/playlist\/([0-9]{5,})/);
  if (idMatch) return idMatch[1];
  const short = raw.match(/https?:\/\/[^\s]+/);
  if (!short) return '';
  const link = short[0];
  if (!/163cn\.tv|music\.163\.com/.test(link)) return '';
  const page = await readPage(link);
  const found = page.match(/music\.163\.com\/(?:#\/)?playlist(?:[^0-9]{0,30})([0-9]{5,})/)
    || page.match(/[?&]id=([0-9]{5,})/);
  return found ? found[1] : '';
}

async function neteaseMeta(id) {
  try {
    const text = await readPage(`https://music.163.com/api/v6/playlist/detail?id=${id}&n=0`);
    const name = text.match(/"playlist":\s*\{"id":[^\n]*?"name":"((?:\\.|[^"\\])*)"/);
    const cover = text.match(/"coverImgUrl":"((?:\\.|[^"\\])*)"/);
    return {
      name: name ? jsonText(name[1]) : '',
      cover: cover ? secureUrl(jsonText(cover[1])) : '',
    };
  } catch {
    return { name: '', cover: '' };
  }
}

function neteaseTracks(list, playlistId) {
  if (!Array.isArray(list)) throw new Error('网易云没返回歌曲列表');
  return list.slice(0, 300).map((item, index) => ({
    id: `ne_${playlistId}_${index}`,
    title: String(item.title || '未命名'),
    artist: String(item.author || '').replace(/\s*\/\s*/g, '、'),
    album: '',
    url: secureUrl(item.url || ''),
    pic: secureUrl(item.pic || ''),
    lrc: item.lrc || '',
    via: 'netease',
  })).filter(item => item.title);
}

async function importNetease(ctx, raw) {
  const id = await resolveNeteaseId(raw);
  if (!id) throw new Error('没认出网易云歌单 ID，请粘贴带 playlist?id= 的完整链接');
  const [meta, tracks] = await Promise.all([
    neteaseMeta(id),
    fetchJson(`${MUSIC_API}?server=netease&type=playlist&id=${encodeURIComponent(id)}`),
  ]);
  const list = neteaseTracks(tracks, id);
  if (!list.length) throw new Error('这个歌单里没读到歌');
  savePlaylist(ctx, {
    source: 'netease',
    remoteId: id,
    name: meta.name || `网易云歌单 ${id}`,
    cover: meta.cover || list[0].pic,
    link: `https://music.163.com/playlist?id=${id}`,
    tracks: list,
  });
}

function pageTitle(text) {
  const match = text.match(/^Title:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}

function qishuiPageTracks(text) {
  const body = text.includes('Markdown Content:') ? text.split('Markdown Content:').pop() : text;
  const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
  const tracks = [];
  const seen = new Set();
  for (let index = 0; index < lines.length - 2; index += 1) {
    if (!/^\d{1,4}$/.test(lines[index])) continue;
    const title = lines[index + 1];
    const meta = lines[index + 2];
    if (!title || /^https?:/i.test(title) || !meta.includes('•')) continue;
    const [artistPart, albumPart] = meta.split('•').map(part => part.trim());
    const artist = artistPart || '未知歌手';
    const album = albumPart || '';
    const key = `${title}::${artist}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push({
      id: `qs_page_${index}_${newId('t').slice(-6)}`,
      title,
      artist,
      album,
      url: '',
      pic: '',
      lrc: '',
      via: 'qishui',
    });
    if (tracks.length >= 200) break;
    index += 2;
  }
  return tracks;
}

function qishuiIdFromText(text) {
  const match = text.match(/[?&]playlist_id=([0-9]{5,})/)
    || text.match(/"playlist"\s*:\s*\{"id"\s*:\s*"([0-9]{5,})"/)
    || text.match(/"id"\s*:\s*"([0-9]{5,})"\s*,\s*"title"/);
  return match ? match[1] : '';
}

async function resolveQishuiId(link) {
  const direct = link.match(/[?&]playlist_id=([0-9]+)/);
  if (direct) return direct[1];
  const page = await readPage(link);
  const found = qishuiIdFromText(page);
  if (found) return found;
  throw new Error('没认出汽水歌单 ID，请粘贴公开歌单的完整分享链接');
}

function qishuiApiTracks(data, playlistId) {
  const resources = Array.isArray(data?.media_resources) ? data.media_resources : [];
  const tracks = [];
  const seen = new Set();
  resources.forEach(item => {
    const entity = item?.entity || {};
    const track = entity.track || entity.track_wrapper?.track || item?.track || {};
    const title = String(track.name || '').trim();
    if (!title) return;
    const key = String(track.id || `${title}::${tracks.length}`);
    if (seen.has(key)) return;
    seen.add(key);
    const artists = Array.isArray(track.artists)
      ? track.artists.map(person => String(person?.name || '').trim()).filter(Boolean).join('、')
      : '';
    tracks.push({
      id: `qs_${playlistId}_${key}`,
      title,
      artist: artists || '未知歌手',
      album: String(track.album?.name || ''),
      url: '',
      pic: '',
      lrc: '',
      via: 'qishui',
    });
  });
  return tracks;
}

function qishuiCover(playlist) {
  const cover = playlist?.url_cover;
  if (!cover) return '';
  const base = Array.isArray(cover.urls) ? cover.urls[0] : '';
  if (!base || !cover.uri) return '';
  return `${base}${cover.uri}~c5_500x500.jpg`;
}

async function importQishui(ctx, link) {
  const remoteId = await resolveQishuiId(link);
  const api = `https://api.qishui.com/luna/pc/playlist/detail?playlist_id=${encodeURIComponent(remoteId)}&cursor=0&cnt=20&aid=386088&device_platform=web&channel=pc_web`;
  let data = null;
  let tracks = [];
  try {
    const text = await readPage(api);
    const body = text.slice(text.indexOf('{'));
    data = JSON.parse(body);
    tracks = qishuiApiTracks(data, remoteId);
  } catch {
    tracks = [];
  }
  if (!tracks.length) {
    const page = await readPage(link);
    tracks = qishuiPageTracks(page);
    if (!tracks.length) throw new Error('没读到汽水歌单里的歌，试试公开歌单的完整分享链接');
    savePlaylist(ctx, {
      source: 'qishui',
      remoteId,
      name: pageTitle(page) || `汽水歌单 ${remoteId}`,
      cover: '',
      link,
      tracks,
    });
    return;
  }
  const name = String(data?.playlist?.title || '').trim() || `汽水歌单 ${remoteId}`;
  savePlaylist(ctx, {
    source: 'qishui',
    remoteId,
    name,
    cover: qishuiCover(data.playlist),
    link,
    tracks,
  });
}

function savePlaylist(ctx, incoming) {
  const music = musicOf(ctx.state);
  const old = music.playlists.find(item => item.source === incoming.source && item.remoteId === incoming.remoteId);
  let playlist;
  if (old) {
    playlist = old;
    playlist.name = incoming.name;
    playlist.cover = incoming.cover || old.cover;
    playlist.tracks = incoming.tracks;
    playlist.link = incoming.link;
    playlist.importedAt = Date.now();
  } else {
    playlist = {
      id: newId('pl'),
      ...incoming,
      importedAt: Date.now(),
    };
    music.playlists.unshift(playlist);
  }
  music.activeId = playlist.id;
  ctx.save();
  ctx.toast(old ? `已更新「${playlist.name}」` : `已导入「${playlist.name}」`);
  ctx.go('music-playlist', { playlistId: playlist.id });
}

async function importByText(ctx, raw) {
  const text = String(raw || '').trim();
  if (!text) return;
  try {
    const link = (text.match(/https?:\/\/[^\s]+/) || [text])[0];
    if (/music\.163\.com|163cn\.tv/.test(link) || /^\d{5,}$/.test(text)) {
      await importNetease(ctx, text);
      return;
    }
    if (/qishui\.douyin\.com|music\.douyin\.com/.test(link)) {
      await importQishui(ctx, link);
      return;
    }
    throw new Error('没认出链接，支持网易云歌单和汽水歌单分享链接');
  } catch (error) {
    ctx.toast(error?.message || '导入失败，稍后再试');
  }
}

/**
 * 试遍候选音源，直到真的开始出声。成功才把地址写回歌单，失败不留下坏链接。
 * gate 变了就说明用户已经切歌或停播，当前这轮直接作废。
 */
async function startTrack(ctx, playlist, track, gate, options = {}) {
  attemptDepth += 1;
  try {
    for await (const candidate of sourceCandidates(track, options.skip || [])) {
      if (gate !== loadToken) return false;
      const player = ensureAudio();
      player.__ctxToast = message => ctx.toast(message);
      const ok = await trySource(player, candidate.url);
      if (gate !== loadToken) return false;
      if (!ok) continue;
      track.url = candidate.url;
      track.playVia = candidate.via;
      track.dead = false;
      track.swapped = !candidate.cached;
      setCurrent(track, playlist);
      playing = !player.paused;
      freshSave(ctx, playlist.id, track.id);
      if (!candidate.cached) ctx.toast(`已自动换源：${sourceLabel(candidate.via)}`);
      paintPlayState();
      ctx.rerender();
      return true;
    }
    return false;
  } finally {
    attemptDepth -= 1;
  }
}

async function playAt(ctx, playlist, index, options = {}) {
  if (!playlist?.tracks?.length) return false;
  const track = playlist.tracks[index];
  if (!track) return false;
  lastCtx = ctx;
  const gate = ++loadToken;
  queue = playlist.tracks;
  queueIndex = index;
  queuePlaylistId = playlist.id;
  deadCandidates = [];
  /* 换歌先把上一首停下，免得找音源的时候旧歌还在响、进度条却挂在新歌上 */
  const player = ensureAudio();
  player.__ctxToast = message => ctx.toast(message);
  try { player.pause(); } catch { /* 忽略 */ }
  try { player.removeAttribute('src'); player.load(); } catch { /* 忽略 */ }
  playing = false;
  setCurrent(track, playlist);
  ctx.toast(track.url ? '正在打开音源…' : '正在找可播音源…');
  const ok = await startTrack(ctx, playlist, track, gate, options);
  if (gate !== loadToken) return false;
  if (!ok) {
    track.url = '';
    track.playVia = '';
    track.dead = true;
    track.swapped = false;
    playing = false;
    paintPlayState();
    ctx.toast('这首暂时没找到能播的音源，可以再点一次重试');
    ctx.rerender();
    return false;
  }
  return true;
}

/** 放到一半音源断了：换一条能播的接着放，实在没有才提示失败 */
async function recoverCurrent() {
  const ctx = lastCtx;
  if (recovering) return;
  if (!ctx || !current) return;
  const playlist = ctx.state.music?.playlists?.find(item => item.id === current.playlistId);
  if (!playlist) return;
  const index = playlist.tracks.findIndex(item => item.id === current.trackId);
  if (index < 0) return;
  const track = playlist.tracks[index];
  recovering = true;
  const gate = ++loadToken;
  const skip = deadCandidates.slice();
  if (current.url) skip.push(current.url);
  deadCandidates = skip.filter(Boolean);
  try {
    const ok = await startTrack(ctx, playlist, track, gate, { skip });
    if (gate !== loadToken) return;
    if (!ok) {
      track.url = '';
      track.playVia = '';
      track.dead = true;
      track.swapped = false;
      playing = false;
      paintPlayState();
      ctx.toast('自动换源没成功，可以再点一次播放');
      ctx.rerender();
    }
  } finally {
    recovering = false;
  }
}

function freshSave(ctx, playlistId, trackId) {
  const music = musicOf(ctx.state);
  music.current = { playlistId, trackId };
  ctx.save();
}

async function playNextByQueue() {
  if (!queue.length || !lastCtx) return;
  queueIndex += 1;
  if (queueIndex >= queue.length) {
    playing = false;
    paintPlayState();
    return;
  }
  const playlist = lastCtx.state.music?.playlists?.find(item => item.id === queuePlaylistId);
  if (!playlist) {
    playing = false;
    paintPlayState();
    return;
  }
  playAt(lastCtx, playlist, queueIndex);
}

function togglePlay(ctx) {
  if (!current) return;
  const playlist = ctx.state.music?.playlists?.find(item => item.id === current.playlistId);
  const player = ensureAudio();
  player.__ctxToast = message => ctx.toast(message);
  const track = playlist ? playlist.tracks.find(item => item.id === current.trackId) : null;
  if (!track?.url || !player.src) {
    if (playlist) {
      const index = playlist.tracks.findIndex(item => item.id === current.trackId);
      playAt(ctx, playlist, Math.max(0, index));
    }
    return;
  }
  if (player.paused) {
    player.play().then(() => { playing = true; paintPlayState(); }).catch(() => ctx.toast('播放失败，稍后再点一次'));
  } else {
    player.pause();
  }
}

function nextTrack(ctx) {
  const playlist = ctx.state.music?.playlists?.find(item => item.id === current?.playlistId);
  if (!playlist) return;
  const index = playlist.tracks.findIndex(item => item.id === current?.trackId);
  const next = index + 1;
  if (!playlist.tracks[next]) { ctx.toast('已经是最后一首了'); return; }
  queue = playlist.tracks;
  queuePlaylistId = playlist.id;
  playAt(ctx, playlist, next);
}

function coverHtml(playlist, className = '') {
  if (playlist?.cover) {
    return `<div class="mp-music-cover ${className}"><img src="${esc(secureUrl(playlist.cover))}" alt=""></div>`;
  }
  return `<div class="mp-music-cover is-empty ${className}" style="background:${coverTint(playlist?.name)}">${icon('music')}</div>`;
}

function coverTint(name) {
  const tints = [
    'linear-gradient(150deg,#e8d7fa,#bda1ee)',
    'linear-gradient(150deg,#d9e5fb,#9dbcef)',
    'linear-gradient(150deg,#f8dceb,#e4a8cf)',
    'linear-gradient(150deg,#d5eee6,#91d2c0)',
    'linear-gradient(150deg,#f5e3d2,#dfb98e)',
  ];
  const text = String(name || 'music');
  let code = 0;
  for (let index = 0; index < text.length; index += 1) code = (code + text.charCodeAt(index) * (index + 3)) % 997;
  return tints[code % tints.length];
}

function trackLine(ctx, track, playlist, index) {
  const active = current && current.playlistId === playlist.id && current.trackId === track.id;
  return `
    <button class="mp-music-track${active ? ' is-on' : ''}" data-act="music-track" data-id="${playlist.id}" data-index="${index}" type="button">
      <span class="mp-music-index">${active ? icon('play') : String(index + 1).padStart(2, '0')}</span>
      <span class="mp-music-track-main">
        <b>${esc(track.title)}</b>
        <span>${esc(track.artist || '未知歌手')}${track.album ? ` · ${esc(track.album)}` : ''}</span>
      </span>
      <span class="mp-music-track-side">${esc(trackSourceTag(track))}</span>
    </button>`;
}

function playerHtml(ctx, state) {
  const track = trackFromState(state);
  if (!track) return '';
  const cover = track.pic || '';
  return `
    <div class="mp-music-player">
      ${cover ? `<div class="mp-music-cover is-small"><img src="${esc(secureUrl(cover))}" alt=""></div>` : `<div class="mp-music-cover is-small is-empty">${icon('music')}</div>`}
      <div class="mp-music-player-main">
        <div class="mp-music-now">
          <b>${esc(track.title)}</b>
          <span>${esc(track.artist || '未知歌手')}</span>
        </div>
        <div class="mp-music-progress"><i id="mpMusicBar"></i></div>
        <div class="mp-music-time" id="mpMusicTime">0:00 / --:--</div>
      </div>
      <button class="mp-music-play" data-act="music-toggle" type="button" aria-label="播放或暂停">
        <span data-music-icon>${icon(playing ? 'pause' : 'play')}</span>
      </button>
      <button class="mp-music-next" data-act="music-next" type="button" aria-label="下一首">${icon('next')}</button>
    </div>`;
}

function playAllButton(playlist) {
  return `<button class="mp-btn accent mp-music-all" data-act="music-playlist-play" data-id="${playlist.id}" type="button">${icon('play')}<span>播放全部</span></button>`;
}

export const musicApp = {
  id: 'music', name: '音乐', icon: 'music',

  render(ctx) {
    const music = musicOf(ctx.state);
    const playlists = music.playlists;
    const cards = playlists.map(playlist => {
      const active = current?.playlistId === playlist.id;
      return `
        <button class="mp-music-card${active ? ' is-on' : ''}" data-act="music-open" data-id="${playlist.id}" type="button">
          ${coverHtml(playlist, 'is-list')}
          <div class="mp-music-card-main">
            <div class="mp-music-card-name">${esc(playlist.name)}</div>
            <div class="mp-music-card-sub">${playlist.tracks.length} 首 · ${playlist.source === 'qishui' ? '汽水' : '网易云'}</div>
            <div class="mp-music-card-bar"><i style="width:${active && playing ? '60%' : '0%'}"></i></div>
          </div>
          <span class="mp-music-card-play">${icon(active && playing ? 'pause' : 'play')}</span>
        </button>`;
    }).join('');

    return `
      <div class="mp-page-body mp-music">
        <div class="mp-music-hero">
          <div>
            <div class="mp-subtitle" style="margin-top:2px">音乐 · 把喜欢的歌单放进口袋</div>
          </div>
          <button class="mp-icon-btn" data-act="music-import" type="button" aria-label="导入歌单">${icon('plus')}</button>
        </div>
        ${playerHtml(ctx, ctx.state)}
        <div class="mp-music-section-head"><b>我的歌单</b><span>${playlists.length ? `${playlists.length} 张` : '还没导入'}</span></div>
        ${cards || `
          <div class="mp-music-empty">
            <div class="mp-music-empty-art">${icon('music')}</div>
            <b>还没有歌单</b>
            <span>粘贴网易云或汽水的歌单分享链接，歌名和封面会留在这里。</span>
            <button class="mp-btn accent" data-act="music-import" type="button">${icon('plus')}导入歌单</button>
          </div>`}
        <div class="mp-music-note">
          网易云公开歌单直接播放；汽水整张歌单都能导入。哪首放不出来，会自动按歌名换一个能放音源。
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'music-import') {
      ctx.openSheet({
        kind: 'text',
        title: '导入歌单',
        confirm: '读进来',
        placeholder: '粘贴歌单链接。网易云用 music.163.com/playlist?id=…；汽水用 qishui.douyin.com/s/… 或 music.douyin.com/qishui/share/playlist?playlist_id=…',
        onText: value => importByText(ctx, value),
      });
      return true;
    }
    if (act === 'music-open') {
      ctx.go('music-playlist', { playlistId: data.id });
      return true;
    }
    if (act === 'music-playlist-play') {
      const playlist = ctx.state.music?.playlists?.find(item => item.id === data.id);
      if (playlist) playAt(ctx, playlist, 0);
      return true;
    }
    if (act === 'music-toggle') {
      const playlist = ctx.state.music?.playlists?.find(item => item.id === current?.playlistId);
      if (!current && playlist) playAt(ctx, playlist, 0);
      else togglePlay(ctx);
      return true;
    }
    if (act === 'music-next') {
      nextTrack(ctx);
      return true;
    }
    return false;
  },
};

export const musicPlaylistApp = {
  id: 'music-playlist', name: '歌单', icon: 'music',

  render(ctx, params) {
    const playlist = ctx.state.music?.playlists?.find(item => item.id === params.playlistId);
    if (!playlist) return '<div class="mp-page-body"><div class="mp-empty">这张歌单不在了。</div></div>';
    const tracks = playlist.tracks || [];
    return `
      <div class="mp-page-body mp-music">
        <div class="mp-music-detail-head">
          ${coverHtml(playlist, 'is-detail')}
          <div class="mp-music-detail-copy">
            <div class="mp-music-source">${playlist.source === 'qishui' ? '汽水音乐' : '网易云音乐'}</div>
            <div class="mp-music-detail-name">${esc(playlist.name)}</div>
            <div class="mp-music-detail-sub">${tracks.length} 首 · ${playlist.tracks[0]?.via === 'qishui' ? '按歌名匹配可播版本' : '公开音源 · 放不出来自动换源'}</div>
            <div style="display:flex;gap:8px;margin-top:10px">
              ${playAllButton(playlist)}
              <button class="mp-icon-btn" data-act="music-delete" data-id="${playlist.id}" type="button" aria-label="删除歌单">${icon('trash')}</button>
            </div>
          </div>
        </div>
        ${playerHtml(ctx, ctx.state)}
        <div class="mp-music-track-list">
          ${tracks.map((track, index) => trackLine(ctx, track, playlist, index)).join('')}
        </div>
        <div class="mp-music-note">${playlist.source === 'qishui' ? '汽水歌单整张导入，点歌时先按歌名找可播版本；放不出来会自动换源，VIP 或版权受限的可能真的没有。' : '先播公开外链，链接失效或没有版权时会自动按歌名换源。'}</div>
      </div>`;
  },

  handle(ctx, act, data) {
    const playlist = ctx.state.music?.playlists?.find(item => item.id === data.id);
    if (act === 'music-track') {
      if (playlist) playAt(ctx, playlist, Number(data.index) || 0);
      return true;
    }
    if (act === 'music-playlist-play') {
      if (playlist) playAt(ctx, playlist, 0);
      return true;
    }
    if (act === 'music-toggle') {
      if (!current && playlist) playAt(ctx, playlist, 0);
      else togglePlay(ctx);
      return true;
    }
    if (act === 'music-next') {
      nextTrack(ctx);
      return true;
    }
    if (act === 'music-delete') {
      if (!playlist) return true;
      ctx.openSheet({
        title: '删除歌单？',
        items: [{ label: '删除这张歌单', value: 'yes', danger: true }],
        onPick: value => {
          if (value !== 'yes') return;
          const music = musicOf(ctx.state);
          music.playlists = music.playlists.filter(item => item.id !== playlist.id);
          if (music.current?.playlistId === playlist.id) {
            music.current = null;
            stopMusic();
          }
          ctx.save();
          ctx.back();
          ctx.toast('删掉了');
        },
      });
      return true;
    }
    return false;
  },
};
