/**
 * multipart/form-data 解析器
 *
 * 手动解析 multipart 格式的请求体，不依赖第三方库。
 * 用于处理文件上传时解析表单字段和文件数据。
 */

/**
 * 解析 multipart 请求体
 *
 * @param {Buffer} body - 原始请求体 Buffer
 * @param {string} boundary - 分隔符（从 Content-Type header 中提取）
 * @returns {Array<{name: string, filename: string|null, contentType: string|null, data: Buffer}>}
 */
function parseMultipart(body, boundary) {
  const parts = [];
  const delimiter = Buffer.from(`--${boundary}`);
  const endMarker = Buffer.from(`--${boundary}--`);

  let pos = 0;

  while (pos < body.length) {
    // 查找下一个分隔符
    const boundaryStart = body.indexOf(delimiter, pos);
    if (boundaryStart === -1) break;

    const afterBoundary = boundaryStart + delimiter.length;

    // 检查是否是结束标记
    if (body.length >= afterBoundary + 2 &&
        body[afterBoundary] === 45 && body[afterBoundary + 1] === 45) {
      break; // 遇到 --boundary--
    }

    // 跳过分隔符后的 \r\n
    let dataStart = afterBoundary;
    if (body[dataStart] === 13) dataStart++; // \r
    if (body[dataStart] === 10) dataStart++; // \n

    // 查找下一个分隔符位置，确定当前 part 的结束
    const nextBoundary = body.indexOf(delimiter, dataStart);
    if (nextBoundary === -1) break;

    // part 数据在下一个分隔符之前，去掉末尾的 \r\n
    let dataEnd = nextBoundary;
    if (dataEnd >= 2 && body[dataEnd - 1] === 10) dataEnd--;
    if (dataEnd >= 2 && body[dataEnd - 1] === 13) dataEnd--;

    const partBuffer = body.slice(dataStart, dataEnd);

    // 解析 part：分离 header 和 body
    // header 以 \r\n\r\n 结束
    const headerEnd = findBuffer(partBuffer, Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) {
      pos = nextBoundary;
      continue;
    }

    const headerRaw = partBuffer.slice(0, headerEnd).toString('utf-8');
    const content = partBuffer.slice(headerEnd + 4); // 跳过 \r\n\r\n

    const part = {
      name: '',
      filename: null,
      contentType: null,
      data: content,
    };

    // 解析 header 行
    const headerLines = headerRaw.split('\r\n');
    for (const line of headerLines) {
      if (line.startsWith('Content-Disposition')) {
        const nameMatch = line.match(/name="([^"]*)"/);
        if (nameMatch) part.name = nameMatch[1];

        const filenameMatch = line.match(/filename="([^"]*)"/);
        if (filenameMatch) part.filename = filenameMatch[1];
      }

      if (line.startsWith('Content-Type')) {
        part.contentType = line.split(':')[1]?.trim() || null;
      }
    }

    parts.push(part);
    pos = nextBoundary;
  }

  return parts;
}

/**
 * 在 Buffer 中查找子 Buffer 的位置
 * @param {Buffer} haystack
 * @param {Buffer} needle
 * @returns {number} 位置索引，未找到返回 -1
 */
function findBuffer(haystack, needle) {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let match = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

/**
 * 从 Content-Type header 中提取 boundary
 * @param {string} contentType - Content-Type header 值
 * @returns {string|null} boundary 字符串
 */
function extractBoundary(contentType) {
  const match = contentType.match(/boundary=([^;\s]+)/);
  return match ? match[1] : null;
}

module.exports = { parseMultipart, extractBoundary };
