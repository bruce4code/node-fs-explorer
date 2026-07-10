/**
 * 流式 multipart/form-data 解析器
 *
 * 与 lib/multipartParser.js 的区别：
 *   - 旧版 parseMultipart 需要 Buffer.concat(chunks) 全量缓冲到内存，大文件会 OOM
 *   - 本解析器基于 stream.Transform，边接收边解析，文件 part 通过回调流式写盘
 *
 * 使用方式：
 *   const parser = createMultipartStream(boundary, {
 *     onField(name, value) { ... },      // 普通字段（值已完整收集）
 *     onFileStart(name, filename, contentType) { ... return writeStream }, // 文件开始，返回一个可写流
 *     onFileEnd(name, filename) { ... }, // 文件结束
 *   });
 *   pipeline(req, parser, callback);
 */

const { Transform } = require('stream');

/**
 * 创建流式 multipart 解析器
 * @param {string} boundary - multipart boundary（不含前缀 --）
 * @param {object} handlers - 事件回调
 * @param {Function} [handlers.onField] - (name: string, value: string) => void
 * @param {Function} [handlers.onFileStart] - (name, filename, contentType) => stream.Writable | null
 *        返回一个可写流，解析器会把文件数据 pipe 进去；返回 null 则丢弃该文件
 * @param {Function} [handlers.onFileEnd] - (name, filename) => void
 * @returns {Transform}
 */
