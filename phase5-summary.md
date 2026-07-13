# Phase 5 学习总结：生产级进阶 — JWT 鉴权、Cluster 多进程、分片上传

## 目录
1. [学到的 Node.js 知识点](#一学到的-nodejs-知识点)
2. [我能做什么](#二我能做什么)
3. [能应付的面试题](#三能应付的面试题)
4. [扩展方向](#四扩展方向)

---

## 一、学到的 Node.js 知识点

### 1.1 零依赖实现 JWT — HMAC-SHA256 签名与验证

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `crypto.createHmac('sha256')` | 对称签名算法 | `lib/jwt.js:45` |
| base64url 编码 | URL 安全的 Base64（`-`/`_` 替代 `+`/`/`） | `lib/jwt.js:26` |
| `crypto.timingSafeEqual` | 恒定时间比较签名，防计时攻击 | `lib/jwt.js:181` |
| `iat` / `exp` 声明 | 签发时间 / 过期时间（Unix 秒） | `lib/jwt.js:125-126` |
| 自定义 Error + code | `JWTError` 携带错误码便于分支处理 | `lib/jwt.js:142-148` |

**JWT 三段结构：**

```
base64url(header).base64url(payload).base64url(signature)

header    = { "alg": "HS256", "typ": "JWT" }
payload   = { "sub": "admin", "role": "admin", "iat": 1690000000, "exp": 1690003600 }
signature = HMAC-SHA256(base64url(header) + "." + base64url(payload), secret)
```

**签发与验证核心：**

```js
// 签发
function sign(payload, secret, options = {}) {
  const { expiresIn = 3600 } = options;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const fullPayload = { ...payload, iat: now, exp: now + expiresIn };

  const headerB64 = base64urlEncode(JSON.stringify(header));
  const payloadB64 = base64urlEncode(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;
  const signature = createSignature(data, secret);  // HMAC-SHA256

  return `${data}.${signature}`;
}

// 验证
function verify(token, secret) {
  const [headerB64, payloadB64, signatureB64] = token.split('.');

  // 1. 恒定时间比较签名（防计时攻击）
  const expectedSig = createSignature(`${headerB64}.${payloadB64}`, secret);
  if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(signatureB64))) {
    throw new JWTError('签名无效', 'INVALID_SIGNATURE');
  }

  // 2. 解析 payload
  const payload = JSON.parse(base64urlDecode(payloadB64));

  // 3. 过期校验
  if (payload.exp && Date.now() / 1000 >= payload.exp) {
    throw new JWTError('令牌已过期', 'EXPIRED');
  }

  // 4. 黑名单校验
  if (isRevoked(payload, token)) {
    throw new JWTError('令牌已被撤销', 'REVOKED');
  }

  return payload;
}
```

**为什么 JWT 是无状态的？**

```
传统 Session：服务端存储 sessionId → 用户信息（内存/Redis）
  每次请求查一次存储 → 有状态

JWT：签名校验即可，不需要查库
  服务端只需保管 secret → 无状态
  适合分布式：任意节点都能验签
```

### 1.2 JWT 黑名单与刷新机制 — 令牌撤销与续期

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `Map<jti, expireAt>` | 内存黑名单，过期自动清理 | `lib/jwt.js:55` |
| `setInterval().unref()` | 定时清理不阻止进程退出 | `lib/jwt.js:103` |
| 宽限期刷新（gracePeriod） | 允许刚过期的令牌刷新 | `lib/jwt.js:224` |
| 旧令牌撤销 | 刷新时把旧 token 加入黑名单 | `lib/jwt.js:257` |

**黑名单实现：**

```js
const blacklist = new Map();  // Map<jti, expireAt>

function revoke(token, secret) {
  const payload = verify(token, secret, { skipBlacklist: true });
  const id = payload.jti || crypto.createHash('sha256').update(token).digest('hex');
  const expireAt = payload.exp ? payload.exp * 1000 : Date.now() + 24 * 3600 * 1000;
  blacklist.set(id, expireAt);
}

// 每 10 分钟清理过期条目（unref 保证不阻止退出）
setInterval(cleanupBlacklist, 10 * 60 * 1000).unref();
```

**刷新流程（带宽限期）：**

```js
function refresh(token, secret, { expiresIn = 3600, gracePeriod = 300 } = {}) {
  // 1. 验证签名（不检查过期）
  // 2. 检查是否在宽限期内（过期不超过 5 分钟可刷新）
  if (now >= payload.exp + gracePeriod) {
    throw new JWTError('令牌已过期太久，无法刷新', 'EXPIRED');
  }
  // 3. 撤销旧令牌（防止旧令牌继续使用）
  revoke(token, secret);
  // 4. 签发新令牌
  return sign(rest, secret, { expiresIn });
}
```

**为什么需要黑名单？JWT 不是无状态吗？**

```
矛盾：JWT 无状态（不查库），但"登出"需要让令牌立即失效
解决：黑名单是"有状态补充"
  - 正常验签：无状态（99% 请求）
  - 登出/刷新：记录到黑名单（少量请求）
  - 黑名单条目过期后自动清理（不需要永久存储）
```

### 1.3 Cluster 多进程 — 共享端口与负载均衡

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `cluster.isPrimary` | 区分主进程/工作进程 | `server/cluster.js:49` |
| `cluster.fork()` | 主进程派生工作进程 | `server/cluster.js:60` |
| `os.cpus().length` | 按 CPU 核心数启动 worker | `server/cluster.js:40` |
| SO_REUSEADDR | 多进程共享同一端口（OS 级负载均衡） | 内核特性 |
| `cluster.on('exit')` | worker 退出事件，触发重启 | `server/cluster.js:70` |
| `process.send()` / `cluster.on('message')` | IPC 通信 | `server/cluster.js:103,157` |

**架构图：**

```
┌──────────────┐
│   Master     │  ← 管理进程（不处理请求）
│  (cluster)   │
└──────┬───────┘
       │ fork()
  ┌────┴────┬────────┬────────┐
  ↓         ↓        ↓        ↓
Worker1  Worker2  Worker3  Worker4
(HTTP)   (HTTP)   (HTTP)   (HTTP)
  │        │        │        │
  └────────┴────────┴────────┘
           │ 共享端口 (SO_REUSEADDR)
           ↓
        客户端请求
```

**为什么多个进程能监听同一端口？**

```
普通情况：bind() 同一端口会报 EADDRINUSE
Cluster 模式：Master 进程 bind() 端口，fork() 出的 worker 共享监听
  操作系统通过 SO_REUSEADDR 把连接轮流分发给各 worker
  Round-robin 调度（Node.js 默认，非 Windows）
```

**自动重启（带频率限制）：**

```js
cluster.on('exit', (worker, code, signal) => {
  // 防止无限重启：60 秒内最多重启 10 次
  const now = Date.now();
  let timestamps = (workerRestarts.get(worker.id) || [])
    .filter((t) => now - t < RESTART_WINDOW);  // 滑动窗口
  timestamps.push(now);

  if (timestamps.length > MAX_RESTART_COUNT) {
    logger.error('重启次数超限，可能存在严重 bug');
    return;  // 停止重启
  }

  cluster.fork();  // 重启 worker
});
```

**优雅关闭流程：**

```js
function gracefulShutdown(signal) {
  isShuttingDown = true;
  // 1. 通知所有 worker
  for (const id in cluster.workers) {
    worker.send({ type: 'shutdown' });
    worker.process.kill('SIGTERM');
  }
  // 2. 等待 5 秒
  setTimeout(() => {
    const alive = /* 存活 worker 数 */;
    process.exit(alive > 0 ? 1 : 0);  // 还有存活 → 强制退出
  }, SHUTDOWN_TIMEOUT);
}
```

### 1.4 分片上传 + 断点续传 — uploadId 会话管理

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `crypto.randomUUID()` | 生成 uploadId | `core/chunkUploadService.js:53` |
| `.meta.json` 持久化 | 崩溃恢复用元数据 | `core/chunkUploadService.js:73-78` |
| 幂等上传 | 重复分片静默跳过 | `core/chunkUploadService.js:227` |
| `readStream.pipe(writeStream, { end: false })` | 顺序合并分片不关闭写入流 | `core/chunkUploadService.js:336` |
| 内存会话 + 磁盘恢复 | `sessions` Map + `loadMeta()` | `core/chunkUploadService.js:40,83` |

**完整流程：**

```
1. init → 生成 uploadId，返回已上传分片（断点续传）
   POST /api/files/upload/init
   { fileName, fileSize, totalChunks, md5?, targetDir? }
   → { uploadId, chunkSize, totalChunks, uploadedChunks: [] }

2. chunk → 逐个上传分片（application/octet-stream）
   POST /api/files/upload/chunk?uploadId=xxx&chunkIndex=0
   Body: 原始二进制
   → { chunkIndex, uploaded, totalChunks, uploadedChunks: [0,1,...] }

3. complete → 合并所有分片，校验 MD5，清理临时文件
   POST /api/files/upload/complete
   { uploadId }
   → { path, fileName, size, md5? }

4. status → 查询上传进度（断点续传）
   GET /api/files/upload/status?uploadId=xxx

5. abort → 取消上传，清理临时文件
   POST /api/files/upload/abort
   { uploadId }
```

**断点续传实现：**

```js
// init 时检查是否有未完成的会话
async status(uploadId) {
  let session = sessions.get(uploadId);  // 先查内存
  if (!session) {
    session = await loadMeta(uploadId);  // 内存没有，从磁盘恢复
    if (session) {
      // 验证磁盘上的分片实际存在（可能被手动删除）
      const validChunks = [];
      for (const idx of session.uploadedChunks) {
        try {
          await fs.access(getChunkPath(uploadId, idx));
          validChunks.push(idx);
        } catch { /* 分片不存在，跳过 */ }
      }
      session.uploadedChunks = validChunks;
      sessions.set(uploadId, session);
    }
  }
  return { ...session, uploadedChunks: [...session.uploadedChunks] };
}
```

**幂等上传（重复分片跳过）：**

```js
async uploadChunk(uploadId, chunkIndex, data) {
  const session = sessions.get(uploadId);

  // 已上传过 → 直接返回（幂等）
  if (session.uploadedChunks.includes(chunkIndex)) {
    return {
      chunkIndex,
      uploaded: session.uploadedChunks.length,
      totalChunks: session.totalChunks,
      uploadedChunks: [...session.uploadedChunks],
    };
  }

  // 写入分片文件
  await fs.writeFile(getChunkPath(uploadId, chunkIndex), data);
  session.uploadedChunks.push(chunkIndex);
  session.uploadedChunks.sort((a, b) => a - b);
  await saveMeta(uploadId);  // 持久化元数据
  return { ... };
}
```

### 1.5 分片合并 — `pipe(writeStream, { end: false })` 的关键用法

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `pipe(writable, { end: false })` | pipe 完成后不自动关闭 writable | `core/chunkUploadService.js:336` |
| 流式 MD5 计算 | `hash.update(chunk)` 在 `data` 事件中累计 | `core/chunkUploadService.js:329` |
| `writeStream.end()` 手动关闭 | 所有分片合并后显式关闭 | `core/chunkUploadService.js:344` |
| MD5 校验失败回滚 | 删除文件 + 回滚 session 状态 | `core/chunkUploadService.js:353,384` |

**为什么需要 `{ end: false }`？**

```js
// ❌ 错误：pipe 默认会在 readStream 'end' 时关闭 writeStream
for (let i = 0; i < totalChunks; i++) {
  const readStream = fsSync.createReadStream(chunkPath);
  readStream.pipe(writeStream);  // 第一个分片读完，writeStream 就关了！
  // 第二个分片无法写入 → 报错
}

// ✅ 正确：{ end: false } 让 writeStream 保持打开
for (let i = 0; i < totalChunks; i++) {
  await new Promise((resolve, reject) => {
    const readStream = fsSync.createReadStream(chunkPath);
    readStream.on('data', (chunk) => hash.update(chunk));  // 边读边算 MD5
    readStream.on('end', resolve);
    readStream.on('error', reject);
    writeStream.on('error', reject);
    readStream.pipe(writeStream, { end: false });  // 不关闭 writeStream
  });
}
writeStream.end();  // 所有分片合并完，手动关闭
```

**MD5 校验 + 侧载文件（供秒传检查）：**

```js
// 合并时流式计算 MD5
const hash = session.md5 ? crypto.createHash('md5') : null;
for (let i = 0; i < totalChunks; i++) {
  // readStream.on('data', chunk => hash.update(chunk))
}

// 校验
const actualMD5 = hash.digest('hex');
if (actualMD5 !== session.md5) {
  await fs.unlink(finalPath);  // MD5 不匹配，删除文件
  throw new Error(`MD5 校验失败: 期望 ${session.md5}，实际 ${actualMD5}`);
}

// 保存 .md5 侧载文件（下次同文件可秒传）
await fs.writeFile(finalPath + '.md5', actualMD5, 'utf-8');
```

### 1.6 MD5 秒传 — 去重上传

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `.md5` 侧载文件 | 记录文件 MD5 供下次秒传检查 | `core/chunkUploadService.js:117` |
| `fs.readdir` 遍历目标目录 | 检查是否已有同 MD5 文件 | `core/chunkUploadService.js:112` |
| 秒传返回 `instant: true` | 客户端据此跳过分片上传 | `core/chunkUploadService.js:173` |

**秒传流程：**

```js
async init({ fileName, fileSize, md5, targetDir }) {
  // 1. 如果提供了 MD5，检查是否已有同 MD5 文件
  if (md5) {
    const existing = await findFileByMD5(targetDir, md5);
    if (existing) {
      // 秒传：直接返回，无需上传任何分片
      return { instant: true, path: existing.path, fileName: existing.fileName, size: fileSize };
    }
  }
  // 2. 正常创建上传会话
  // ...
}

// findFileByMD5：遍历目标目录的 .md5 侧载文件
async function findFileByMD5(targetDir, md5) {
  const entries = await fs.readdir(safeDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const md5Sidecar = filePath + '.md5';
      const storedMD5 = await fs.readFile(md5Sidecar, 'utf-8');
      if (storedMD5.trim() === md5) {
        return { path: filePath, fileName: entry.name };
      }
    }
  }
  return null;
}
```

### 1.7 JWT 鉴权中间件 — 向后兼容设计

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| 优先 JWT，回退 API Token | `JWT_SECRET` 未设置则用旧版 auth | `server/middleware/jwtAuth.js:71` |
| Bearer Token 提取 | `Authorization: Bearer <token>` | `server/middleware/jwtAuth.js:41` |
| 公开路径白名单 | `/api/auth/login` 等无需鉴权 | `server/middleware/jwtAuth.js:29` |
| `req.user` 挂载 | 验证通过后用户信息注入 req | `server/middleware/jwtAuth.js:93` |

**Token 提取顺序（三通道）：**

```js
function extractToken(req) {
  // 1. Authorization: Bearer <token>（推荐）
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  // 2. X-API-Token（兼容旧版 API Token）
  if (req.headers['x-api-token']) {
    return req.headers['x-api-token'];
  }
  // 3. ?token=（查询参数，用于简单下载链接）
  if (req.url.includes('token=')) {
    return new URL(req.url, 'http://localhost').searchParams.get('token');
  }
  return null;
}
```

**向后兼容策略：**

```js
function jwtAuth(req, res) {
  // 未配置 JWT_SECRET → 回退到 Phase 4 的 API Token 鉴权
  if (!JWT_SECRET) {
    return oldAuth(req, res);
  }
  // 配置了 JWT_SECRET → 走 JWT 流程
  // ...
}
```

---

## 二、我能做什么

### 2.1 Phase 5 新增能力

| 功能 | 入口 | 说明 |
|---|---|---|
| **JWT 登录/登出** | `POST /api/auth/login` / `logout` | 用户名密码 → 签发 JWT，登出撤销 |
| **JWT 刷新** | `POST /api/auth/refresh` | 宽限期内可刷新，旧令牌自动撤销 |
| **JWT 验证** | `GET /api/auth/verify` | 返回令牌有效性和用户信息 |
| **Bearer Token 鉴权** | 中间件自动生效 | 配置 `JWT_SECRET` 即启用 JWT |
| **多进程启动** | `npm start` | 按 CPU 核心数 fork worker |
| **分片上传** | `POST /api/files/upload/init` 等 5 个端点 | 大文件分片、断点续传 |
| **MD5 秒传** | init 时提供 md5 | 已有同 MD5 文件直接返回 |
| **崩溃恢复** | `.meta.json` 持久化 | 服务重启后可继续上传 |

### 2.2 完整 API 清单

| 方法 | 路径 | Phase | 面试价值 |
|---|---|---|---|
| POST | `/api/auth/login` | **P5** | ⭐⭐⭐⭐⭐ |
| POST | `/api/auth/refresh` | **P5** | ⭐⭐⭐⭐⭐ |
| GET | `/api/auth/verify` | **P5** | ⭐⭐⭐ |
| POST | `/api/auth/logout` | **P5** | ⭐⭐⭐⭐ |
| POST | `/api/files/upload/init` | **P5** | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/upload/chunk` | **P5** | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/upload/complete` | **P5** | ⭐⭐⭐⭐⭐ |
| GET | `/api/files/upload/status` | **P5** | ⭐⭐⭐⭐ |
| POST | `/api/files/upload/abort` | **P5** | ⭐⭐⭐ |
| GET | `/api/files` | P2 | ⭐⭐⭐ |
| GET | `/api/files/info` | P2 | ⭐⭐ |
| GET | `/api/files/download` | P3 | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/upload` | P4 流式 | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/mkdir` | P2 | ⭐⭐ |
| DELETE | `/api/files` | P2 | ⭐⭐ |
| PUT | `/api/files/move` | P2 | ⭐⭐ |
| GET | `/api/files/search` | P3 | ⭐⭐⭐ |
| GET | `/api/files/preview` | P3 | ⭐⭐⭐⭐ |
| GET | `/api/files/hash` | P3 | ⭐⭐⭐⭐ |
| GET | `/api/files/logs` | P3 | ⭐⭐⭐⭐ |

### 2.3 启动方式

```bash
# 单进程（开发）
npm run start:single    # node server/index.js

# 多进程（生产）
npm start               # node server/cluster.js
WORKERS=4 npm start     # 指定 worker 数量

# 启用 JWT 鉴权
JWT_SECRET=my-secret-key npm start

# 配置用户
JWT_USERS='{"admin":"admin123","alice":"pass456"}' JWT_SECRET=secret npm start
```

### 2.4 中间件链（Phase 5 更新）

```
请求进入
  ↓
CORS（OPTIONS 预检直接 204）
  ↓
JWT 鉴权（未配置 JWT_SECRET 回退 API Token；401 拦截）
  ↓
限流（IP 滑动窗口；429 拦截）
  ↓
bodyParser（multipart/octet-stream 跳过，交给控制器处理）
  ↓
路由分发 → 控制器
```

---

## 三、能应付的面试题

### 3.1 JWT 深度题

**Q1：JWT 的结构是什么？各部分作用？**

```
Header.Payload.Signature

Header    = { "alg": "HS256", "typ": "JWT" }     — 算法声明
Payload   = { "sub": "user1", "exp": 1690003600 } — 载荷（用户信息+声明）
Signature = HMAC-SHA256(base64(header).base64(payload), secret) — 防篡改

Header 和 Payload 是 base64url 编码（可解码），不是加密
Signature 用 secret 计算，只有持有 secret 的服务端能验签
```

**Q2：JWT 为什么是无状态的？和 Session 的区别？**

| 特性 | Session | JWT |
|---|---|---|
| 状态存储 | 服务端（内存/Redis） | 客户端（Token 自包含） |
| 验证方式 | 查 sessionId → 用户信息 | 验签名 + 读 Payload |
| 分布式 | 需共享 Session 存储 | 任意节点可验签 |
| 撤销 | 删 Session 即可 | 需黑名单机制 |
| 性能 | 每次请求查库 | 签名计算（更快） |

**Q3：JWT 如何实现登出（撤销）？不是无状态吗？**

```
矛盾：JWT 无状态设计，但登出需要让令牌立即失效
方案：黑名单是"有状态补充"
  - 正常验签：无状态（99% 请求，只验签名）
  - 登出/刷新：记录到内存黑名单（少量请求）
  - 黑名单条目过期后自动清理（令牌自然失效后无需再记录）

实现：Map<jti, expireAt>
  - jti 是 JWT 的唯一 ID（或在无 jti 时用 token 哈希）
  - expireAt 是令牌原过期时间
  - 定时清理过期条目（setInterval + unref）
```

**Q4：JWT 刷新为什么要设宽限期？**

```js
// 场景：令牌 12:00:00 过期，用户 12:00:01 发请求
// 没有 gracePeriod：直接 401，用户被迫重新登录（体验差）
// 有 gracePeriod（300 秒）：允许刷新，用户无感知

if (now >= payload.exp + gracePeriod) {
  throw new JWTError('令牌已过期太久，无法刷新', 'EXPIRED');
}
```

**Q5：JWT 用 HMAC-SHA256 还是 RSA？怎么选？**

| 算法 | 密钥 | 适用场景 |
|---|---|---|
| HS256（HMAC） | 对称密钥（双方共享） | 单体应用、服务端自签自验 |
| RS256（RSA） | 公钥/私钥分离 | 微服务、多系统（签发方持私钥，验签方持公钥） |
| ES256（ECDSA） | 椭圆曲线 | 移动端、物联网（性能好） |

**本项目用 HS256**：单体应用，签发和验证同一服务，对称密钥最简单。

### 3.2 Cluster 多进程题

**Q6：Node.js 为什么需要 Cluster？单进程不够吗？**

```
Node.js 单线程：一个进程只用一个 CPU 核心
  8 核服务器 → 单进程只用 12.5% 算力

Cluster 多进程：fork 出多个 worker，共享端口
  8 核 → 8 个 worker → 100% 利用 CPU
  操作系统 Round-robin 分发连接
```

**Q7：多个进程怎么监听同一端口？不会冲突吗？**

```
普通情况：bind() 同一端口报 EADDRINUSE

Cluster 模式：
  Master 进程 bind() 端口
  fork() 出的 worker 共享 Master 的监听
  操作系统通过 SO_REUSEADDR 允许多进程绑定同一端口
  连接由内核 Round-robin 分发给各 worker（Node.js 默认调度）
```

**Q8：Worker 崩溃了怎么办？如何防止无限重启？**

```js
// 自动重启
cluster.on('exit', (worker, code, signal) => {
  cluster.fork();  // 重启 worker
});

// 防止无限重启：滑动窗口频率限制
const MAX_RESTART_COUNT = 10;
const RESTART_WINDOW = 60 * 1000;  // 60 秒

let timestamps = (workerRestarts.get(worker.id) || [])
  .filter((t) => now - t < RESTART_WINDOW);
timestamps.push(now);

if (timestamps.length > MAX_RESTART_COUNT) {
  logger.error('重启次数超限，可能存在严重 bug');
  return;  // 停止重启，避免 CPU 飞车
}
```

**Q9：Cluster 模式下如何优雅关闭？**

```
1. Master 收到 SIGTERM/SIGINT
2. 标记 isShuttingDown = true（停止接收新连接、停止重启 worker）
3. 向所有 worker 发送 shutdown 信号
4. worker 收到 SIGTERM → server.close() 停止接收新连接
   → 等待正在处理的请求完成 → process.exit(0)
5. Master 等待 5 秒，超时则强制退出
```

**Q10：Cluster 和 PM2 的关系？**

```
Cluster 是 Node.js 内置模块（语言级）
PM2 是进程管理器（工具级），底层也是用 Cluster

PM2 额外提供：
  - 零停机重启（reload 而非 restart）
  - 日志管理
  - 监控面板
  - 配置文件

本项目用原生 Cluster：
  - 学习原理
  - 零依赖
  - 可控性强
```

### 3.3 分片上传题

**Q11：分片上传的完整流程是什么？**

```
1. init：客户端告诉服务端文件信息（名、大小、分片数、MD5）
   → 服务端返回 uploadId（会话 ID）
   → 如果提供了 MD5 且已有同 MD5 文件 → 秒传，直接返回

2. chunk：客户端把文件切块，逐个上传
   → 每个分片带 uploadId + chunkIndex
   → 服务端存到 {tmpdir}/fms-chunks/{uploadId}/chunk-{i}
   → 返回已上传分片列表（uploadedChunks）

3. complete：客户端通知所有分片上传完成
   → 服务端按顺序合并分片 → 校验 MD5 → 清理临时文件
   → 返回最终文件路径

4. status：随时查询上传进度（断点续传用）
   → 返回已上传分片列表

5. abort：取消上传，清理临时文件
```

**Q12：断点续传怎么实现？服务重启后还能继续吗？**

```js
// 关键：元数据持久化到磁盘（.meta.json）

// 每次上传分片后保存元数据
async saveMeta(uploadId) {
  await fs.writeFile(metaPath, JSON.stringify(session));
}

// 查询状态时，内存没有则从磁盘恢复
async status(uploadId) {
  let session = sessions.get(uploadId);  // 内存
  if (!session) {
    session = await loadMeta(uploadId);  // 磁盘恢复
    if (session) {
      // 验证磁盘分片实际存在（可能被手动删除）
      const validChunks = [];
      for (const idx of session.uploadedChunks) {
        await fs.access(getChunkPath(uploadId, idx));
        validChunks.push(idx);
      }
      session.uploadedChunks = validChunks;
    }
  }
  return session;
}
```

**Q13：分片合并时为什么要用 `pipe(writeStream, { end: false })`？**

```js
// ❌ 默认 pipe 会在 readStream 结束时关闭 writeStream
readStream.pipe(writeStream);
// → 第一个分片读完，writeStream 关了，后续分片无法写入

// ✅ { end: false } 保持 writeStream 打开
for (let i = 0; i < totalChunks; i++) {
  await new Promise((resolve, reject) => {
    readStream.on('end', resolve);
    readStream.pipe(writeStream, { end: false });
  });
}
writeStream.end();  // 所有分片合并完，手动关闭
```

**Q14：MD5 秒传原理？如何检测？**

```
原理：相同文件 MD5 相同，已上传过则无需再传

实现：
  1. 上传完成时，计算文件 MD5，保存为 .md5 侧载文件
     final.txt + final.txt.md5（内容是 MD5 哈希值）

  2. 下次上传 init 时，如果客户端提供了 md5：
     - 遍历目标目录的所有 .md5 侧载文件
     - 找到匹配的 → 返回 { instant: true, path, fileName }
     - 客户端据此跳过分片上传
```

**Q15：分片上传如何保证幂等性？**

```js
// 重复上传同一分片 → 静默跳过，不报错
async uploadChunk(uploadId, chunkIndex, data) {
  if (session.uploadedChunks.includes(chunkIndex)) {
    // 已上传，直接返回当前状态
    return {
      chunkIndex,
      uploaded: session.uploadedChunks.length,
      uploadedChunks: [...session.uploadedChunks],
    };
  }
  // 写入分片...
}
```

**Q16：分片上传中途网络断了怎么办？**

```
客户端策略：
  1. 分片上传失败 → 重试该分片（幂等，重复上传无副作用）
  2. 全部失败 → 调用 status 查询已上传分片
  3. 从断点继续上传（只传缺失的分片）
  4. 所有分片齐了 → 调用 complete 合并

服务端保证：
  - 分片上传幂等（重复跳过）
  - 元数据持久化（崩溃可恢复）
  - complete 时校验分片完整性（缺少则报错）
```

### 3.4 综合架构题

**Q17：JWT 鉴权中间件如何向后兼容旧版 API Token？**

```js
function jwtAuth(req, res) {
  if (!JWT_SECRET) {
    return oldAuth(req, res);  // 回退到 API Token 鉴权
  }
  // JWT 流程...
}

// Token 提取顺序（三通道）：
// 1. Authorization: Bearer <token>  — JWT 标准
// 2. X-API-Token: <token>           — 旧版兼容
// 3. ?token=<token>                 — 查询参数
```

**Q18：分片上传和流式上传（Phase 4）的区别？什么时候用哪个？**

| 维度 | 流式上传（multipart） | 分片上传 |
|---|---|---|
| 协议 | multipart/form-data | application/octet-stream |
| 客户端 | 浏览器原生支持 | 需 JS 切片逻辑 |
| 断点续传 | ❌ 不支持 | ✅ 支持 |
| 秒传 | ❌ 不支持 | ✅ 支持（MD5） |
| 大文件 | 支持但中断需重传 | 中断可续传 |
| 实现复杂度 | 中 | 高 |
| 适用 | 普通上传 | 大文件、弱网络 |

**Q19：Cluster 模式下，多个 worker 的 sessions Map 怎么共享？**

```
问题：分片上传的 sessions 是进程内 Map，各 worker 独立
  worker1 上的 init → worker2 上的 chunk 找不到 session

当前方案（单机演示）：
  - 负载均衡可能把请求分到不同 worker
  - 实际生产需要共享存储

生产方案：
  1. Redis 共享 sessions（推荐）
  2. Sticky Session（同一客户端固定到同一 worker）
  3. IPC 把 session 同步到所有 worker（复杂）
```

**Q20：文件上传的完整安全防护应包括哪些层？**

```
1. 鉴权层（JWT）       — 未授权拒绝
2. 限流层（rateLimit） — 防恶意刷接口
3. 大小限制（MAX_FILE_SIZE） — 防大文件耗尽磁盘
4. 路径校验（resolveSafePath） — 防目录穿越
5. 文件名净化（path.basename） — 防路径注入
6. MD5 校验（complete 时） — 防传输中篡改
7. 临时文件清理（abort/cleanupExpired） — 防磁盘占满
8. 分片完整性检查（complete 时） — 防漏传
```

---

## 四、扩展方向

### 4.1 Phase 6 后续方向

| 方向 | 知识点 | 面试价值 | 难度 |
|---|---|---|---|
| **Redis 共享 Session** | 分布式 session、Lua 原子操作 | ⭐⭐⭐⭐⭐ | 🔴 |
| **WebSocket 实时推送** | `ws` 库、上传进度通知 | ⭐⭐⭐⭐ | 🟡 |
| **HTTPS + HTTP/2** | TLS 证书、`https.createServer`、ALPN | ⭐⭐⭐⭐ | 🟡 |
| **Docker 容器化** | Dockerfile、多阶段构建、健康检查 | ⭐⭐⭐⭐ | 🟡 |
| **Prometheus 监控** | metrics 采集、Grafana 可视化 | ⭐⭐⭐⭐ | 🟡 |
| **前端上传 SDK** | 切片、并发、进度、重试 | ⭐⭐⭐⭐ | 🟡 |
| **文件存储分离** | S3/OSS、CDN 加速 | ⭐⭐⭐⭐⭐ | 🔴 |

### 4.2 当前实现的改进点

| 当前实现 | 局限 | 改进方案 |
|---|---|---|
| JWT 黑名单用 Map | 单机，重启丢失 | Redis 共享黑名单 |
| 分片 sessions 用 Map | 多 worker 不共享 | Redis 共享 session |
| 用户存储用环境变量 | 无法动态增删 | 数据库（SQLite/PostgreSQL） |
| 分片合并串行 | 大文件合并慢 | 并发读取 + 顺序写入 |
| 无并发控制 | 同一文件可并发上传 | 信号量限制并发数 |
| 无进度通知 | 前端轮询 status | WebSocket/SSE 推送 |

### 4.3 面试冲刺清单

Phase 5 完成后，按优先级准备以下面试题：

| 优先级 | 知识点 | 掌握标准 |
|---|---|---|
| ⭐⭐⭐⭐⭐ | JWT 结构与原理 | 能手画三段结构，解释签名如何防篡改 |
| ⭐⭐⭐⭐⭐ | JWT 无状态 vs Session | 能对比优劣，说出 JWT 适用场景 |
| ⭐⭐⭐⭐⭐ | 分片上传完整流程 | 能画出 init→chunk→complete 时序图 |
| ⭐⭐⭐⭐⭐ | 断点续传实现 | 能解释 .meta.json + status 恢复机制 |
| ⭐⭐⭐⭐⭐ | Cluster 多进程 | 能解释 fork、共享端口、自动重启 |
| ⭐⭐⭐⭐ | pipe({ end: false }) | 能解释为什么分片合并需要这个选项 |
| ⭐⭐⭐⭐ | JWT 黑名单 | 能解释无状态 JWT 如何实现撤销 |
| ⭐⭐⭐⭐ | MD5 秒传 | 能解释侧载文件机制 |
| ⭐⭐⭐⭐ | 优雅关闭 | 能描述 SIGTERM → 通知 worker → 超时强退 |
| ⭐⭐⭐ | timingSafeEqual | 知道防计时攻击的原理 |
| ⭐⭐⭐ | HMAC vs RSA | 知道对称 vs 非对称签名的选择 |

### 4.4 测试覆盖

Phase 5 新增测试用例（共 143 个测试全部通过）：

| 测试文件 | 用例数 | 覆盖点 |
|---|---|---|
| `test/jwt.test.js` | 13 | sign/verify、签名校验、格式校验、过期、黑名单/撤销、refresh、base64url 特殊字符 |
| `test/chunkUpload.test.js` | 14 | init、uploadChunk+complete、幂等性、status、abort、不完整拒绝、秒传、MD5 校验、二进制数据 |
| `test/cluster.test.js` | 4 | 启动+HTTP、自动重启、优雅关闭、多 worker |

---

> **一句话总结 Phase 5：** 通过零依赖实现 JWT（HMAC-SHA256 + 黑名单 + 宽限期刷新）、Cluster 多进程（fork/共享端口/自动重启/优雅关闭）、分片上传（init/chunk/complete/status/abort + 断点续传 + MD5 秒传），深入掌握了 JWT 无状态鉴权、多进程架构、大文件分片与断点续传等生产级核心技术，将文件管理系统从"可上线"提升到"可扩展、可恢复"的水平。
