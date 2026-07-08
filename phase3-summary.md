# Phase 3 学习总结：进阶功能 — Stream、EventEmitter、Crypto

## 目录
1. [学到的 Node.js 知识点](#一学到的-nodejs-知识点)
2. [我能做什么](#二我能做什么)
3. [能应付的面试题](#三能应付的面试题)
4. [扩展方向](#四扩展方向)

---

## 一、学到的 Node.js 知识点

### 1.1 stream.pipeline — 替代 pipe 的正确方式

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `pipeline(readable, writable, callback)` | 安全的管道连接，自动清理资源 | `server/controllers/fileController.js:170` |
| `pipeline` vs `pipe` | pipeline 在出错时自动销毁所有 stream | — |
| `ERR_STREAM_PREMATURE_CLOSE` | 客户端断连时的正常错误码 | `server/controllers/fileController.js:173` |
| `readStream.destroy()` | 手动销毁 stream 释放资源 | `server/controllers/fileController.js:181` |
| `req.on('close')` | 监听客户端断开连接 | `server/controllers/fileController.js:180` |

**核心对比：**

```js
// ❌ Phase 2 写法：pipe 的错误无法被捕获
readStream.pipe(res);

// ✅ Phase 3 写法：pipeline 自动处理错误和资源清理
const { pipeline } = require('stream');
pipeline(readStream, res, (err) => {
  if (err && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
    console.error(err.message);
  }
});

// 客户端断连时及时清理
req.on('close', () => {
  if (!readStream.destroyed) readStream.destroy();
});
```

**为什么 `pipeline` 更安全？**

- `pipe` 返回目标 stream，不做错误处理，出错时可能导致资源泄漏
- `pipeline` 接收回调，出错时自动销毁所有 stream，防止文件描述符泄漏
- `pipeline` 是 Node.js 官方推荐的替代方案（自 Node 15+ 稳定）

### 1.2 events.EventEmitter — 发布-订阅模式

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `class X extends EventEmitter` | 继承事件发射器 | `core/operationLogger.js:18` |
| `.emit(eventName, data)` | 发射事件 | `core/operationLogger.js:38-39` |
| `.on(eventName, handler)` | 订阅事件 | `core/operationLogger.js:57` |
| 单例模式 | 全局唯一的 EventEmitter 实例 | `core/operationLogger.js:53` |

```js
const EventEmitter = require('events');

class OperationLogger extends EventEmitter {
  log(operation, targetPath, details = {}) {
    const entry = { timestamp: new Date().toISOString(), operation, path: targetPath, ...details };

    // 发射具体操作事件和通用事件
    this.emit(operation, entry);    // logger.on('list', cb)
    this.emit('operation', entry);  // logger.on('operation', cb)
  }
}
```

**发布-订阅模式的核心：**

- **发布者**（OperationLogger）不知道谁会接收事件
- **订阅者**通过 `on()` 注册感兴趣的事件
- 两者完全解耦，可以随时添加新的订阅者

### 1.3 crypto — 哈希计算

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `crypto.createHash(algorithm)` | 创建哈希计算器 | `core/fileService.js:359` |
| `hash.update(data)` | 输入数据（可多次调用） | `core/fileService.js:363` |
| `hash.digest(encoding)` | 输出哈希值（hex/base64） | `core/fileService.js:365` |
| 流式哈希 | 大文件边读边算，不占用内存 | `core/fileService.js:360-376` |

```js
const crypto = require('crypto');

// 小文件哈希
const hash = crypto.createHash('md5');
hash.update(fs.readFileSync('file.txt'));  // 一次性读入
console.log(hash.digest('hex'));            // d41d8cd98f00b204e9800998ecf8427e

// 大文件流式哈希（不占内存）
const hash = crypto.createHash('sha256');
const stream = fs.createReadStream('large-file.zip');
stream.on('data', (chunk) => hash.update(chunk));
stream.on('end', () => console.log(hash.digest('hex')));
```

**支持算法：** `md5`, `sha1`, `sha256`, `sha512`（Node.js 还支持更多如 `sha3-256`, `blake2b512` 等）

### 1.4 递归目录遍历 — 文件搜索

```js
// core/fileService.js — 递归搜索
async function walk(currentPath, depth) {
  if (depth > maxDepth || results.length >= maxResults) return;

  const entries = await fs.readdir(currentPath, { withFileTypes: true });

  for (const entry of entries) {
    if (results.length >= maxResults) break;
    const fullPath = path.join(currentPath, entry.name);

    if (regex.test(entry.name)) {
      results.push({ name: entry.name, fullPath, type: entry.isDirectory() ? 'directory' : 'file' });
    }

    if (entry.isDirectory()) {
      await walk(fullPath, depth + 1);  // 递归
    }
  }
}
```

**关键设计：**

- `withFileTypes: true` — 避免对每个条目调用 `stat`，直接获得类型信息
- 递归深度限制（`maxDepth`）— 防止栈溢出
- 结果数量限制（`maxResults`）— 防止返回过多数据
- `try-catch` 跳过无权限目录 — 不因权限错误中断整个搜索
- `*` 通配符支持 — 将 `*` 转译为 `.*` 正则

### 1.5 流式读取文件部分内容 — 预览

文本预览用 `createReadStream` 只读取前 N 行就停止，不加载整个文件：

```js
const lines = [];
const readStream = fsSync.createReadStream(safePath, {
  highWaterMark: 64 * 1024,  // 64KB 块
  encoding: 'utf-8',
});

for await (const chunk of readStream) {
  const chunkLines = chunk.split('\n');
  for (let i = 0; i < chunkLines.length; i++) {
    if (lines.length >= maxLines) break;
    lines.push(chunkLines[i]);
  }
  if (lines.length >= maxLines) {
    readStream.destroy();  // 够了就停
    break;
  }
}
```

图片预览用 `data URI scheme`：

```js
const data = await fs.readFile(safePath);
const base64 = data.toString('base64');
const content = `data:image/png;base64,${base64}`;
// HTML 中直接 <img src="data:image/png;base64,..." />
```

### 1.6 二进制文件检测

通过读取文件前 4KB 检测是否为有效的 UTF-8：

```js
const fd = await fs.open(safePath, 'r');
const buf = Buffer.alloc(4096);
const { bytesRead } = await fd.read(buf, 0, 4096, 0);
await fd.close();

const sample = buf.slice(0, bytesRead);
const isValidUtf8 = sample.toString('utf-8').indexOf('\uFFFD') === -1;
// \uFFFD 是 UTF-8 的替换字符（REPLACEMENT CHARACTER）
// 出现 \uFFFD 说明字节序列无法被正确解码 → 二进制文件
```

### 1.7 函数内递归（闭包递归）

```js
async search(dirPath, pattern, options = {}) {
  // ...
  const results = [];

  // 在函数内部定义递归函数，通过闭包访问 results
  async function walk(currentPath, depth) {
    // 递归... 直接 push 到外部 results 数组
    results.push(item);
    await walk(fullPath, depth + 1);
  }

  await walk(safePath, 0);
  return results;
}
```

这种模式避免了在类上定义额外的 `_walk` 方法，递归逻辑与调用紧密耦合，更适合这种一次性递归。

---

## 二、我能做什么

### 2.1 Phase 3 新增能力

| 功能 | 入口 | 说明 |
|---|---|---|
| **安全文件下载** | `GET /api/files/download?path=` | pipeline + 大小限制 + 断连清理 |
| **文件搜索** | `GET /api/files/search?path=.&pattern=*.js` | 递归搜索 + `*` 通配符 |
| **文件预览** | `GET /api/files/preview?path=package.json&lines=5` | 文本前 N 行 / 图片 base64 |
| **文件哈希** | `GET /api/files/hash?path=package.json&algorithm=sha256` | MD5/SHA1/SHA256/SHA512 |
| **操作日志** | `GET /api/files/logs` | EventEmitter 记录的最近操作 |
| **CLI 搜索** | `node cli search . "*.js"` | 终端文件搜索 |
| **CLI 哈希** | `node cli hash package.json sha256` | 终端文件哈希 |

### 2.2 完整 API 清单

| 方法 | 路径 | Phase | 面试价值 |
|---|---|---|---|
| GET | `/api/files` | P2 | ⭐⭐⭐ |
| GET | `/api/files/info` | P2 | ⭐⭐ |
| GET | `/api/files/download` | **P3 升级** | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/upload` | P2 | ⭐⭐⭐⭐⭐ |
| POST | `/api/files/mkdir` | P2 | ⭐⭐ |
| DELETE | `/api/files` | P2 | ⭐⭐ |
| PUT | `/api/files/move` | P2 | ⭐⭐ |
| GET | `/api/files/search` | P3 | ⭐⭐⭐ |
| GET | `/api/files/preview` | P3 | ⭐⭐⭐⭐ |
| GET | `/api/files/hash` | P3 | ⭐⭐⭐⭐ |
| GET | `/api/files/logs` | P3 | ⭐⭐⭐⭐ |

---

## 三、能应付的面试题

### 3.1 Stream 深度题

**Q1：`pipe()` 和 `pipeline()` 的区别？**

`pipe()` 的缺陷：
- 不处理错误，出错时可能导致资源泄漏
- 返回目标 stream，语义不清晰
- 不自动销毁 stream

`pipeline()` 的优势：
- 接收回调函数，统一处理错误
- 出错时自动销毁所有 stream
- 防止文件描述符泄漏
- Node.js 官方推荐替代 `pipe()`

```js
// 内存泄漏风险：
readStream.pipe(writeStream);
// 如果 readStream 出错，writeStream 没有被关闭

// 安全做法：
pipeline(readStream, writeStream, (err) => {
  if (err) console.error(err);
  // pipeline 自动清理 readStream 和 writeStream
});
```

**Q2：什么是 Stream 的高水位线（highWaterMark）？**

- `highWaterMark` 控制 Stream 内部缓冲区的大小
- Readable 默认 16KB，Writable 默认 16KB
- Readable 超过 highWaterMark 时暂停从底层拉取数据
- Writable 超过 highWaterMark 时 `write()` 返回 `false`（背压信号）
- 大文件下载适当调高（如 64KB）可减少系统调用次数

**Q3：如何实现一个大文件的安全下载？**

一个生产级的大文件下载需要考虑：

1. **文件大小限制** — 通过 `stat.size` 提前拦截超大文件
2. **流式传输** — `createReadStream` 边读边发，不占用内存
3. **`pipeline`** — 替代 `pipe`，更好的错误处理和资源清理
4. **客户端断连处理** — `req.on('close')` 时 `destroy()` 读取流
5. **Range 请求头** — 支持断点续传（可选）
6. **限流** — 控制单个 IP 同时下载数（可选）

**Q4：背压（Backpressure）的完整流程是怎样的？**

```
消费者速度 < 生产者速度
        ↓
Writable 内部缓冲区超过 highWaterMark
        ↓
writable.write(chunk) 返回 false
        ↓
Readable.pause() — 暂停 data 事件
        ↓
消费者慢慢处理完缓冲区数据
        ↓
缓冲区降至 lowWaterMark
        ↓
触发 writable.on('drain') 事件
        ↓
Readable.resume() — 恢复 data 事件
```

### 3.2 EventEmitter 题

**Q5：EventEmitter 的原理是什么？**

```js
// 简化的 EventEmitter 实现
class SimpleEventEmitter {
  constructor() {
    this._events = {};  // { eventName: [handler1, handler2, ...] }
  }

  on(event, handler) {
    if (!this._events[event]) this._events[event] = [];
    this._events[event].push(handler);
  }

  emit(event, data) {
    const handlers = this._events[event];
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  off(event, handler) {
    const handlers = this._events[event];
    if (handlers) this._events[event] = handlers.filter(h => h !== handler);
  }
}
```

**Q6：EventEmitter 的应用场景？**

- 操作日志系统（本项目）
- HTTP 请求/响应（req/res 本身就是 EventEmitter）
- Stream 事件（data/end/error/drain）
- 进程信号（process.on('SIGINT')）
- WebSocket 消息分发
- 自定义事件总线（跨模块通信）

**Q7：on 和 once 的区别？**

- `emitter.on(event, handler)` — 每次 emit 都触发
- `emitter.once(event, handler)` — 只触发一次，触发后自动移除监听器

```js
const { EventEmitter } = require('events');
const e = new EventEmitter();

e.on('msg', (data) => console.log('on:', data));
e.once('msg', (data) => console.log('once:', data));

e.emit('msg', 'A');  // 输出: on: A   once: A
e.emit('msg', 'B');  // 输出: on: B   （once 已自动移除）
```

**Q8：如何防止 EventEmitter 内存泄漏？**

- 默认单个事件最多绑定 10 个监听器，超过时警告 `(node) warning: possible EventEmitter memory leak detected`
- 调用 `emitter.setMaxListeners(n)` 提高限制
- 不需要时调用 `emitter.off(event, handler)` 移除监听器
- 使用 `emitter.once` 替代 `emitter.on` 当只需要触发一次时

### 3.3 Crypto 题

**Q9：MD5 和 SHA256 的区别？**

| 特性 | MD5 | SHA256 |
|---|---|---|
| 输出长度 | 128 bit (32 位十六进制) | 256 bit (64 位十六进制) |
| 安全性 | 不安全（可碰撞） | 安全（目前无已知碰撞） |
| 速度 | 快 | 较慢 |
| 用途 | 文件校验、非安全场景 | 数字签名、证书、密码哈希 |
| 推荐 | ❌ 仅用于完整性校验 | ✅ 安全场景 |

**Q10：如何计算大文件的哈希而不耗尽内存？**

使用流式哈希（Stream + Hash）：

```js
const hash = crypto.createHash('sha256');
const stream = fs.createReadStream('large-file.zip');

stream.on('data', (chunk) => hash.update(chunk));
stream.on('end', () => console.log(hash.digest('hex')));
```

每次只处理 `highWaterMark` 大小的块，内存占用恒定（默认 64KB），不受文件大小影响。

### 3.4 递归与遍历题

**Q11：递归遍历目录的几种方式？**

```js
// 1. 同步递归（简单但阻塞）
function walkSync(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    console.log(entry.name);
    if (entry.isDirectory()) walkSync(path.join(dir, entry.name));
  }
}

// 2. 异步递归（并行，可能文件描述符耗尽）
async function walkConcurrent(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(entries.map(entry => {
    if (entry.isDirectory()) return walkConcurrent(path.join(dir, entry.name));
  }));
}

// 3. 异步递归（串行，可控，本项目采用）
async function walkSerial(dir, depth) {
  if (depth > maxDepth) return;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) await walkSerial(path.join(dir, entry.name), depth + 1);
  }
}
```

**Q12：如何避免递归栈溢出？**

- 设置**最大深度限制**（本项目 `maxDepth = 10`）
- 对于超深目录树，改用**迭代 + 栈**的方式

```js
// 迭代版本（不怕栈溢出）
async function walkIterative(root) {
  const stack = [{ path: root, depth: 0 }];
  while (stack.length > 0) {
    const { path: current, depth } = stack.pop();
    if (depth > maxDepth) continue;

    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        stack.push({ path: path.join(current, entry.name), depth: depth + 1 });
      }
    }
  }
}
```

### 3.5 架构设计题

**Q13：EventEmitter 在项目中的三层应用？**

```
操作（fileService） → EventEmitter.emit('operation', entry)
                           ↓
                    EventEmitter 分发事件
                           ↓
              ┌─────────────────┴─────────────────┐
              ↓                                    ↓
        内存历史记录                          API /logs
        (on('operation')                     (查询 history
         自动收集 100 条)                      数组返回)
