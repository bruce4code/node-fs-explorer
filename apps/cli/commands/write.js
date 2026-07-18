/**
 * write 命令 - 写入文件内容
 * 用法: node cli write <file> <content>
 */
const FileService = require('@file-manager/core/fileService');

module.exports = async function (args, logger) {
  const filePath = args[0];
  const content = args.slice(1).join(' ');

  if (!filePath) {
    throw new Error('请指定要写入的文件路径');
  }

  if (!content) {
    throw new Error('请提供要写入的文件内容');
  }

  const service = new FileService();
  const result = await service.write(filePath, content);

  logger.info(`文件写入成功: ${result}`);
};
