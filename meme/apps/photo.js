/**
 * meme-phone · 看大图
 * 聊天里的照片点开就是这一页：只负责把图铺满屏幕，返回键回聊天。
 */

import { icon } from '../icons.js';
import { esc } from '../shell.js';

export const photoApp = {
  id: 'photo-view', name: '照片', icon: 'image',

  render(ctx, params = {}) {
    const src = params.src || '';
    return `
      <div class="mp-page-body mp-photo-page">
        <div class="mp-photo-full">
          ${src ? `<img src="${esc(src)}" alt="照片">` : '<div class="mp-empty">这张照片已经不在了。</div>'}
        </div>
        <div class="mp-photo-bar">
          <button class="mp-dress-link" data-act="back" type="button">${icon('back')}返回聊天</button>
        </div>
      </div>`;
  },
};
