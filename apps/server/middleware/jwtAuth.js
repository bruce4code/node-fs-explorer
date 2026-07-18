/**
 * JWT 鉴权中间件
 *
 * 工作方式：
 *   - 优先使用 JWT 鉴权（需配置 JWT_SECRET 环境变量）
 *   - 若未配置 JWT_SECRET，回退到旧版 API Token 鉴权（兼容 Phase 4）
 *   - 两者都未配置，则鉴权关闭（开发环境）
 *
 * Token 提取顺序：
 *   1. Authorization: Bearer <token>
 *   2. X-API-Token: <token>      （兼容旧版）
 *   3. ?token=<token>             （查询参数）
 *
 * 公开路径（无需鉴权）：
 *   /api/auth/login
 *   /api/auth/refresh
 *   /api/auth/verify
 *
 * 验证通过后：req.user = payload（包含 sub, name, role 等）
 */

const jwt = require('@file-manager/node-utils/jwt');
const oldAuth = require('./auth');

// JWT 密钥（启动时读取）
const JWT_SECRET = process.env.JWT_SECRET || null;

// 不需要鉴权的路径前缀
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/refresh',
  '/api/auth/verify',
];

/**
 * 从请求中提取 Bearer Token
 */
function extractToken(req) {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // 2. X-API-Token（兼容旧版）
  if (req.headers['x-api-token']) {
    return req.headers['x-api-token'];
  }

  // 3. ?token= 查询参数
  if (req.url && req.url.indexOf('token=') !== -1) {
    try {
      const u = new URL(req.url, 'http://localhost');
      return u.searchParams.get('token');
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * JWT 鉴权中间件
 * @param {object} req
 * @param {object} res
 * @returns {boolean} true = 已拦截，false = 放行
 */
function jwtAuth(req, res) {
  // 未配置 JWT_SECRET → 回退到旧版 API Token 鉴权
  if (!JWT_SECRET) {
    return oldAuth(req, res);
  }

  // 白名单路径放行
  for (const p of PUBLIC_PATHS) {
    if (req.url && req.url.startsWith(p)) {
      return false;
    }
  }

  const token = extractToken(req);

  if (!token) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: '未授权：缺少 Token' }));
    return true;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // 验证通过，挂载用户信息到 req
    req.user = payload;
    return false;
  } catch (err) {
    let message = '未授权';
    if (err.code === 'EXPIRED') message = 'Token 已过期，请重新登录';
    else if (err.code === 'INVALID_SIGNATURE') message = 'Token 签名无效';
    else if (err.code === 'REVOKED') message = 'Token 已被撤销';
    else if (err.code === 'INVALID_FORMAT') message = 'Token 格式无效';

    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: message }));
    return true;
  }
}

// 导出 JWT_SECRET 供控制器使用
jwtAuth.JWT_SECRET = JWT_SECRET;

module.exports = jwtAuth;
