/**
 * 鉴权中间件单元测试
 *
 * 运行: node --test test/auth.test.js
 *
 * 注意：auth.js 在模块加载时读取 API_TOKEN，启用场景通过子进程验证。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');
const auth = require('../server/middleware/auth');

const AUTH_MODULE = path.resolve(__dirname, '../server/middleware/auth');

/**
 * 创建 mock req
 */
function createMockReq(method, url, headers = {}) {
  return { method, url, headers, socket: { remoteAddress: '127.0.0.1' } };
}

function createMockRes() {
  return {
    statusCode: 200, ended: false, body: null,
    setHeader() {}, writeHead(s) { this.statusCode = s; }, end(b) { this.ended = true; this.body = b; },
  };
}

/**
 * 在子进程中设置 API_TOKEN 后测试 auth（单行脚本避免转义问题）
 */
function runAuthInChild(token, reqHeaders, reqUrl) {
  const script = [
    `process.env.API_TOKEN='${token}'`,
    `const auth=require('${AUTH_MODULE}')`,
    `const req={method:'GET',url:'${reqUrl}',headers:${JSON.stringify(reqHeaders)},socket:{remoteAddress:'127.0.0.1'}}`,
    `const res={statusCode:200,ended:false,setHeader(){},writeHead(s){this.statusCode=s},end(b){this.ended=true,this.body=b}}`,
    `const h=auth(req,res)`,
    `console.log(JSON.stringify({handled:h,ended:res.ended,statusCode:res.statusCode,body:res.body}))`,
  ].join(';');
  const output = execSync(`node -e ${JSON.stringify(script)}`, { encoding: 'utf-8' });
  return JSON.parse(output);
}

describe('鉴权中间件（API_TOKEN 未设置时）', () => {
  it('未配置 API_TOKEN 时应放行', () => {
    const req = createMockReq('GET', '/api/files');
    const res = createMockRes();
    const handled = auth(req, res);

    assert.strictEqual(handled, false, '未配置 token 时应返回 false（放行）');
    assert.strictEqual(res.ended, false, '不应结束响应');
  });

  it('未配置 API_TOKEN 时任意路径都放行', () => {
    const req = createMockReq('POST', '/api/files/upload');
    const res = createMockRes();
    const handled = auth(req, res);

    assert.strictEqual(handled, false);
    assert.strictEqual(res.ended, false);
  });
});

describe('鉴权中间件（启用 API_TOKEN 场景）', () => {
  it('配置正确 token 时应通过校验', () => {
    const result = runAuthInChild('test-secret-123', { 'x-api-token': 'test-secret-123' }, '/api/files');

    assert.strictEqual(result.handled, false, '正确 token 应放行');
    assert.strictEqual(result.ended, false, '不应结束响应');
  });

  it('配置错误 token 时应返回 401', () => {
    const result = runAuthInChild('test-secret-123', { 'x-api-token': 'wrong-token' }, '/api/files');

    assert.strictEqual(result.handled, true, '错误 token 应被拦截');
    assert.strictEqual(result.ended, true, '应结束响应');
    assert.strictEqual(result.statusCode, 401, '应返回 401');
    assert.ok(result.body.includes('未授权'), '应包含未授权信息');
  });

  it('缺少 token 时应返回 401', () => {
    const result = runAuthInChild('test-secret-123', {}, '/api/files');

    assert.strictEqual(result.handled, true);
    assert.strictEqual(result.statusCode, 401);
  });

  it('应支持通过 query 参数传递 token', () => {
    const result = runAuthInChild('test-secret-123', {}, '/api/files?token=test-secret-123');

    assert.strictEqual(result.handled, false, 'query 参数正确 token 应放行');
    assert.strictEqual(result.ended, false);
  });

  it('query 参数错误 token 应返回 401', () => {
    const result = runAuthInChild('test-secret-123', {}, '/api/files?token=wrong');

    assert.strictEqual(result.handled, true);
    assert.strictEqual(result.statusCode, 401);
  });
});
