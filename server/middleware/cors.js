/**
 * CORS 跨域中间件
 * 允许跨域请求，处理 OPTIONS 预检请求
 */

const ALLOWED_ORIGINS = '*';
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';
const ALLOWED_HEADERS = 'Content-Type, Authorization';

/**
 * 应用 CORS 头到响应
 * @param {object} req
 * @param {object} res
 * @returns {boolean} 如果是 OPTIONS 预检请求返回 true（已处理），否则 false
 */
function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS);
  res.setHeader('Access-Control-Allow-Methods', ALLOWED_METHODS);
  res.setHeader('Access-Control-Allow-Headers', ALLOWED_HEADERS);

  // OPTIONS 预检请求直接返回 204
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }

  return false;
}

module.exports = cors;
