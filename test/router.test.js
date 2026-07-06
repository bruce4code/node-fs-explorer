/**
 * Router 单元测试
 * 测试路由注册、匹配、404 和错误处理
 *
 * 运行: node --test test/router.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const Router = require('../server/router');

// =============================================
// 辅助函数：创建 mock req/res
// =============================================
function createMockReq(method, url, headers) {
  return {
    method,
    url,
    headers: headers || { host: 'localhost' },
  };
}

function createMockRes() {
  const chunks = [];
  return {
    statusCode: null,
    headers: null,
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(data) {
      this.body = data ? data.toString() : '';
      chunks.push(this.body);
    },
    getBody() {
      return this.body || '';
    },
    getJson() {
      try {
        return JSON.parse(this.getBody());
      } catch {
        return null;
      }
    },
  };
}

// =============================================
// Router 测试
// =============================================
describe('Router', () => {
  let router;

  before(() => {
    router = new Router();
  });

  describe('路由注册', () => {
    it('应注册 GET 路由', () => {
      const handler = () => {};
      router.get('/test', handler);
      // 验证路由已注册（内部 routes 数组应有该条目）
      assert.strictEqual(router.routes.length, 1);
      assert.strictEqual(router.routes[0].method, 'GET');
      assert.strictEqual(router.routes[0].path, '/test');
    });

    it('应注册 POST 路由', () => {
      const handler = () => {};
      router.post('/api/test', handler);
      assert.strictEqual(router.routes.length, 2);
      assert.strictEqual(router.routes[1].method, 'POST');
      assert.strictEqual(router.routes[1].path, '/api/test');
    });

    it('应注册 PUT 路由', () => {
      const handler = () => {};
      router.put('/api/update', handler);
      assert.strictEqual(router.routes.length, 3);
      assert.strictEqual(router.routes[2].method, 'PUT');
    });

    it('应注册 DELETE 路由', () => {
      const handler = () => {};
      router.delete('/api/remove', handler);
      assert.strictEqual(router.routes.length, 4);
      assert.strictEqual(router.routes[3].method, 'DELETE');
    });
  });

  describe('路由匹配', () => {
    it('应匹配 GET /test 并执行 handler', async () => {
      const req = createMockReq('GET', '/test');
      const res = createMockRes();
      let handlerCalled = false;

      // 注册一个测试路由
      router.get('/test-match', (req, res) => {
        handlerCalled = true;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });

      // 构造请求
      const matchReq = createMockReq('GET', '/test-match');
      const matchRes = createMockRes();

      await router.handle(matchReq, matchRes);

      assert.ok(handlerCalled, 'handler 应被执行');
      assert.strictEqual(matchRes.statusCode, 200);
      assert.strictEqual(matchRes.getJson().success, true);
    });

    it('应解析 URL 参数到 req.query', async () => {
      router.get('/test-query', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ query: req.query }));
      });

      const req = createMockReq('GET', '/test-query?path=./cli&type=dir');
      const res = createMockRes();

      await router.handle(req, res);

      const json = res.getJson();
      assert.strictEqual(json.query.path, './cli');
      assert.strictEqual(json.query.type, 'dir');
    });

    it('应解析 req.pathname', async () => {
      router.get('/test-pathname', (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ pathname: req.pathname }));
      });

      const req = createMockReq('GET', '/test-pathname?foo=bar');
      const res = createMockRes();

      await router.handle(req, res);

      assert.strictEqual(res.getJson().pathname, '/test-pathname');
    });

    it('不匹配时返回 404', async () => {
      const req = createMockReq('GET', '/nonexistent');
      const res = createMockRes();

      await router.handle(req, res);

      assert.strictEqual(res.statusCode, 404);
      const json = res.getJson();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Not Found'));
    });

    it('匹配到路由但方法不匹配时返回 404', async () => {
      const req = createMockReq('POST', '/test-match');
      const res = createMockRes();

      await router.handle(req, res);

      assert.strictEqual(res.statusCode, 404);
    });
  });

  describe('错误处理', () => {
    it('handler 抛出异常时返回 500', async () => {
      router.get('/test-error', () => {
        throw new Error('Something broke');
      });

      const req = createMockReq('GET', '/test-error');
      const res = createMockRes();

      await router.handle(req, res);

      assert.strictEqual(res.statusCode, 500);
      const json = res.getJson();
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Internal Server Error'));
    });

    it('async handler 异常也应捕获', async () => {
      router.get('/test-async-error', async () => {
        throw new Error('Async error');
      });

      const req = createMockReq('GET', '/test-async-error');
      const res = createMockRes();

      await router.handle(req, res);

      assert.strictEqual(res.statusCode, 500);
      assert.ok(res.getJson().error.includes('Async error'));
    });
  });
});