/**
 * 原生路由分发器
 * 支持 GET/POST/PUT/DELETE 方法的路由注册与匹配
 */
class Router {
  constructor() {
    this.routes = [];
  }

  /**
   * 注册路由
   * @param {string} method - HTTP 方法
   * @param {string} path - 路径
   * @param {Function} handler - (req, res) => void
   */
  register(method, path, handler) {
    this.routes.push({ method, path, handler });
  }

  get(path, handler) { this.register('GET', path, handler); }
  post(path, handler) { this.register('POST', path, handler); }
  put(path, handler) { this.register('PUT', path, handler); }
  delete(path, handler) { this.register('DELETE', path, handler); }

  /**
   * 处理请求：匹配路由并执行对应的 handler
   * @param {object} req - http.IncomingMessage
   * @param {object} res - http.ServerResponse
   */
  async handle(req, res) {
    // 解析 URL
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    req.pathname = url.pathname;
    req.query = Object.fromEntries(url.searchParams);

    // 查找匹配的路由
    for (const route of this.routes) {
      if (route.method === req.method && route.path === req.pathname) {
        try {
          await route.handler(req, res);
        } catch (err) {
          this._sendError(res, 500, `Internal Server Error: ${err.message}`);
        }
        return;
      }
    }

    // 无匹配路由
    this._sendError(res, 404, `Not Found: ${req.method} ${req.pathname}`);
  }

  /**
   * 发送 JSON 错误响应
   */
  _sendError(res, status, message) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: message }));
  }
}

module.exports = Router;
