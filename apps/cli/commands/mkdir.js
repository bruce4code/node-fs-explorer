/**
 * mkdir 命令 - 创建目录
 * 用法: node cli mkdir <dir>
 */
const FileService = require('@file-manager/core/fileService');

module.exports = async function (args, logger) {
  const dirPath = args[0];

  if (!dirPath) {
    throw new Error('请指定要创建的目录路径');
  }

  const service = new FileService();
  const result = await service.mkdir(dirPath);

  logger.info(`目录创建成功: ${result}`);
};
