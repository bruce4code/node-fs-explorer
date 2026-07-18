/**
 * 分片上传服务
 *
 * 支持大文件分片上传、断点续传、MD5 秒传
 *
 * 流程：
 *   1. 客户端调用 init → 服务端返回 uploadId + 已上传分片列表（断点续传）
 *      若提供 md5 且服务端已有同 md5 文件 → 直接返回（秒传）
 *   2. 客户端逐个上传 chunk → 服务端保存到临时目录
 *   3. 客户端调用 complete → 服务端按顺序合并分片，校验 md5，清理临时文件
 *
 * 存储结构：
 *   {tmpdir}/fms-chunks/{uploadId}/
 *     ├── .meta.json          — 上传元数据（崩溃恢复用）
 *     ├── chunk-0
 *     ├── chunk-1
 *     └── ...
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { pipeline } = require('stream');
const pathValidator = require('./pathValidator');
const { resolveSafePath } = pathValidator;
const operationLogger = require('./operationLogger');

// =============================================
// 配置
// =============================================

const CHUNK_DIR = path.join(os.tmpdir(), 'fms-chunks');
const DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_FILE_SIZE = 1024 * 1024 * 1024;   // 1GB
const MAX_UPLOAD_AGE = 24 * 60 * 60 * 1000;  // 24 小时后自动清理

// 内存中的上传会话
const sessions = new Map();

// =============================================
// 初始化临时目录
// =============================================

fsSync.mkdirSync(CHUNK_DIR, { recursive: true });

// =============================================
// 辅助函数
// =============================================

function generateUploadId() {
  return crypto.randomUUID();
}

/**
 * 获取上传会话的临时目录
 */
function getSessionDir(uploadId) {
  return path.join(CHUNK_DIR, uploadId);
}

/**
 * 获取分片文件路径
 */
function getChunkPath(uploadId, chunkIndex) {
  return path.join(getSessionDir(uploadId), `chunk-${chunkIndex}`);
}

/**
 * 持久化元数据到磁盘（崩溃恢复用）
 */
async function saveMeta(uploadId) {
  const session = sessions.get(uploadId);
  if (!session) return;
  const metaPath = path.join(getSessionDir(uploadId), '.meta.json');
  await fs.writeFile(metaPath, JSON.stringify(session), 'utf-8');
}

/**
 * 从磁盘恢复元数据
 */
