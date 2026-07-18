/**
 * remove 命令 - 删除文件或目录
 * 用法: node cli remove <path>
 */
const FileService = require('@file-manager/core/fileService');

module.exports = async function (args, logger) {
  const targetPath = args[0];

  if (!targetPath) {
    throw new Error('请指定要删除的路径');
  }

  // 安全确认
  logger.warn(`即将删除: ${targetPath}`);
  logger.warn('此操作不可恢复！确认请输 y/Y，取消请按任意其他键');

  // 简单确认
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question('确认删除? (y/N): ', (ans) => {
      resolve(ans.trim().toLowerCase());
    });
  });
  rl.close();

  if (answer !== 'y' && answer !== 'yes') {
    logger.info('已取消删除操作');
    return;
  }

  const service = new FileService();
  const result = await service.remove(targetPath);

  logger.info(`删除成功: ${result}`);
};
