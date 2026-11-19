/**
 * meme-phone · 钱包
 *
 * 只读展示钱包流水和会员状态；充值也在这里做，不碰聊天请求。
 */

import { icon } from '../icons.js';
import { contactsOf, contactById } from '../data.js';
import { esc, timeText } from '../shell.js';
import { walletBalance, walletTransactions, userMembership, contactMembership, membershipLabel } from '../behavior-domains.js';

function money(value) {
  return `¥${(Number(value) || 0).toFixed(2)}`;
}

function membershipText(record) {
  if (!record || record.expireAt <= Date.now()) return '未开通';
  return `${membershipLabel(record.type)} · ${new Date(record.expireAt).toLocaleDateString('sv-SE')} 到期`;
}

function txRow(tx, state) {
  const contact = contactById(state, tx.contactId);
  const incoming = tx.direction === 'received';
  return `
    <div class="mp-wallet-row">
      <span class="mp-wallet-ico ${incoming ? 'in' : 'out'}">${icon(incoming ? 'download' : 'upload')}</span>
      <div class="mp-wallet-main">
        <div class="mp-wallet-title">${esc(contact?.name || '钱包')} · ${tx.type === 'redpacket' ? '红包' : tx.type === 'gift' ? '会员' : '转账'}</div>
        <div class="mp-wallet-sub">${timeText(tx.at)}${tx.note ? ` · ${esc(tx.note)}` : ''}${tx.status === 'reversed' ? ' · 已退回' : ''}</div>
      </div>
      <div class="mp-wallet-amount ${incoming ? 'in' : 'out'}">${incoming ? '+' : '-'}${money(tx.amount)}</div>
    </div>`;
}

export const walletApp = {
  id: 'app-wallet', name: '钱包', icon: 'wallet',

  render(ctx) {
    const state = ctx.state;
    const transactions = walletTransactions(state).slice(0, 80);
    const member = userMembership(state);
    const contacts = contactsOf(state).filter(contact => contact.kind !== 'group');
    const memberRows = contacts
      .map(contact => ({ contact, record: contactMembership(state, contact.id) }))
      .filter(item => item.record.type !== 'none' && item.record.expireAt > Date.now())
      .slice(0, 20)
      .map(item => `
        <div class="mp-wallet-row">
          <span class="mp-wallet-ico in">${icon('spark')}</span>
          <div class="mp-wallet-main">
            <div class="mp-wallet-title">${esc(item.contact.name)}</div>
            <div class="mp-wallet-sub">${esc(membershipText(item.record))}</div>
          </div>
        </div>`).join('');

    return `
      <div class="mp-page-body">
        <div class="mp-wallet-hero">
          <div class="mp-wallet-label">钱包余额</div>
          <div class="mp-wallet-balance">${money(walletBalance(state))}</div>
          <div class="mp-wallet-hero-foot">
            <span>${member.expireAt > Date.now() ? `我的会员：${membershipText(member)}` : '我的会员：未开通'}</span>
            <button class="mp-mini-btn plain" data-act="wallet-add-toggle" type="button">充值</button>
          </div>
          ${ctx.shell.walletAdd ? `
            <div class="mp-wallet-add">
              <input id="mpWalletAdd" class="mp-behavior-input" inputmode="decimal" placeholder="充多少" aria-label="充值金额">
              <button class="mp-mini-btn" data-act="wallet-add" type="button">确认</button>
              <button class="mp-mini-btn plain" data-act="wallet-add-toggle" type="button">取消</button>
            </div>` : ''}
        </div>

        <div class="mp-group">
          <div class="mp-group-label">会员</div>
          <div class="mp-group-box">
            <div class="mp-set-row is-static">
              <span class="mp-set-ico">${icon('spark')}</span>
              <span class="mp-set-name">我的会员<small>${esc(member.expireAt > Date.now() ? membershipText(member) : '还没有开通')}</small></span>
              <span class="mp-set-value">${esc(membershipLabel(member.type))}</span>
            </div>
            ${memberRows || '<div class="mp-empty" style="padding:18px">通讯录里还没有人开通会员。</div>'}
          </div>
        </div>

        <div class="mp-group">
          <div class="mp-group-label">收支</div>
          <div class="mp-group-box">
            ${transactions.length ? transactions.map(tx => txRow(tx, state)).join('') : '<div class="mp-empty" style="padding:18px">还没有转账、红包或会员记录。</div>'}
          </div>
        </div>
      </div>`;
  },

  handle(ctx, act, data) {
    if (act === 'wallet-add-toggle') {
      ctx.shell.walletAdd = !ctx.shell.walletAdd;
      ctx.rerender();
      return true;
    }
    if (act === 'wallet-add') {
      const input = ctx.shell.root.querySelector('#mpWalletAdd');
      const amount = Number((input?.value || '').replace(/[^\d.]/g, ''));
      if (!Number.isFinite(amount) || amount <= 0) { ctx.toast('先填一个金额'); return true; }
      ctx.state.wallet.balance = Math.round((walletBalance(ctx.state) + amount) * 100) / 100;
      ctx.shell.walletAdd = false;
      ctx.save();
      ctx.rerender();
      ctx.toast(`充了 ${money(amount)}`);
      return true;
    }
    return false;
  },
};
