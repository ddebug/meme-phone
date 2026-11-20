import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeImagePayload } from '../meme/host.js';

function bytesOf(text) {
  return new TextEncoder().encode(text);
}

function bufferOf(bytes) {
  return new Uint8Array(bytes).buffer;
}

test('直出 PNG 文件头识别为 png', async () => {
  const buf = bufferOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
  const { url } = await decodeImagePayload(buf, '', '接口');
  assert.match(url, /^data:image\/png;base64,/);
});

test('JPEG 文件头识别为 jpeg', async () => {
  const buf = bufferOf([0xff, 0xd8, 0xff, 0xe0, 0x01]);
  const { url } = await decodeImagePayload(buf, '', '接口');
  assert.match(url, /^data:image\/jpeg;base64,/);
});

test('GIF 文件头识别为 gif', async () => {
  const buf = bufferOf([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  const { url } = await decodeImagePayload(buf, '', '接口');
  assert.match(url, /^data:image\/gif;base64,/);
});

test('WebP 文件头识别为 webp', async () => {
  const buf = bufferOf([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const { url } = await decodeImagePayload(buf, '', '接口');
  assert.match(url, /^data:image\/webp;base64,/);
});

test('BMP 文件头识别为 bmp', async () => {
  const buf = bufferOf([0x42, 0x4d, 0x01, 0x02]);
  const { url } = await decodeImagePayload(buf, '', '接口');
  assert.match(url, /^data:image\/bmp;base64,/);
});

test('content-type 为 image/jpeg 时按类型直出', async () => {
  const { url } = await decodeImagePayload(bufferOf([0x00, 0x01]), 'image/jpeg; charset=binary', '接口');
  assert.match(url, /^data:image\/jpeg;base64,/);
});

test('content-type image/jpg 归一为 jpeg', async () => {
  const { url } = await decodeImagePayload(bufferOf([0x00, 0x01]), 'image/jpg', '接口');
  assert.match(url, /^data:image\/jpeg;base64,/);
});

test('JSON data[0].b64_json 包成 png data URL', async () => {
  const raw = JSON.stringify({ data: [{ b64_json: 'QUJDREVGRw==' }] });
  const { url } = await decodeImagePayload(bufferOf(bytesOf(raw)), 'application/json', '豆包');
  assert.equal(url, 'data:image/png;base64,QUJDREVGRw==');
});

test('JSON 顶层 image 为 data URL 时原样保留', async () => {
  const raw = JSON.stringify({ image: 'data:image/webp;base64,YWJj' });
  const { url } = await decodeImagePayload(bufferOf(bytesOf(raw)), 'application/json', '接口');
  assert.equal(url, 'data:image/webp;base64,YWJj');
});

test('JSON data[0].url 远程地址原样返回', async () => {
  const raw = JSON.stringify({ data: [{ url: 'https://cdn.example/a.png' }] });
  const { url } = await decodeImagePayload(bufferOf(bytesOf(raw)), 'application/json', '接口');
  assert.equal(url, 'https://cdn.example/a.png');
});

test('JSON 顶层 url 与 image_url 都能取到', async () => {
  const raw = JSON.stringify({ image_url: 'https://cdn.example/b.webp' });
  const { url } = await decodeImagePayload(bufferOf(bytesOf(raw)), 'application/json', '接口');
  assert.equal(url, 'https://cdn.example/b.webp');
});

test('JSON 服务端错误透传真实 message 与接口标签', async () => {
  const raw = JSON.stringify({ error: { message: '配额已用尽' } });
  await assert.rejects(
    () => decodeImagePayload(bufferOf(bytesOf(raw)), 'application/json', 'NovelAI'),
    /NovelAI 返回错误：配额已用尽/,
  );
});

test('JSON 里没有图片时给出兜底报错', async () => {
  const raw = JSON.stringify({ data: [] });
  await assert.rejects(
    () => decodeImagePayload(bufferOf(bytesOf(raw)), 'application/json', '接口'),
    /响应里没有图片/,
  );
});

test('以 { 开头但解析失败时提示无法解析并带上字节数', async () => {
  await assert.rejects(
    () => decodeImagePayload(bufferOf(bytesOf('{oops not json')), 'application/json', '接口'),
    /无法解析的内容/,
  );
});

test('纯文本非图片非 JSON 时报无法识别并带上预览', async () => {
  await assert.rejects(
    () => decodeImagePayload(bufferOf(bytesOf('hello proxy gateway')), 'text/plain', '接口'),
    /无法识别的内容.*hello proxy gateway/,
  );
});
