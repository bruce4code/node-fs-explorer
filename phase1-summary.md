# Phase 1 学习总结：CLI 文件管理系统

## 目录
1. [学到的 Node.js 知识点](#一学到的-nodejs-知识点)
2. [我能做什么](#二我能做什么)
3. [能应付的面试题](#三能应付的面试题)
4. [扩展方向](#四扩展方向)

---

## 一、学到的 Node.js 知识点

### 1.1 Node.js 模块系统（CommonJS）

| 知识点 | 说明 | 代码位置 |
|---|---|---|
| `require` 加载机制 | Node.js 按同步方式加载模块，会缓存已加载的模块 | `cli/index.js:15-22` |
| `module.exports` | 导出模块接口，可以是对象、函数、类 | 各命令文件末尾 |
| 目录作为模块 | `require('./cli')` 自动查找 `cli/index.js` | 项目入口 |
| `__dirname` | 当前模块文件所在目录的绝对路径 | `core/pathValidator.js:8` |
| `require` 路径解析 | 相对路径 `./`、`../` 的查找规则 | 各文件头部 |

**面试相关：**
- `require` 和 `import` 的区别？—— CommonJS 是同步加载、运行时加载、值拷贝；ESM 是异步加载、编译时加载、值引用
- Node.js 模块查找策略？—— 内置模块 → `node_modules` → 逐级向上查找 → NODE_PATH
- 循环引用如何处理？—— CommonJS 返回未完成的 `module.exports` 的当前状态

### 1.2 fs 文件系统模块

**Phase 1 用到的 API：**

| API | 同步/异步 | 用途 |
|---|---|---|
| `fs.promises.readdir(path, { withFileTypes: true })` | Promise | 读取目录，返回 `fs.Dirent` 对象（可直接判断类型） |
| `fs.promises.readFile(path, 'utf-8')` | Promise | 读取文件内容 |
| `fs.promises.writeFile(path, content, 'utf-8')` | Promise | 写入文件内容 |
| `fs.promises.mkdir(path, { recursive: true })` | Promise | 创建目录（递归创建） |
| `fs.promises.copyFile(src, dst)` | Promise | 复制文件 |
| `fs.promises.rm(path, { recursive: true, force: true })` | Promise | 删除文件或目录（递归删除） |
| `fs.promises.unlink(path)` | Promise | 删除单个文件 |
| `fs.promises.stat(path)` | Promise | 获取文件/目录的 Stats 信息 |
| `fs.existsSync(path)` | 同步 | 检查路径是否存在（没有 Promise 版本） |

**核心知识点：**

- **三种 API 风格**：
  - 回调风格：`fs.readFile(path, cb)` — 回调地狱风险
  - 同步风格：`fs.readFileSync(path)` — 阻塞事件循环
  - Promise 风格：`fs.promises.readFile(path)` — 可 await，推荐

  ```js
  // 回调风格（旧）
  fs.readFile('a.txt', (err, data) => { if (err) throw err; });

  // 同步风格（阻塞）
  const data = fs.readFileSync('a.txt');

  // Promise 风格（推荐）
  const data = await fs.promises.readFile('a.txt', 'utf-8');
  ```

- **`fs.Dirent`**：`readdir` 的 `withFileTypes: true` 选项，返回 `fs.Dirent` 对象，提供 `isDirectory()`、`isFile()`、`isSymbolicLink()` 等方法，避免对每个条目额外调用 `stat`

- **`recursive: true`**：`mkdir` 和 `rm` 的递归选项，允许创建/删除多级嵌套目录

- **文件元数据**：`fs.Stats` 提供 `size`、`birthtime`、`mtime`、`atime`、`mode`（权限）等信息

**面试相关：**
- 三种 API 的应用场景？—— CLI 工具可用同步；服务器用 Promise/回调
- `withFileTypes: true` 的作用？—— 避免 N+1 次 `stat` 调用
- 如何实现递归删除目录？—— Node 14+ 用 `fs.rm(path, { recursive: true })`，之前用 `rimraf` 库

### 1.3 path 路径模块

| API | 作用 | 示例 |
|---|---|---|
| `path.resolve([...paths])` | 解析为绝对路径（从右往左，遇到绝对路径停止） | `resolve('/a', 'b', 'c')` → `/a/b/c` |
| `path.join([...paths])` | 拼接路径片段（使用平台分隔符） | `join('/a', '/b')` → `/a/b` |
| `path.basename(path)` | 获取文件名 | `basename('/a/b/c.js')` → `c.js` |
| `path.dirname(path)` | 获取目录名 | `dirname('/a/b/c.js')` → `/a/b` |
| `path.relative(from, to)` | 获取相对路径 | `relative('/a/b', '/a/c')` → `../c` |

**关键区别 `resolve` vs `join`：**

```js
// resolve：处理绝对路径，从右向左构建
path.resolve('/a', 'b')      → '/a/b'
path.resolve('/a', '/b')     → '/b'     // 遇到绝对路径就停
path.resolve('a', 'b')       → '/cwd/a/b'

// join：只是拼接，用平台分隔符连接
path.join('/a', '/b')        → '/a/b'   // 不会重置
path.join('a', '..', 'b')    → 'b'      // 处理 ..
```

**安全应用：** `path.resolve(PROJECT_ROOT, userInput)` 后检查是否以 `PROJECT_ROOT` 开头，防止路径穿越攻击。

**面试相关：**
- `path.resolve` 和 `path.join` 的底层区别？—— resolve 会处理绝对路径并基于 `cwd` 计算；join 单纯拼接
- 跨平台路径问题？—— Windows 用 `\`，POSIX 用 `/`，`path` 模块自动处理

### 1.4 process 进程模块

| API | 用途 |
|---|---|
| `process.argv` | 获取命令行参数数组（前两个是 node 路径和脚本路径） |
| `process.exit(code)` | 退出进程，0 成功，非 0 失败 |
| `process.cwd()` | 获取当前工作目录 |
| `process.stdout` | 标准输出流 |
| `process.stdin` | 标准输入流 |

**`process.argv` 结构：**

```js
// node cli/index.js list test
// process.argv = [
//   '/usr/local/bin/node',    // Node.js 执行路径
//   '/path/to/cli/index.js',  // 脚本路径
//   'list',                   // 第一个参数
//   'test'                    // 第二个参数
// ]
```

**面试相关：**
- 如何解析复杂命令行参数？—— 简单用 `process.argv.slice(2)`，复杂用 `commander`/`yargs` 库
- `process.cwd()` 和 `__dirname` 的区别？—— `cwd()` 是执行命令时所在的目录，`__dirname` 是代码文件所在的目录

### 1.5 readline 交互模块

| API | 用途 |
|---|---|
| `readline.createInterface({ input, output })` | 创建交互接口 |
| `rl.question(query, callback)` | 向用户提问 |
| `rl.close()` | 关闭接口 |

```js
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const answer = await new Promise((resolve) => {
  rl.question('确认删除? (y/N): ', (ans) => resolve(ans));
});
rl.close();
```

**面试相关：**
- 如何让 Node.js CLI 实现交互输入？—— 用 `readline` 模块
- `readline` 的事件驱动模型？—— 基于 `EventEmitter`，监听 `line`、`close` 事件

### 1.6 错误处理模式

**Phase 1 的分层错误处理：**

```
命令层 (list.js)                     → 无 try-catch，错误向上抛
核心层 (fileService.js)              → 检查型错误直接 throw
入口层 (cli/index.js)                → 统一 try-catch 捕获并输出
```

```js
// 入口层统一处理
try {
  await commandFn(args.slice(1), logger);
} catch (err) {
  logger.error(`${command} 操作失败: ${err.message}`);
  process.exit(1);
}
```

**Node.js 错误类型：**

| 错误类型 | 示例 | 处理方式 |
|---|---|---|
| 操作错误 | 文件不存在、权限不足 | 可预期的错误，用 try-catch |
| 程序员错误 | 参数为 undefined、类型错误 | 应该修复代码 |
| 系统错误 | ENOENT、EACCES、EISDIR | 通过 `err.code` 区分处理 |

**面试相关：**
- Node.js 中如何优雅处理错误？—— 区分操作错误和程序员错误，使用 Error 对象的 code 属性分类处理
- 未捕获的异常如何处理？—— `process.on('uncaughtException')` 和 `process.on('unhandledRejection')`

### 1.7 async/await 与 Promise

```js
// Promise 链 vs async/await

// Promise 链
fs.promises.readFile('a.txt')
  .then(data => fs.promises.writeFile('b.txt', data))
  .then(() => console.log('done'))
  .catch(err => console.error(err));

// async/await（更直观）
async function copy() {
  try {
    const data = await fs.promises.readFile('a.txt');
    await fs.promises.writeFile('b.txt', data);
    console.log('done');
  } catch (err) {
    console.error(err);
  }
}
```

### 1.8 安全实践

**路径穿越防护（Path Traversal Prevention）：**

```js
const PROJECT_ROOT = path.resolve(__dirname, '..');

function resolveSafePath(inputPath) {
  const resolved = path.resolve(PROJECT_ROOT, inputPath);

  // 关键的检查：用户输入解析后必须在项目目录内
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error('Invalid path: directory traversal detected');
  }

  return resolved;
}
```

**攻击示例：** `../../etc/passwd` → `resolve` 后超出项目根目录 → 被拦截

---

## 二、我能做什么

### 2.1 已完成的功能清单

| 命令 | 功能 | 使用场景 |
|---|---|---|
| `node cli list [dir]` | 浏览目录，区分文件和文件夹，显示文件大小 | 查看项目结构 |
| `node cli read <file>` | 读取并显示文件内容 | 快速查看文件 |
| `node cli info <path>` | 查看文件/目录详细信息（大小、权限、时间等） | 诊断文件属性 |
| `node cli mkdir <dir>` | 创建目录（支持多级递归） | 快速建目录结构 |
| `node cli write <file> <text>` | 写入文件内容 | 快速创建文件 |
| `node cli copy <src> <dst>` | 复制文件 | 文件备份 |
| `node cli remove <path>` | 删除文件或目录（带确认提示，防误删） | 清理文件 |

### 2.2 扩展能力（基于已学知识）

- **批量重命名工具**：利用 `readdir` + `rename` 实现
- **文件搜索工具**：递归遍历目录，按名称/内容/正则匹配
- **目录对比工具**：对比两个目录的文件差异
- **文件监控**：使用 `fs.watch` 监听文件变化
- **简单的构建脚本**：文件复制、合并、压缩等
- **脚手架生成器**：根据模板生成项目目录结构

---

## 三、能应付的面试题

### 3.1 基础概念题

**Q1：`require` 和 `import` 的区别？**
- CommonJS 是运行时同步加载，输出值的拷贝；ESM 是编译时异步加载，输出值的引用
- CommonJS 使用 `require()` / `module.exports`；ESM 使用 `import` / `export`
- CommonJS 可以在条件语句中动态加载；ESM 的 `import` 必须是静态的（顶层）

**Q2：Node.js 模块查找策略？**
- 内置模块（fs、path 等）优先级最高
- 如果路径以 `./` 或 `../` 开头，按相对路径查找
- 如果是裸名称（如 `lodash`），逐级向上查找 `node_modules`
- 查找时会尝试添加 `.js`、`.json`、`.node` 扩展名
- 如果目录有 `package.json` 的 `main` 字段，指向入口文件

**Q3：Node.js 的全局对象有哪些？**
- `global`（浏览器中的 `window` 对应）
- `__dirname`、`__filename`（模块级，非全局但普遍使用）
- `process`、`Buffer`、`console`
- `setTimeout`、`setInterval`、`setImmediate`
- `exports`、`require`、`module`

### 3.2 fs 模块题

**Q4：`fs.readFile`、`fs.readFileSync`、`fs.promises.readFile` 的区别？**
- `readFile`（回调）：不阻塞，但嵌套多时回调地狱
- `readFileSync`（同步）：简单直观，但阻塞事件循环，不适合生产服务器
- `promises.readFile`（Promise）：不阻塞，可用 async/await，推荐方式

**Q5：如何处理大文件读取？**
- `readFile` 会一次性加载到内存，不适合大文件
- 大文件应使用 `fs.createReadStream`（Stream），边读边处理，控制内存占用

**Q6：`fs.stat` 能获取哪些信息？**
- `size`（字节数）、`mode`（权限）
- `birthtime`（创建时间）、`mtime`（修改时间）、`atime`（访问时间）
- `isFile()`、`isDirectory()`、`isSymbolicLink()`

### 3.3 path 模块题

**Q7：`path.resolve` 和 `path.join` 的区别？**
- `resolve` 从右到左处理，遇到绝对路径就返回，否则基于 `cwd` 拼接
- `join` 只是简单地用平台分隔符连接所有片段，不做绝对路径解析
- 例子：`resolve('/a', '/b')` → `/b`；`join('/a', '/b')` → `/a/b`

**Q8：跨平台路径要注意什么？**
- Windows 用反斜杠 `\`，Linux/macOS 用正斜杠 `/`
- 使用 `path` 模块自动处理，不要手动拼接路径字符串
- `path.sep` 获取平台路径分隔符

### 3.4 process 模块题

**Q9：`process.argv` 的结构是怎样的？**
- `[0]`：Node.js 可执行文件路径
- `[1]`：当前执行的 JS 文件路径
- `[2]` 起：用户传入的命令行参数

**Q10：`process.cwd()` 和 `__dirname` 的区别？**
- `cwd()`：用户执行 `node` 命令时所在的目录，可能变化
- `__dirname`：当前代码文件所在的目录，固定不变

### 3.5 事件循环与异步题

**Q11：什么是事件循环（Event Loop）？**
- Node.js 的事件循环分为多个阶段：timers → I/O callbacks → idle/prepare → poll → check → close
- `setTimeout(fn, 0)` 在 timers 阶段执行
- `setImmediate(fn)` 在 check 阶段执行
- `process.nextTick(fn)` 在当前阶段结束后立即执行（优先级最高）

**Q12：为什么 `readFile` 的回调晚于 `setTimeout`？**
- `readFile` 属于 I/O 操作，回调在 poll 阶段处理
- `setTimeout` 在 timers 阶段处理
- 执行顺序取决于文件读取完成的时间点

### 3.6 安全题

**Q13：什么是路径穿越攻击（Path Traversal）？如何防护？**
- 攻击者用 `../../etc/passwd` 等方式访问受限目录外的文件
- 防护方法：
  - 使用 `path.resolve()` 解析为绝对路径
  - 检查解析后的路径是否以项目根目录开头（`startsWith`）
  - 避免直接拼接用户输入到路径中

### 3.7 架构设计题

**Q14：这个项目为什么分成 cli / core / lib 三层？**
- **入口层**（cli）：负责参数解析、命令分发、用户交互
- **业务层**（core）：封装核心文件操作逻辑，与输入输出解耦
- **工具层**（lib）：提供通用的日志、配置等基础设施
- 好处：职责单一、便于测试、Core 层可被 CLI 和未来的 Web API 共享

---

## 四、扩展方向

### 4.1 Phase 2 预告：Web API 版本

基于原生 `http` 模块构建 RESTful 服务：

```js
// 大致结构
const http = require('http');

const server = http.createServer(async (req, res) => {
  const { method, url } = req;

  // 路由分发
  // GET /api/files           → 浏览目录
  // GET /api/files/info      → 文件详情
  // POST /api/files/upload   → 上传文件
  // GET /api/files/download  → 下载文件
  // DELETE /api/files        → 删除文件
});
```

**将学到的新知识点：**
- `http` 模块：创建服务器、请求/响应处理
- `url` 模块：URL 解析、查询参数提取
- 请求体解析：处理 JSON、multipart/form-data
- CORS 跨域处理
- MIME 类型设置
- 文件上传下载的流式处理

### 4.2 Phase 3 进阶方向

| 方向 | 知识点 | 面试价值 |
|---|---|---|
| **Stream 流处理** | `fs.createReadStream`、`fs.createWriteStream`、pipe、背压控制 | ⭐⭐⭐⭐⭐ |
| **Buffer 详解** | Buffer 创建、编码转换、二进制操作 | ⭐⭐⭐⭐ |
| **事件系统** | `EventEmitter` 自定义事件、发布订阅模式 | ⭐⭐⭐⭐⭐ |
| **加密与校验** | `crypto` 模块：MD5/SHA1 哈希、文件完整性校验 | ⭐⭐⭐⭐ |
| **Cluster 多进程** | 利用多核 CPU、进程间通信 | ⭐⭐⭐⭐ |
| **Stream 实战** | 大文件分片上传、断点续传 | ⭐⭐⭐⭐⭐ |

### 4.3 面试冲刺建议

完成 Phase 1 后，你已经可以回答大部分 Node.js 基础面试题。按优先级准备：

1. **事件循环机制**（最高频）— 结合项目中的 async/await 理解
2. **模块系统** — CommonJS vs ESM，循环依赖
3. **Stream 与 Buffer** — 大文件处理场景
4. **错误处理** — 分层设计、错误分类
5. **安全** — 路径穿越、XSS、CSRF 的基本防护

---

> **一句话总结 Phase 1：** 通过一个 CLI 文件管理工具，掌握了 Node.js 最核心的 `fs`、`path`、`process`、`readline` 模块，理解了 CommonJS 模块化、async/await 异步编程、分层架构和安全实践，覆盖了 Node.js 后端面试的 60% 基础知识。
