/**
 * info 命令 - 获取文件/目录详细信息
 * 用法: node cli info <path>
 */
const FileService = require('@file-manager/core/fileService');

function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + units[i];
}

module.exports = async function (args, logger) {
  const targetPath = args[0];

  if (!targetPath) {
    throw new Error('请指定要查看的路径');
  }

  const service = new FileService();
  const info = await service.info(targetPath);

  logger.info(`路径信息: ${info.fullPath}`);
  logger.divider();

  console.log(`  名称:         ${info.name}`);
  console.log(`  类型:         ${info.type === 'directory' ? '目录' : '文件'}`);
  console.log(`  大小:         ${formatSize(info.size)}`);
  console.log(`  权限:         ${info.permissions}`);
  console.log(`  创建时间:     ${info.createdTime.toLocaleString('zh-CN')}`);
  console.log(`  修改时间:     ${info.modifiedTime.toLocaleString('zh-CN')}`);
  console.log(`  访问时间:     ${info.accessTime.toLocaleString('zh-CN')}`);
  console.log(`  符号链接:     ${info.isSymbolicLink ? '是' : '否'}`);
};
