/**
 * 操作日志模块（EventEmitter 实现）
 *
 * 用于文件操作事件的发布与订阅（发布-订阅模式）。
 *
 * 使用方式:
 *   const logger = require('./operationLogger');
 *
 *   // 订阅所有操作
 *   logger.on('operation', (entry) => { ... });
 *
 *   // 订阅特定操作
 *   logger.on('list', (entry) => { ... });
 *   logger.on('remove', (entry) => { ... });
 */
const EventEmitter = require('events');

class OperationLogger extends EventEmitter {
  constructor() {
    super();
    // 内存中保留最近 100 条操作历史，作为实例属性管理
    this._history = [];

    // 订阅通用 operation 事件，自动收集历史
    this.on('operation', (entry) => {
      this._history.push(entry);
      if (this._history.length > 100) this._history.shift();
    });
  }

  /**
   * 记录操作日志
   * @param {string} operation - 操作类型（list/read/mkdir/write/copy/remove/move/search/hash/preview/download/upload）
   * @param {string} targetPath - 操作目标路径
   * @param {object} [details={}] - 附加信息
   */
  log(operation, targetPath, details = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      operation,
      path: targetPath,
      ...details,
    };

    // 发射具体操作事件和通用事件
    this.emit(operation, entry);
    this.emit('operation', entry);

    return entry;
  }

  /**
   * 获取最近的操作历史（内存中最多保留 100 条）
   */
  history(max = 100) {
    return this._history.slice(-max);
  }
}

// 单例导出
const instance = new OperationLogger();

module.exports = instance;
