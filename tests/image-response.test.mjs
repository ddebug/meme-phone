import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { novelaiImage, unzipNaiImage } from '../meme/host.js';

/* 1×1 PNG，用来模拟代理/自定义接口直接返回图片。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

/* 官方 NovelAI 风格的单文件 ZIP，里面是上面的 PNG。 */
const NAI_ZIP = Buffer.from(
  'UEsDBBQAAAAIAEptdF1ZqVCQPwAAAEQAAAAJAAAAaW1hZ2UucG5n6wzwc+flkuJiYGDg9fRwCQLSjCDMwQIkt8rwMAEpbk8Xx5CKW8l//sszMDMzMbzfv/w2UJjB09XPZZ1TQhMAUEsBAhQAFAAAAAgASm10XVmpUJA/AAAARAAAAAkAAAAAAAAAAAAAAAAAAAAAAGltYWdlLnBuZ1BLBQYAAAAAAQABADcAAABmAAAAAAA=',
  'base64',
);

afterEach(() => {
  delete globalThis.fetch;
});

function reply(body, type, status = 200) {
  return new Response(body, { status, headers: { 'content-type': type } });
}

test('直出 PNG 不再当 ZIP 解包', async () => {
  globalThis.fetch = async () => reply(PNG, 'image/png');
  const out = await novelaiImage({ url: 'https://example.test', key: 'k', width: 64, height: 64, prompt: 'x' });
  assert.match(out.url, /^data:image\/png;base64,/);
});

test('没有 Content-Type 的 PNG 也能按文件头识别', async () => {
  globalThis.fetch = async () => reply(PNG, 'application/octet-stream');
  const out = await novelaiImage({ url: 'https://example.test', key: 'k', width: 64, height: 64, prompt: 'x' });
  assert.match(out.url, /^data:image\/png;base64,/);
});

test('200 返回 JSON 错误时抛出服务端原因，而不是 zip 错误', async () => {
  globalThis.fetch = async () => reply(JSON.stringify({ message: 'quota exceeded' }), 'application/json');
  await assert.rejects(
    () => novelaiImage({ url: 'https://example.test', key: 'k', width: 64, height: 64, prompt: 'x' }),
    /NovelAI 返回错误：quota exceeded/,
  );
});

test('200 返回 HTML 错误页时给出内容预览', async () => {
  globalThis.fetch = async () => reply('<html><body>Forbidden by proxy</body></html>', 'text/html');
  await assert.rejects(
    () => novelaiImage({ url: 'https://example.test', key: 'k', width: 64, height: 64, prompt: 'x' }),
    /NovelAI 返回了无法识别的内容.*Forbidden by proxy/,
  );
});

test('合法 NovelAI ZIP 仍然正常解出图片', async () => {
  globalThis.fetch = async () => reply(NAI_ZIP, 'application/zip');
  const out = await novelaiImage({ url: 'https://example.test', key: 'k', width: 64, height: 64, prompt: 'x' });
  assert.match(out.url, /^data:image\/png;base64,/);
});

test('unzipNaiImage 对空响应给出明确提示', async () => {
  await assert.rejects(() => unzipNaiImage(new ArrayBuffer(0)), /空响应/);
});

test('出图接口返回空响应时给出明确提示', async () => {
  globalThis.fetch = async () => reply(new ArrayBuffer(0), 'image/png');
  await assert.rejects(
    () => novelaiImage({ url: 'https://example.test', key: 'k', width: 64, height: 64, prompt: 'x' }),
    /NovelAI 返回了空响应/,
  );
});
