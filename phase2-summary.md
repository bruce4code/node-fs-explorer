# Phase 2 学习总结：Web API 文件管理服务

## 目录
1. [学到的 Node.js 知识点](#一学到的-nodejs-知识点)
2. [我能做什么](#二我能做什么)
3. [能应付的面试题](#三能应付的面试题)
4. [扩展方向](#四扩展方向)

---

## 一、学到的 Node.js 知识点

### 1.1 http 模块 — 原生 HTTP 服务器

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `http.createServer(callback)` | 创建 HTTP 服务器，回调接收 `req` 和 `res` | `server/index.js:17` |
| `req.method` | HTTP 请求方法（GET / POST / PUT / DELETE / OPTIONS） | `server/router.js:30` |
| `req.url` | 请求的原始 URL 路径 | `server/router.js:28` |
| `req.headers` | 请求头对象（小写键名） | `server/middleware/bodyParser.js:18` |
| `res.writeHead(statusCode, headers)` | 设置响应状态码和头 | `server/controllers/fileController.js:18` |
| `res.end(data)` | 结束响应并发送数据 | `server/controllers/fileController.js:19` |
| `req.on('data', cb)` | 监听请求体数据到达事件（流式读取） | `server/middleware/bodyParser.js:14` |
| `req.on('end', cb)` | 监听请求体数据接收完毕事件 | `server/middleware/bodyParser.js:17` |

**核心原理：**

`req` 是一个 `IncomingMessage` 对象（继承自 `Readable Stream`），`res` 是一个 `ServerResponse` 对象（继承自 `Writable Stream`）。这意味着：

- 请求体是**流式**到达的，需要用 `data`/`end` 事件拼接收
- 响应体是**流式**写入的，可以用 `pipe` 将文件流直接导向响应

```js
const server = http.createServer((req, res) => {
  // req 是 Readable Stream
  // res 是 Writable Stream

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'hello' }));
});
```

### 1.2 URL 模块 — 请求路由解析

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `new URL(url, base)` | 解析 URL 为 URL 对象，提供 `pathname`、`searchParams` 等属性 | `server/router.js:28` |
| `url.pathname` | 获取请求路径（不含查询参数） | `server/router.js:29` |
| `url.searchParams` | URLSearchParams 对象，用于获取查询参数 | `server/router.js:30` |
| `Object.fromEntries(url.searchParams)` | 将查询参数转为普通对象 | `server/router.js:30` |

**`new URL()` 的两种用法：**

```js
// 解析完整 URL
new URL('http://localhost:3000/api/files?path=./test')

// 用 base URL 解析相对路径（必须传入 base）
new URL('/api/files?path=./test', 'http://localhost:3000')
```

**为什么需要 base URL？** 因为 `req.url` 只包含路径部分（如 `/api/files?path=./test`），没有协议和域名，必须提供 base URL 才能被 `new URL()` 正确解析。

### 1.3 请求体解析原理

**GET 请求：** 没有请求体，参数通过 URL 查询字符串传递（`?key=value`）。

**POST/PUT 请求：** 请求体在 `req` 流中，需要手动读取：

```js
// server/middleware/bodyParser.js
const chunks = [];
req.on('data', (chunk) => chunks.push(chunk));
req.on('end', () => {
  const rawBody = Buffer.concat(chunks);
  // 根据 Content-Type 解析
});
```

**支持的三种格式：**

| Content-Type | 解析方式 | 使用场景 |
|---|---|---|
| `application/json` | `JSON.parse(rawBody.toString())` | RESTful API 数据传输 |
| `application/x-www-form-urlencoded` | `new URLSearchParams(body)` | 传统表单提交 |
| `multipart/form-data` | 手动解析 boundary 分隔（见下文） | 文件上传 |

### 1.4 multipart/form-data 解析（零依赖）

**面试最高频考点之一：文件上传原理**

```http
POST /upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundary

------WebKitFormBoundary
Content-Disposition: form-data; name="file"; filename="test.txt"
Content-Type: text/plain

文件内容在这里
------WebKitFormBoundary
Content-Disposition: form-data; name="path"

./uploads
------WebKitFormBoundary--
```

**解析流程：**

1. 从 `Content-Type` header 提取 `boundary`（分隔符）
2. 用 `--boundary` 切分每个 part
3. 每个 part 内部：`header\r\n\r\ncontent`
4. 从 `Content-Disposition` 中提取 `name` 和 `filename`
5. 从 `Content-Type` 中提取文件类型
6. `--boundary--` 表示结束

**代码实现：** [lib/multipartParser.js](file:///Users/linruitao/Documents/100-study/211-nodejs/filesManageSystem/lib/multipartParser.js) 用纯 `Buffer` 操作完成解析，没有依赖任何第三方库。

### 1.5 Buffer 与二进制数据

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `Buffer.concat(list)` | 将多个 Buffer 数组合并为一个 | `server/middleware/bodyParser.js:20` |
| `Buffer.from(string)` | 从字符串创建 Buffer | `lib/multipartParser.js:12` |
| `Buffer.indexOf(needle)` | 在 Buffer 中查找子序列 | `lib/multipartParser.js:15` |
| `Buffer.slice(start, end)` | 截取 Buffer 片段 | `lib/multipartParser.js:35` |
| `Buffer.alloc(size)` | 创建指定大小的空 Buffer | `server/index.js:41` |

**Buffer 是 Node.js 处理二进制数据的核心**，文件操作、网络传输、加密等场景都离不开它。

```js
// Buffer 和字符串的相互转换
const buf = Buffer.from('你好', 'utf-8');  // 字符串 → Buffer
const str = buf.toString('utf-8');          // Buffer → 字符串
```

### 1.6 Stream 基础 — 文件下载

```js
// server/controllers/fileController.js
const readStream = require('fs').createReadStream(safePath);
readStream.pipe(res);
```

**Stream 的核心优势：** 不一次性加载整个文件到内存，而是边读边发。对于大文件下载（GB 级），不会导致内存溢出。

**`pipe` 的作用：** 将 `Readable Stream`（`createReadStream`）的数据自动导向 `Writable Stream`（`res`），并处理背压（backpressure）——当消费者速度慢于生产者时自动暂停读取。

### 1.7 CORS 跨域

```js
// server/middleware/cors.js
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

// OPTIONS 预检请求直接返回 204
if (req.method === 'OPTIONS') {
  res.writeHead(204);
  res.end();
}
```

**CORS 流程：**

1. 浏览器发送**预检请求**（OPTIONS），询问服务器是否允许跨域
2. 服务器返回允许的源、方法、头
3. 浏览器确认允许后，才发送真正的请求

### 1.8 优雅关闭

```js
// server/index.js
function gracefulShutdown(signal) {
  logger.info(`收到 ${signal} 信号，正在关闭服务...`);
  server.close(() => {
    logger.info('服务已关闭');
    process.exit(0);
  });
  // 5 秒后强制退出
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
```

**为什么需要优雅关闭？**
- 停止接受新连接
- 处理完正在处理的请求
- 关闭数据库连接、清理临时文件
- 然后才退出进程

### 1.9 架构设计模式

**中间件模式（Middleware Pattern）：**

```
请求 → CORS 中间件 → BodyParser 中间件 → 路由分发 → Controller
```

每个中间件处理一个横切关注点，职责单一，可插拔：

```js
// server/index.js - 中间件链
// 1. CORS（所有请求都需要）
cors(req, res);

// 2. 解析请求体（非 GET/HEAD 需要）
await bodyParser(req);

// 3. 路由分发
await router.handle(req, res);
```

**三层架构在 Web 版本中的延续：**

```
server/routes/index.js            → 路由层（URL 映射）
server/controllers/fileController.js → 控制器层（处理请求/响应）
core/fileService.js               → 业务层（核心逻辑）
```

### 1.10 环境变量配置

```js
const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
```

- `process.env` 获取环境变量
- 12-Factor App 的配置管理方式
- 开发/生产环境通过环境变量区分

---

## 二、我能做什么

### 2.1 完整的 RESTful API 服务

| 方法 | 路径 | 功能 | 请求示例 |
|---|---|---|---|
| GET | `/api/files` | 浏览目录 | `?path=./cli` |
| GET | `/api/files/info` | 文件详情 | `?path=package.json` |
| GET | `/api/files/download` | 下载文件 | `?path=test.txt` |
| POST | `/api/files/upload` | 上传文件 | multipart: `file` + `path` |
| POST | `/api/files/mkdir` | 创建目录 | JSON: `{"path":"demo"}` |
| DELETE | `/api/files` | 删除文件/目录 | `?path=demo` |
| PUT | `/api/files/move` | 移动/重命名 | JSON: `{"src":"a","dst":"b"}` |

### 2.2 扩展能力（基于已学知识）

- **图床服务**：上传图片 + 生成 URL + 访问控制
- **在线代码编辑器后端**：文件 CRUD + 目录树
- **静态文件服务器**：`fs.createReadStream` + MIME 类型
- **简单的 CMS 系统**：文件管理 + 分类
- **WebDAV 兼容服务**：基于 HTTP 的远程文件管理协议
- **文件分享服务**：上传 → 生成分享链接 → 限时/限次访问

---

## 三、能应付的面试题

### 3.1 HTTP 模块题

**Q1：`http.createServer` 的 `req` 和 `res` 分别是什么？**
- `req` 是 `http.IncomingMessage`，继承自 `Readable Stream`，包含请求方法、URL、头、体
- `res` 是 `http.ServerResponse`，继承自 `Writable Stream`，用于设置响应状态码、头、体
- 两者都是 Stream，这是理解 Node.js HTTP 的关键

**Q2：`res.end()` 和 `res.write()` 的区别？**
- `res.write(data)` 写入响应体的一部分，可多次调用
- `res.end(data)` 结束响应，最后一次发送数据
- 必须先调用 `writeHead` 或 `setHeader` 设置头，再调用 `write`/`end`

**Q3：如何处理 HTTP 请求体？**
- GET 请求体不存在，参数通过 URL 查询字符串传递
- POST/PUT 用 `req.on('data')` 拼接收 Buffer，`req.on('end')` 完成后解析
- 根据 `Content-Type` 选择合适的解析方式

### 3.2 路由设计题

**Q4：如何实现一个简单的路由系统？**
- 维护一个 `{ method, path, handler }` 数组
- 请求到来时遍历匹配 `method + pathname`
- 匹配则执行 handler，不匹配返回 404
- 匹配规则可以扩展支持参数化路径如 `/api/files/:id`

**Q5：RESTful API 设计原则？**
- 资源用名词复数：`/api/files`
- 操作通过 HTTP 方法表达：GET 查、POST 增、PUT 改、DELETE 删
- 查询参数用于过滤和排序：`?path=xxx`
- 统一响应格式：`{ success: true, data: ... }` 或 `{ success: false, error: ... }`

### 3.3 文件上传题

**Q6：multipart/form-data 上传的原理？**
- 用 `boundary` 分隔符将请求体分成多个 part
- 每个 part 包含 `Content-Disposition`（name + filename）和 `Content-Type`
- 手动解析需要：找到 boundary → 切分 part → 解析 header → 提取数据
- `--boundary--` 表示结束

**Q7：如何处理大文件上传？**
- 不能一次性 `Buffer.concat`，会内存溢出
- 用流式解析：边接收边写入磁盘（`busboy`/`formidable` 库的做法）
- 设置上传大小限制，防止恶意攻击
- 分片上传：大文件切成多个小块，服务端合并

### 3.4 Stream 题

**Q8：什么是 Stream？有哪几种类型？**
- Stream 是 Node.js 处理流式数据的抽象接口
- 四种类型：
  - `Readable` — 可读（`fs.createReadStream`、`req`）
  - `Writable` — 可写（`fs.createWriteStream`、`res`）
  - `Duplex` — 可读可写（`net.Socket`）
  - `Transform` — 转换（`zlib.createGzip`）

**Q9：什么是背压（Backpressure）？**
- 当消费者处理速度慢于生产者时，数据堆积
- `pipe` 自动处理背压：`Readable.pipe(Writable)` 内部监听 `drain` 事件
- 手动处理：`readable.read()` 配合 `highWaterMark` 控制缓冲区大小

### 3.5 Buffer 题

**Q10：Buffer 和普通数组的区别？**
- Buffer 是固定长度的二进制数据容器，分配在堆外内存
- 元素是 0-255 的整数（一个字节）
- 提供高效的二进制操作方法（slice、indexOf、concat）
- 不能像数组一样动态扩容

**Q11：Buffer 的编码方式有哪些？**
- `utf-8`、`utf16le`、`latin1`、`base64`、`hex`、`ascii`
- 默认是 `utf-8`
- `base64` 常用于图片作为字符串传输

### 3.6 CORS 题

**Q12：什么是跨域？什么是 CORS？**
- 跨域：不同源（协议+域名+端口）之间的请求被浏览器限制
- CORS（Cross-Origin Resource Sharing）：服务器通过 HTTP 头告知浏览器允许跨域
- 简单请求：直接发送，服务器返回 `Access-Control-Allow-Origin`
- 预检请求：OPTIONS 方法，浏览器先问服务器是否允许

### 3.7 错误处理题

**Q13：Node.js 服务器如何处理未捕获的异常？**
- 为 `process.on('uncaughtException')` 和 `process.on('unhandledRejection')` 注册监听器
- 记录错误日志后优雅退出（建议），因为进程可能处于不稳定状态
- 使用 PM2 等进程管理工具自动重启

**Q14：优雅关闭（Graceful Shutdown）怎么做？**
- 监听 `SIGINT`（Ctrl+C）和 `SIGTERM`（kill）
- 调用 `server.close()` 停止接受新连接
- 等待正在处理的请求完成
- 清理资源后 `process.exit(0)`

### 3.8 架构设计题

**Q15：中间件模式的好处？**
- 横切关注点分离：认证、日志、CORS、解析器等独立维护
- 可插拔：需要时加入，不需要时移除
- 请求处理管道：每个中间件可以决定是否传递给下一个

**Q16：为什么把 core 层和 server 层分开？**
- core 层（`fileService`）只关心文件操作，不关心 HTTP 细节
- server 层（`controller`）只关心 HTTP 请求/响应处理
- 好处：core 层可以被 CLI 和 Web 版本共享，便于测试

---

## 四、扩展方向

### 4.1 Phase 3 进阶方向

| 方向 | 知识点 | 面试价值 |
|---|---|---|
| **Stream 深度应用** | 大文件分片上传、断点续传、进度通知 | ⭐⭐⭐⭐⭐ |
| **EventEmitter 事件系统** | 操作日志、进度事件、WebSocket 通知 | ⭐⭐⭐⭐⭐ |
| **crypto 加密模块** | 文件哈希（MD5/SHA1）、签名验证、文件去重 | ⭐⭐⭐⭐ |
| **Cluster 多进程** | 利用多核 CPU 并行处理请求 | ⭐⭐⭐⭐ |
| **HTTPS 与安全** | TLS/SSL 证书、HTTPS 服务器 | ⭐⭐⭐⭐ |
| **文件系统监控** | `fs.watch` / `fs.watchFile` 实时监控文件变化 | ⭐⭐⭐ |
| **WebSocket** | 实时文件变更推送 | ⭐⭐⭐⭐ |

### 4.2 性能优化方向

| 优化点 | 当前问题 | 改进方案 |
|---|---|---|
| 请求体解析 | 小文件没问题，大文件 `Buffer.concat` 占用内存 | 流式解析（边读边写磁盘） |
| 目录列表 | 每次重新读取磁盘 | 加缓存 + 监听文件变更刷新 |
| 大量并发 | 单线程处理所有请求 | Cluster 多进程 + 负载均衡 |
| 文件下载 | 已用 Stream，但大文件可优化 | Range 请求支持断点续传 |

### 4.3 面试冲刺建议

完成 Phase 2 后，你已经覆盖了 80% 的 Node.js 后端面试题。按优先级准备：

1. **Stream 原理**（最高频）— 四种类型、背压、pipe 机制
2. **Buffer 与二进制** — 编码转换、二进制操作
3. **HTTP 协议** — 请求/响应模型、CORS、RESTful
4. **文件上传原理** — multipart 解析、form-data 格式
5. **事件循环** — 宏任务/微任务、process.nextTick、setImmediate
6. **错误处理与优雅关闭** — 生产环境必备知识

### 4.4 实战项目扩展

基于当前项目可继续扩展的实战项目：

- **文件分享系统**：上传 → 生成链接 → 密码保护 → 过期时间
- **在线 Markdown 编辑器**：目录树 + 文件编辑 + 实时预览
- **图片管理服务**：上传 → 压缩 → 缩略图 → CDN 分发
- **配置管理中心**：JSON/YAML 配置文件的 CRUD + 版本管理
- **日志收集系统**：多文件日志的实时 tail + 搜索 + 下载

---

> **一句话总结 Phase 2：** 通过构建 RESTful Web API 服务，掌握了 Node.js 最核心的 `http` 模块、URL 路由、请求体解析、文件上传原理、Stream 流式传输、CORS 跨域等关键知识，覆盖了 Node.js 后端面试的 80% 高频考点。