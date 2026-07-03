/**
 * 日志工具模块
 * 提供带颜色和时间戳的控制台输出
 */

// 终端颜色编码
const COLORS = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

class Logger {
  /**
   * 获取当前时间字符串
   */
  _timestamp() {
    const now = new Date();
    return now.toLocaleTimeString('zh-CN', { hour12: false });
  }

  /**
   * 普通信息
   */
  info(msg) {
    console.log(`${COLORS.gray}[${this._timestamp()}]${COLORS.reset} ${COLORS.green}[INFO]${COLORS.reset} ${msg}`);
  }

  /**
   * 警告信息
   */
  warn(msg) {
    console.log(`${COLORS.gray}[${this._timestamp()}]${COLORS.reset} ${COLORS.yellow}[WARN]${COLORS.reset} ${msg}`);
  }

  /**
   * 错误信息
   */
  error(msg) {
    console.log(`${COLORS.gray}[${this._timestamp()}]${COLORS.reset} ${COLORS.red}[ERROR]${COLORS.reset} ${msg}`);
  }

  /**
   * 数据/结果输出
   */
  data(msg) {
    console.log(`${COLORS.gray}[${this._timestamp()}]${COLORS.reset} ${COLORS.cyan}[DATA]${COLORS.reset} ${msg}`);
  }

  /**
   * 分隔线
   */
  divider() {
    console.log(COLORS.gray + '─'.repeat(50) + COLORS.reset);
  }

  /**
   * 纯文本输出（无标签）
   */
  raw(msg) {
    console.log(msg);
  }
}

module.exports = Logger;
