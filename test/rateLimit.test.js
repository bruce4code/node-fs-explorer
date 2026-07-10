/**
 * 限流中间件单元测试
 *
 * 运行: node --test test/rateLimit.test.js
 *
 * 注意：rateLimit 的窗口和上限在模块加载时从环境变量读取，
 * 通过子进程设置环境变量来测试限流触发。
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const path = require('node:path');

const RATE_LIMIT_MODULE = path.resolve(__dirname, '../server/middleware/rateLimit');

/**
 * 在子进程中以指定环境变量运行限流测试（单行脚本避免转义问题）
 */
function runInChildProcess(max, requestCount) {
  const script = [
    `process.env.RATE_LIMIT_MAX='${max}'`,
    `process.env.RATE_LIMIT_WINDOW='60'`,
    `const rateLimit=require('${RATE_LIMIT_MODULE}')`,
    `const results=[]`,
    `for(let i=0;i<${requestCount};i++){`,
    `const req={method:'GET',url:'/api/files',headers:{},socket:{remoteAddress:'127.0.0.1'}}`,
    `const res={statusCode:200,headers:{},setHeader(n,v){this.headers[n]=v},writeHead(s){this.statusCode=s},end(b){this.body=b}}`,
    `const h=rateLimit(req,res)`,
    `results.push({handled:h,statusCode:res.statusCode})`,
    `}`,
    `console.log(JSON.stringify(results))`,
  ].join(';');
  const output = execSync(`node -e ${JSON.stringify(script)}`, { encoding: 'utf-8' });
  return JSON.parse(output);
}

describe('限流中间件', () => {
  it('未超限时应全部放行', () => {
    const results = runInChildProcess(10, 5);

    assert.strictEqual(results.length, 5);
    assert.ok(results.every((r) => r.handled === false), '前 5 次应全部放行');
    assert.ok(results.every((r) => r.statusCode === 200), '放行时状态码应为 200');
  });

  it('超过上限后应返回 429', () => {
    const results = runInChildProcess(3, 5);

    assert.strictEqual(results.length, 5);
    assert.strictEqual(results[0].handled, false);
    assert.strictEqual(results[1].handled, false);
    assert.strictEqual(results[2].handled, false);
    assert.strictEqual(results[3].handled, true, '第 4 次应被限流');
    assert.strictEqual(results[3].statusCode, 429, '应返回 429');
    assert.strictEqual(results[4].handled, true, '第 5 次应被限流');
    assert.strictEqual(results[4].statusCode, 429);
  });

  it('恰好达到上限时应放行，再多一次则限流', () => {
    const results = runInChildProcess(3, 4);

    assert.strictEqual(results[2].handled, false, '第 3 次（刚好达上限）应放行');
    assert.strictEqual(results[3].handled, true, '第 4 次应被限流');
  });

  it('不同 IP 应独立计数', () => {
    const script = [
      `process.env.RATE_LIMIT_MAX='2'`,
      `process.env.RATE_LIMIT_WINDOW='60'`,
      `const rateLimit=require('${RATE_LIMIT_MODULE}')`,
      `const results=[]`,
      `for(let i=0;i<3;i++){`,
      `const req={method:'GET',url:'/api/files',headers:{},socket:{remoteAddress:'10.0.0.1'}}`,
      `const res={statusCode:200,headers:{},setHeader(){},writeHead(s){this.statusCode=s},end(){}}`,
      `results.push({ip:'A',handled:rateLimit(req,res)})`,
      `}`,
      `const req2={method:'GET',url:'/api/files',headers:{},socket:{remoteAddress:'10.0.0.2'}}`,
      `const res2={statusCode:200,headers:{},setHeader(){},writeHead(s){this.statusCode=s},end(){}}`,
      `results.push({ip:'B',handled:rateLimit(req2,res2)})`,
      `console.log(JSON.stringify(results))`,
    ].join(';');
    const output = execSync(`node -e ${JSON.stringify(script)}`, { encoding: 'utf-8' });
    const results = JSON.parse(output);

    assert.strictEqual(results[0].handled, false);
    assert.strictEqual(results[1].handled, false);
    assert.strictEqual(results[2].handled, true, 'IP A 第 3 次应被限流');
    assert.strictEqual(results[3].handled, false, 'IP B 第 1 次应放行（独立计数）');
  });

  it('应支持 X-Forwarded-For 提取真实 IP', () => {
    const script = [
      `process.env.RATE_LIMIT_MAX='2'`,
      `const rateLimit=require('${RATE_LIMIT_MODULE}')`,
      `const req={method:'GET',url:'/api/files',headers:{'x-forwarded-for':'203.0.113.5, 10.0.0.1'},socket:{remoteAddress:'10.0.0.1'}}`,
      `const res={statusCode:200,headers:{},setHeader(){},writeHead(s){this.statusCode=s},end(){}}`,
      `const h=rateLimit(req,res)`,
      `const store=rateLimit._getStore()`,
      `const ips=Array.from(store.keys())`,
      `console.log(JSON.stringify({handled:h,ips:ips}))`,
    ].join(';');
    const output = execSync(`node -e ${JSON.stringify(script)}`, { encoding: 'utf-8' });
    const result = JSON.parse(output);

    assert.strictEqual(result.handled, false, '应放行');
    assert.ok(result.ips.includes('203.0.113.5'), '应使用 X-Forwarded-For 的第一个 IP');
  });

  it('应设置限流信息响应头', () => {
    const script = [
      `process.env.RATE_LIMIT_MAX='10'`,
      `const rateLimit=require('${RATE_LIMIT_MODULE}')`,
      `const req={method:'GET',url:'/api/files',headers:{},socket:{remoteAddress:'127.0.0.1'}}`,
      `const headers={}`,
      `const res={statusCode:200,setHeader(n,v){headers[n]=v},writeHead(){},end(){}}`,
      `rateLimit(req,res)`,
      `console.log(JSON.stringify(headers))`,
    ].join(';');
    const output = execSync(`node -e ${JSON.stringify(script)}`, { encoding: 'utf-8' });
    const headers = JSON.parse(output);
    // key 大小写不敏感检查（真实 http.ServerResponse 会转小写，mock 保留原样）
    const keys = Object.keys(headers).map((k) => k.toLowerCase());

    assert.ok(keys.includes('x-ratelimit-limit'), '应设置 X-RateLimit-Limit');
    assert.ok(keys.includes('x-ratelimit-remaining'), '应设置 X-RateLimit-Remaining');
    assert.ok(keys.includes('x-ratelimit-reset'), '应设置 X-RateLimit-Reset');
  });
});
