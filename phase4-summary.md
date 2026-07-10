# Phase 4 学习总结：生产级能力 — 流式上传、鉴权、限流

## 目录
1. [学到的 Node.js 知识点](#一学到的-nodejs-知识点)
2. [我能做什么](#二我能做什么)
3. [能应付的面试题](#三能应付的面试题)
4. [扩展方向](#四扩展方向)

---

## 一、学到的 Node.js 知识点

### 1.1 自定义 Transform Stream — 流式 multipart 解析器

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `new Transform({ transform, flush })` | 自定义转换流 | `lib/multipartStreamParser.js:54` |
| 状态机驱动解析 | `SEARCH_BOUNDARY → IN_HEADERS → IN_DATA → DONE` | `lib/multipartStreamParser.js:39-44` |
| Buffer 边界处理 | 保留 `safeKeep` 字节防止 boundary 跨 chunk 被截断 | `lib/multipartStreamParser.js:149` |
| `Buffer.indexOf` | 在二进制数据中定位分隔符 | `lib/multipartStreamParser.js:81,144` |
| `pipeline(req, parser, cb)` | 把请求流接入解析器 | `server/controllers/fileController.js:146` |

**核心实现（Transform + 状态机）：**

```js
const { Transform } = require('stream');

const STATE = {
  SEARCH_BOUNDARY: 0,  // 寻找 boundary
  IN_HEADERS: 1,       // 解析 part 头部
  IN_DATA: 2,          // part 数据
  DONE: 3,             // 结束
};

const transform = new Transform({
  transform(chunk, encoding, cb) {
    buffer = Buffer.concat([buffer, chunk]);
    this._processBuffer(cb);  // 循环消费 buffer
  },
  flush(cb) {
    if (currentWriteStream) currentWriteStream.end();
    cb();
  },
});
```

**与旧版 `parseMultipart` 的关键区别：**

| 维度 | 旧版（Buffer.concat） | 新版（Transform Stream） |
|---|---|---|
| 内存占用 | O(n)（整个文件） | O(highWaterMark)（恒定） |
| 何时写盘 | 全部接收后 | 边接收边写 |
| 大文件支持 | ❌ OOM 风险 | ✅ 支持 GB 级 |
| 实现复杂度 | 简单 | 需状态机 + 边界处理 |

**boundary 跨 chunk 的处理（最容易踩坑的点）：**

```js
// 没找到完整 boundary，但末尾可能是 boundary 的前缀
const safeKeep = delimiterWithCrlf.length;  // '\r\n--boundary' 的长度
if (buffer.length > safeKeep) {
  // 前面安全的部分写出，末尾 safeKeep 字节留给下一个 chunk 拼接
  const toWrite = buffer.slice(0, buffer.length - safeKeep);
  buffer = buffer.slice(buffer.length - safeKeep);
  if (toWrite.length > 0) writePartData(toWrite);
}
```

### 1.2 两阶段流式上传 — 解决 multipart 字段顺序问题

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| 临时文件中转 | 先写 `os.tmpdir()`，解析完成后再 `rename` 到目标 | `server/controllers/fileController.js:118` |
| `os.tmpdir()` | 系统临时目录，跨设备时需 fallback | `server/controllers/fileController.js:118` |
| `fs.rename` EXDEV 回退 | 跨设备重命名失败时 copy + unlink | `core/fileService.js:moveUpload` |
| `Transform` 做大小限制 | 超过上限时 `destroy(new Error())` | `server/controllers/fileController.js:122-132` |

**为什么需要两阶段？**

multipart 字段顺序不保证 —— `path` 字段可能在 `file` 之前或之后。如果 `file` 在前，`onFileStart` 触发时还不知道目标目录。

```js
onFileStart(name, filename) {
  // 此时 fields.path 可能还没解析到！
  // 解决：先写临时文件
  const tmpPath = path.join(os.tmpdir(), `fms-upload-${Date.now()}-${safeFileName}`);
  const writeStream = fsSync.createWriteStream(tmpPath);
  // ... 大小限制 Transform ...
  return sizeLimiter;  // 解析器会 pipe 进来
}

// 所有 part 解析完后
pipeline(req, parser, async (err) => {
  await tmpFile.writeDone;  // 等待落盘
  // 此时 fields.path 已就绪，移动到最终位置
  const result = await fileService.moveUpload(tmpFile.tmpPath, targetDir, ...);
});
```

**EXDEV 跨设备回退：**

```js
async moveUpload(tmpPath, targetDir, fileName, size) {
  const finalPath = path.join(safeTargetDir, safeFileName);
  try {
    await fs.rename(tmpPath, finalPath);  // 同设备：原子操作，最快
  } catch (renameErr) {
    if (renameErr.code === 'EXDEV') {
      // 跨设备（如 /tmp 和项目目录在不同分区）：copy + unlink
      await fs.copyFile(tmpPath, finalPath);
      await fs.unlink(tmpPath);
    } else {
      throw renameErr;
    }
  }
}
```

### 1.3 鉴权中间件 — API Token + 防计时攻击

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `crypto.timingSafeEqual(a, b)` | 恒定时间比较，防止计时攻击 | `server/middleware/auth.js:25,81` |
| 环境变量配置 | `API_TOKEN` 未设置则鉴权关闭 | `server/middleware/auth.js:20` |
| Header / Query 双通道 | `X-API-Token` 或 `?token=` | `server/middleware/auth.js:48` |
| 白名单路径 | `PUBLIC_PATHS` 数组 | `server/middleware/auth.js:23` |

**计时攻击原理与防御：**

```js
// ❌ 普通字符串比较：比较到第一个不等的字符就返回
//    攻击者可通过响应时间逐字符爆破 token
if (token === API_TOKEN) { ... }
// 'abc' vs 'abd' 比 'abc' vs 'xyz' 慢（多比了一位）

// ✅ 恒定时间比较：无论匹配多少位，耗时相同
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

**中间件返回值约定：**

```js
function auth(req, res) {
  if (!API_TOKEN) return false;  // 未配置 → 放行（返回 false 表示"不拦截"）
  if (!safeEqual(token, API_TOKEN)) {
    res.writeHead(401, ...);
    res.end(...);
    return true;  // 已响应 → 返回 true 表示"已处理"
  }
  return false;  // 通过 → 继续后续中间件
}

// 调用方：
if (auth(req, res)) return;  // true = 已拦截，停止
```

### 1.4 限流中间件 — IP 滑动窗口

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| 滑动窗口算法 | `Map<ip, timestamps[]>` 过滤窗口外记录 | `server/middleware/rateLimit.js:74-75` |
| `X-Forwarded-For` | 反向代理场景提取真实 IP | `server/middleware/rateLimit.js:53-56` |
| `setInterval` + `unref()` | 定时清理不阻止进程退出 | `server/middleware/rateLimit.js:32,45` |
| 限流响应头 | `X-RateLimit-*` / `Retry-After` | `server/middleware/rateLimit.js:80-89` |

**滑动窗口 vs 固定窗口：**

```
固定窗口（简单但有突发问题）：
|---窗口1---|---窗口2---|
  50 请求      50 请求
        ↑
      窗口边界处可能瞬间 100 请求（前窗口末尾 + 后窗口开头）

滑动窗口（平滑）：
  当前时刻 t，统计 [t-60s, t] 内的请求数
  每次请求都"滑动"窗口，无突发缺口
```

**实现核心：**

```js
function rateLimit(req, res) {
  const ip = getClientIP(req);
  const now = Date.now();

  // 取出历史记录，过滤掉窗口外的（滑动窗口核心）
  let timestamps = store.get(ip) || [];
  timestamps = timestamps.filter((t) => now - t < WINDOW_MS);

  // 设置限流信息头（RFC 标准）
  res.setHeader('X-RateLimit-Limit', MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, MAX_REQUESTS - timestamps.length - 1));
  res.setHeader('X-RateLimit-Reset', Math.floor((now + WINDOW_MS) / 1000));

  if (timestamps.length >= MAX_REQUESTS) {
    res.setHeader('Retry-After', retryAfter);
    res.writeHead(429, ...);
    res.end(...);
    return true;  // 已限流
  }

  timestamps.push(now);  // 记录本次请求
  store.set(ip, timestamps);
  return false;  // 放行
}
```

**`unref()` 的作用：**

```js
cleanupTimer = setInterval(() => { ... }, CLEANUP_INTERVAL);
cleanupTimer.unref();  // 这个定时器不阻止 Node 进程退出
// 没有 unref() 的话，即使所有请求结束，进程也会因为定时器挂起不退出
```

### 1.5 stream.pipeline 错误传播

```js
pipeline(req, parser, async (err) => {
  if (err) {
    // 任何一环出错（请求中断、解析失败、大小超限）都会到这里
    if (tmpFile) fsSync.unlink(tmpFile.tmpPath, () => {});  // 清理临时文件
    if (!res.headersSent) sendError(res, 400, `上传失败: ${err.message}`);
    return;
  }
  // 正常完成
});
```

**pipeline 的错误传播链：**

```
req 出错 ──┐
parser 出错 ──┤── pipeline 回调收到 err
sizeLimiter 出错（大小超限）──┤   （同时销毁所有 stream）
writeStream 出错 ──┘
```

### 1.6 子进程测试模式 — 测试环境变量依赖的模块

```js
// auth.js / rateLimit.js 在 require 时就读取 process.env
// 普通测试无法改变已加载模块的环境变量
// 解决：用子进程隔离

function runAuthInChild(code, cb) {
  const child = spawn('node', ['-e', code]);
  // 子进程独立加载模块，环境变量互不影响
}
```

**为什么需要子进程？**

```js
// ❌ 这样不行：require 会缓存，模块已用旧 env 初始化
process.env.API_TOKEN = 'secret';
const auth = require('../server/middleware/auth');  // API_TOKEN 已是 null
process.env.API_TOKEN = undefined;  // 太晚了

// ✅ 子进程隔离
const code = [
  "process.env.API_TOKEN = 'secret'",
  "const auth = require('./server/middleware/auth')",
  "// 测试逻辑...",
].join(';');
spawn('node', ['-e', code]);
```

---

## 二、我能做什么

### 2.1 Phase 4 新增能力

| 功能 | 入口 | 说明 |
|---|---|---|
| **大文件流式上传** | `POST /api/files/upload` | Transform 解析 + 边收边写，支持 GB 级 |
| **上传大小限制** | 中间件 | 超过 200MB 自动中止并清理 |
| **API Token 鉴权** | `X-API-Token` 头 / `?token=` | 恒定时间比较，防计时攻击 |
| **IP 限流** | 自动生效 | 100 次/分钟，超限 429 + Retry-After |
| **限流信息头** | 所有响应 | `X-RateLimit-*` 透传剩余配额 |

### 2.2 完整 API 清单

| 方法 | 路径 | Phase | 面试价值 |
|---|---|---|---|
| GET | `/api/files` | P2 | ⭐⭐⭐ |
| GET | `/api/files/info` | P2 | ⭐⭐ |
| GET | `/api/files/download` | P3 | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/upload` | **P4 流式升级** | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/mkdir` | P2 | ⭐⭐ |
| DELETE | `/api/files` | P2 | ⭐⭐ |
| PUT | `/api/files/move` | P2 | ⭐⭐ |
| GET | `/api/files/search` | P3 | ⭐⭐⭐ |
| GET | `/api/files/preview` | P3 | ⭐⭐⭐⭐ |
| GET | `/api/files/hash` | P3 | ⭐⭐⭐⭐ |
| GET | `/api/files/logs` | P3 | ⭐⭐⭐⭐ |

### 2.3 中间件链

```
请求进入
  ↓
CORS（OPTIONS 预检直接 204）
  ↓
鉴权（无 API_TOKEN 则跳过；401 拦截）
  ↓
限流（IP 滑动窗口；429 拦截）
  ↓
bodyParser（multipart 跳过，交给控制器流式处理）
  ↓
路由分发 → 控制器
```

---

## 三、能应付的面试题

### 3.1 流式上传深度题

**Q1：如何实现大文件上传不撑爆内存？**

核心：**流式处理，边收边写**，内存占用恒定。

```js
// ❌ 旧版：全量缓冲
const chunks = [];
req.on('data', (c) => chunks.push(c));
req.on('end', () => {
  const buf = Buffer.concat(chunks);  // 整个文件在内存！
  parseMultipart(buf);  // 1GB 文件 = 1GB 内存
});

// ✅ 新版：Transform 流式解析
const parser = createMultipartStream(boundary, {
  onFileStart(name, filename) {
    return fsSync.createWriteStream(tmpPath);  // 返回可写流
  },
});
pipeline(req, parser, cb);  // 边收边解析边写盘
```

**Q2：multipart 解析器如何处理 boundary 跨 chunk？**

boundary 可能被 chunk 边界切断：

```
chunk1: "...文件数据\r\n--boun"
chunk2: "dary\r\nContent-Disposition..."
```

解决：保留末尾可能不完整的部分，下个 chunk 拼接后再判断：

```js
const safeKeep = delimiterWithCrlf.length;  // '\r\n--boundary' 长度
if (buffer.length > safeKeep) {
  const toWrite = buffer.slice(0, buffer.length - safeKeep);
  buffer = buffer.slice(buffer.length - safeKeep);  // 保留末尾
  writePartData(toWrite);
}
// 下个 chunk 进来时：buffer = Buffer.concat([buffer, chunk])
```

**Q3：multipart 字段顺序不保证，如何处理？**

HTTP 规范不保证 multipart 字段顺序。`file` 可能在 `path` 之前。

**方案一（本项目）：两阶段**
- `onFileStart` 时先写临时目录
- 所有 part 解析完后，用 `path` 字段把临时文件 `rename` 到最终位置

**方案二：缓冲字段直到拿到 path**
- 缺点：文件仍需流式写，逻辑更复杂

**方案三：要求客户端按顺序发**
- 缺点：不健壮，违反 HTTP 语义

**Q4：fs.rename 报 EXDEV 怎么办？**

`EXDEV` 表示跨设备链接（源和目标在不同文件系统/分区）：

```js
try {
  await fs.rename(tmpPath, finalPath);  // 同设备：原子操作
} catch (err) {
  if (err.code === 'EXDEV') {
    await fs.copyFile(tmpPath, finalPath);  // 跨设备：复制
    await fs.unlink(tmpPath);               // 删除源
  } else {
    throw err;
  }
}
```

常见场景：`/tmp` 是 tmpfs（内存文件系统），项目目录在硬盘。

### 3.2 鉴权与安全题

**Q5：什么是计时攻击？如何防御？**

计时攻击通过测量响应时间推断秘密信息：

```js
// 普通比较 'abc' === 'abd'：比到第 3 位就返回 false（耗时略长）
//           'abc' === 'xyz'：比到第 1 位就返回 false（耗时略短）
// 攻击者通过时间差逐字符爆破
```

防御：`crypto.timingSafeEqual` 保证无论匹配多少位，耗时恒定：

```js
const { timingSafeEqual } = require('crypto');
function safeEqual(a, b) {
  if (a.length !== b.length) return false;  // 长度不同直接返回（但不泄露内容）
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

**Q6：API Token 放 Header 还是 Query？**

| 位置 | 优点 | 缺点 |
|---|---|---|
| Header（`X-API-Token`） | 不进日志、不进浏览器历史 | 需要支持自定义 Header |
| Query（`?token=`） | 简单、支持 `<img src>` | 进 access log、进浏览器历史、可能被 Referer 泄露 |

**最佳实践：** 优先 Header，Query 作为降级方案（如简单文件下载链接）。

**Q7：JWT 和 API Token 的区别？**

| 特性 | API Token | JWT |
|---|---|---|
| 结构 | 单一字符串 | Header.Payload.Signature |
| 状态 | 服务端需存储/校验 | 无状态（签名校验） |
| 过期 | 服务端控制 | Payload 内含 exp |
| 用户信息 | 需查库 | Payload 内含 |
| 撤销 | 删库即可 | 需黑名单机制 |
| 适用 | 服务间/简单场景 | 分布式/微服务 |

### 3.3 限流题

**Q8：滑动窗口和固定窗口的区别？**

```
固定窗口：[0-60s] 最多 100 次
  问题：59 秒发 100 次 + 61 秒发 100 次 = 2 秒内 200 次

滑动窗口：任意 60 秒内最多 100 次
  每次请求检查 [now-60s, now] 内的请求数
  平滑无突发缺口
```

**Q9：如何实现分布式限流？**

单机限流用 `Map`，多机需共享存储：

| 方案 | 实现 | 适用 |
|---|---|---|
| Redis + INCR | `INCR ip:timestamp` + EXPIRE | 中小规模 |
| Redis + ZSET | ZADD 时间戳，ZREMRANGEBYSCORE 清理 | 精确滑动窗口 |
| 令牌桶（Redis + Lua） | 原子操作保证准确 | 高并发 |
| Nginx limit_req | 网关层限流 | 入口防护 |

**Q10：限流应返回什么状态码和头？**

```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 100          # 窗口上限
X-RateLimit-Remaining: 0        # 剩余
X-RateLimit-Reset: 1690000000   # 窗口重置 Unix 秒
Retry-After: 30                 # 建议重试秒数
Content-Type: application/json

{"success": false, "error": "请求过于频繁"}
```

### 3.4 Stream 进阶题

**Q11：Transform 的 transform 和 flush 的区别？**

- `transform(chunk, encoding, cb)` — 每个输入 chunk 调用一次，用 `cb(null, outChunk)` 输出
- `flush(cb)` — 流结束时调用一次，用于输出剩余缓冲数据

```js
new Transform({
  transform(chunk, encoding, cb) {
    // 每个输入块
    this._buffer = Buffer.concat([this._buffer, chunk]);
    this._process(cb);
  },
  flush(cb) {
    // 流结束，清理未完成的部分
    if (this._currentWriteStream) this._currentWriteStream.end();
    cb();
  },
});
```

**Q12：为什么 pipeline 比 pipe + error 监听更好？**

```js
// pipe + 手动 error：容易漏，且不自动销毁
stream1.pipe(stream2).on('error', handler);  // 只监听了 stream2 的 error
// stream1 出错时 stream2 不会被销毁 → 资源泄漏

// pipeline：自动处理所有 stream 的错误和销毁
pipeline(stream1, stream2, (err) => {
  // 任何 stream 出错都会到这里，且所有 stream 已自动销毁
});
```

### 3.5 架构设计题

**Q13：文件上传的完整安全防护应包括哪些层？**

```
1. 鉴权层（auth）      — 未授权拒绝
2. 限流层（rateLimit） — 防恶意刷接口
3. 大小限制（sizeLimiter） — 防大文件耗尽磁盘
4. 路径校验（resolveSafePath） — 防目录穿越
5. 文件名净化（path.basename） — 防路径注入
6. 临时文件中转 — 原子性（要么完整成功，要么不留垃圾）
7. 清理兜底 — 失败时 unlink 临时文件
```

**Q14：为什么上传用两阶段（临时文件→rename），而不是直接写到目标？**

| 直接写 | 两阶段 |
|---|---|
| 字段顺序依赖（path 可能在 file 之后） | 顺序无关 |
| 上传中途失败留下半截文件 | 失败只留临时文件（可清理） |
| 非原子性 | rename 原子操作（同设备） |

---

## 四、扩展方向

### 4.1 Phase 5 后续方向

| 方向 | 知识点 | 面试价值 | 难度 |
|---|---|---|---|
| **分片上传 + 断点续传** | chunk 编号、合并、秒传、MD5 去重 | ⭐⭐⭐⭐⭐ | 🔴 |
| **JWT 鉴权** | 签发、校验、刷新、黑名单 | ⭐⭐⭐⭐⭐ | 🔴 |
| **Cluster 多进程** | `cluster.fork()`、负载均衡、共享端口 | ⭐⭐⭐⭐⭐ | 🔴 |
| **WebSocket 实时推送** | `ws` 库、文件变更通知 | ⭐⭐⭐⭐ | 🟡 |
| **HTTPS + HTTP/2** | TLS 证书、`https.createServer`、ALPN | ⭐⭐⭐⭐ | 🟡 |
| **文件监视** | `fs.watch`、chokidar、增量同步 | ⭐⭐⭐ | 🟢 |
| **Redis 分布式限流** | 令牌桶、Lua 原子脚本 | ⭐⭐⭐⭐⭐ | 🔴 |

### 4.2 当前实现的改进点

| 当前实现 | 局限 | 改进方案 |
|---|---|---|
| 临时文件 rename | 跨设备需 copy | 启动时检测，或直接用目标目录做临时目录 |
| 限流用 Map | 单机，重启丢失 | Redis ZSET 实现分布式 |
| API Token 单一 | 无法区分用户 | JWT + 用户体系 |
| 无并发控制 | 同一 IP 可同时上传多个 | 信号量限制并发数 |
| 无进度通知 | 前端不知道上传进度 | WebSocket / SSE 推送进度 |

### 4.3 面试冲刺清单

Phase 4 完成后，按优先级准备以下面试题：

| 优先级 | 知识点 | 掌握标准 |
|---|---|---|
| ⭐⭐⭐⭐⭐ | 流式上传原理 | 能画出 req→Transform→writeStream 数据流，解释为什么不占内存 |
| ⭐⭐⭐⭐⭐ | Transform 自定义 | 能手写状态机驱动的 Transform，处理 boundary 跨 chunk |
| ⭐⭐⭐⭐⭐ | 计时攻击与防御 | 能解释 timingSafeEqual 原理，说出为什么普通比较不安全 |
| ⭐⭐⭐⭐⭐ | 滑动窗口限流 | 能手写实现，对比固定窗口的优劣 |
| ⭐⭐⭐⭐ | pipeline 错误传播 | 能说出任意一环出错如何传播到回调 |
| ⭐⭐⭐⭐ | EXDEV 处理 | 知道跨设备 rename 失败的 fallback |
| ⭐⭐⭐⭐ | multipart 字段顺序 | 能说出两阶段方案的必要性 |
| ⭐⭐⭐ | X-Forwarded-For | 知道反向代理场景的 IP 提取 |
| ⭐⭐⭐ | unref() | 知道定时器不阻止进程退出的原理 |

### 4.4 测试覆盖

Phase 4 新增测试用例（共 107 个测试全部通过）：

| 测试文件 | 用例数 | 覆盖点 |
|---|---|---|
| `test/multipartStreamParser.test.js` | 8 | 流式解析：字段、文件、多 part、boundary 跨 chunk |
| `test/auth.test.js` | 7 | 鉴权：无 token、错误 token、Header/Query、白名单 |
| `test/rateLimit.test.js` | 6 | 限流：放行、超限、429、响应头、IP 提取 |
| `test/api.test.js`（更新） | — | 流式上传集成测试、限流重置 |
| `test/middleware.test.js`（更新） | — | multipart 跳过 bodyParser 验证 |

---

> **一句话总结 Phase 4：** 通过实现流式 multipart 解析器（Transform + 状态机）、两阶段流式上传、API Token 鉴权（timingSafeEqual 防计时攻击）、IP 滑动窗口限流，深入掌握了自定义 Transform Stream、pipeline 错误传播、恒定时间比较、滑动窗口算法等生产级核心技术，将文件管理系统从"能用"提升到"可上线"的水平。
