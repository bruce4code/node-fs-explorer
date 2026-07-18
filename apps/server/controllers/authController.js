/**
 * 认证控制器
 * 处理 /api/auth/* 的请求
 *
 * 端点:
 *   POST /api/auth/login    — 登录，签发 JWT
 *   POST /api/auth/refresh  — 刷新令牌
 *   GET  /api/auth/verify   — 验证当前令牌
 *   POST /api/auth/logout   — 撤销令牌（登出）
 */

const jwt = require('@file-manager/node-utils/jwt');

// =============================================
// 用户存储（基于环境变量配置，零依赖）
// JWT_USERS 格式: JSON 字符串 {"alice": "password123", "bob": "secret"}
// =============================================

let users = {};
try {
  users = JSON.parse(process.env.JWT_USERS || '{}');
} catch {
  users = {};
}

// 如果没有配置用户，提供一个演示用户
if (Object.keys(users).length === 0) {
  users = { admin: 'admin123' };
}

// JWT 密钥
const JWT_SECRET = process.env.JWT_SECRET || null;
const TOKEN_EXPIRES_IN = parseInt(process.env.JWT_EXPIRES_IN, 10) || 3600; // 默认 1 小时

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
// POST /api/auth/login — 登录
// 请求体: { username, password }
// 返回: { token, expiresIn, user }
// =============================================

async function login(req, res) {
  if (!JWT_SECRET) {
    return sendError(res, 500, 'JWT 未配置（请设置 JWT_SECRET 环境变量）');
  }

  const { username, password } = req.body || {};

  if (!username || !password) {
    return sendError(res, 400, '请提供 username 和 password');
  }

  // 验证用户名密码
  if (users[username] !== password) {
    return sendError(res, 401, '用户名或密码错误');
  }

  // 签发 JWT
  const payload = {
    sub: username,
    name: username,
    role: username === 'admin' ? 'admin' : 'user',
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });

  sendSuccess(res, {
    token,
    expiresIn: TOKEN_EXPIRES_IN,
    tokenType: 'Bearer',
    user: { username, role: payload.role },
  });
}

// =============================================
// POST /api/auth/refresh — 刷新令牌
// 请求体: { token }  或 Header: Authorization: Bearer <token>
// 返回: { token, expiresIn }
// =============================================

async function refresh(req, res) {
  if (!JWT_SECRET) {
    return sendError(res, 500, 'JWT 未配置');
  }

  // 从 body 或 header 提取 token
  let token = (req.body && req.body.token) || null;
  if (!token) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return sendError(res, 400, '请提供 token');
  }

  try {
    const newToken = jwt.refresh(token, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
    sendSuccess(res, {
      token: newToken,
      expiresIn: TOKEN_EXPIRES_IN,
      tokenType: 'Bearer',
    });
  } catch (err) {
    const status = err.code === 'EXPIRED' ? 401 : 400;
    sendError(res, status, err.message);
  }
}

// =============================================
// GET /api/auth/verify — 验证当前令牌
// 返回: { valid: true, user: payload }
// =============================================

async function verify(req, res) {
  if (!JWT_SECRET) {
    return sendError(res, 500, 'JWT 未配置');
  }

  let token = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.headers['x-api-token']) {
    token = req.headers['x-api-token'];
  } else if (req.url && req.url.indexOf('token=') !== -1) {
    try {
      const u = new URL(req.url, 'http://localhost');
      token = u.searchParams.get('token');
    } catch { /* ignore */ }
  }

  if (!token) {
    return sendError(res, 401, '缺少 Token');
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    sendSuccess(res, {
      valid: true,
      user: { username: payload.sub, name: payload.name, role: payload.role },
      exp: payload.exp,
    });
  } catch (err) {
    const status = err.code === 'EXPIRED' ? 401 : 403;
    sendError(res, status, err.message);
  }
}

// =============================================
// POST /api/auth/logout — 登出（撤销令牌）
// 请求体: { token } 或 Header: Bearer
// =============================================

async function logout(req, res) {
  if (!JWT_SECRET) {
    return sendError(res, 500, 'JWT 未配置');
  }

  let token = (req.body && req.body.token) || null;
  if (!token) {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return sendError(res, 400, '请提供 token');
  }

  jwt.revoke(token, JWT_SECRET);
  sendSuccess(res, { message: '已登出' });
}

module.exports = { login, refresh, verify, logout };
