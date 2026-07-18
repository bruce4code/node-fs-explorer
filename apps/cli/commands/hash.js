/**
 * CLI 哈希命令
 * 计算文件的 MD5/SHA1/SHA256 哈希值
 *
 * 用法: node cli hash <file> [algorithm]
 *   algorithm 可选: md5（默认）, sha1, sha256, sha512
 *
 * 示例:
 *   node cli hash package.json
 *   node cli hash package.json sha256
 */
const FileService = require('@file-manager/core/fileService');

async function hashCommand(args, logger) {
  const filePath = args[0];
  if (!filePath) {
    logger.error('请提供文件路径');
    logger.info('');
    logger.info('用法: node cli hash <file> [algorithm]');
    logger.info('  algorithm 可选: md5（默认）, sha1, sha256, sha512');
    return;
  }

  const algorithm = args[1] || 'md5';

  const service = new FileService();
  const result = await service.hash(filePath, algorithm);

  logger.divider();
  logger.raw(`  文件: ${result.path}`);
  logger.raw(`  大小: ${(result.size / 1024).toFixed(2)} KB (${result.size} bytes)`);
  logger.raw(`  算法: ${result.algorithm.toUpperCase()}`);
  logger.raw(`  哈希: ${result.hash}`);
  logger.divider();
}

module.exports = hashCommand;