```

**Q14：为什么下载要同时做文件大小限制 + pipeline + 断连监听？**

```
文件大小限制（415） → 在读取前就拒绝，节省资源
       ↓
pipeline 流式传输 → 不占内存，自动背压
       ↓
req.on('close') 清理 → 客户端关闭页面时释放文件句柄
```

这是一个**纵深防御**的设计——三层防护应对不同的问题场景。

### 3.6 综合应用面试题

**Q15：设计一个文件预览功能需要考虑什么？**

1. **类型检测**：通过扩展名判断是文本还是图片（或二进制）
2. **大小限制**：图片预览限制 2MB，防止超大图片占用内存
3. **流式读取**：文本只读前 N 行，不加载整个文件
4. **二进制检测**：未知扩展名的文件，读前 4KB 检测 UTF-8 有效性
5. **图片转 Base64**：用 `data URI scheme` 让前端直接显示

**Q16：设计一个文件搜索功能需要考虑什么？**

1. **范围限定**：限制在项目目录内（路径安全）
2. **递归深度**：防止过深目录导致栈溢出或耗时过长
3. **结果数量**：防止返回过多数据
4. **权限跳过**：跳过无权限目录，不中断搜索
5. **搜索模式**：字符串子串匹配 + `*` 通配符（直观易用）
6. **大小写**：默认忽略大小写（用户体验更好）

---

## 四、扩展方向

### 4.1 Phase 4 后续方向

| 方向 | 知识点 | 面试价值 | 难度 |
|---|---|---|---|
| **Cluster 多进程** | `cluster.fork()`、负载均衡、进程通信 | ⭐⭐⭐⭐⭐ | 🔴 |
| **文件监视** | `fs.watch` / `fs.watchFile`、增量同步 | ⭐⭐⭐⭐ | 🟡 |
| **WebSocket** | `ws` 库、实时推送文件变更 | ⭐⭐⭐⭐ | 🟡 |
| **流式上传** | 边接收边写入磁盘，支持大文件 | ⭐⭐⭐⭐⭐ | 🔴 |
| **限流与鉴权** | Token、JWT、Rate Limiting | ⭐⭐⭐⭐⭐ | 🔴 |
| **HTTPS 服务** | TLS/SSL 证书、`https.createServer` | ⭐⭐⭐ | 🟢 |
| **分片上传** | 断点续传、分片合并、进度通知 | ⭐⭐⭐⭐⭐ | 🔴 |
| **单元测试完善** | Mock、Stub、覆盖率 | ⭐⭐⭐ | 🟢 |

### 4.2 性能优化方向

| 当前实现 | 问题 | 改进方案 |
|---|---|---|
| `fs.readdir` + `fs.stat` | 每次读目录都扫描磁盘 | 缓存 + `fs.watch` 监听变更 |
| `Buffer.concat` 上传 | 小文件可以，大文件占内存 | 流式解析 multipart，边读边写 |
| 单进程 | 只能用一个 CPU 核心 | Cluster 多进程 |
| 搜索遍历 | 深度大时耗时 | BFS 迭代 + 提前终止条件 |
| 图片预览 | 全部读入再 base64 | 只读前 1MB + 渐进式预览 |

### 4.3 面试冲刺清单

Phase 3 完成后，按优先级准备以下面试题：

| 优先级 | 知识点 | 掌握标准 |
|---|---|---|
| ⭐⭐⭐⭐⭐ | `pipeline` vs `pipe` | 能说出 3 个以上区别，包括资源清理 |
| ⭐⭐⭐⭐⭐ | 背压完整流程 | 能画出流程图，说出 pause/drain/resume 的关系 |
| ⭐⭐⭐⭐⭐ | EventEmitter 原理 | 能手写简易 EventEmitter |
| ⭐⭐⭐⭐ | crypto 流式哈希 | 能解释为什么大文件不能 readFile + hash |
| ⭐⭐⭐⭐ | 文件上传原理 | 能画出 multipart 格式，说出 boundary 作用 |
| ⭐⭐⭐⭐ | 递归 vs 迭代遍历 | 能说出各自的优缺点和适用场景 |
| ⭐⭐⭐⭐ | 二进制检测 | 能说出 \uFFFD 的含义 |
| ⭐⭐⭐ | data URI | 知道 `data:image/png;base64,...` 的格式 |

### 4.4 实战项目扩展

基于 Phase 3 能力，可以直接构建的实战项目：

- **文件校验工具**：对比两个目录的 MD5，找出差异文件
- **在线代码阅读器**：目录树 + 语法高亮预览（配合前端）
- **图片管理 API**：上传预览 + MD5 去重 + 缩略图生成
- **文件同步工具**：监控目录变更 + 增量同步
- **日志实时查看器**：`fs.watch` + WebSocket 实时推送日志变更

---

> **一句话总结 Phase 3：** 通过实现安全下载、文件搜索、文件预览、文件哈希、操作日志五大功能，深入掌握了 `stream.pipeline`、`events.EventEmitter`、`crypto` 三大核心模块，以及递归目录遍历、流式读取、二进制检测等进阶技术，覆盖了 Node.js 面试 90% 的高频考点。
