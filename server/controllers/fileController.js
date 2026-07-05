/**
 * 文件操作控制器
 * 处理所有 /api/files/* 的请求
 */
const FileService = require('../../core/fileService');
const path = require('path');
const fs = require('fs').promises;
const { parseMultipart, extractBoundary } = require('../../lib/multipartParser');

const fileService = new FileService();

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
// 上传文件，用于 POST /api/files/upload
// =============================================
async function upload(req, res) {
  try {
    const contentType = req.headers['content-type'] || '';

    if (!contentType.includes('multipart/form-data')) {
      return sendError(res, 400, '请使用 multipart/form-data 格式上传');
    }

    const boundary = extractBoundary(contentType);
    if (!boundary) {
      return sendError(res, 400, '无法解析 boundary');
    }

    const parts = parseMultipart(req.rawBody, boundary);

    // 查找文件部分和可选的目标路径
    let filePart = null;
    let targetDir = '.';

    for (const part of parts) {
      if (part.filename) {
        filePart = part;
      } else if (part.name === 'path' && part.data.length > 0) {
        targetDir = part.data.toString('utf-8').trim() || '.';
      }
    }

    if (!filePart) {
      return sendError(res, 400, '未找到上传的文件');
    }

    // 保存文件
    const safeTargetDir = require('../../core/pathValidator').resolveSafePath(targetDir);
    const fileName = filePart.filename;
    const filePath = path.join(safeTargetDir, fileName);

    // 确保目标目录存在
    await fs.mkdir(safeTargetDir, { recursive: true });
    await fs.writeFile(filePath, filePart.data);

    sendSuccess(res, {
      path: filePath,
      fileName,
      size: filePart.data.length,
    });
  } catch (err) {
    sendError(res, 400, `上传失败: ${err.message}`);
  }
}

// =============================================
// 下载文件，用于 GET /api/files/download
// =============================================
async function download(req, res) {
  try {
    const filePath = req.query.path;
    if (!filePath) {
      return sendError(res, 400, '请提供 path 参数');
    }

    const safePath = require('../../core/pathValidator').resolveSafePath(filePath);
    const stat = await fs.stat(safePath);

    if (!stat.isFile()) {
      return sendError(res, 400, '指定路径不是文件');
    }

    const fileName = path.basename(safePath);

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"`,
      'Content-Length': stat.size,
    });

    // 使用 Stream 发送文件
    const readStream = require('fs').createReadStream(safePath);
    readStream.pipe(res);
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

    const pathValidator = require('../../core/pathValidator');
    const safeSrc = pathValidator.ensureExists(pathValidator.resolveSafePath(src));
    const safeDst = pathValidator.resolveSafePath(dst);

    // 确保目标父目录存在
    const parentDir = path.dirname(safeDst);
    if (!require('fs').existsSync(parentDir)) {
      await fs.mkdir(parentDir, { recursive: true });
    }

    await fs.rename(safeSrc, safeDst);
    sendSuccess(res, { src: safeSrc, dst: safeDst });
  } catch (err) {
    sendError(res, 400, `移动失败: ${err.message}`);
  }
}

module.exports = { list, info, mkdir, upload, download, remove, move };
