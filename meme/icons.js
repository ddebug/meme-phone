/**
 * meme-phone · 图标
 * 统一 24×24 视窗、1.6 描边；只描述形状，颜色由外面的 CSS 给。
 */

const P = {
  chat: '<path d="M4 11.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5-3.6 6.5-8 6.5c-1 0-2-.1-2.9-.4"/><path d="M4 11.5c0 1.3.6 2.5 1.6 3.5L5 19l3.6-1.4"/>',
  contacts: '<circle cx="9" cy="9" r="3.2"/><path d="M3.6 18.4c.5-2.7 2.7-4.3 5.4-4.3s4.9 1.6 5.4 4.3"/><circle cx="17" cy="10" r="2.3"/><path d="M16 14.6c2.4 0 4.2 1.3 4.6 3.6"/>',
  diary: '<path d="M5.5 4.5h9.5a2.5 2.5 0 0 1 2.5 2.5v12.5H8a2.5 2.5 0 0 1-2.5-2.5z"/><path d="M8.5 4.5v15"/><path d="M11.4 9h3.6M11.4 12.6h3.6"/>',
  settings: '<circle cx="12" cy="12" r="2.9"/><path d="M12 3.8v2.2M12 18v2.2M4.6 12H3M21 12h-1.6M6.9 6.9l1.5 1.5M15.6 15.6l1.5 1.5M17.1 6.9l-1.5 1.5M8.4 15.6l-1.5 1.5"/>',
  theater: '<path d="M4 8.4h16v9.2a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 17.6z"/><path d="M4.6 5.2h14.8l-1 3.2H5.6z"/><path d="M8.6 12.6h2M13.4 12.6h2"/>',
  wallet: '<path d="M4 8.2A2.2 2.2 0 0 1 6.2 6h11.2a1.6 1.6 0 0 1 1.6 1.6v9.4a1.6 1.6 0 0 1-1.6 1.6H6.2A2.2 2.2 0 0 1 4 16.4z"/><path d="M15.4 11.4h3.4v3.2h-3.4a1.6 1.6 0 0 1 0-3.2z"/><path d="M6.8 6v11"/>',
  bookmark: '<path d="M7 4.6h10A1.4 1.4 0 0 1 18.4 6v13.4l-6.4-3.7-6.4 3.7V6A1.4 1.4 0 0 1 7 4.6z"/>',
  smile: '<circle cx="12" cy="12" r="7.8"/><path d="M9.2 14.6c.7.9 1.7 1.4 2.8 1.4s2.1-.5 2.8-1.4"/><circle cx="9.4" cy="10.2" r=".8"/><circle cx="14.6" cy="10.2" r=".8"/>',
  crown: '<path d="M5 17.4h14"/><path d="M5.4 17.4 4 8.6l4.2 2.6L12 6.6l3.8 4.6L20 8.6l-1.4 8.8"/>',
  plan: '<rect x="4.4" y="4.6" width="15.2" height="15" rx="3"/><path d="M8 9.4l1.6 1.6 2.6-2.6M8 15l1.6 1.6 2.6-2.6"/><path d="M14.6 9.8h2.4M14.6 15.4h2.4"/>',
  brush: '<path d="M15.6 4.6 19.4 8.4 9.6 18.2l-3.8 1.2 1.2-3.8z"/><path d="M13.4 6.8 17.2 10.6"/>',
  help: '<circle cx="12" cy="12" r="7.8"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.7.5-1.2 1-1.2 1.9"/><circle cx="12" cy="16.4" r=".8"/>',
  back: '<path d="M14.6 5.4 7.8 12l6.8 6.6"/>',
  home: '<path d="M4.6 11.2 12 4.8l7.4 6.4"/><path d="M6.8 10.4v8.4h10.4v-8.4"/><path d="M9.8 18.8v-4.2h4.4v4.2"/>',
  chevron: '<path d="M6.6 9.4 12 14.6 17.4 9.4"/>',
  close: '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>',
  plus: '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
  send: '<path d="M5 12 19.4 5.6 13.6 19.4l-2.8-5.6z"/>',
  spark: '<path d="M12 4.4l1.7 4.6 4.6 1.7-4.6 1.7L12 17l-1.7-4.6-4.6-1.7 4.6-1.7z"/><path d="M17.8 15.4l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9z"/>',
  search: '<circle cx="11" cy="11" r="5.6"/><path d="M15.2 15.2 19 19"/>',
  more: '<circle cx="6.2" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17.8" cy="12" r="1"/>',
  copy: '<rect x="8.4" y="8.4" width="11" height="11" rx="2.4"/><path d="M15.6 8.4V6.6a2 2 0 0 0-2-2H6.6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1.8"/>',
  reply: '<path d="M8.6 6.4 4.6 10.4l4 4"/><path d="M4.6 10.4h8.2c3.6 0 5.6 2.2 5.6 5.4v1.8"/>',
  refresh: '<path d="M18.4 9.6A6.6 6.6 0 0 0 6 7.4"/><path d="M18.6 4.6v5h-5"/><path d="M5.6 14.4A6.6 6.6 0 0 0 18 16.6"/><path d="M5.4 19.4v-5h5"/>',
  trash: '<path d="M5.6 7.4h12.8"/><path d="M9.4 7.4V5.6h5.2v1.8"/><path d="M7.2 7.4l.8 10.4a1.4 1.4 0 0 0 1.4 1.3h5.2a1.4 1.4 0 0 0 1.4-1.3l.8-10.4"/>',
  heart: '<path d="M12 19.4c-4.6-3-7-5.4-7-8.4a3.7 3.7 0 0 1 6.6-2.2l.4.5.4-.5A3.7 3.7 0 0 1 19 11c0 3-2.4 5.4-7 8.4z"/>',
  clock: '<circle cx="12" cy="12" r="7.6"/><path d="M12 8.2V12l2.8 1.8"/>',
  moon: '<path d="M15.4 4.8a7.6 7.6 0 1 0 3.8 10.6A7.9 7.9 0 0 1 15.4 4.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3.4v1.8M12 18.8v1.8M3.4 12h1.8M18.8 12h1.8M6 6l1.3 1.3M16.7 16.7 18 18M18 6l-1.3 1.3M7.3 16.7 6 18"/>',
  image: '<rect x="4.4" y="5.4" width="15.2" height="13.2" rx="2.6"/><circle cx="9.2" cy="10" r="1.3"/><path d="M5 16.4l4.2-3.8 3.4 2.8 3-2.4 3.6 3"/>',
  pin: '<path d="M12 4.8a4.8 4.8 0 0 1 4.8 4.8c0 3.4-4.8 9.6-4.8 9.6S7.2 13 7.2 9.6A4.8 4.8 0 0 1 12 4.8z"/><circle cx="12" cy="9.4" r="1.6"/>',
  bell: '<path d="M8 10a4 4 0 0 1 8 0c0 3 .8 4.4 1.6 5.2H6.4c.8-.8 1.6-2.2 1.6-5.2z"/><path d="M10.2 18a2 2 0 0 0 3.6 0"/>',
  code: '<path d="M9 6.6 4.4 12 9 17.4M15 6.6l4.6 5.4-4.6 5.4"/>',
};

