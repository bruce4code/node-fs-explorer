/**
 * 文件操作控制器
 * 处理所有 /api/files/* 的请求
 */
const FileService = require('@file-manager/core/fileService');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const { pipeline } = require('stream');
const { extractBoundary } = require('@file-manager/node-utils/multipartParser');
const { createMultipartStream } = require('@file-manager/node-utils/multipartStreamParser');

const fileService = new FileService();

// 单文件上传大小上限（200MB），超过则中止
const MAX_UPLOAD_SIZE = 200 * 1024 * 1024;

// =============================================
// 响应辅助函数
// =============================================

function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendError(res, status, message) {
  sendJSON(res, status, { success: false, error: message });
}

function sendSuccess(res, data) {
  sendJSON(res, 200, { success: true, data });
}

// 最大下载限制（500MB）
const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024;

// =============================================
// 获取文件名列表（含大小），用于 GET /api/files
// =============================================
async function list(req, res) {
  try {
    const dirPath = req.query.path || '.';
    const entries = await fileService.list(dirPath);
    sendSuccess(res, entries);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// 获取文件/目录详情，用于 GET /api/files/info
// =============================================
async function info(req, res) {
  try {
    const targetPath = req.query.path;
    if (!targetPath) {
      return sendError(res, 400, '请提供 path 参数');
    }
    const result = await fileService.info(targetPath);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// 创建目录，用于 POST /api/files/mkdir
// =============================================
async function mkdir(req, res) {
  try {
    const dirPath = req.body.path;
    if (!dirPath) {
      return sendError(res, 400, '请提供 path 参数');
    }
    const result = await fileService.mkdir(dirPath);
    sendSuccess(res, { path: result });
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// 上传文件（流式），用于 POST /api/files/upload
// 边接收边写盘，不缓冲整个文件到内存，支持大文件
//
// 实现说明：
//   multipart 字段顺序不保证（path 可能在 file 之前或之后），
//   因此 file 先流式写入系统临时目录，所有 part 解析完后，
//   再用 path 字段把文件移动到最终位置。
//   这样既保持流式（不缓冲整个文件），又与字段顺序无关。
// =============================================
function upload(req, res) {
  const contentType = req.headers['content-type'] || '';

  if (!contentType.includes('multipart/form-data')) {
    return sendError(res, 400, '请使用 multipart/form-data 格式上传');
  }

  const boundary = extractBoundary(contentType);
  if (!boundary) {
    return sendError(res, 400, '无法解析 boundary');
  }

  const fields = {};
  // 临时文件信息：先写到 os.tmpdir()，解析完成后再移动到最终位置
  let tmpFile = null; // { tmpPath, fileName, size, writeDone }

  const parser = createMultipartStream(boundary, {
    onField(name, value) {
      fields[name] = value;
    },
    onFileStart(name, filename) {
      const safeFileName = path.basename(filename) || 'unnamed';
      // 临时文件路径：系统临时目录 + 随机后缀防冲突
      const tmpPath = path.join(os.tmpdir(), `fms-upload-${Date.now()}-${Math.random().toString(36).slice(2)}-${safeFileName}`);

      const writeStream = fsSync.createWriteStream(tmpPath, { flags: 'w' });
      // 大小限制 Transform：超过上限则中止
      const sizeLimiter = new (require('stream').Transform)({
        transform(chunk, encoding, cb) {
          this.bytesWritten = (this.bytesWritten || 0) + chunk.length;
          if (this.bytesWritten > MAX_UPLOAD_SIZE) {
            this.destroy(new Error(`文件过大，单文件上限 ${MAX_UPLOAD_SIZE} 字节`));
            fsSync.unlink(tmpPath, () => {});
            return;
          }
          cb(null, chunk);
        },
      });
      sizeLimiter.pipe(writeStream);

      tmpFile = { tmpPath, fileName: safeFileName, size: 0, writeDone: null };
      sizeLimiter.on('data', (chunk) => { tmpFile.size += chunk.length; });
      tmpFile.writeDone = new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve());
        writeStream.on('error', reject);
      });

      return sizeLimiter;
    },
  });

  pipeline(req, parser, async (err) => {
    if (err) {
      // 清理临时文件
      if (tmpFile) fsSync.unlink(tmpFile.tmpPath, () => {});
      if (!res.headersSent) {
        sendError(res, 400, `上传失败: ${err.message}`);
      }
      return;
    }

    if (!tmpFile) {
      return sendError(res, 400, '未找到上传的文件');
    }

    try {
      // 等待临时文件落盘完成
      await tmpFile.writeDone;

      // 用 path 字段把临时文件移动到最终位置（路径校验、目录创建、日志交给 fileService）
      const targetDir = (fields.path && fields.path.trim()) || '.';
      const result = await fileService.moveUpload(tmpFile.tmpPath, targetDir, tmpFile.fileName, tmpFile.size);
      sendSuccess(res, result);
    } catch (moveErr) {
      // 清理临时文件
      if (fsSync.existsSync(tmpFile.tmpPath)) {
        fsSync.unlink(tmpFile.tmpPath, () => {});
      }
      if (!res.headersSent) {
        sendError(res, 400, `上传失败: ${moveErr.message}`);
      }
    }
  });
}

// =============================================
// 下载文件（生产级安全实现），用于 GET /api/files/download
// =============================================
async function download(req, res) {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return sendError(res, 400, '请提供 path 参数');
    }

    const pathValidator = require('@file-manager/core/pathValidator');
    const safePath = pathValidator.resolveSafePath(filePath);
    const stat = await fs.stat(safePath);

    if (!stat.isFile()) {
      return sendError(res, 400, '指定路径不是文件');
    }

    // 文件大小限制
    if (stat.size > MAX_DOWNLOAD_SIZE) {
      return sendError(res, 413, `文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，最大支持 500MB`);
    }

    const fileName = path.basename(safePath);

    // 设置响应头
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    });

    // 使用 pipeline 替代 pipe（更好的错误处理和资源清理）
    const readStream = require('fs').createReadStream(safePath, {
      highWaterMark: 64 * 1024, // 64KB 块
    });

    pipeline(readStream, res, (err) => {
      if (err) {
        // ERR_STREAM_PREMATURE_CLOSE 是客户端断连，属于正常情况
        if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
          console.error(`下载文件出错: ${err.message}`);
        }
      }
    });

    // 客户端断连时及时清理
    req.on('close', () => {
      if (!readStream.destroyed) {
        readStream.destroy();
      }
    });
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// 删除文件/目录，用于 DELETE /api/files
// =============================================
async function remove(req, res) {
  try {
    const targetPath = req.query.path || req.body.path;
    if (!targetPath) {
      return sendError(res, 400, '请提供 path 参数');
    }

    const result = await fileService.remove(targetPath);
    sendSuccess(res, { path: result });
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// 移动/重命名，用于 PUT /api/files/move
// =============================================
async function move(req, res) {
  try {
    const src = req.body.src || req.query.src;
    const dst = req.body.dst || req.query.dst;

    if (!src || !dst) {
      return sendError(res, 400, '请提供 src 和 dst 参数');
    }

    // 路径校验、目录创建、日志记录统一交给 fileService
    const result = await fileService.move(src, dst);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, `移动失败: ${err.message}`);
  }
}

// =============================================
// 搜索文件，用于 GET /api/files/search?path=&pattern=
// =============================================
async function search(req, res) {
  try {
    const dirPath = req.query.path || '.';
    const pattern = req.query.pattern;
    if (!pattern) {
      return sendError(res, 400, '请提供 pattern 参数（支持正则）');
    }

    const maxDepth = parseInt(req.query.maxDepth, 10) || 10;
    const maxResults = parseInt(req.query.maxResults, 10) || 100;

    const results = await fileService.search(dirPath, pattern, { maxDepth, maxResults });
    sendSuccess(res, results);
  } catch (err) {
    sendError(res, 400, `搜索失败: ${err.message}`);
  }
}

// =============================================
// 预览文件，用于 GET /api/files/preview?path=&lines=
// =============================================
async function preview(req, res) {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return sendError(res, 400, '请提供 path 参数');
    }

    const maxLines = parseInt(req.query.lines, 10) || 20;
    const result = await fileService.preview(filePath, maxLines);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, `预览失败: ${err.message}`);
  }
}

// =============================================
// 文件哈希，用于 GET /api/files/hash?path=&algorithm=
// =============================================
async function hash(req, res) {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return sendError(res, 400, '请提供 path 参数');
    }

    const algorithm = req.query.algorithm || 'md5';
    const result = await fileService.hash(filePath, algorithm);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, `计算哈希失败: ${err.message}`);
  }
}

// =============================================
// 操作日志历史，用于 GET /api/files/logs
// =============================================
async function logs(req, res) {
  try {
    const max = parseInt(req.query.max, 10) || 50;
    const operationLogger = require('@file-manager/core/operationLogger');
    const history = operationLogger.history(max);
    sendSuccess(res, history);
  } catch (err) {
    sendError(res, 400, `获取日志失败: ${err.message}`);
  }
}

module.exports = { list, info, mkdir, upload, download, remove, move, search, preview, hash, logs };
