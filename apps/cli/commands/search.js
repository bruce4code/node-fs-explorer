/**
 * CLI 搜索命令
 * 递归搜索文件/目录
 *
 * 用法: node cli search <dir> <pattern> [options]
 *   pattern 支持正则表达式（如 .*\.js 搜索所有 JS 文件）
 *
 * 示例:
 *   node cli search . package
 *   node cli search . ".*\.js$"
 *   node cli search /path/to/dir "test.*\.txt"
 */
const FileService = require('@file-manager/core/fileService');
const path = require('path');

async function searchCommand(args, logger) {
  const dirPath = args[0] || '.';
  const pattern = args[1];

  if (!pattern) {
    logger.error('请提供搜索模式（支持正则表达式）');
    logger.info('');
    logger.info('示例:');
    logger.info('  node cli search . package         # 搜索包含 "package" 的文件');
    logger.info('  node cli search . ".*\\.js$"       # 搜索所有 JS 文件');
    logger.info('  node cli search . "test.*\\.txt"  # 搜索匹配 test*.txt 的文件');
    return;
  }

  const service = new FileService();
  const results = await service.search(dirPath, pattern, {
    maxDepth: 10,
    maxResults: 100,
  });

  if (results.length === 0) {
    logger.info(`未找到匹配 "${pattern}" 的文件`);
    return;
  }

  logger.divider();
  results.forEach((item, index) => {
    const icon = item.type === 'directory' ? '[DIR]' : '[FILE]';
    const sizeStr = item.size ? `  ${(item.size / 1024).toFixed(1)}KB` : '';
    logger.raw(`  ${icon} ${item.name}${sizeStr}`);
  });
  logger.divider();
  logger.data(`共找到 ${results.length} 个匹配项`);
}

module.exports = searchCommand;
