/**
 * list 命令 - 浏览目录内容
 * 用法: node cli list [dir]
 */
const FileService = require('@file-manager/core/fileService');
const path = require('path');

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + units[i];
}

module.exports = async function (args, logger) {
  const dirPath = args[0] || '.';
  const service = new FileService();

  const entries = await service.list(dirPath);
  const resolvedPath = path.resolve(dirPath);

  logger.info(`浏览目录: ${resolvedPath}`);
  logger.divider();

  if (entries.length === 0) {
    logger.warn('目录为空');
    return;
  }

  // 分别输出目录和文件
  const dirs = entries.filter((e) => e.type === 'directory');
  const files = entries.filter((e) => e.type === 'file');

  for (const dir of dirs) {
    console.log(`  [DIR]   ${dir.name}`);
  }
  for (const file of files) {
    const size = formatSize(file.size || 0).padStart(8);
    console.log(`  [FILE]  ${file.name}  ${size}`);
  }

  logger.divider();
  logger.data(`共 ${entries.length} 项（${dirs.length} 个目录，${files.length} 个文件）`);
};
