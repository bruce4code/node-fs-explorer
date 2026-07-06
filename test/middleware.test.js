/**
 * 中间件单元测试
 * 测试 CORS 和 BodyParser 中间件
 *
 * 运行: node --test test/middleware.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');

// =============================================
// 辅助函数：创建 mock req/res
// =============================================
function createMockReq(method, url, headers, bodyData) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = headers || {};
  req.rawBody = null;
  req.body = null;

  // 模拟异步数据流
  if (bodyData) {
    process.nextTick(() => {
      req.emit('data', Buffer.from(bodyData));
      req.emit('end');
    });
  } else {
    process.nextTick(() => {
      req.emit('end');
    });
  }

  return req;
}

function createMockRes() {
  const res = {
    statusCode: null,
    headers: {},
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    writeHead(status, headers) {
      this.statusCode = status;
      if (headers) Object.assign(this.headers, headers);
    },
    end(data) {
      this.ended = true;
      this.body = data ? data.toString() : '';
    },
  };
  return res;
}

// =============================================
// CORS 中间件测试
// =============================================
describe('CORS 中间件', () => {
  const cors = require('../server/middleware/cors');

  it('应为所有请求设置 CORS 头', () => {
    const req = createMockReq('GET', '/api/files');
    const res = createMockRes();

    cors(req, res);

    assert.strictEqual(res.headers['Access-Control-Allow-Origin'], '*');
    assert.strictEqual(res.headers['Access-Control-Allow-Methods'], 'GET, POST, PUT, DELETE, OPTIONS');
    assert.strictEqual(res.headers['Access-Control-Allow-Headers'], 'Content-Type, Authorization');
  });

  it('OPTIONS 预检请求应返回 204 并结束', () => {
    const req = createMockReq('OPTIONS', '/api/files');
    const res = createMockRes();

    const result = cors(req, res);

    assert.strictEqual(result, true, 'OPTIONS 请求应返回 true');
    assert.strictEqual(res.statusCode, 204);
    assert.ok(res.ended, 'OPTIONS 请求应结束响应');
  });

  it('非 OPTIONS 请求应返回 false', () => {
    const req = createMockReq('GET', '/api/files');
    const res = createMockRes();

    const result = cors(req, res);

    assert.strictEqual(result, false, '非 OPTIONS 请求应返回 false');
    assert.strictEqual(res.ended, false, '非 OPTIONS 请求不应结束响应');
  });
});

// =============================================
// BodyParser 中间件测试
// =============================================
describe('BodyParser 中间件', () => {
  const bodyParser = require('../server/middleware/bodyParser');

  it('应解析 application/json 请求体', async () => {
    const req = createMockReq(
      'POST',
      '/api/files/mkdir',
      { 'content-type': 'application/json' },
      JSON.stringify({ path: './test-folder' }),
    );

    await bodyParser(req);

    assert.ok(req.rawBody instanceof Buffer, 'rawBody 应为 Buffer');
    assert.deepStrictEqual(req.body, { path: './test-folder' });
  });

  it('应解析 application/x-www-form-urlencoded 请求体', async () => {
    const req = createMockReq(
      'POST',
      '/api/files/move',
      { 'content-type': 'application/x-www-form-urlencoded' },
      'src=old.txt&dst=new.txt',
    );

    await bodyParser(req);

    assert.deepStrictEqual(req.body, { src: 'old.txt', dst: 'new.txt' });
  });

  it('非 JSON 格式的 JSON 请求体应返回空对象', async () => {
    const req = createMockReq(
      'POST',
      '/api/files/mkdir',
      { 'content-type': 'application/json' },
      'invalid json{{{',
    );

    await bodyParser(req);

    assert.deepStrictEqual(req.body, {}, '解析失败的 JSON 应返回空对象');
  });

  it('multipart/form-data 应只解析 rawBody 不解析 body', async () => {
    const bodyData = [
      '------WebKitFormBoundary\r\n',
      'Content-Disposition: form-data; name="file"; filename="test.txt"\r\n',
      'Content-Type: text/plain\r\n',
      '\r\n',
      'hello world\r\n',
      '------WebKitFormBoundary--\r\n',
    ].join('');

    const req = createMockReq(
      'POST',
      '/api/files/upload',
      { 'content-type': 'multipart/form-data; boundary=----WebKitFormBoundary' },
      bodyData,
    );

    await bodyParser(req);

    assert.ok(req.rawBody instanceof Buffer, 'rawBody 应为 Buffer');
    assert.ok(req.rawBody.length > 0, 'rawBody 不应为空');
    // multipart 不解析 body，留给控制器自行处理
    assert.deepStrictEqual(req.body, {});
  });

  it('空请求体应返回空 Buffer 和空对象', async () => {
    const req = createMockReq(
      'POST',
      '/api/files/mkdir',
      { 'content-type': 'application/json' },
      '', // 空 body
    );

    await bodyParser(req);

    assert.strictEqual(req.rawBody.length, 0, '空请求体的 rawBody 长度应为 0');
    assert.deepStrictEqual(req.body, {});
  });

  it('无 Content-Type 应解析为 rawBody 和空 body', async () => {
    const req = createMockReq(
      'POST',
      '/api/files/upload',
      {}, // 无 Content-Type
      'some data',
    );

    await bodyParser(req);

    assert.ok(req.rawBody instanceof Buffer);
    assert.strictEqual(req.rawBody.toString('utf-8'), 'some data');
    assert.deepStrictEqual(req.body, {}, '无 Content-Type 时 body 应为空对象');
  });

  it('请求体错误时应 reject', async () => {
    const req = new EventEmitter();
    req.method = 'POST';
    req.url = '/api/files/mkdir';
    req.headers = { 'content-type': 'application/json' };
    req.rawBody = null;
    req.body = null;

    // 在 end 事件之前触发 error
    process.nextTick(() => {
      req.emit('error', new Error('Stream error'));
    });

    await assert.rejects(
      () => bodyParser(req),
      { message: 'Stream error' },
    );
  });
});