export function icon(name, className = '') {
  const body = P[name] || P.help;
  return `<svg class="mp-i ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** 桌面图标配色：同族渐变，不用高饱和色块。 */
export const TINT = {
  chat: ['#bcd4f6', '#8fb9f2'],
  contacts: ['#cfc2f7', '#a892ee'],
  diary: ['#f8cfdf', '#f2a0c2'],
  settings: ['#cfd2e6', '#a8aed0'],
  theater: ['#e2ccf6', '#bf9cec'],
  wallet: ['#fbd6ae', '#f5b877'],
  bookmark: ['#f4c8e6', '#e79fce'],
  smile: ['#fbd0c4', '#f39f92'],
  crown: ['#fbdda6', '#f2bd5f'],
  plan: ['#bfe9d6', '#7fd2bc'],
  brush: ['#c3d6f2', '#8fb3e8'],
  help: ['#d7d2e6', '#a9a2c4'],
  membership: ['#fbdda6', '#f0b451'],
  favorites: ['#f4c8e6', '#e79fce'],
  extras: ['#e2ccf6', '#bf9cec'],
  emoji: ['#fbd0c4', '#f39f92'],
  plans: ['#bfe9d6', '#7fd2bc'],
  image: ['#c9e2f5', '#93c6ec'],
  code: ['#d3cdf0', '#aea3e6'],
  draw: ['#c9e2f5', '#93c6ec'],
  api: ['#d3cdf0', '#aea3e6'],
  dress: ['#c3d6f2', '#8fb3e8'],
};
