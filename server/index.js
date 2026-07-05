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

  try {
    // 2. 解析请求体（GET/HEAD 请求没有 body，无需解析）
    //    注意: 这里始终解析 rawBody，上传时 multipart 由控制器自行处理
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      await bodyParser(req);
    } else {
      req.rawBody = Buffer.alloc(0);
      req.body = {};
    }

    // 3. 路由分发
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
  logger.info(` 可用的接口:`);
  logger.info(`   GET    /api/files             浏览目录`);
  logger.info(`   GET    /api/files/info?path=   文件详情`);
  logger.info(`   GET    /api/files/download?path= 下载文件`);
  logger.info(`   POST   /api/files/upload       上传文件`);
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
