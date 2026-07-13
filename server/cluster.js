/**
 * Cluster 多进程入口
 *
 * 启动方式:
 *   node server/cluster.js           — 默认按 CPU 核心数启动 worker
 *   WORKERS=4 node server/cluster.js — 指定 worker 数量
 *
 * 特性:
 *   - 多 worker 共享同一端口（操作系统级负载均衡）
 *   - worker 崩溃自动重启
 *   - 优雅关闭（SIGINT/SIGTERM → 通知 worker → 等待关闭 → 强制退出）
 *   - IPC 通信（worker → master 报告状态）
 *
 * 架构:
 *   ┌──────────────┐
 *   │   Master     │  ← 管理进程（不处理请求）
 *   │  (cluster)   │
 *   └──────┬───────┘
 *          │ fork()
 *     ┌────┴────┬────────┬────────┐
 *     ↓         ↓        ↓        ↓
 *   Worker1  Worker2  Worker3  Worker4
 *   (HTTP)   (HTTP)   (HTTP)   (HTTP)
 *     │        │        │        │
 *     └────────┴────────┴────────┘
 *              │ 共享端口 (SO_REUSEADDR)
 *              ↓
 *           客户端请求
 */

const cluster = require('cluster');
const os = require('os');
const Logger = require('../lib/logger');
const logger = new Logger();

// =============================================
// 配置
// =============================================

const NUM_WORKERS = parseInt(process.env.WORKERS, 10) || os.cpus().length;
const MAX_RESTART_COUNT = 10;       // 最大重启次数（防止无限重启）
const RESTART_WINDOW = 60 * 1000;   // 重启计数窗口（60 秒内）
const SHUTDOWN_TIMEOUT = 5000;      // 优雅关闭超时（5 秒后强制）

// =============================================
// Master 进程：管理 worker
// =============================================

if (cluster.isPrimary) {
  const workerRestarts = new Map(); // workerId -> timestamps[]
  let isShuttingDown = false;

  logger.info('================================');
  logger.info(` Cluster 模式启动 (Master PID: ${process.pid})`);
  logger.info(` Worker 数量: ${NUM_WORKERS} (CPU 核心: ${os.cpus().length})`);
  logger.info('================================');

  // Fork workers
  for (let i = 0; i < NUM_WORKERS; i++) {
    const worker = cluster.fork();
    logger.info(`  启动 Worker #${i + 1} (PID: ${worker.process.pid})`);
  }

  // Worker 上线
  cluster.on('online', (worker) => {
    logger.info(`  Worker ${worker.process.pid} 已上线`);
  });

  // Worker 退出处理
  cluster.on('exit', (worker, code, signal) => {
    if (isShuttingDown) return;

    const workerPid = worker.process.pid;
    logger.warn(`  Worker ${workerPid} 退出 (code=${code}, signal=${signal || 'none'})`);

    // 检查重启频率，防止无限重启
    const now = Date.now();
    let timestamps = workerRestarts.get(worker.id) || [];
    timestamps = timestamps.filter((t) => now - t < RESTART_WINDOW);
    timestamps.push(now);
    workerRestarts.set(worker.id, timestamps);

    if (timestamps.length > MAX_RESTART_COUNT) {
      logger.error(`  Worker ${workerPid} 在 ${RESTART_WINDOW / 1000} 秒内重启超过 ${MAX_RESTART_COUNT} 次，停止重启`);
      logger.error('  可能存在严重 bug，请检查日志');

      // 检查是否还有存活 worker
      const aliveWorkers = Object.keys(cluster.workers).filter((id) => cluster.workers[id]);
      if (aliveWorkers.length === 0) {
        logger.error('  所有 Worker 已退出，Master 也将关闭');
        process.exit(1);
      }
      return;
    }

    // 自动重启
    logger.info(`  重启 Worker (第 ${timestamps.length} 次)...`);
    const newWorker = cluster.fork();
    logger.info(`  新 Worker 启动 (PID: ${newWorker.process.pid})`);
  });

  // IPC: 接收 worker 消息
  cluster.on('message', (worker, msg) => {
    if (msg && msg.type === 'ready') {
      logger.info(`  Worker ${worker.process.pid} 报告就绪`);
    } else if (msg && msg.type === 'error') {
      logger.error(`  Worker ${worker.process.pid} 报告错误: ${msg.message}`);
    }
  });

  // =============================================
  // 优雅关闭
  // =============================================

  function gracefulShutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info(`\n收到 ${signal} 信号，正在优雅关闭...`);
    logger.info(`  通知 ${Object.keys(cluster.workers).length} 个 Worker 关闭`);

    // 向所有 worker 发送关闭信号
    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (worker) {
        worker.send({ type: 'shutdown' });
        worker.process.kill('SIGTERM');
      }
    }

    // 超时强制退出
    setTimeout(() => {
      const alive = Object.keys(cluster.workers).filter((id) => cluster.workers[id]).length;
      if (alive > 0) {
        logger.warn(`  ${alive} 个 Worker 未在 ${SHUTDOWN_TIMEOUT / 1000} 秒内关闭，强制退出`);
      }
      process.exit(alive > 0 ? 1 : 0);
    }, SHUTDOWN_TIMEOUT);
  }

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

} else {
  // =============================================
  // Worker 进程：启动 HTTP 服务
  // =============================================

  // Worker 标记，供其他模块识别
  process.env.CLUSTER_WORKER = '1';

  // 加载 HTTP 服务（复用 server/index.js）
  require('./index.js');

  // 通知 Master 已就绪
  if (process.send) {
    process.send({ type: 'ready', pid: process.pid });
  }

  // 接收 Master 的关闭通知
  process.on('message', (msg) => {
    if (msg && msg.type === 'shutdown') {
      // server/index.js 中的 SIGTERM handler 会处理关闭
      // 这里只做标记，实际的 server.close() 由信号处理器完成
    }
  });

  // Worker 异常捕获（防止直接崩溃无日志）
  process.on('uncaughtException', (err) => {
    logger.error(`Worker ${process.pid} 未捕获异常: ${err.message}`);
    if (process.send) {
      process.send({ type: 'error', message: err.message });
    }
    // 退出后 Master 会自动重启
    setTimeout(() => process.exit(1), 100);
  });
}
