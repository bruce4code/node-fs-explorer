#!/usr/bin/env node

/**
 * CLI 主入口
 * 解析命令行参数并分发给对应的命令处理函数
 *
 * 用法: node cli/index.js <command> [args...]
 */

const Logger = require('@file-manager/node-utils/logger');
const logger = new Logger();

// 命令映射表
const commands = {
  list: require('./commands/list'),
  read: require('./commands/read'),
  info: require('./commands/info'),
  mkdir: require('./commands/mkdir'),
  write: require('./commands/write'),
  copy: require('./commands/copy'),
  remove: require('./commands/remove'),
  search: require('./commands/search'),
  hash: require('./commands/hash'),
};

/**
 * 打印帮助信息
 */
function printUsage() {
  const usage = `
  Node.js 文件管理系统 - CLI

  用法:
    node cli list [dir]             浏览目录内容
    node cli read <file>            读取文件内容
    node cli info <path>            获取文件/目录详细信息
    node cli mkdir <dir>            创建目录（支持递归）
    node cli write <file> <text>    写入文件内容
    node cli copy <src> <dst>       复制文件
    node cli remove <path>          删除文件或目录
    node cli search <dir> <pattern> 搜索文件（支持正则）
    node cli hash <file> [algo]     计算文件哈希（md5/sha1/sha256/sha512）
    node cli help                   显示本帮助信息

  示例:
    node cli list
    node cli read package.json
    node cli info cli
    node cli mkdir test/new-folder
    node cli write test/hello.txt "Hello World"
    node cli copy package.json package.json.bak
    node cli remove test
    node cli search . ".*\\.js$"
    node cli hash package.json sha256
  `;
  console.log(usage);
}

/**
 * 主函数
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  // 无命令或 help 时显示帮助
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  const commandFn = commands[command];
  if (!commandFn) {
    logger.error(`未知命令: "${command}"`);
    logger.info('输入 node cli help 查看可用命令');
    process.exit(1);
  }

  try {
    await commandFn(args.slice(1), logger);
  } catch (err) {
    logger.error(`${command} 操作失败: ${err.message}`);
    process.exit(1);
  }
}

main();
