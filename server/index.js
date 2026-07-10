/**
 * Web API 服务入口
 *
 * 基于 Node.js 原生 http 模块构建的 RESTful 文件管理服务。
 * 启动方式:
 *   node server/index.js
 *   PORT=8080 node server/index.js
 */
const http = require('http');
const Logger = require('../lib/logger');
const logger = new Logger();

// 中间件
const cors = require('./middleware/cors');
const auth = require('./middleware/auth');
const rateLimit = require('./middleware/rateLimit');
const bodyParser = require('./middleware/bodyParser');

// 路由
const router = require('./routes');

// =============================================
// 服务配置
// =============================================
const PORT = parseInt(process.env.PORT, 10) || 3300;
const HOST = process.env.HOST || '0.0.0.0';

// =============================================
// 创建 HTTP 服务
// =============================================
const server = http.createServer(async (req, res) => {
  // 1. CORS 处理（OPTIONS 预检请求在此结束）
  if (cors(req, res)) {
    return;
  }

  // 2. 鉴权（API Token，未配置则跳过）
  if (auth(req, res)) {
    return;
  }

  // 3. 限流（基于 IP 的滑动窗口）
  if (rateLimit(req, res)) {
    return;
  }

  try {
    // 4. 解析请求体（GET/HEAD 请求没有 body，无需解析）
    //    multipart 请求由 bodyParser 跳过，交给 upload 控制器流式处理
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      await bodyParser(req);
    } else {
      req.rawBody = Buffer.alloc(0);
      req.body = {};
    }

    // 5. 路由分发
    await router.handle(req, res);
  } catch (err) {
    // 全局异常捕获
    logger.error(`请求处理异常: ${err.message}`);

    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, error: `Internal Server Error: ${err.message}` }));
    }
  }
});

// =============================================
// 启动服务
// =============================================
server.listen(PORT, HOST, () => {
  logger.info(`================================`);
  logger.info(` 文件管理 API 服务已启动`);
  logger.info(` 地址: http://localhost:${PORT}`);
  logger.info(` 接口前缀: /api/files`);
  logger.info(`================================`);
  logger.info(``);
  logger.info(` 中间件:`);
  logger.info(`   CORS        已启用`);
  logger.info(`   鉴权        ${process.env.API_TOKEN ? '已启用 (X-API-Token)' : '未启用 (设置 API_TOKEN 环境变量开启)'}`);
  logger.info(`   限流        已启用 (${process.env.RATE_LIMIT_MAX || 100} 次 / ${process.env.RATE_LIMIT_WINDOW || 60} 秒)`);
  logger.info(``);
  logger.info(` 可用的接口:`);
  logger.info(`   GET    /api/files             浏览目录`);
  logger.info(`   GET    /api/files/info?path=   文件详情`);
  logger.info(`   GET    /api/files/download?path= 下载文件`);
  logger.info(`   POST   /api/files/upload       上传文件(流式)`);
  logger.info(`   POST   /api/files/mkdir        创建目录`);
  logger.info(`   DELETE /api/files?path=        删除文件/目录`);
  logger.info(`   PUT    /api/files/move         移动/重命名`);
});

// =============================================
// 优雅关闭
// =============================================
function gracefulShutdown(signal) {
  logger.info(`收到 ${signal} 信号，正在关闭服务...`);
  server.close(() => {
    logger.info('服务已关闭');
    process.exit(0);
  });

  // 5 秒后强制退出
  setTimeout(() => {
    logger.warn('强制退出');
    process.exit(1);
  }, 5000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
