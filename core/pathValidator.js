/**
 * 路径安全校验模块
 * 防止目录穿越攻击，确保所有文件操作在安全范围内
 */
const path = require('path');
const fs = require('fs');

const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * 将输入路径解析为安全的绝对路径
 * 如果解析后的路径超出项目根目录，则抛出错误
 * @param {string} inputPath - 用户输入的路径
 * @returns {string} 安全的绝对路径
 */
function resolveSafePath(inputPath) {
  // 处理空值，默认当前目录
  const targetPath = inputPath || '.';
  const resolved = path.resolve(PROJECT_ROOT, targetPath);

  // 防止目录穿越攻击
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error('Invalid path: directory traversal detected');
  }

  return resolved;
}

/**
 * 确保路径存在，不存在则抛出错误
 * @param {string} resolvedPath - 已经过resolveSafePath的路径
 * @returns {string} 确认存在的路径
 */
function ensureExists(resolvedPath) {
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Path does not exist: ${resolvedPath}`);
  }
  return resolvedPath;
}

/**
 * 获取项目根目录路径
 * @returns {string}
 */
function getProjectRoot() {
  return PROJECT_ROOT;
}

module.exports = {
  resolveSafePath,
  ensureExists,
  getProjectRoot,
};
