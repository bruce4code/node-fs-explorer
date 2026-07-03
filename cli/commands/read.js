/**
 * read 命令 - 读取文件内容
 * 用法: node cli read <file>
 */
const FileService = require('../../core/fileService');

module.exports = async function (args, logger) {
  const filePath = args[0];

  if (!filePath) {
    throw new Error('请指定要读取的文件路径');
  }

  const service = new FileService();
  const content = await service.read(filePath);

  logger.info(`读取文件: ${filePath}`);
  logger.divider();
  console.log(content);
};