async function loadMeta(uploadId) {
  const metaPath = path.join(getSessionDir(uploadId), '.meta.json');
  try {
    const data = await fs.readFile(metaPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/**
 * 计算文件 MD5（流式）
 */
async function calculateMD5(filePath) {
  const hash = crypto.createHash('md5');
  const stream = fsSync.createReadStream(filePath, { highWaterMark: 64 * 1024 });
  for await (const chunk of stream) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

/**
 * 检查是否有同 MD5 的文件已存在（秒传）
 * 搜索上传目录中的文件
 */
async function findFileByMD5(targetDir, md5) {
  try {
    const safeDir = resolveSafePath(targetDir);
    const entries = await fs.readdir(safeDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const filePath = path.join(safeDir, entry.name);
        // 检查是否有 .md5 侧载文件
        const md5Sidecar = filePath + '.md5';
        try {
          const storedMD5 = await fs.readFile(md5Sidecar, 'utf-8');
          if (storedMD5.trim() === md5) {
            return { path: filePath, fileName: entry.name };
          }
        } catch {
          // 没有侧载文件，跳过
        }
      }
    }
  } catch {
    // 目录不存在或无权限
  }
  return null;
}

// =============================================
// 核心 API
// =============================================

class ChunkUploadService {
  /**
   * 初始化分片上传
   * @param {object} params
   * @param {string} params.fileName - 文件名
   * @param {number} params.fileSize - 文件总大小（字节）
   * @param {number} [params.totalChunks] - 分片总数（不传则自动计算）
   * @param {number} [params.chunkSize] - 分片大小（默认 2MB）
   * @param {string} [params.md5] - 文件 MD5（用于秒传）
   * @param {string} [params.targetDir='.'] - 目标目录
   * @returns {Promise<object>}
   *   - 秒传: { instant: true, path, fileName, size }
   *   - 正常: { uploadId, chunkSize, totalChunks, uploadedChunks: [] }
   *   - 续传: { uploadId, chunkSize, totalChunks, uploadedChunks: [0,2,3,...] }
   */
  async init(params) {
    const { fileName, fileSize, totalChunks, md5, targetDir = '.' } = params;
    const chunkSize = params.chunkSize || DEFAULT_CHUNK_SIZE;

    if (!fileName) throw new Error('请提供 fileName');
    if (!fileSize || fileSize <= 0) throw new Error('请提供有效的 fileSize');
    if (fileSize > MAX_FILE_SIZE) throw new Error(`文件过大，上限 ${MAX_FILE_SIZE / 1024 / 1024}MB`);

    const safeFileName = path.basename(fileName) || 'unnamed';
    const computedTotalChunks = totalChunks || Math.ceil(fileSize / chunkSize);

    // 1. 秒传检查：如果提供了 MD5，检查是否已有同 MD5 文件
    if (md5) {
      const existing = await findFileByMD5(targetDir, md5);
      if (existing) {
        operationLogger.log('upload', existing.path, {
          size: fileSize,
          fileName: existing.fileName,
          instant: true,
        });
        return {
          instant: true,
          path: existing.path,
          fileName: existing.fileName,
          size: fileSize,
        };
      }
    }

    // 2. 创建上传会话
    const uploadId = generateUploadId();
    const sessionDir = getSessionDir(uploadId);
    await fs.mkdir(sessionDir, { recursive: true });

    const session = {
      uploadId,
      fileName: safeFileName,
      fileSize,
      chunkSize,
      totalChunks: computedTotalChunks,
      md5: md5 || null,
      targetDir,
      uploadedChunks: [],
      createdAt: Date.now(),
      status: 'uploading', // uploading | completing | completed | aborted
    };

    sessions.set(uploadId, session);
    await saveMeta(uploadId);

    return {
      uploadId,
      chunkSize,
      totalChunks: computedTotalChunks,
      uploadedChunks: [],
    };
  }

  /**
   * 上传单个分片
   * @param {string} uploadId - 上传 ID
   * @param {number} chunkIndex - 分片序号（0-based）
   * @param {Buffer} data - 分片数据
   * @returns {Promise<{chunkIndex, uploaded, totalChunks, uploadedChunks}>}
   */
  async uploadChunk(uploadId, chunkIndex, data) {
    const session = sessions.get(uploadId);
    if (!session) throw new Error('上传会话不存在或已过期');
    if (session.status !== 'uploading') throw new Error(`上传会话状态: ${session.status}，无法上传分片`);
    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      throw new Error(`分片序号越界: ${chunkIndex}（有效范围 0-${session.totalChunks - 1}）`);
    }

    // 如果该分片已上传，跳过（幂等）
    if (session.uploadedChunks.includes(chunkIndex)) {
      return {
        chunkIndex,
        uploaded: session.uploadedChunks.length,
        totalChunks: session.totalChunks,
        uploadedChunks: [...session.uploadedChunks],
      };
    }

    // 写入分片文件
    const chunkPath = getChunkPath(uploadId, chunkIndex);
    await fs.writeFile(chunkPath, data);

    // 更新会话
    session.uploadedChunks.push(chunkIndex);
    session.uploadedChunks.sort((a, b) => a - b);
    await saveMeta(uploadId);

    return {
      chunkIndex,
      uploaded: session.uploadedChunks.length,
      totalChunks: session.totalChunks,
      uploadedChunks: [...session.uploadedChunks],
    };
  }

  /**
   * 查询上传状态（用于断点续传）
   * @param {string} uploadId
   * @returns {Promise<object>}
   */
  async status(uploadId) {
    let session = sessions.get(uploadId);

    // 内存中没有，尝试从磁盘恢复
    if (!session) {
      session = await loadMeta(uploadId);
      if (session) {
        // 验证磁盘上的分片实际存在
        const validChunks = [];
        for (const idx of session.uploadedChunks) {
          try {
            await fs.access(getChunkPath(uploadId, idx));
            validChunks.push(idx);
          } catch {
            // 分片不存在，跳过
          }
        }
        session.uploadedChunks = validChunks;
        sessions.set(uploadId, session);
      }
    }

    if (!session) throw new Error('上传会话不存在或已过期');

    return {
      uploadId: session.uploadId,
      fileName: session.fileName,
      fileSize: session.fileSize,
      chunkSize: session.chunkSize,
      totalChunks: session.totalChunks,
      uploadedChunks: [...session.uploadedChunks],
      status: session.status,
    };
  }

  /**
   * 合并所有分片为最终文件
   * @param {string} uploadId
   * @returns {Promise<{path, fileName, size, md5?}>}
   */
  async complete(uploadId) {
    const session = sessions.get(uploadId);
    if (!session) throw new Error('上传会话不存在或已过期');
    if (session.status !== 'uploading') throw new Error(`上传会话状态: ${session.status}`);

    // 检查所有分片都已上传
    if (session.uploadedChunks.length !== session.totalChunks) {
      const missing = [];
      for (let i = 0; i < session.totalChunks; i++) {
        if (!session.uploadedChunks.includes(i)) missing.push(i);
      }
      throw new Error(`分片未上传完整，缺少 ${missing.length} 个分片: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}`);
    }

    session.status = 'completing';
    await saveMeta(uploadId);

    try {
      // 准备最终文件路径
      const safeTargetDir = resolveSafePath(session.targetDir);
      const finalPath = path.join(safeTargetDir, session.fileName);
      fsSync.mkdirSync(safeTargetDir, { recursive: true });

      // 流式合并：按顺序读取每个分片，管道写入最终文件
      const writeStream = fsSync.createWriteStream(finalPath);
      const hash = session.md5 ? crypto.createHash('md5') : null;

      for (let i = 0; i < session.totalChunks; i++) {
        const chunkPath = getChunkPath(uploadId, i);
        await new Promise((resolve, reject) => {
          const readStream = fsSync.createReadStream(chunkPath);
          readStream.on('data', (chunk) => {
            if (hash) hash.update(chunk);
          });
          readStream.on('end', resolve);
          readStream.on('error', reject);
          writeStream.on('error', reject);
          // end: false — 不在 pipe 完成后关闭 writeStream（还有后续分片）
          readStream.pipe(writeStream, { end: false });
        });
      }

      // 关闭写入流
      await new Promise((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
        writeStream.end();
      });

      // MD5 校验
      let actualMD5 = null;
      if (hash) {
        actualMD5 = hash.digest('hex');
        if (session.md5 && actualMD5 !== session.md5) {
          // MD5 不匹配，删除文件
          await fs.unlink(finalPath).catch(() => {});
          throw new Error(`MD5 校验失败: 期望 ${session.md5}，实际 ${actualMD5}`);
        }
        // 保存 .md5 侧载文件（供秒传检查用）
        await fs.writeFile(finalPath + '.md5', actualMD5, 'utf-8');
      }

      // 获取文件大小
      const stat = await fs.stat(finalPath);

      // 清理分片临时目录
      await fs.rm(getSessionDir(uploadId), { recursive: true, force: true });

      // 更新会话状态
      session.status = 'completed';
      sessions.delete(uploadId);

      operationLogger.log('upload', finalPath, {
        size: stat.size,
        fileName: session.fileName,
        chunks: session.totalChunks,
        md5: actualMD5,
      });

      return {
        path: finalPath,
        fileName: session.fileName,
        size: stat.size,
        ...(actualMD5 ? { md5: actualMD5 } : {}),
      };
    } catch (err) {
      session.status = 'uploading'; // 回滚状态
      await saveMeta(uploadId);
      throw err;
    }
  }

  /**
   * 取消上传，清理临时文件
   * @param {string} uploadId
   */
  async abort(uploadId) {
    const session = sessions.get(uploadId);
    sessions.delete(uploadId);

    // 删除临时目录
    const sessionDir = getSessionDir(uploadId);
    await fs.rm(sessionDir, { recursive: true, force: true }).catch(() => {});

    return { uploadId, aborted: true };
  }

  /**
   * 清理过期的上传会话（定期调用）
   */
  async cleanupExpired() {
    const now = Date.now();
    for (const [uploadId, session] of sessions) {
      if (now - session.createdAt > MAX_UPLOAD_AGE) {
        await this.abort(uploadId);
      }
    }
  }
}

// =============================================
// 单例 + 定时清理
// =============================================

const service = new ChunkUploadService();

// 每小时清理一次过期会话
setInterval(() => {
  service.cleanupExpired().catch(() => {});
}, 60 * 60 * 1000).unref();

module.exports = service;
