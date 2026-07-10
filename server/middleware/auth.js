/**
 * 鉴权中间件 — API Token 校验
 *
 * 工作方式：
 *   - 通过环境变量 API_TOKEN 配置合法 token
 *   - 若未配置 API_TOKEN，则鉴权关闭（开发环境友好）
 *   - 客户端通过 X-API-Token 请求头 或 ?token= 查询参数 传递
 *   - 校验失败返回 401
 *
 * 使用：
 *   API_TOKEN=secret node server/index.js   // 启用鉴权
 *   node server/index.js                    // 关闭鉴权（开发）
 *
 * 客户端调用：
 *   curl -H "X-API-Token: secret" http://localhost:3300/api/files
 *   curl http://localhost:3300/api/files?token=secret
 */

// 合法 token（启动时读取，未配置则为 null，表示鉴权关闭）
const API_TOKEN = process.env.API_TOKEN || null;

// 不需要鉴权的路径前缀（白名单），如健康检查
const PUBLIC_PATHS = [];

const { timingSafeEqual } = require('crypto');

/**
 * 鉴权中间件
 * @param {object} req
 * @param {object} res
 * @returns {boolean} true 表示已处理（拦截/通过），false 表示继续
 *         当返回 true 时调用方不应再继续后续处理
 */
function auth(req, res) {
  // 未配置 token，鉴权关闭
  if (!API_TOKEN) {
    return false;
  }

  // 白名单路径放行
  for (const p of PUBLIC_PATHS) {
    if (req.url && req.url.startsWith(p)) {
      return false;
    }
  }

  // 从 header 或 query 提取 token
  const token = req.headers['x-api-token'] || extractTokenFromQuery(req.url);

  // 使用恒定时间比较，防止计时攻击
  if (!token || !safeEqual(token, API_TOKEN)) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: false, error: '未授权：API Token 无效或缺失' }));
    return true;
  }

  return false;
}

/**
 * 从 URL query 提取 token 参数
 */
function extractTokenFromQuery(url) {
  if (!url || url.indexOf('token=') === -1) return null;
  try {
    const u = new URL(url, 'http://localhost');
    return u.searchParams.get('token');
  } catch {
    return null;
  }
}

/**
 * 恒定时间字符串比较，防止计时攻击
 * （比较时长固定，不因匹配前缀长度而提前返回）
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  // timingSafeEqual 要求两个 Buffer 长度相同
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = auth;
