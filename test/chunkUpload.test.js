/**
 * 分片上传服务单元测试
 *
 * 运行: node --test test/chunkUpload.test.js
 */
const { describe, it, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');

const chunkUploadService = require('../packages/core/chunkUploadService');
const pathValidator = require('../packages/core/pathValidator');

const TEST_DIR = path.resolve(__dirname, '../.test-chunk-temp');
const PROJECT_ROOT = path.resolve(__dirname, '..');

// 确保 TEST_DIR 在项目根目录下（路径安全）
assert.ok(TEST_DIR.startsWith(PROJECT_ROOT), 'TEST_DIR 应在项目根目录下');

// =============================================
// 辅助函数
// =============================================

async function cleanTestDir() {
  if (fsSync.existsSync(TEST_DIR)) {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  }
  await fs.mkdir(TEST_DIR, { recursive: true });
}

// =============================================
// 清理
// =============================================

after(async () => {
  await cleanTestDir();
});

// =============================================
// 测试用例
// =============================================

describe('分片上传服务', () => {
  describe('init - 初始化上传', () => {
    it('应创建上传会话并返回 uploadId', async () => {
      await cleanTestDir();
      const result = await chunkUploadService.init({
        fileName: 'test.txt',
        fileSize: 100,
        targetDir: TEST_DIR,
      });

      assert.ok(result.uploadId, '应返回 uploadId');
      assert.ok(result.chunkSize > 0, '应返回 chunkSize');
      assert.ok(result.totalChunks > 0, '应返回 totalChunks');
      assert.deepStrictEqual(result.uploadedChunks, [], '初始 uploadedChunks 应为空');

      // 清理
      await chunkUploadService.abort(result.uploadId);
    });

    it('缺少 fileName 应报错', async () => {
      await assert.rejects(
        () => chunkUploadService.init({ fileSize: 100, targetDir: TEST_DIR }),
        /fileName/,
      );
    });

    it('缺少 fileSize 应报错', async () => {
      await assert.rejects(
        () => chunkUploadService.init({ fileName: 'test.txt', targetDir: TEST_DIR }),
        /fileSize/,
      );
    });

    it('文件名净化：应取 basename', async () => {
      await cleanTestDir();
      const result = await chunkUploadService.init({
        fileName: '../../etc/passwd',
        fileSize: 100,
        targetDir: TEST_DIR,
      });

      const status = await chunkUploadService.status(result.uploadId);
      assert.strictEqual(status.fileName, 'passwd', '文件名应为 basename');

      await chunkUploadService.abort(result.uploadId);
    });
  });

  describe('uploadChunk + complete - 上传分片并合并', () => {
    it('应上传多个分片并合并为完整文件', async () => {
      await cleanTestDir();

      // 准备测试数据：10 字节，分片大小 3 字节 → 4 个分片
      const content = '0123456789';
      const chunkSize = 3;
      const totalChunks = Math.ceil(content.length / chunkSize);

      const initResult = await chunkUploadService.init({
        fileName: 'multi-chunk.txt',
        fileSize: content.length,
        chunkSize,
        targetDir: TEST_DIR,
      });

      // 逐个上传分片
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, content.length);
        const chunkData = Buffer.from(content.slice(start, end));

        const result = await chunkUploadService.uploadChunk(
          initResult.uploadId,
          i,
          chunkData,
        );

        assert.strictEqual(result.chunkIndex, i);
        assert.strictEqual(result.uploaded, i + 1);
        assert.strictEqual(result.totalChunks, totalChunks);
      }

      // 合并
      const completeResult = await chunkUploadService.complete(initResult.uploadId);

      // 验证合并结果
      assert.ok(completeResult.path);
      assert.strictEqual(completeResult.fileName, 'multi-chunk.txt');
      assert.strictEqual(completeResult.size, content.length);

      // 验证文件内容
      const fileContent = await fs.readFile(completeResult.path, 'utf-8');
      assert.strictEqual(fileContent, content);
    });

    it('单分片文件应正确上传和合并', async () => {
      await cleanTestDir();

      const content = 'hello';
      const initResult = await chunkUploadService.init({
        fileName: 'single.txt',
        fileSize: content.length,
        chunkSize: 1024, // 大于文件，只有 1 个分片
        targetDir: TEST_DIR,
      });

      assert.strictEqual(initResult.totalChunks, 1);

      await chunkUploadService.uploadChunk(initResult.uploadId, 0, Buffer.from(content));
      const result = await chunkUploadService.complete(initResult.uploadId);

      const fileContent = await fs.readFile(result.path, 'utf-8');
      assert.strictEqual(fileContent, content);
    });
  });

  describe('幂等性 - 重复上传同一分片', () => {
    it('重复上传同一分片应跳过', async () => {
      await cleanTestDir();

      const initResult = await chunkUploadService.init({
        fileName: 'idempotent.txt',
        fileSize: 10,
        chunkSize: 5,
        targetDir: TEST_DIR,
      });

      // 上传分片 0
      await chunkUploadService.uploadChunk(initResult.uploadId, 0, Buffer.from('hello'));
      // 再次上传分片 0
      const result = await chunkUploadService.uploadChunk(initResult.uploadId, 0, Buffer.from('hello'));

      assert.strictEqual(result.uploaded, 1, '重复上传不应增加计数');
    });
  });

  describe('status - 查询上传状态', () => {
    it('应返回正确的上传进度', async () => {
      await cleanTestDir();

      const initResult = await chunkUploadService.init({
        fileName: 'status-test.txt',
        fileSize: 10,
        chunkSize: 3,
        targetDir: TEST_DIR,
      });

      // 上传 2 个分片
      await chunkUploadService.uploadChunk(initResult.uploadId, 0, Buffer.from('012'));
      await chunkUploadService.uploadChunk(initResult.uploadId, 1, Buffer.from('345'));

      const status = await chunkUploadService.status(initResult.uploadId);

      assert.strictEqual(status.totalChunks, 4);
      assert.strictEqual(status.uploadedChunks.length, 2);
      assert.deepStrictEqual(status.uploadedChunks, [0, 1]);
      assert.strictEqual(status.status, 'uploading');
    });

    it('不存在的 uploadId 应报错', async () => {
      await assert.rejects(
        () => chunkUploadService.status('nonexistent-id'),
        /不存在/,
      );
    });
  });

  describe('abort - 取消上传', () => {
    it('应清理临时文件', async () => {
      await cleanTestDir();

      const initResult = await chunkUploadService.init({
        fileName: 'abort-test.txt',
        fileSize: 10,
        chunkSize: 5,
        targetDir: TEST_DIR,
      });

      await chunkUploadService.uploadChunk(initResult.uploadId, 0, Buffer.from('hello'));

      const result = await chunkUploadService.abort(initResult.uploadId);
      assert.strictEqual(result.aborted, true);

      // 会话应不存在
      await assert.rejects(
        () => chunkUploadService.status(initResult.uploadId),
        /不存在/,
      );
    });
  });

  describe('complete 校验', () => {
    it('分片未上传完整应拒绝合并', async () => {
      await cleanTestDir();

      const initResult = await chunkUploadService.init({
        fileName: 'incomplete.txt',
        fileSize: 10,
        chunkSize: 3,
        targetDir: TEST_DIR,
      });

      // 只上传 2/4 个分片
      await chunkUploadService.uploadChunk(initResult.uploadId, 0, Buffer.from('012'));
      await chunkUploadService.uploadChunk(initResult.uploadId, 1, Buffer.from('345'));

      await assert.rejects(
        () => chunkUploadService.complete(initResult.uploadId),
        /分片未上传完整/,
      );

      // 清理
      await chunkUploadService.abort(initResult.uploadId);
    });
  });

  describe('MD5 秒传', () => {
    it('相同 MD5 的文件应秒传', async () => {
      await cleanTestDir();

      // 第一次上传文件
      const content = 'instant-upload-test';
      const md5 = crypto.createHash('md5').update(content).digest('hex');

      const initResult1 = await chunkUploadService.init({
        fileName: 'first.txt',
        fileSize: content.length,
        chunkSize: 1024,
        md5,
        targetDir: TEST_DIR,
      });

      // 上传并合并
      await chunkUploadService.uploadChunk(initResult1.uploadId, 0, Buffer.from(content));
      const completeResult = await chunkUploadService.complete(initResult1.uploadId);

      // 验证 .md5 侧载文件已创建
      const md5Sidecar = await fs.readFile(completeResult.path + '.md5', 'utf-8');
      assert.strictEqual(md5Sidecar, md5);

      // 第二次上传同 MD5 文件 → 应秒传
      const initResult2 = await chunkUploadService.init({
        fileName: 'second.txt',
        fileSize: content.length,
        md5,
        targetDir: TEST_DIR,
      });

      assert.strictEqual(initResult2.instant, true, '应返回 instant: true');
      assert.ok(initResult2.path);
      assert.strictEqual(initResult2.fileName, 'first.txt'); // 返回的是已存在的文件
    });
  });

  describe('MD5 校验', () => {
    it('合并后 MD5 不匹配应报错', async () => {
      await cleanTestDir();

      const content = 'md5-verify-test';
      const wrongMD5 = '00000000000000000000000000000000'; // 故意错误的 MD5

      const initResult = await chunkUploadService.init({
        fileName: 'md5-fail.txt',
        fileSize: content.length,
        chunkSize: 1024,
        md5: wrongMD5,
        targetDir: TEST_DIR,
      });

      await chunkUploadService.uploadChunk(initResult.uploadId, 0, Buffer.from(content));

      await assert.rejects(
        () => chunkUploadService.complete(initResult.uploadId),
        /MD5 校验失败/,
      );

      // 清理
      await chunkUploadService.abort(initResult.uploadId);
    });
  });

  describe('二进制文件分片上传', () => {
    it('应正确上传和合并二进制数据', async () => {
      await cleanTestDir();

      // 创建 1KB 二进制数据
      const binaryData = Buffer.alloc(1024);
      for (let i = 0; i < 1024; i++) {
        binaryData[i] = i % 256;
      }

      const chunkSize = 256;
      const totalChunks = Math.ceil(binaryData.length / chunkSize);

      const initResult = await chunkUploadService.init({
        fileName: 'binary.bin',
        fileSize: binaryData.length,
        chunkSize,
        targetDir: TEST_DIR,
      });

      // 逐个上传
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, binaryData.length);
        await chunkUploadService.uploadChunk(initResult.uploadId, i, binaryData.slice(start, end));
      }

      const result = await chunkUploadService.complete(initResult.uploadId);

      // 验证二进制内容
      const fileContent = await fs.readFile(result.path);
      assert.strictEqual(fileContent.length, binaryData.length);
      for (let i = 0; i < binaryData.length; i++) {
        assert.strictEqual(fileContent[i], binaryData[i], `字节 ${i} 不匹配`);
      }
    });
  });
});
