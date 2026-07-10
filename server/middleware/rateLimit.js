/**
 * 限流中间件 — 基于 IP 的滑动窗口计数限流
 *
 * 原理：
 *   - 每个 IP 维护一个时间窗口（默认 60 秒）内的请求计数
 *   - 超过上限（默认 100 次/分钟）则返回 429 Too Many Requests
 *   - 用 Map 存储 { ip: [{ timestamp }] }，定期清理过期记录防内存泄漏
 *
 * 配置（环境变量）：
 *   RATE_LIMIT_WINDOW  窗口大小（秒），默认 60
 *   RATE_LIMIT_MAX     窗口内最大请求数，默认 100
 *
 * 响应头（透传限流信息给客户端）：
 *   X-RateLimit-Limit     窗口内最大请求数
 *   X-RateLimit-Remaining 剩余请求数
 *   X-RateLimit-Reset     窗口重置时间（Unix 秒）
 *   Retry-After           被限流时，建议重试等待秒数
 */

const WINDOW_MS = (parseInt(process.env.RATE_LIMIT_WINDOW, 10) || 60) * 1000;
const MAX_REQUESTS = parseInt(process.env.RATE_LIMIT_MAX, 10) || 100;

// IP -> 请求时间戳数组
const store = new Map();

// 清理间隔：每 5 分钟清理一次过期 IP 记录，防止内存无限增长
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupTimer = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [ip, timestamps] of store) {
      // 移除窗口外的旧记录
      const valid = timestamps.filter((t) => now - t < WINDOW_MS);
      if (valid.length === 0) {
        store.delete(ip);
      } else {
        store.set(ip, valid);
      }
    }
  }, CLEANUP_INTERVAL);
  // 不阻止进程退出
  if (cleanupTimer.unref) cleanupTimer.unref();
}

/**
 * 提取客户端 IP（处理代理转发场景）
 */
function getClientIP(req) {
  // 信任 X-Forwarded-For 的第一个 IP（反向代理场景）
  const xff = req.headers['x-forwarded-for'];
  if (xff) {
    return xff.split(',')[0].trim();
  }
  // 直连场景
  return req.socket.remoteAddress || 'unknown';
}

/**
 * 限流中间件
 * @param {object} req
 * @param {object} res
 * @returns {boolean} true 表示已被限流（已响应 429），false 表示放行
 */
function rateLimit(req, res) {
  ensureCleanupTimer();

  const ip = getClientIP(req);
  const now = Date.now();

  // 取出该 IP 的历史记录，过滤掉窗口外的
  let timestamps = store.get(ip) || [];
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS);

  // 设置限流信息响应头
  const remaining = Math.max(0, MAX_REQUESTS - timestamps.length - 1);
  const resetAt = Math.floor((now + WINDOW_MS) / 1000);
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', remaining);
  res.setHeader('X-RateLimit-Reset', resetAt);

  // 超过上限：拒绝
  if (timestamps.length >= MAX_REQUESTS) {
    // 计算最早一条记录何时过期，作为 Retry-After
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((WINDOW_MS - (now - oldest)) / 1000);
    res.setHeader('Retry-After', Math.max(1, retryAfter));

    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      success: false,
      error: `请求过于频繁，每 ${WINDOW_MS / 1000} 秒最多 ${MAX_REQUESTS} 次`,
    }));
    return true;
  }

  // 放行：记录本次请求时间
  timestamps.push(now);
  store.set(ip, timestamps);
  return false;
}

/**
 * 重置限流状态（测试用）
 */
function _reset() {
  store.clear();
}

module.exports = rateLimit;
module.exports._reset = _reset;
module.exports._getStore = () => store;
