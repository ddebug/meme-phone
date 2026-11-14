/**
 * meme-phone · 收藏
 * 聊天里长按消息可以「收藏这条」，这里只是那一份清单：不复制聊天，只存一句快照。
 */

import { icon } from '../icons.js';
import { esc, shortText } from '../shell.js';
import { chatById } from '../data.js';

export const favoritesApp = {
  id: 'app-favorites', name: '收藏', icon: 'bookmark',

  render(ctx) {
    const list = ctx.state.favorites || [];
    const rows = list.map(item => `
      <button class="mp-row" data-act="fav-open" data-id="${esc(item.id)}" type="button">
        <div class="mp-row-main">
          <div class="mp-row-name">${esc(item.contactName || 'TA')}${item.from === 'me' ? '<span class="mp-pill plain">我</span>' : ''}</div>
          <div class="mp-row-sub">${esc(item.text || '')}</div>
        </div>
        <div class="mp-row-side"><span>${item.at ? shortText(item.at) : ''}</span></div>
      </button>`).join('');

    return `
      <div class="mp-page-body">
        <div class="mp-subtitle" style="margin-top:0">收藏 · 从聊天里存下来的消息，删了那段聊天也还在</div>
        ${rows || '<div class="mp-empty">还没有收藏。<br>在聊天里长按一条消息，点「收藏这条」。</div>'}
      </div>`;
  },

  handle(ctx, act, data) {
    if (act !== 'fav-open') return false;
    const list = ctx.state.favorites || [];
    const item = list.find(entry => entry.id === data.id);
    if (!item) return true;
    const chat = item.chatId ? chatById(ctx.state, item.chatId) : null;
    ctx.openSheet({
      title: item.text || '',
      items: [
        ...(chat ? [{ label: `回到和「${item.contactName || 'TA'}」的聊天`, value: 'open', icon: 'chat' }] : []),
        ...(item.image ? [{ label: '看这张原图', value: 'photo', icon: 'image' }] : []),
        ...(item.text ? [{ label: '复制文字', value: 'copy', icon: 'copy' }] : []),
        { label: '取消收藏', value: 'delete', icon: 'trash', danger: true },
      ],
      onPick: (value) => {
        if (value === 'open' && chat) ctx.go('thread', { chatId: chat.id });
        if (value === 'photo' && item.image) ctx.go('photo-view', { src: item.image });
        if (value === 'copy') {
          navigator.clipboard?.writeText(item.text).then(() => ctx.toast('已复制'), () => ctx.toast('复制失败'));
        }
        if (value === 'delete') {
          ctx.state.favorites = list.filter(entry => entry.id !== item.id);
          ctx.save();
          ctx.rerender();
          ctx.toast('收藏已移除');
        }
      },
    });
    return true;
  },
};
