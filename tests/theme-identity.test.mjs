import assert from 'node:assert/strict';
import { test } from 'node:test';
import { desktopIdentity } from '../meme/shell.js';
import { PIXEL_BUNNY } from '../meme/theme-data.js';

test('像素小兔只带壁纸、横幅和头像框，不再携带头像与签名', () => {
  assert.equal('avatar' in PIXEL_BUNNY, false);
  assert.equal('profile' in PIXEL_BUNNY, false);
  for (const key of ['wallpaper', 'banner', 'avatarFrame']) {
    assert.match(PIXEL_BUNNY[key], /^data:image\//, `${key} 应该保留为主题美术资源`);
  }
});

test('桌面身份只认用户自己的昵称、头像和签名，主题不接管', () => {
  const state = {
    users: [{ key: 'persona_yan.png', name: '颜', description: '在便利店上夜班。', avatarUrl: '' }],
    settings: {
      user: { key: 'persona_yan.png', name: '颜', avatar: '' },
      profile: { bio: '自己写的签名' },
      dress: { theme: 'pixel' },
    },
  };
  assert.deepEqual(desktopIdentity(state), {
    myName: '颜',
    myAvatar: '',
    myBio: '自己写的签名',
  });
});

test('没写签名时回退到用户角色设定，不用主题自带的简介', () => {
  const state = {
    users: [{ key: 'persona_yan.png', name: '颜', description: '在便利店上夜班。', avatarUrl: '' }],
    settings: {
      user: { key: 'persona_yan.png', name: '颜', avatar: '' },
      profile: { bio: '' },
      dress: { theme: 'pixel' },
    },
  };
  assert.equal(desktopIdentity(state).myBio, '在便利店上夜班。');
});

test('用户头像优先于角色卡头像；都没有时留空给首字兜底', () => {
  const state = {
    users: [{ key: 'persona_yan.png', name: '颜', avatarUrl: 'data:image/png;base64,CARD' }],
    settings: {
      user: { key: 'persona_yan.png', name: '颜', avatar: 'data:image/png;base64,USER' },
      profile: {},
      dress: { theme: 'pixel' },
    },
  };
  assert.equal(desktopIdentity(state).myAvatar, 'data:image/png;base64,USER');

  const empty = { users: [], settings: { user: {}, profile: {}, dress: { theme: 'pixel' } } };
  assert.deepEqual(desktopIdentity(empty), {
    myName: '我',
    myAvatar: '',
    myBio: '把每天的事，记在这台小手机里。',
  });
});
