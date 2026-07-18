/**
 * JWT (JSON Web Token) 工具库 — 零依赖实现
 *
 * 结构: base64url(header).base64url(payload).base64url(signature)
 *   header    = { alg: "HS256", typ: "JWT" }
 *   payload   = { sub, name, iat, exp, ... }
 *   signature = HMAC-SHA256(base64url(header) + "." + base64url(payload), secret)
 *
 * 安全特性:
 *   - 使用 crypto.timingSafeEqual 恒定时间比较签名
 *   - 支持 exp 过期校验
 *   - 内存黑名单（撤销令牌）
 *
 * 使用:
 *   const { sign, verify, refresh, revoke, isRevoked } = require('./lib/jwt');
 *   const token = sign({ sub: 'user1', name: 'alice' }, secret, { expiresIn: 3600 });
 *   const payload = verify(token, secret);  // 验证通过返回 payload，失败抛异常
 */

const crypto = require('crypto');

// =============================================
// base64url 编码/解码（URL 安全的 Base64）
// =============================================

function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function base64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

// =============================================
// 签名
// =============================================

/**
 * 创建 HMAC-SHA256 签名
 * @param {string} data - base64url(header).base64url(payload)
 * @param {string} secret - 密钥
 * @returns {string} base64url 编码的签名
 */
function createSignature(data, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  return base64urlEncode(hmac.digest());
}

// =============================================
// 黑名单（撤销令牌管理）
// =============================================

// Map<tokenId, expireAt> — 过期后自动可被清理
const blacklist = new Map();

/**
 * 撤销令牌（加入黑名单）
 * @param {string} token - 完整 JWT
 * @param {string} secret - 密钥（用于解析 exp）
 */
function revoke(token, secret) {
  try {
    const payload = verify(token, secret, { skipBlacklist: true });
    // 用 jti 或 sub 作为唯一标识，没有 jti 则用整个 token 的哈希
    const id = payload.jti || crypto.createHash('sha256').update(token).digest('hex');
    const expireAt = payload.exp ? payload.exp * 1000 : Date.now() + 24 * 3600 * 1000;
    blacklist.set(id, expireAt);
  } catch {
    // 无效令牌不需要加入黑名单
  }
}

/**
 * 检查令牌是否已被撤销
 * @param {object} payload - 解析后的 payload
 * @param {string} token - 原始 token（用于计算哈希 ID）
 * @returns {boolean}
 */
function isRevoked(payload, token) {
  const id = payload.jti || crypto.createHash('sha256').update(token).digest('hex');
  const expireAt = blacklist.get(id);
  if (!expireAt) return false;
  // 已过期则清理
  if (Date.now() > expireAt) {
    blacklist.delete(id);
    return false;
  }
  return true;
}

/**
 * 清理过期的黑名单条目（定期调用）
 */
function cleanupBlacklist() {
  const now = Date.now();
  for (const [id, expireAt] of blacklist) {
    if (now > expireAt) blacklist.delete(id);
  }
}

// 每 10 分钟清理一次过期黑名单
setInterval(cleanupBlacklist, 10 * 60 * 1000).unref();

// =============================================
// 签发令牌
// =============================================

/**
 * 签发 JWT
 * @param {object} payload - 载荷数据（如 { sub, name, role }）
 * @param {string} secret - 密钥
 * @param {object} [options]
 * @param {number} [options.expiresIn=3600] - 过期时间（秒），默认 1 小时
 * @param {string} [options.issuer] - 签发者 (iss)
 * @returns {string} JWT 字符串
 */
function sign(payload, secret, options = {}) {
  const { expiresIn = 3600, issuer } = options;
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = {
    ...payload,
    iat: now, // 签发时间
    exp: now + expiresIn, // 过期时间
    ...(issuer ? { iss: issuer } : {}),
  };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const signature = createSignature(data, secret);

  return `${data}.${signature}`;
}

// =============================================
// 验证令牌
// =============================================

class JWTError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'JWTError';
    this.code = code;
  }
}

/**
 * 验证并解码 JWT
 * @param {string} token - JWT 字符串
 * @param {string} secret - 密钥
 * @param {object} [options]
 * @param {boolean} [options.skipBlacklist=false] - 跳过黑名单检查（内部用）
 * @returns {object} payload 载荷
 * @throws {JWTError} 验证失败时抛出（code: 'INVALID_FORMAT' | 'INVALID_SIGNATURE' | 'EXPIRED' | 'REVOKED'）
 */
function verify(token, secret, options = {}) {
  const { skipBlacklist = false } = options;

  if (typeof token !== 'string') {
    throw new JWTError('令牌格式无效', 'INVALID_FORMAT');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JWTError('令牌格式无效：应有三段', 'INVALID_FORMAT');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  // 1. 验证签名（恒定时间比较）
  const expectedSignature = createSignature(data, secret);
  const actualSignature = signatureB64;

  if (expectedSignature.length !== actualSignature.length) {
    throw new JWTError('签名无效', 'INVALID_SIGNATURE');
  }
  if (!crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(actualSignature))) {
    throw new JWTError('签名无效', 'INVALID_SIGNATURE');
  }

  // 2. 解析 payload
  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
  } catch {
    throw new JWTError('载荷解析失败', 'INVALID_FORMAT');
  }

  // 3. 验证过期时间
  if (payload.exp) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp) {
      throw new JWTError('令牌已过期', 'EXPIRED');
    }
  }

  // 4. 黑名单检查
  if (!skipBlacklist && isRevoked(payload, token)) {
    throw new JWTError('令牌已被撤销', 'REVOKED');
  }

  return payload;
}

// =============================================
// 刷新令牌
// =============================================

/**
 * 刷新令牌（旧令牌需仍在有效期内或刚刚过期）
 * @param {string} token - 旧 JWT
 * @param {string} secret - 密钥
 * @param {object} [options]
 * @param {number} [options.expiresIn=3600] - 新令牌过期时间（秒）
 * @param {number} [options.gracePeriod=300] - 过期宽限期（秒），允许刚过期的令牌刷新
 * @returns {string} 新 JWT
 * @throws {JWTError}
 */
function refresh(token, secret, options = {}) {
  const { expiresIn = 3600, gracePeriod = 300 } = options;

  // 先验证签名（不检查过期）
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new JWTError('令牌格式无效', 'INVALID_FORMAT');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expectedSignature = createSignature(data, secret);

  if (expectedSignature.length !== signatureB64.length ||
      !crypto.timingSafeEqual(Buffer.from(expectedSignature), Buffer.from(signatureB64))) {
    throw new JWTError('签名无效', 'INVALID_SIGNATURE');
  }

  let payload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
  } catch {
    throw new JWTError('载荷解析失败', 'INVALID_FORMAT');
  }

  // 检查是否在宽限期内
  if (payload.exp) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= payload.exp + gracePeriod) {
      throw new JWTError('令牌已过期太久，无法刷新', 'EXPIRED');
    }
  }

  // 撤销旧令牌
  revoke(token, secret);

  // 签发新令牌（保留 sub/name 等，去掉 iat/exp）
  const { iat, exp, ...rest } = payload;
  return sign(rest, secret, { expiresIn });
}

module.exports = {
  sign,
  verify,
  refresh,
  revoke,
  isRevoked,
  JWTError,
  // 测试用
  _blacklist: blacklist,
  _cleanupBlacklist: cleanupBlacklist,
};
