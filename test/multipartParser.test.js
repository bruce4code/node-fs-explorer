/**
 * multipartParser 单元测试
 * 测试 multipart/form-data 的解析逻辑（纯函数，不依赖文件系统）
 *
 * 运行: node --test test/multipartParser.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseMultipart, extractBoundary } = require('../packages/node-utils/multipartParser');

// =============================================
// extractBoundary 测试
// =============================================
describe('extractBoundary', () => {
  it('应从标准 Content-Type 中提取 boundary', () => {
    const result = extractBoundary('multipart/form-data; boundary=----WebKitFormBoundary');
    assert.strictEqual(result, '----WebKitFormBoundary');
  });

  it('应处理 boundary 带后缀参数的情况', () => {
    const result = extractBoundary('multipart/form-data; boundary=----TestBoundary; charset=utf-8');
    assert.strictEqual(result, '----TestBoundary');
  });

  it('如果没有 boundary 应返回 null', () => {
    const result = extractBoundary('multipart/form-data');
    assert.strictEqual(result, null);
  });

  it('应处理空字符串', () => {
    const result = extractBoundary('');
    assert.strictEqual(result, null);
  });
});

// =============================================
// parseMultipart 测试
// =============================================
describe('parseMultipart', () => {
  it('应解析单个文本字段', () => {
    const boundary = '----TestBoundary';
    const body = [
      `------TestBoundary\r\n`,
      `Content-Disposition: form-data; name="path"\r\n`,
      `\r\n`,
      `./uploads\r\n`,
      `------TestBoundary--\r\n`,
    ].join('');

    const parts = parseMultipart(Buffer.from(body), boundary);

    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0].name, 'path');
    assert.strictEqual(parts[0].filename, null);
    assert.strictEqual(parts[0].data.toString('utf-8'), './uploads');
  });

  it('应解析单文件上传', () => {
    const boundary = '----TestBoundary';
    const fileContent = 'Hello, World!';
    const body = [
      `------TestBoundary\r\n`,
      `Content-Disposition: form-data; name="file"; filename="test.txt"\r\n`,
      `Content-Type: text/plain\r\n`,
      `\r\n`,
      `${fileContent}\r\n`,
      `------TestBoundary--\r\n`,
    ].join('');

    const parts = parseMultipart(Buffer.from(body), boundary);

    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0].name, 'file');
    assert.strictEqual(parts[0].filename, 'test.txt');
    assert.strictEqual(parts[0].contentType, 'text/plain');
    assert.strictEqual(parts[0].data.toString('utf-8'), fileContent);
  });

  it('应解析多个字段（文本 + 文件）', () => {
    const boundary = '----TestBoundary';
    const body = [
      `------TestBoundary\r\n`,
      `Content-Disposition: form-data; name="path"\r\n`,
      `\r\n`,
      `./uploads\r\n`,
      `------TestBoundary\r\n`,
      `Content-Disposition: form-data; name="file"; filename="hello.txt"\r\n`,
      `Content-Type: text/plain\r\n`,
      `\r\n`,
      `file content here\r\n`,
      `------TestBoundary--\r\n`,
    ].join('');

    const parts = parseMultipart(Buffer.from(body), boundary);

    assert.strictEqual(parts.length, 2);

    // 第一个 part：文本字段
    assert.strictEqual(parts[0].name, 'path');
    assert.strictEqual(parts[0].filename, null);
    assert.strictEqual(parts[0].data.toString('utf-8'), './uploads');

    // 第二个 part：文件
    assert.strictEqual(parts[1].name, 'file');
    assert.strictEqual(parts[1].filename, 'hello.txt');
    assert.strictEqual(parts[1].contentType, 'text/plain');
    assert.strictEqual(parts[1].data.toString('utf-8'), 'file content here');
  });

  it('应处理文件名为中文的情况', () => {
    const boundary = '----TestBoundary';
    const body = [
      `------TestBoundary\r\n`,
      `Content-Disposition: form-data; name="file"; filename="中文文件.txt"\r\n`,
      `Content-Type: text/plain\r\n`,
      `\r\n`,
      `中文内容\r\n`,
      `------TestBoundary--\r\n`,
    ].join('');

    const parts = parseMultipart(Buffer.from(body), boundary);

    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0].filename, '中文文件.txt');
    assert.strictEqual(parts[0].data.toString('utf-8'), '中文内容');
  });

  it('应处理空内容文件', () => {
    const boundary = '----TestBoundary';
    const body = [
      `------TestBoundary\r\n`,
      `Content-Disposition: form-data; name="file"; filename="empty.txt"\r\n`,
      `Content-Type: text/plain\r\n`,
      `\r\n`,
      `\r\n`,
      `------TestBoundary--\r\n`,
    ].join('');

    const parts = parseMultipart(Buffer.from(body), boundary);

    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0].filename, 'empty.txt');
    assert.strictEqual(parts[0].data.length, 0);
  });

  it('应处理二进制文件内容', () => {
    const boundary = '----TestBoundary';
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0x7F]);
    const body = Buffer.concat([
      Buffer.from(`------TestBoundary\r\n`),
      Buffer.from(`Content-Disposition: form-data; name="file"; filename="binary.bin"\r\n`),
      Buffer.from(`Content-Type: application/octet-stream\r\n`),
      Buffer.from(`\r\n`),
      binaryData,
      Buffer.from(`\r\n`),
      Buffer.from(`------TestBoundary--\r\n`),
    ]);

    const parts = parseMultipart(body, boundary);

    assert.strictEqual(parts.length, 1);
    assert.strictEqual(parts[0].filename, 'binary.bin');
    assert.strictEqual(parts[0].data.length, binaryData.length);
    assert.ok(parts[0].data.equals(binaryData), '二进制数据应一致');
  });

  it('应处理空 body 返回空数组', () => {
    const parts = parseMultipart(Buffer.alloc(0), '----TestBoundary');
    assert.ok(Array.isArray(parts));
    assert.strictEqual(parts.length, 0);
  });

  it('应处理不含 boundary 的 body 返回空数组', () => {
    const parts = parseMultipart(Buffer.from('some random data without boundary'), '----TestBoundary');
    assert.ok(Array.isArray(parts));
    assert.strictEqual(parts.length, 0);
  });
});
