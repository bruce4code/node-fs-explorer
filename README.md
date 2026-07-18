<p align="center">
  <img src="https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=A%20minimalist%20logo%20for%20a%20Node.js%20file%20explorer%20project%2C%20featuring%20a%20folder%20icon%20with%20a%20node%20leaf%2C%20clean%20lines%2C%20tech%20blue%20and%20green%20color%20scheme%2C%20flat%20design%20style&image_size=square_hd" width="120" alt="node-fs-explorer logo" />
</p>

<h1 align="center">node-fs-explorer</h1>

<p align="center">
  <strong>A zero-dependency Node.js file management system — from CLI to production-ready API.</strong>
</p>

<p align="center">
  <a href="https://github.com/bruce4code/node-fs-explorer/actions/workflows/ci.yml"><img src="https://github.com/bruce4code/node-fs-explorer/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18.0-brightgreen" alt="Node version" />
  <img src="https://img.shields.io/badge/dependencies-0-blue" alt="Zero dependencies" />
  <img src="https://img.shields.io/badge/tests-143%20passing-green" alt="Tests" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License" />
</p>

---

English | [中文](#-概述)

## 📖 Overview

**node-fs-explorer** is a hands-on project for systematically learning Node.js core knowledge. It builds a complete file management system **using only native Node.js modules** (`fs`, `http`, `path`, `stream`, `crypto`, `events`, etc.) — **zero npm dependencies**.

> Designed for developers who want to deeply understand Node.js internals rather than just using frameworks.

### Learning Path

The project is organized into 5 progressive phases:

| Phase | Focus | Core Modules |
|---|---|---|
| **1** | CLI file operations | `fs`, `path`, `process`, `readline` |
| **2** | RESTful Web API | `http`, `url`, `buffer`, `stream` |
| **3** | Advanced features | `events`, `crypto`, `stream.pipeline` |
| **4** | Security & Performance | `cluster`, timing-safe comparison, rate limiting |
| **5** | Large file upload | streaming multipart, chunked upload, MD5 dedup |

---

## ✨ Features

```
┌──────────────────────────────────────────────────┐
│               node-fs-explorer                    │
├──────────────────────────────────────────────────┤
│  CLI  ────  list / read / info / mkdir / write   │
│            copy / remove / search / hash          │
├──────────────────────────────────────────────────┤
│  API  ─────  GET    /api/files                   │
│              GET    /api/files/info               │
│              GET    /api/files/download            │
│              GET    /api/files/search              │
│              GET    /api/files/preview             │
│              GET    /api/files/hash                │
│              GET    /api/files/logs                │
│              POST   /api/files/upload              │
│              POST   /api/files/mkdir               │
│              POST   /api/files/upload/init         │
│              POST   /api/files/upload/chunk        │
│              POST   /api/files/upload/complete     │
│              PUT    /api/files/move                │
│              DELETE /api/files                     │
├──────────────────────────────────────────────────┤
│  Auth  ────  JWT (HS256) / API Token / Login     │
│  Rate  ────  Sliding window per IP               │
│  Cluster ──  Multi-process with auto restart     │
└──────────────────────────────────────────────────┘
```

### Key Highlights

- **Zero dependencies** — Every line is hand-written for learning
- **JWT implementation from scratch** — `lib/jwt.js` with HMAC-SHA256, expiration, blacklist, refresh
- **Streaming multipart parser** — `lib/multipartStreamParser.js` with state machine
- **Chunked upload** — Resumable, idempotent, MD5 instant upload, streaming merge
- **Security by design** — Path traversal prevention, timing-safe comparison, rate limiting
- **143 tests, all native** — Uses Node.js built-in `node:test` framework

---

## 🚀 Quick Start

```bash
# Clone
git clone https://github.com/bruce4code/node-fs-explorer.git
cd node-fs-explorer

# Install workspace dependencies
pnpm install

# Run tests
pnpm test:backend

# CLI mode
pnpm cli -- list
pnpm cli -- read package.json
pnpm cli -- search . "*.js"
pnpm cli -- hash package.json sha256

# API mode (single process)
JWT_SECRET=my-secret JWT_USERS='{"admin":"pass123"}' pnpm dev:server

# API mode (multi-process cluster)
JWT_SECRET=my-secret JWT_USERS='{"admin":"pass123"}' pnpm start

# Auth enabled
JWT_SECRET=my-secret JWT_USERS='{"admin":"pass123"}' pnpm dev
```

---

## 🧪 Testing

```bash
pnpm test:backend     # Run the backend suite
pnpm test:unit        # Unit tests only
pnpm test:api         # API integration tests
```

All tests use Node.js native [`node:test`](https://nodejs.org/api/test.html) — no extra test framework required.

---

## 🗺️ Knowledge Map

### Phase 1 — CLI File Operations

| Topic | What you'll learn | Interview relevance |
|---|---|---|
| `require` / CommonJS | Module system, caching, circular deps | ⭐⭐⭐⭐⭐ |
| `fs` module | promises API vs sync vs callback | ⭐⭐⭐⭐⭐ |
| `path` module | resolve/join/basename, cross-platform | ⭐⭐⭐⭐ |
| `process.argv` | CLI argument parsing | ⭐⭐⭐ |

### Phase 2 — Web API

| Topic | What you'll learn | Interview relevance |
|---|---|---|
| `http.createServer` | req/res as streams | ⭐⭐⭐⭐⭐ |
| URL routing | `new URL()`, pathname, searchParams | ⭐⭐⭐⭐ |
| Body parsing | JSON, urlencoded, multipart boundary | ⭐⭐⭐⭐⭐ |
| CORS | Preflight, OPTIONS, headers | ⭐⭐⭐⭐ |
| Graceful shutdown | SIGINT/SIGTERM, server.close() | ⭐⭐⭐⭐ |

### Phase 3 — Advanced Features

| Topic | What you'll learn | Interview relevance |
|---|---|---|
| `stream.pipeline` | vs pipe, resource cleanup, error handling | ⭐⭐⭐⭐⭐ |
| Backpressure | pause/drain/resume cycle | ⭐⭐⭐⭐⭐ |
| `events.EventEmitter` | Pub-sub pattern, memory leak | ⭐⭐⭐⭐⭐ |
| `crypto.createHash` | Streaming hash, MD5 vs SHA256 | ⭐⭐⭐⭐ |
| Recursive traversal | BFS/DFS, depth limits, permission handling | ⭐⭐⭐⭐ |

### Phase 4 — Security & Performance

| Topic | What you'll learn | Interview relevance |
|---|---|---|
| Rate limiting | Sliding window, X-Forwarded-For, Redis | ⭐⭐⭐⭐⭐ |
| `cluster` module | Multi-process, SO_REUSEADDR, IPC | ⭐⭐⭐⭐⭐ |
| Auto-restart | Crash recovery, circuit breaker | ⭐⭐⭐⭐ |
| Timing-safe compare | `crypto.timingSafeEqual` | ⭐⭐⭐⭐ |

### Phase 5 — Large File Upload

| Topic | What you'll learn | Interview relevance |
|---|---|---|
| Chunked upload | init/upload/complete/abort protocol | ⭐⭐⭐⭐⭐ |
| Resumable upload | Idempotent chunks, status query | ⭐⭐⭐⭐⭐ |
| MD5 instant upload | Sidecar file, deduplication | ⭐⭐⭐⭐⭐ |
| Streaming multipart | Transform stream, state machine | ⭐⭐⭐⭐⭐ |
| Streaming merge | `pipe({ end: false })`, sequential read | ⭐⭐⭐⭐ |

---

## 🛡️ Security

| Feature | Implementation |
|---|---|
| Path traversal | `path.resolve()` + `startsWith()` guard |
| Timing attack | `crypto.timingSafeEqual` for all comparisons |
| Rate limiting | Per-IP sliding window with cleanup |
| JWT auth | HMAC-SHA256, expiration, blacklist, refresh |
| Body size limit | 50MB max request body |
| Token revocation | In-memory blacklist with auto-cleanup |
| File size check | 500MB download limit, 1GB upload limit |

---

## 🏗️ Project Structure

```
node-fs-explorer/
├── apps/
│   ├── web/                # Next.js file management console and BFF
│   ├── cli/                # CLI commands (list/read/info/mkdir/...)
│   └── server/             # HTTP API server
├── packages/
│   ├── core/               # Shared file-system business logic
│   ├── node-utils/         # JWT, multipart and logger utilities
│   └── contracts/          # Web API TypeScript contracts
├── test/                   # Native node:test suite
├── pnpm-workspace.yaml
├── package.json
├── README.md
```

### Web console

```bash
JWT_SECRET=my-secret JWT_USERS='{"admin":"pass123"}' pnpm dev
```

Open http://localhost:3000 and sign in with the configured user. The Next.js app keeps the JWT in an HttpOnly cookie and forwards requests to `FILE_API_URL` (defaults to `http://127.0.0.1:3300`).

```
Legacy structure (before the pnpm migration):
├── server/                 # HTTP API server
│   ├── index.js            # Entry point with middleware chain
│   ├── router.js           # Native URL router
│   ├── cluster.js          # Multi-process launcher
│   ├── middleware/         # cors, bodyParser, auth, jwtAuth, rateLimit
│   ├── controllers/        # fileController, authController, uploadController
│   └── routes/             # Route definitions
├── core/                   # Shared business logic
│   ├── fileService.js      # File CRUD operations
│   ├── chunkUploadService.js # Chunked upload engine
│   ├── pathValidator.js    # Path security
│   └── operationLogger.js  # EventEmitter-based logging
├── lib/                    # Utilities
│   ├── jwt.js              # JWT implementation (zero deps)
│   ├── multipartParser.js  # Buffer-based multipart parser
│   ├── multipartStreamParser.js # Streaming multipart parser
│   └── logger.js           # Colored console logger
└── test/                   # 143 tests (node:test)
```

---

## 📄 License

MIT

---

<br>

<h1 align="center">node-fs-explorer</h1>

<p align="center">
  <strong>零依赖的 Node.js 文件管理系统 —— 从命令行到生产级 API 的完整实战。</strong>
</p>

---

## 📖 概述

**node-fs-explorer** 是一个系统学习 Node.js 核心知识的实战项目，**纯 Node.js 原生模块**构建（`fs`、`http`、`path`、`stream`、`crypto`、`events` 等），**零 npm 依赖**。

> 适合想深入理解 Node.js 底层原理而非只会用框架的开发者。

### 学习路径

5 个渐进式阶段：

| 阶段 | 重点 | 核心模块 |
|---|---|---|
| **1** | CLI 文件操作 | `fs`, `path`, `process`, `readline` |
| **2** | RESTful Web API | `http`, `url`, `buffer`, `stream` |
| **3** | 进阶功能 | `events`, `crypto`, `stream.pipeline` |
| **4** | 安全与性能 | `cluster`, 恒定时间比较, 限流 |
| **5** | 大文件上传 | 流式 multipart, 分片上传, MD5 秒传 |

---

## ✨ 功能亮点

- **零依赖** — 每一行代码都是手写的，适合学习
- **手写 JWT** — `lib/jwt.js`，HMAC-SHA256、过期校验、黑名单、刷新令牌
- **流式 multipart 解析器** — 基于状态机的 Transform Stream
- **分片上传** — 断点续传、幂等性、MD5 秒传、流式合并
- **安全设计** — 路径穿越防护、恒定时间比较、限流、多级鉴权
- **143 个测试** — 全部使用 Node.js 内置 `node:test` 框架

---

## 🚀 快速开始

```bash
# 克隆
git clone https://github.com/bruce4code/node-fs-explorer.git
cd node-fs-explorer

# 运行测试（不需要安装！）
npm test

# CLI 模式
node cli list
node cli read package.json
node cli search . "*.js"
node cli hash package.json sha256

# API 模式（单进程）
node server/index.js

# API 模式（多进程集群）
node server/cluster.js

# 启用鉴权
JWT_SECRET=my-secret JWT_USERS='{"admin":"pass123"}' node server/index.js
```

---

## 🧪 测试

```bash
npm test              # 运行全部 143 个测试
npm run test:unit     # 纯单元测试
npm run test:api      # API 集成测试
```

所有测试使用 Node.js 原生 [`node:test`](https://nodejs.org/api/test.html)，无需额外测试框架。

---

## 🗺️ 知识点覆盖

| 模块 | 知识点 | 面试价值 |
|---|---|---|
| `fs` | promises/sync/callback 三种 API | ⭐⭐⭐⭐⭐ |
| `http` | 原生 HTTP 服务器，req/res 即 Stream | ⭐⭐⭐⭐⭐ |
| `stream` | pipeline/pipe、背压、Transform | ⭐⭐⭐⭐⭐ |
| `events` | EventEmitter、发布-订阅 | ⭐⭐⭐⭐⭐ |
| `crypto` | 哈希、HMAC、恒定时间比较 | ⭐⭐⭐⭐⭐ |
| `cluster` | 多进程、负载均衡、进程管理 | ⭐⭐⭐⭐⭐ |
| `path` | 路径解析、跨平台兼容 | ⭐⭐⭐⭐ |
| `buffer` | 二进制数据操作 | ⭐⭐⭐⭐ |
| `process` | argv/env/exit/信号处理 | ⭐⭐⭐⭐ |

---

## 🛡️ 安全措施

| 措施 | 实现方式 |
|---|---|
| 路径穿越防护 | `path.resolve()` + `startsWith()` 校验 |
| 计时攻击防护 | `crypto.timingSafeEqual` 恒定时间比较 |
| 限流 | 基于 IP 的滑动窗口（默认 100 次/分钟） |
| JWT 鉴权 | HMAC-SHA256、过期、黑名单、刷新 |
| 请求体限制 | 最大 50MB |
| Token 撤销 | 内存黑名单 + 自动清理 |
| 文件大小限制 | 下载 500MB、上传 1GB 上限 |

---

## 🏗️ 项目结构

```
node-fs-explorer/
├── cli/                    # CLI 命令（list/read/info/mkdir/...）
├── server/                 # HTTP API 服务
│   ├── index.js            # 入口，中间件链
│   ├── router.js           # 原生 URL 路由
│   ├── cluster.js          # 多进程启动器
│   ├── middleware/         # cors/bodyParser/auth/jwtAuth/rateLimit
│   ├── controllers/        # fileController/authController/uploadController
│   └── routes/             # 路由注册表
├── core/                   # 共享业务逻辑
│   ├── fileService.js      # 文件 CRUD 操作
│   ├── chunkUploadService.js # 分片上传引擎
│   ├── pathValidator.js    # 路径安全校验
│   └── operationLogger.js  # EventEmitter 操作日志
├── lib/                    # 工具库
│   ├── jwt.js              # JWT 零依赖实现
│   ├── multipartParser.js  # Buffer 版 multipart 解析
│   ├── multipartStreamParser.js # 流式版 multipart 解析
│   └── logger.js           # 彩色日志
└── test/                   # 143 个测试（node:test）
```

---

## 📄 许可证

MIT
