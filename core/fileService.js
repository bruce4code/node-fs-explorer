/**
 * 文件操作核心服务
 * 封装所有文件/目录操作，使用 fs.promises API
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const pathValidator = require('./pathValidator');
const { resolveSafePath, ensureExists } = pathValidator;

class FileService {
  /**
   * 浏览目录内容
   * @param {string} dirPath - 目录路径
   * @returns {Promise<Array<{name: string, type: string, size?: number}>>}
   */
  async list(dirPath) {
    const safePath = ensureExists(resolveSafePath(dirPath));
    const entries = await fs.readdir(safePath, { withFileTypes: true });

    const result = [];
    for (const entry of entries) {
      const item = {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
      };

      // 如果是文件，额外获取文件大小
      if (!entry.isDirectory()) {
        try {
          const stat = await fs.stat(path.join(safePath, entry.name));
          item.size = stat.size;
        } catch {
          item.size = 0;
        }
      }

      result.push(item);
    }

    return result;
  }

  /**
   * 读取文件内容
   * @param {string} filePath - 文件路径
   * @returns {Promise<string>} 文件内容
   */
  async read(filePath) {
    const safePath = ensureExists(resolveSafePath(filePath));
    const stat = await fs.stat(safePath);

    if (!stat.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    return await fs.readFile(safePath, 'utf-8');
  }

  /**
   * 获取文件/目录详细信息
   * @param {string} itemPath - 路径
   * @returns {Promise<object>} 详细信息
   */
  async info(itemPath) {
    const safePath = ensureExists(resolveSafePath(itemPath));
    const stat = await fs.stat(safePath);

    return {
      name: path.basename(safePath),
      fullPath: safePath,
      type: stat.isDirectory() ? 'directory' : 'file',
      size: stat.size,
      createdTime: stat.birthtime,
      modifiedTime: stat.mtime,
      accessTime: stat.atime,
      permissions: stat.mode.toString(8).slice(-3),
      isDirectory: stat.isDirectory(),
      isFile: stat.isFile(),
      isSymbolicLink: stat.isSymbolicLink(),
    };
  }

  /**
   * 创建目录（支持递归创建）
   * @param {string} dirPath - 目录路径
   * @returns {Promise<string>} 创建的目录绝对路径
   */
  async mkdir(dirPath) {
    const safePath = resolveSafePath(dirPath);

    // 如果目录已存在，直接返回
    if (fsSync.existsSync(safePath)) {
      const stat = await fs.stat(safePath);
      if (stat.isDirectory()) {
        return safePath;
      }
      throw new Error(`Path exists but is not a directory: ${dirPath}`);
    }

    // recursive: true 允许递归创建多级目录
    await fs.mkdir(safePath, { recursive: true });
    return safePath;
  }

  /**
   * 写入文件（覆盖模式）
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @returns {Promise<string>} 文件绝对路径
   */
  async write(filePath, content) {
    const safePath = resolveSafePath(filePath);

    // 确保父目录存在
    const parentDir = path.dirname(safePath);
    if (!fsSync.existsSync(parentDir)) {
      await fs.mkdir(parentDir, { recursive: true });
    }

    await fs.writeFile(safePath, content, 'utf-8');
    return safePath;
  }

  /**
   * 复制文件
   * @param {string} srcPath - 源文件路径
   * @param {string} dstPath - 目标文件路径
   * @returns {Promise<string>} 目标文件绝对路径
   */
  async copy(srcPath, dstPath) {
    const safeSrc = ensureExists(resolveSafePath(srcPath));
    const safeDst = resolveSafePath(dstPath);

    const srcStat = await fs.stat(safeSrc);
    if (!srcStat.isFile()) {
      throw new Error(`Source is not a file: ${srcPath}`);
    }

    // 确保目标父目录存在
    const parentDir = path.dirname(safeDst);
    if (!fsSync.existsSync(parentDir)) {
      await fs.mkdir(parentDir, { recursive: true });
    }

    await fs.copyFile(safeSrc, safeDst);
    return safeDst;
  }

  /**
   * 删除文件或目录
   * @param {string} targetPath - 目标路径
   * @returns {Promise<string>} 被删除的路径
   */
  async remove(targetPath) {
    const safePath = ensureExists(resolveSafePath(targetPath));

    // 禁止删除项目根目录
    if (safePath === pathValidator.getProjectRoot()) {
      throw new Error('Cannot delete project root directory');
    }

    const stat = await fs.stat(safePath);

    if (stat.isDirectory()) {
      // 递归删除目录
      await fs.rm(safePath, { recursive: true, force: true });
    } else {
      await fs.unlink(safePath);
    }

    return safePath;
  }
}

module.exports = FileService;
