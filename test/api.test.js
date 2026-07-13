/**
 * API 集成测试
 * 启动真实 HTTP 服务，测试所有 API 端点
 *
 * 运行: node --test test/api.test.js
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

// 引入服务组件（与 server/index.js 相同的中间件链）
const cors = require('../server/middleware/cors');
const jwtAuth = require('../server/middleware/jwtAuth');
const rateLimit = require('../server/middleware/rateLimit');
const bodyParser = require('../server/middleware/bodyParser');
const router = require('../server/routes');

// =============================================
// 测试环境配置
// =============================================
const TEST_DIR = path.resolve(__dirname, '../.test-temp');
const PROJECT_ROOT = path.resolve(__dirname, '..');

// =============================================
// 全局变量
// =============================================
let server;
let baseUrl;

// =============================================
// 辅助函数：创建 HTTP 请求
// =============================================
function request(method, urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const body = options.body;

    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          ...(options.headers || {}),
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          let data;
          try {
            data = JSON.parse(raw.toString());
          } catch {
            data = raw.toString();
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            data,
            raw,
          });
        });
      },
    );

    req.on('error', reject);

    if (body) req.write(body);
    req.end();
  });
}

/**
 * 生成 multipart/form-data 请求体
 */
function createMultipartBody(fields, boundary) {
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(`--${boundary}`);
    if (value.isFile) {
      parts.push(`Content-Disposition: form-data; name="${name}"; filename="${value.filename}"`);
      parts.push(`Content-Type: ${value.contentType || 'application/octet-stream'}`);
      parts.push('');
      parts.push(value.content);
    } else {
      parts.push(`Content-Disposition: form-data; name="${name}"`);
      parts.push('');
      parts.push(value);
    }
  }
  parts.push(`--${boundary}--`);
  parts.push('');
  return parts.join('\r\n');
}

