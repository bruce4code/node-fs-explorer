/**
 * 文件操作核心服务
 * 封装所有文件/目录操作，使用 fs.promises API
 */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const pathValidator = require('./pathValidator');
const operationLogger = require('./operationLogger');
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

      try {
        const stat = await fs.stat(path.join(safePath, entry.name));
        item.modifiedTime = stat.mtime;
        if (!entry.isDirectory()) {
          item.size = stat.size;
        }
      } catch {
        if (!entry.isDirectory()) {
          item.size = 0;
        }
      }

      result.push(item);
    }

    operationLogger.log('list', safePath, { count: result.length });
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

    const content = await fs.readFile(safePath, 'utf-8');
    operationLogger.log('read', safePath, { size: content.length });
    return content;
  }

  /**
   * 获取文件/目录详细信息
   * @param {string} itemPath - 路径
   * @returns {Promise<object>} 详细信息
   */
  async info(itemPath) {
    const safePath = ensureExists(resolveSafePath(itemPath));
    const stat = await fs.stat(safePath);

    const info = {
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

    operationLogger.log('info', safePath, info);
    return info;
  }

  /**
   * 创建目录（支持递归创建）
   * @param {string} dirPath - 目录路径
   * @returns {Promise<string>} 创建的目录绝对路径
   */
  async mkdir(dirPath) {
    const safePath = resolveSafePath(dirPath);

    if (fsSync.existsSync(safePath)) {
      const stat = await fs.stat(safePath);
      if (stat.isDirectory()) {
        return safePath;
      }
      throw new Error(`Path exists but is not a directory: ${dirPath}`);
    }

    await fs.mkdir(safePath, { recursive: true });
    operationLogger.log('mkdir', safePath);
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

    const parentDir = path.dirname(safePath);
    if (!fsSync.existsSync(parentDir)) {
      await fs.mkdir(parentDir, { recursive: true });
    }

    await fs.writeFile(safePath, content, 'utf-8');
    operationLogger.log('write', safePath, { size: content.length });
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

    const parentDir = path.dirname(safeDst);
    if (!fsSync.existsSync(parentDir)) {
      await fs.mkdir(parentDir, { recursive: true });
    }

    await fs.copyFile(safeSrc, safeDst);
    operationLogger.log('copy', safeSrc, { target: safeDst });
    return safeDst;
  }

  /**
   * 移动/重命名文件或目录
   * @param {string} srcPath - 源路径
   * @param {string} dstPath - 目标路径
   * @returns {Promise<{src: string, dst: string}>}
   */
  async move(srcPath, dstPath) {
    const safeSrc = ensureExists(resolveSafePath(srcPath));
    const safeDst = resolveSafePath(dstPath);

    const parentDir = path.dirname(safeDst);
    if (!fsSync.existsSync(parentDir)) {
      await fs.mkdir(parentDir, { recursive: true });
    }

    await fs.rename(safeSrc, safeDst);
    operationLogger.log('move', safeSrc, { target: safeDst });
    return { src: safeSrc, dst: safeDst };
  }

  /**
   * 保存上传的文件（小文件，整 Buffer 写入）
   * @param {string} targetDir - 目标目录
   * @param {string} fileName - 原始文件名（会自动净化为 basename，防止路径穿越）
   * @param {Buffer} data - 文件数据
   * @returns {Promise<{path: string, fileName: string, size: number}>}
   */
  async upload(targetDir, fileName, data) {
    const { filePath, safeFileName, writeStream, sizeTracker } = this._prepareUpload(targetDir, fileName);
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
      writeStream.end(data);
    });
    const size = sizeTracker.size || data.length;
    operationLogger.log('upload', filePath, { size, fileName: safeFileName });
    return { path: filePath, fileName: safeFileName, size };
  }

  /**
   * 流式上传：准备写入流 + 大小限制 Transform，供 multipart 解析器边解析边写入
   *
   * 用法：
   *   const handle = fileService.prepareUploadStream(targetDir, fileName, maxSize);
   *   pipeline(parser, handle.sizeLimiter, handle.writeStream, callback);
   *   handle.writeStream.on('finish', () => fileService.logUpload(handle, ...));
   *
   * @param {string} targetDir - 目标目录
   * @param {string} fileName - 原始文件名（自动净化 basename）
   * @param {number} [maxSize] - 单文件大小上限（字节），超过则中止
   * @returns {{filePath: string, safeFileName: string, writeStream: fs.WriteStream, sizeLimiter: import('stream').Transform}}
   */
  prepareUploadStream(targetDir, fileName, maxSize) {
    const safeTargetDir = resolveSafePath(targetDir);
    const safeFileName = path.basename(fileName) || 'unnamed';
    const filePath = path.join(safeTargetDir, safeFileName);

    fsSync.mkdirSync(safeTargetDir, { recursive: true });
    const writeStream = fsSync.createWriteStream(filePath, { flags: 'w' });

    // 大小限制 Transform：统计写入字节，超限则销毁流并清理文件
    const sizeLimiter = new (require('stream').Transform)({
      transform(chunk, encoding, cb) {
        this.bytesWritten = (this.bytesWritten || 0) + chunk.length;
        if (maxSize && this.bytesWritten > maxSize) {
          this.destroy(new Error(`文件过大，单文件上限 ${maxSize} 字节`));
          // 清理半成品文件
          fsSync.unlink(filePath, () => {});
          return;
        }
        cb(null, chunk);
      },
    });

    return { filePath, safeFileName, writeStream, sizeLimiter };
  }

  /**
   * 记录上传完成日志（配合 prepareUploadStream 使用）
   */
  logUpload(handle, size) {
    operationLogger.log('upload', handle.filePath, { size, fileName: handle.safeFileName });
  }

  /**
   * 把临时文件移动到最终上传位置（流式上传的第二阶段）
   * @param {string} tmpPath - 临时文件路径（系统临时目录）
   * @param {string} targetDir - 目标目录
   * @param {string} fileName - 净化后的文件名
   * @param {number} size - 文件大小（字节数）
   * @returns {Promise<{path: string, fileName: string, size: number}>}
   */
  async moveUpload(tmpPath, targetDir, fileName, size) {
    const safeTargetDir = resolveSafePath(targetDir);
    const safeFileName = path.basename(fileName) || 'unnamed';
    const finalPath = path.join(safeTargetDir, safeFileName);

    // 确保目标目录存在
    fsSync.mkdirSync(safeTargetDir, { recursive: true });

    // 移动文件（跨设备时 rename 会失败，回退到 copy + unlink）
    try {
      await fs.rename(tmpPath, finalPath);
    } catch (renameErr) {
      if (renameErr.code === 'EXDEV') {
        // 跨设备：复制后删除临时文件
        await fs.copyFile(tmpPath, finalPath);
        await fs.unlink(tmpPath);
      } else {
        throw renameErr;
      }
    }

    operationLogger.log('upload', finalPath, { size, fileName: safeFileName });
    return { path: finalPath, fileName: safeFileName, size };
  }

  /**
   * 删除文件或目录
   * @param {string} targetPath - 目标路径
   * @returns {Promise<string>} 被删除的路径
   */
  async remove(targetPath) {
    const safePath = ensureExists(resolveSafePath(targetPath));

    if (safePath === pathValidator.getProjectRoot()) {
      throw new Error('Cannot delete project root directory');
    }

    const stat = await fs.stat(safePath);

    if (stat.isDirectory()) {
      await fs.rm(safePath, { recursive: true, force: true });
    } else {
      await fs.unlink(safePath);
    }

    operationLogger.log('remove', safePath, { isDirectory: stat.isDirectory() });
    return safePath;
  }

  /**
   * 搜索文件（递归 + 按名称/正则匹配）
   * @param {string} dirPath - 起始目录
   * @param {string|RegExp} pattern - 文件名匹配模式（字符串或正则）
   * @param {object} [options] - 搜索选项
   * @param {number} [options.maxDepth=10] - 最大递归深度
   * @param {number} [options.maxResults=100] - 最大返回结果数
   * @returns {Promise<Array<{name: string, fullPath: string, type: string, size: number}>>}
   */
  async search(dirPath, pattern, options = {}) {
    const { maxDepth = 10, maxResults = 100 } = options;
    const safePath = ensureExists(resolveSafePath(dirPath));
    // 支持两种模式：
    // 1. 字符串模式：大小写不敏感的子串匹配，支持 * 作为通配符
    // 2. RegExp 对象：直接使用自定义正则
    let regex;
    if (typeof pattern === 'string') {
      const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
      regex = new RegExp(escaped, 'i');
    } else {
      regex = pattern;
    }

    const results = [];

    async function walk(currentPath, depth) {
      if (depth > maxDepth || results.length >= maxResults) return;

      let entries;
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true });
      } catch {
        return; // 跳过无权限目录
      }

      for (const entry of entries) {
        if (results.length >= maxResults) break;

        const fullPath = path.join(currentPath, entry.name);

        if (regex.test(entry.name)) {
          const stat = entry.isDirectory() ? null : await fs.stat(fullPath).catch(() => null);
          results.push({
            name: entry.name,
            fullPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size: stat ? stat.size : 0,
          });
        }

        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
        }
      }
    }

    await walk(safePath, 0);
    operationLogger.log('search', safePath, { pattern: regex.toString(), count: results.length });
    return results;
  }

  /**
   * 预览文件内容
   * 文本文件返回前 N 行，图片返回 base64
   * @param {string} filePath - 文件路径
   * @param {number} [maxLines=20] - 最大返回行数
   * @returns {Promise<{type: string, content: string, totalLines?: number, extension: string}>}
   */
  async preview(filePath, maxLines = 20) {
    const safePath = ensureExists(resolveSafePath(filePath));
    const stat = await fs.stat(safePath);

    if (!stat.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    const extension = path.extname(safePath).toLowerCase();
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg'];

    // 图片文件：返回 base64
    if (imageExtensions.includes(extension)) {
      const maxPreviewSize = 2 * 1024 * 1024; // 2MB 限制
      if (stat.size > maxPreviewSize) {
        return {
          type: 'text',
          content: `[图片过大，无法预览: ${(stat.size / 1024 / 1024).toFixed(1)}MB]`,
          extension,
        };
      }

      const data = await fs.readFile(safePath);
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp',
        '.svg': 'image/svg+xml',
      };
      const contentType = mimeTypes[extension] || 'image/png';
      const base64 = data.toString('base64');
      const content = `data:${contentType};base64,${base64}`;

      operationLogger.log('preview', safePath, { type: 'image', size: data.length });
      return { type: 'image', content, extension };
    }

    // 文本文件：返回前 N 行
    const textExtensions = ['.txt', '.js', '.json', '.md', '.html', '.css', '.yml', '.yaml',
      '.xml', '.sh', '.env', '.gitignore', '.npmrc', '.editorconfig', ''];
    const isLikelyText = textExtensions.includes(extension) || extension === '';

    if (!isLikelyText) {
      // 尝试前 4KB 看是否可解析为 UTF-8
      const fd = await fs.open(safePath, 'r');
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fd.read(buf, 0, 4096, 0);
      await fd.close();

      const sample = buf.slice(0, bytesRead);
      const isValidUtf8 = sample.toString('utf-8').indexOf('\uFFFD') === -1;
      if (!isValidUtf8) {
        throw new Error('Cannot preview binary file');
      }
    }

    // 流式读取前 maxLines 行
    const lines = [];
    const readStream = fsSync.createReadStream(safePath, {
      highWaterMark: 64 * 1024,
      encoding: 'utf-8',
    });

    for await (const chunk of readStream) {
      const chunkLines = chunk.split('\n');
      for (let i = 0; i < chunkLines.length; i++) {
        if (lines.length >= maxLines) break;
        lines.push(chunkLines[i]);
      }
      if (lines.length >= maxLines) {
        readStream.destroy();
        break;
      }
    }

    // 计算总行数（只统计文件前 1MB 来估算）
    let totalLines;
    try {
      const content = await fs.readFile(safePath, { encoding: 'utf-8', flag: 'r' });
      totalLines = content.split('\n').length;
    } catch {
      totalLines = lines.length;
    }

    const result = {
      type: 'text',
      content: lines.join('\n'),
      extension,
      totalLines,
      previewLines: lines.length,
    };

    operationLogger.log('preview', safePath, { type: 'text', lines: lines.length });
    return result;
  }

  /**
   * 计算文件哈希值
   * @param {string} filePath - 文件路径
   * @param {string} [algorithm='md5'] - 哈希算法 (md5/sha1/sha256/sha512)
   * @returns {Promise<{algorithm: string, hash: string, size: number, path: string}>}
   */
  async hash(filePath, algorithm = 'md5') {
    const safePath = ensureExists(resolveSafePath(filePath));
    const stat = await fs.stat(safePath);

    if (!stat.isFile()) {
      throw new Error(`Not a file: ${filePath}`);
    }

    const supported = ['md5', 'sha1', 'sha256', 'sha512'];
    if (!supported.includes(algorithm)) {
      throw new Error(`Unsupported algorithm: ${algorithm}. Supported: ${supported.join(', ')}`);
    }

    const hash = crypto.createHash(algorithm);
    const readStream = fsSync.createReadStream(safePath);

    return new Promise((resolve, reject) => {
      readStream.on('data', (chunk) => hash.update(chunk));
      readStream.on('end', () => {
        const digest = hash.digest('hex');
        const result = {
          algorithm,
          hash: digest,
          size: stat.size,
          path: safePath,
        };
        operationLogger.log('hash', safePath, result);
        resolve(result);
      });
      readStream.on('error', reject);
    });
  }
}

module.exports = FileService;
