/**
 * 分片上传控制器
 * 处理 /api/files/upload/* 的分片上传请求
 *
 * 端点:
 *   POST /api/files/upload/init       — 初始化分片上传
 *   POST /api/files/upload/chunk      — 上传单个分片（application/octet-stream）
 *   POST /api/files/upload/complete   — 合并所有分片
 *   GET  /api/files/upload/status     — 查询上传状态（断点续传）
 *   POST /api/files/upload/abort      — 取消上传
 */

const chunkUploadService = require('@file-manager/core/chunkUploadService');

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
// POST /api/files/upload/init
// 请求体 (JSON): { fileName, fileSize, totalChunks?, chunkSize?, md5?, targetDir? }
// 响应:
//   秒传: { instant: true, path, fileName, size }
//   正常: { uploadId, chunkSize, totalChunks, uploadedChunks: [] }
// =============================================

async function init(req, res) {
  try {
    const { fileName, fileSize, totalChunks, chunkSize, md5, targetDir } = req.body || {};
    const result = await chunkUploadService.init({
      fileName,
      fileSize,
      totalChunks,
      chunkSize,
      md5,
      targetDir,
    });
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// POST /api/files/upload/chunk?uploadId=xxx&chunkIndex=0
// 请求体: 原始二进制（application/octet-stream）
// 响应: { chunkIndex, uploaded, totalChunks, uploadedChunks }
// =============================================

async function chunk(req, res) {
  try {
    const uploadId = req.query.uploadId;
    const chunkIndex = parseInt(req.query.chunkIndex, 10);

    if (!uploadId) {
      return sendError(res, 400, '请提供 uploadId 参数');
    }
    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return sendError(res, 400, '请提供有效的 chunkIndex 参数');
    }

    // 分片数据在 rawBody 中（application/octet-stream）
    const data = req.rawBody;
    if (!data || data.length === 0) {
      return sendError(res, 400, '分片数据为空');
    }

    const result = await chunkUploadService.uploadChunk(uploadId, chunkIndex, data);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// POST /api/files/upload/complete
// 请求体 (JSON): { uploadId }
// 响应: { path, fileName, size, md5? }
// =============================================

async function complete(req, res) {
  try {
    const { uploadId } = req.body || {};
    if (!uploadId) {
      return sendError(res, 400, '请提供 uploadId');
    }

    const result = await chunkUploadService.complete(uploadId);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// GET /api/files/upload/status?uploadId=xxx
// 响应: { uploadId, fileName, fileSize, chunkSize, totalChunks, uploadedChunks, status }
// =============================================

async function status(req, res) {
  try {
    const uploadId = req.query.uploadId;
    if (!uploadId) {
      return sendError(res, 400, '请提供 uploadId 参数');
    }

    const result = await chunkUploadService.status(uploadId);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

// =============================================
// POST /api/files/upload/abort
// 请求体 (JSON): { uploadId }
// 响应: { uploadId, aborted: true }
// =============================================

async function abort(req, res) {
  try {
    const { uploadId } = req.body || {};
    if (!uploadId) {
      return sendError(res, 400, '请提供 uploadId');
    }

    const result = await chunkUploadService.abort(uploadId);
    sendSuccess(res, result);
  } catch (err) {
    sendError(res, 400, err.message);
  }
}

module.exports = { init, chunk, complete, status, abort };
