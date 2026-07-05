/**
 * 请求体解析中间件
 * - 读取原始请求体到 req.rawBody（Buffer）
 * - 根据 Content-Type 解析到 req.body
 *
 * 支持的 Content-Type:
 *   - application/json
 *   - application/x-www-form-urlencoded
 *   - multipart/form-data（只读取 rawBody，不解析，留给 upload 自行处理）
 */

/**
 * 解析请求体
 * @param {object} req - http.IncomingMessage
 * @returns {Promise<void>}
 */
function bodyParser(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(chunk);
    });

    req.on('end', () => {
      // 原始请求体（Buffer），上传文件时需要用到
      req.rawBody = Buffer.concat(chunks);

      const contentType = req.headers['content-type'] || '';

      // 根据 Content-Type 解析 body
      if (contentType.includes('application/json')) {
        try {
          req.body = JSON.parse(req.rawBody.toString('utf-8'));
        } catch {
          req.body = {};
        }
      } else if (contentType.includes('application/x-www-form-urlencoded')) {
        const params = new URLSearchParams(req.rawBody.toString('utf-8'));
        req.body = Object.fromEntries(params);
      } else {
        // multipart/form-data 或其他类型不解析，留给具体控制器
        req.body = {};
      }

      resolve();
    });

    req.on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = bodyParser;
