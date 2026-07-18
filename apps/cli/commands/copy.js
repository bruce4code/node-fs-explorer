/**
 * copy 命令 - 复制文件
 * 用法: node cli copy <src> <dst>
 */
const FileService = require('@file-manager/core/fileService');

module.exports = async function (args, logger) {
  const srcPath = args[0];
  const dstPath = args[1];

  if (!srcPath || !dstPath) {
    throw new Error('请指定源文件路径和目标文件路径\n  用法: node cli copy <源文件> <目标文件>');
  }

  const service = new FileService();
  const result = await service.copy(srcPath, dstPath);

  logger.info(`文件复制成功: ${result}`);
};