// =============================================
// 启动/停止测试服务
// =============================================
before(async () => {
  // 清理残留测试目录
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  // 创建测试目录
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // 重置限流状态，避免不同测试文件间相互影响
  rateLimit._reset();

  return new Promise((resolve) => {
    process.env.PORT = '0'; // 随机端口
    const http = require('node:http');

    server = http.createServer(async (req, res) => {
      if (cors(req, res)) return;
      // 测试环境不启用鉴权（JWT_SECRET/API_TOKEN 未设置则 jwtAuth 直接放行）
      if (jwtAuth(req, res)) return;
      // 测试环境不启用限流（放宽上限避免测试自身被限）
      // 如需测试限流，单独在 rateLimit.test.js 中验证
      if (req.headers['x-test-ratelimit']) {
        if (rateLimit(req, res)) return;
      }
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          await bodyParser(req);
        } else {
          req.rawBody = Buffer.alloc(0);
          req.body = {};
        }
        await router.handle(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ success: false, error: `Internal Server Error: ${err.message}` }));
        }
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

after(() => {
  // 清理测试目录
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  // 关闭服务
  if (server) server.close();
});

// =============================================
// 集成测试用例
// =============================================
describe('API 集成测试', () => {
  // =============================================
  // 浏览目录
  // =============================================
  describe('GET /api/files', () => {
    it('应返回项目根目录的文件列表', async () => {
      const res = await request('GET', '/api/files');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.data));

      // 应包含核心目录和文件
      const names = res.data.data.map((e) => e.name);
      assert.ok(names.includes('cli'));
      assert.ok(names.includes('core'));
      assert.ok(names.includes('server'));
      assert.ok(names.includes('package.json'));
    });

    it('应返回指定子目录的内容', async () => {
      const res = await request('GET', '/api/files?path=cli');

      assert.strictEqual(res.status, 200);
      assert.ok(res.data.success);
      assert.ok(Array.isArray(res.data.data));

      const names = res.data.data.map((e) => e.name);
      assert.ok(names.includes('index.js'));
      assert.ok(names.includes('commands'));
    });

    it('目录穿越应返回错误', async () => {
      const res = await request('GET', '/api/files?path=../../etc');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.ok(res.data.error.toLowerCase().includes('directory traversal'));
    });

    it('不存在的目录应返回错误', async () => {
      const res = await request('GET', '/api/files?path=nonexistent-dir-12345');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 文件详情
  // =============================================
  describe('GET /api/files/info', () => {
    it('应返回文件详情', async () => {
      const res = await request('GET', '/api/files/info?path=package.json');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.type, 'file');
      assert.ok(res.data.data.size > 0);
      assert.ok(res.data.data.name === 'package.json');
      assert.ok(res.data.data.createdTime);
      assert.ok(res.data.data.modifiedTime);
    });

    it('应返回目录详情', async () => {
      const res = await request('GET', '/api/files/info?path=cli');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.type, 'directory');
      assert.strictEqual(res.data.data.isDirectory, true);
    });

    it('缺少 path 参数应返回 400', async () => {
      const res = await request('GET', '/api/files/info');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.ok(res.data.error.includes('path'));
    });

    it('不存在的路径应返回 400', async () => {
      const res = await request('GET', '/api/files/info?path=nonexistent-file-98765.txt');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 创建目录
  // =============================================
  describe('POST /api/files/mkdir', () => {
    const testDirName = '.test-mkdir-dir';

    it('应创建新目录', async () => {
      const res = await request('POST', '/api/files/mkdir', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path.join(TEST_DIR, testDirName) }),
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      // 验证目录确实存在
      const dirPath = path.resolve(PROJECT_ROOT, TEST_DIR, testDirName);
      assert.ok(fs.existsSync(dirPath), '目录应存在于磁盘');
    });

    it('缺少 path 参数应返回 400', async () => {
      const res = await request('POST', '/api/files/mkdir', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('路径穿越应返回错误', async () => {
      const res = await request('POST', '/api/files/mkdir', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: '../../etc/hacked' }),
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 上传文件
  // =============================================
  describe('POST /api/files/upload', () => {
    const boundary = '----TestFormBoundary';

    it('应上传文本文件', async () => {
      const body = createMultipartBody(
        {
          file: {
            isFile: true,
            filename: 'hello.txt',
            contentType: 'text/plain',
            content: 'Hello, API Test!',
          },
          path: TEST_DIR,
        },
        boundary,
      );

      const res = await request('POST', '/api/files/upload', {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.fileName, 'hello.txt');

      // 验证文件已写入磁盘
      const filePath = path.resolve(PROJECT_ROOT, TEST_DIR, 'hello.txt');
      assert.ok(fs.existsSync(filePath), '文件应存在于磁盘');
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.strictEqual(content, 'Hello, API Test!');
    });

    it('应上传二进制文件', async () => {
      const binaryData = Buffer.from([0x00, 0xFF, 0xAB, 0xCD]).toString('binary');
      const body = createMultipartBody(
        {
          file: {
            isFile: true,
            filename: 'data.bin',
            contentType: 'application/octet-stream',
            content: binaryData,
          },
          path: TEST_DIR,
        },
        boundary,
      );

      const res = await request('POST', '/api/files/upload', {
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.fileName, 'data.bin');

      // 验证文件
      const filePath = path.resolve(PROJECT_ROOT, TEST_DIR, 'data.bin');
      assert.ok(fs.existsSync(filePath));
    });

    it('不是 multipart 格式应返回 400', async () => {
      const res = await request('POST', '/api/files/upload', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'test' }),
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
      assert.ok(res.data.error.includes('multipart'));
    });
  });

  // =============================================
  // 下载文件
  // =============================================
  describe('GET /api/files/download', () => {
    it('应下载存在的文件', async () => {
      const res = await request('GET', '/api/files/download?path=package.json');

      assert.strictEqual(res.status, 200);
      // 下载直接返回文件流，不是 JSON
      assert.ok(res.raw.length > 0, '应返回文件内容');
      assert.ok(res.headers['content-disposition'], '应包含 Content-Disposition 头');
    });

    it('缺少 path 参数应返回 400', async () => {
      const res = await request('GET', '/api/files/download');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('不存在的文件应返回 400', async () => {
      const res = await request('GET', '/api/files/download?path=nonexistent-file-4444.txt');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 移动/重命名
  // =============================================
  describe('PUT /api/files/move', () => {
    it('应重命名文件', async () => {
      // 先创建一个测试文件
      const srcPath = path.join(TEST_DIR, 'old-name.txt');
      fs.writeFileSync(srcPath, 'rename test');

      const res = await request('PUT', '/api/files/move', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          src: srcPath,
          dst: path.join(TEST_DIR, 'new-name.txt'),
        }),
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);

      // 验证旧文件不存在，新文件存在
      assert.ok(!fs.existsSync(srcPath), '旧文件应不存在');
      assert.ok(fs.existsSync(path.join(TEST_DIR, 'new-name.txt')), '新文件应存在');
    });

    it('缺少参数应返回 400', async () => {
      const res = await request('PUT', '/api/files/move', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: 'a.txt' }), // 缺少 dst
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('源文件不存在应返回 400', async () => {
      const res = await request('PUT', '/api/files/move', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ src: '/nonexistent-file-555.txt', dst: '/newname.txt' }),
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 删除文件/目录
  // =============================================
  describe('DELETE /api/files', () => {
    it('应删除文件', async () => {
      // 先创建一个测试文件
      const filePath = path.join(TEST_DIR, 'to-delete.txt');
      fs.writeFileSync(filePath, 'delete me');

      const res = await request('DELETE', `/api/files?path=${encodeURIComponent(filePath)}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(!fs.existsSync(filePath), '文件应已被删除');
    });

    it('删除不存在的文件应返回 400', async () => {
      const res = await request('DELETE', '/api/files?path=/nonexistent-file-666.txt');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('缺少 path 参数应返回 400', async () => {
      const res = await request('DELETE', '/api/files');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 404 路由
  // =============================================
  // =============================================
  // 文件搜索（Phase 3）
  // =============================================
  describe('GET /api/files/search', () => {
    it('应搜索匹配的文件', async () => {
      const res = await request('GET', '/api/files/search?path=.&pattern=package');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.data));
      assert.ok(res.data.data.length > 0);
      // 应找到 package.json
      const names = res.data.data.map((e) => e.name);
      assert.ok(names.includes('package.json'));
    });

    it('应支持 * 通配符搜索', async () => {
      const res = await request('GET', '/api/files/search?path=cli&pattern=*.js');

      assert.strictEqual(res.status, 200);
      assert.ok(res.data.success);
      assert.ok(res.data.data.length > 0);
      const names = res.data.data.map((e) => e.name);
      assert.ok(names.includes('index.js'));
    });

    it('无匹配时返回空数组', async () => {
      const res = await request('GET', '/api/files/search?path=.&pattern=zzz_nonexistent_xxx');

      assert.strictEqual(res.status, 200);
      assert.ok(res.data.success);
      assert.strictEqual(res.data.data.length, 0);
    });

    it('缺少 pattern 应返回 400', async () => {
      const res = await request('GET', '/api/files/search?path=.');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 文件预览（Phase 3）
  // =============================================
  describe('GET /api/files/preview', () => {
    it('应预览文本文件的前 N 行', async () => {
      const res = await request('GET', '/api/files/preview?path=package.json&lines=3');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.type, 'text');
      assert.ok(res.data.data.content.length > 0);
      assert.ok(res.data.data.extension, '.json');
    });

    it('缺少 path 应返回 400', async () => {
      const res = await request('GET', '/api/files/preview');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('预览不存在的文件应返回 400', async () => {
      const res = await request('GET', '/api/files/preview?path=nonexistent.txt');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 文件哈希（Phase 3）
  // =============================================
  describe('GET /api/files/hash', () => {
    it('应计算文件的 MD5 值', async () => {
      const res = await request('GET', '/api/files/hash?path=package.json');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.algorithm, 'md5');
      assert.ok(/^[a-f0-9]{32}$/.test(res.data.data.hash), 'MD5 应为 32 位十六进制');
      assert.ok(res.data.data.size > 0);
    });

    it('应计算文件的 SHA256 值', async () => {
      const res = await request('GET', '/api/files/hash?path=package.json&algorithm=sha256');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.strictEqual(res.data.data.algorithm, 'sha256');
      assert.ok(/^[a-f0-9]{64}$/.test(res.data.data.hash), 'SHA256 应为 64 位十六进制');
    });

    it('不支持的算法应返回 400', async () => {
      const res = await request('GET', '/api/files/hash?path=package.json&algorithm=sha3');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });

    it('缺少 path 应返回 400', async () => {
      const res = await request('GET', '/api/files/hash');

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.data.success, false);
    });
  });

  // =============================================
  // 操作日志（Phase 3）
  // =============================================
  describe('GET /api/files/logs', () => {
    it('应返回操作日志列表', async () => {
      // 先做几个操作产生日志
      await request('GET', '/api/files?path=.');
      await request('GET', '/api/files/hash?path=package.json');

      const res = await request('GET', '/api/files/logs');

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.success, true);
      assert.ok(Array.isArray(res.data.data));
      // 至少应有 list 和 hash 操作
      assert.ok(res.data.data.length > 0);
    });
  });

  // =============================================
  // 404 路由
  // =============================================
  describe('404 处理', () => {
    it('未匹配的路由应返回 404', async () => {
      const res = await request('GET', '/api/unknown');

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.data.success, false);
    });
  });
});