function createMultipartStream(boundary, handlers = {}) {
  const { onField, onFileStart, onFileEnd } = handlers;

  // 分隔符相关 Buffer
  const delimiter = Buffer.from(`--${boundary}`);
  const endMarker = Buffer.from(`--${boundary}--`);
  const crlf = Buffer.from('\r\n');
  const headerSep = Buffer.from('\r\n\r\n');

  // 解析状态机
  const STATE = {
    SEARCH_BOUNDARY: 0,   // 寻找第一个 boundary
    IN_HEADERS: 1,        // 解析 part 头部
    IN_DATA: 2,           // part 数据（文件或字段值）
    DONE: 3,              // 遇到结束标记
  };

  let state = STATE.SEARCH_BOUNDARY;
  let buffer = Buffer.alloc(0);

  // 当前 part 信息
  let currentPart = null;       // { name, filename, contentType, isFile }
  let currentWriteStream = null; // 文件 part 的写入流
  let fieldChunks = [];          // 普通字段的 chunks（字段值通常很小，可缓冲）

  const transform = new Transform({
    // 不自动 decode 字符串，保持 Buffer
    decodeStrings: true,

    transform(chunk, encoding, cb) {
      buffer = Buffer.concat([buffer, chunk]);
      // 循环处理，因为一个 chunk 可能包含多个 part
      this._processBuffer(cb);
    },

    flush(cb) {
      // 流结束时的清理
      if (currentWriteStream) {
        currentWriteStream.end();
      }
      cb();
    },
  });

  // 把 _processBuffer 挂到实例上（避免 Transform 内部冲突）
  transform._processBuffer = function _processBuffer(done) {
    // 防止无限循环
    let progress = true;
    while (progress && state !== STATE.DONE) {
      progress = false;

      if (state === STATE.SEARCH_BOUNDARY) {
        const idx = buffer.indexOf(delimiter);
        if (idx === -1) {
          // 保留可能是不完整 boundary 的尾部
          if (buffer.length > delimiter.length) {
            buffer = buffer.slice(buffer.length - delimiter.length);
          }
          break;
        }
        // 丢弃 boundary 之前的内容（通常是 preamble，可忽略）
        const after = idx + delimiter.length;
        // 检查是否是结束标记 --boundary--
        if (buffer.length >= after + 2 && buffer[after] === 45 && buffer[after + 1] === 45) {
          state = STATE.DONE;
          buffer = Buffer.alloc(0);
          done();
          return;
        }
        // 跳过 boundary 后的 \r\n
        let pos = after;
        if (buffer[pos] === 13) pos++;
        if (buffer[pos] === 10) pos++;
        buffer = buffer.slice(pos);
        state = STATE.IN_HEADERS;
        progress = true;
        continue;
      }

      if (state === STATE.IN_HEADERS) {
        const headerEnd = buffer.indexOf(headerSep);
        if (headerEnd === -1) {
          // 头部未完整，等待更多数据
          break;
        }
        const headerRaw = buffer.slice(0, headerEnd).toString('utf-8');
        buffer = buffer.slice(headerEnd + 4); // 跳过 \r\n\r\n

        currentPart = parseHeaders(headerRaw);
        if (currentPart.filename != null) {
          currentPart.isFile = true;
          // 通知文件开始，获取写入流
          currentWriteStream = onFileStart
            ? onFileStart(currentPart.name, currentPart.filename, currentPart.contentType)
            : null;
          if (currentWriteStream) {
            currentWriteStream.on('error', (err) => {
              transform.destroy(err);
            });
          }
        } else {
          currentPart.isFile = false;
          fieldChunks = [];
        }
        state = STATE.IN_DATA;
        progress = true;
        continue;
      }

      if (state === STATE.IN_DATA) {
        // 在数据中寻找下一个 delimiter（含前导 \r\n）
        const searchFrom = 0;
        // boundary 前面通常有 \r\n，但文件内容里也可能出现 \r\n
        // 标准：\r\n--boundary 表示 part 结束
        const delimiterWithCrlf = Buffer.concat([crlf, delimiter]);
        const idx = buffer.indexOf(delimiterWithCrlf, searchFrom);

        if (idx === -1) {
          // 没找到完整 boundary，但可能 boundary 跨 chunk
          // 安全策略：保留末尾可能不完整的部分，其余写出
          const safeKeep = delimiterWithCrlf.length;
          if (buffer.length > safeKeep) {
            const toWrite = buffer.slice(0, buffer.length - safeKeep);
            buffer = buffer.slice(buffer.length - safeKeep);
            if (toWrite.length > 0) {
              writePartData(toWrite);
            }
          }
          break;
        }

        // 找到 boundary，idx 之前的数据（去掉末尾 \r\n）属于当前 part
        const dataEnd = idx; // \r\n--boundary 中的 \r 位置
        const data = buffer.slice(0, dataEnd);
        if (data.length > 0) {
          writePartData(data);
        }

        // 完成当前 part
        finishPart();

        // 跳过 \r\n--boundary
        let pos = idx + delimiterWithCrlf.length;
        // 检查是否结束标记
        if (buffer.length >= pos + 2 && buffer[pos] === 45 && buffer[pos + 1] === 45) {
          // --boundary--
          state = STATE.DONE;
          buffer = Buffer.alloc(0);
          done();
          return;
        }
        // 跳过 boundary 后的 \r\n，进入下一个 part
        if (buffer[pos] === 13) pos++;
        if (buffer[pos] === 10) pos++;
        buffer = buffer.slice(pos);
        state = STATE.IN_HEADERS;
        progress = true;
        continue;
      }
    }
    done();
  };

  function writePartData(data) {
    if (!currentPart) return;
    if (currentPart.isFile) {
      if (currentWriteStream && !currentWriteStream.destroyed) {
        currentWriteStream.write(data);
      }
    } else {
      fieldChunks.push(data);
    }
  }

  function finishPart() {
    if (!currentPart) return;
    if (currentPart.isFile) {
      if (currentWriteStream) {
        currentWriteStream.end();
        currentWriteStream = null;
      }
      if (onFileEnd) onFileEnd(currentPart.name, currentPart.filename);
    } else {
      const value = Buffer.concat(fieldChunks).toString('utf-8');
      if (onField) onField(currentPart.name, value);
      fieldChunks = [];
    }
    currentPart = null;
  }

  return transform;
}

/**
 * 解析 part 头部
 * @param {string} headerRaw - 头部原始文本
 * @returns {{name: string, filename: string|null, contentType: string|null}}
 */
function parseHeaders(headerRaw) {
  const part = { name: '', filename: null, contentType: null };
  const lines = headerRaw.split('\r\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith('content-disposition:')) {
      const nameMatch = line.match(/name="([^"]*)"/);
      if (nameMatch) part.name = nameMatch[1];
      const filenameMatch = line.match(/filename="([^"]*)"/);
      if (filenameMatch) part.filename = filenameMatch[1];
    } else if (line.toLowerCase().startsWith('content-type:')) {
      part.contentType = line.split(':')[1].trim();
    }
  }
  return part;
}

module.exports = { createMultipartStream };
