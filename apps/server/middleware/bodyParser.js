/**
 * 请求体解析中间件
 * - 读取原始请求体到 req.rawBody（Buffer）
 * - 根据 Content-Type 解析到 req.body
 *
 * 支持的 Content-Type:
 *   - application/json
 *   - application/x-www-form-urlencoded
 *   - multipart/form-data：不解析、不读取，留给 upload 控制器流式处理
 *     （这样大文件上传不会全量进内存）
 */

// 请求体大小上限（50MB），防止恶意大请求体导致 OOM
const MAX_BODY_SIZE = 50 * 1024 * 1024;

/**
 * 判断是否为 multipart 请求（需流式处理，跳过缓冲）
 */
function isMultipart(req) {
  return (req.headers['content-type'] || '').includes('multipart/form-data');
}

/**
 * 解析请求体
 * @param {object} req - http.IncomingMessage
 * @returns {Promise<void>}
 */
function bodyParser(req) {
  // multipart 交给控制器流式处理，这里只初始化空 body
  if (isMultipart(req)) {
    req.rawBody = Buffer.alloc(0);
    req.body = {};
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;

      // 超过大小上限：中止读取并拒绝，防止内存溢出
      if (size > MAX_BODY_SIZE) {
        done = true;
        reject(new Error(`请求体过大，最大支持 ${MAX_BODY_SIZE / 1024 / 1024}MB`));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on('end', () => {
      if (done) return;
      done = true;

      // 原始请求体（Buffer）
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
        req.body = {};
      }

      resolve();
    });

    req.on('error', (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

module.exports = bodyParser;
