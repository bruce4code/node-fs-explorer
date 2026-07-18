/**
 * 流式 multipart 解析器单元测试
 *
 * 运行: node --test test/multipartStreamParser.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createMultipartStream } = require('../packages/node-utils/multipartStreamParser');

/**
 * 构造 multipart body Buffer
 */
function buildBody(parts, boundary) {
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (p.isFile) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"; filename="${p.filename}"\r\n`));
      if (p.contentType) chunks.push(Buffer.from(`Content-Type: ${p.contentType}\r\n`));
      chunks.push(Buffer.from('\r\n'));
      chunks.push(Buffer.isBuffer(p.content) ? p.content : Buffer.from(p.content));
      chunks.push(Buffer.from('\r\n'));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${p.name}"\r\n\r\n`));
      chunks.push(Buffer.from(p.content));
      chunks.push(Buffer.from('\r\n'));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(chunks);
}

/**
 * 把 body 喂给解析器，收集结果
 */
function runParser(body, boundary) {
  return new Promise((resolve, reject) => {
    const fields = {};
    const files = [];
    const tmpFiles = [];
    const writeStreams = [];

    const parser = createMultipartStream(boundary, {
      onField(name, value) { fields[name] = value; },
      onFileStart(name, filename) {
        const tmpPath = path.join(os.tmpdir(), `test-${Date.now()}-${Math.random().toString(36).slice(2)}-${filename}`);
        tmpFiles.push(tmpPath);
        const ws = fs.createWriteStream(tmpPath);
        writeStreams.push(ws);
        files.push({ name, filename, tmpPath });
        return ws;
      },
      onFileEnd(name, filename) {
        const f = files.find((x) => x.filename === filename);
        if (f) f.done = true;
      },
    });

    // 用 pipeline 连接 src -> parser，完成时回调
    pipeline(Readable.from(body), parser, (err) => {
      if (err) {
        tmpFiles.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
        return reject(err);
      }
      // 等待所有 writeStream 落盘
      const waitAll = writeStreams.map((ws) => new Promise((r) => ws.on('finish', r)));
      Promise.all(waitAll).then(() => {
        const fileResults = files.map((f) => ({
          name: f.name,
          filename: f.filename,
          content: fs.existsSync(f.tmpPath) ? fs.readFileSync(f.tmpPath) : null,
        }));
        tmpFiles.forEach((p) => { try { fs.unlinkSync(p); } catch {} });
        resolve({ fields, files: fileResults });
      });
    });
  });
}

describe('流式 multipart 解析器', () => {
  it('应解析单个文本字段', async () => {
    const boundary = '----TestBoundary';
    const body = buildBody([{ name: 'path', content: './uploads' }], boundary);
    const { fields, files } = await runParser(body, boundary);

    assert.strictEqual(fields.path, './uploads');
    assert.strictEqual(files.length, 0);
  });

  it('应解析单个文件', async () => {
    const boundary = '----TestBoundary';
    const body = buildBody([{
      name: 'file', isFile: true, filename: 'test.txt', contentType: 'text/plain', content: 'Hello Stream!',
    }], boundary);
    const { fields, files } = await runParser(body, boundary);

    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].filename, 'test.txt');
    assert.strictEqual(files[0].content.toString('utf-8'), 'Hello Stream!');
  });

  it('应解析字段 + 文件混合（字段在前）', async () => {
    const boundary = '----TestBoundary';
    const body = buildBody([
      { name: 'path', content: './uploads' },
      { name: 'file', isFile: true, filename: 'a.txt', contentType: 'text/plain', content: 'AAA' },
    ], boundary);
    const { fields, files } = await runParser(body, boundary);

    assert.strictEqual(fields.path, './uploads');
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].content.toString(), 'AAA');
  });

  it('应解析字段 + 文件混合（文件在前，字段在后）', async () => {
    // 这正是 Phase 4 流式上传要解决的核心场景：
    // path 字段在 file 之后，传统顺序处理会拿不到 path
    const boundary = '----TestBoundary';
    const body = buildBody([
      { name: 'file', isFile: true, filename: 'b.txt', contentType: 'text/plain', content: 'BBB' },
      { name: 'path', content: './uploads' },
    ], boundary);
    const { fields, files } = await runParser(body, boundary);

    assert.strictEqual(fields.path, './uploads');
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].content.toString(), 'BBB');
  });

  it('应正确处理二进制文件内容', async () => {
    const boundary = '----TestBoundary';
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0x7F]);
    const body = buildBody([{
      name: 'file', isFile: true, filename: 'bin.dat', contentType: 'application/octet-stream', content: binaryData,
    }], boundary);
    const { files } = await runParser(body, boundary);

    assert.strictEqual(files.length, 1);
    assert.ok(files[0].content.equals(binaryData), '二进制数据应一致');
  });

  it('应正确处理中文文件名和内容', async () => {
    const boundary = '----TestBoundary';
    const body = buildBody([{
      name: 'file', isFile: true, filename: '中文文件.txt', contentType: 'text/plain', content: '中文内容',
    }], boundary);
    const { files } = await runParser(body, boundary);

    assert.strictEqual(files[0].filename, '中文文件.txt');
    assert.strictEqual(files[0].content.toString('utf-8'), '中文内容');
  });

  it('应支持大文件流式写入（分块传输）', async () => {
    const boundary = '----TestBoundary';
    // 构造 1MB 数据
    const bigContent = Buffer.alloc(1024 * 1024, 'X');
    const body = buildBody([{
      name: 'file', isFile: true, filename: 'big.dat', contentType: 'application/octet-stream', content: bigContent,
    }], boundary);

    const { files } = await runParser(body, boundary);
    assert.strictEqual(files[0].content.length, 1024 * 1024);
    assert.ok(files[0].content.equals(bigContent));
  });

  it('应处理多个文件', async () => {
    const boundary = '----TestBoundary';
    const body = buildBody([
      { name: 'file1', isFile: true, filename: 'a.txt', contentType: 'text/plain', content: 'AAA' },
      { name: 'file2', isFile: true, filename: 'b.txt', contentType: 'text/plain', content: 'BBB' },
    ], boundary);
    const { files } = await runParser(body, boundary);

    assert.strictEqual(files.length, 2);
    assert.strictEqual(files[0].content.toString(), 'AAA');
    assert.strictEqual(files[1].content.toString(), 'BBB');
  });
});
