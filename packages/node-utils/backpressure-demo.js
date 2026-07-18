#!/usr/bin/env node

/**
 * 背压（Backpressure）深度演示
 *
 * 运行:
 *   node lib/backpressure-demo.js
 */

const fs = require('fs');
const path = require('path');
const { Readable, Writable } = require('stream');

// =============================================
// 第一部分：验证 pipe 自动处理背压
// =============================================
console.log('═══════════════════════════════════════════');
console.log('第一部分：pipe() 自动处理背压');
console.log('═══════════════════════════════════════════\n');

// 模拟一个读取极快的生产者
class FastSource extends Readable {
  constructor(options) {
    super(options);
    this.count = 0;
    this.max = 100;
    this.totalPushed = 0;
    this.totalPaused = 0;
    this.startTime = Date.now();
  }

  _read() {
    // 每次 push 1KB 数据
    const chunk = Buffer.alloc(1024, 'A');

    // 模拟高速生产
    while (this.count < this.max) {
      const canPush = this.push(chunk);
      this.count++;
      this.totalPushed += chunk.length;

      if (!canPush) {
        // 背压发生！缓冲区满了，暂停
        console.log(`  [背压] 推送第 ${this.count} 块时缓冲区满，暂停生产`);
        this.totalPaused++;
        return;
      }
    }

    if (this.count >= this.max) {
      this.push(null); // 结束
    }
  }
}

// 模拟一个写入极慢的消费者
class SlowSink extends Writable {
  constructor(options) {
    super(options);
    this.totalWritten = 0;
    this.writeCount = 0;
  }

  _write(chunk, encoding, callback) {
    // 模拟慢速写入：每块写完后等 50ms
    setTimeout(() => {
      this.totalWritten += chunk.length;
      this.writeCount++;

      if (this.writeCount % 10 === 0) {
        console.log(`  [消费] 已写入 ${this.writeCount} 块 (${(this.totalWritten / 1024).toFixed(0)}KB)`);
      }

      callback(); // 通知 stream 可以处理下一块了
    }, 50); // 50ms 写一块，非常慢
  }
}

console.log('创建 FastSource(highWaterMark: 8KB) → SlowSink(highWaterMark: 8KB)');
console.log('FastSource: 生产 100 块 × 1KB = 100KB 数据');
console.log('SlowSink:  每 50ms 写入 1 块，极慢\n');

async function runPipeDemo() {
  return new Promise((resolve) => {
    const source = new FastSource({ highWaterMark: 8 * 1024 });  // 8KB 缓冲区
    const sink = new SlowSink({ highWaterMark: 8 * 1024 });      // 8KB 缓冲区

    console.log('▶ 使用 pipe() 连接...\n');

    const startTime = Date.now();

    // 记录背压事件
    let pauseCount = 0;
    source.on('pause', () => {
      pauseCount++;
    });

    sink.on('drain', () => {
      console.log(`  [drain] 缓冲区清空，通知生产者恢复`);
    });

    source.pipe(sink);

    sink.on('finish', () => {
      const elapsed = Date.now() - startTime;
      console.log(`\n✅ pipe() 完成:`);
      console.log(`   生产: ${source.totalPushed} bytes`);
      console.log(`   消费: ${sink.totalWritten} bytes`);
      console.log(`   耗时: ${elapsed}ms`);
      console.log(`   背压暂停次数: ${pauseCount}次`);
      resolve();
    });
  });
}

// =============================================
// 第二部分：如果不处理背压会怎样？
// =============================================
console.log('\n═══════════════════════════════════════════');
console.log('第二部分：不处理背压的后果（无背压控制的写入）');
console.log('═══════════════════════════════════════════\n');

class NoBackpressureSink extends Writable {
  constructor(options) {
    super(options);
    this.totalWritten = 0;
    this.writeCount = 0;
    this.highWaterMark = options.highWaterMark || 16 * 1024;
  }

  _write(chunk, encoding, callback) {
    // 不看 write() 返回值，一直写入
    this.totalWritten += chunk.length;
    this.writeCount++;

    // 用 setTimeout 模拟异步
    setTimeout(() => {
      callback();
    }, 10);
  }

  // 重写 write 方法，忽略背压信号
  write(chunk, encoding, callback) {
    // 永远返回 true，假装缓冲区永远不满！
    return super.write(chunk, encoding, callback) || true;
  }
}

console.log('模拟忽略背压的情况：数据会无限堆积在 Writable 内部缓冲区\n');

// 通过检查 Writable 的内部状态来演示
const { Writable: WritableOriginal } = require('stream');

// 一个观察者：监控 Writable 的缓冲区大小
function monitorBuffer() {
  const writable = new WritableOriginal({
    highWaterMark: 1024, // 1KB 小缓冲区
    write(chunk, encoding, callback) {
      // 模拟慢速消费
      setTimeout(callback, 100);
    },
  });

  let totalWritten = 0;
  let bufferFullReported = false;

  console.log('Writable highWaterMark = 1KB');
  console.log('写入速度远快于消费速度...\n');

  const interval = setInterval(() => {
    // 检查内部缓冲区状态（Node.js 内部属性，仅用于演示！）
    const buffered = writable.writableLength || 0;
    console.log(`  缓冲区: ${(buffered / 1024).toFixed(1)}KB  |  write() 返回: ${buffered < 1024}`);

    if (buffered > 50 * 1024 && !bufferFullReported) {
      console.log(`\n  ⚠️  缓冲区已膨胀到 ${(buffered / 1024).toFixed(0)}KB！`);
      console.log(`  ⚠️  如果数据继续流入，最终会导致内存溢出 (OOM)\n`);
      bufferFullReported = true;
    }
  }, 200);

  // 疯狂写入
  const hugeChunk = Buffer.alloc(1024, 'X');
  let written = 0;

  function keepWriting() {
    for (let i = 0; i < 100; i++) {
      writable.write(hugeChunk);
      written += hugeChunk.length;
    }

    if (written < 200 * 1024) {
      setImmediate(keepWriting);
    } else {
      setTimeout(() => {
        clearInterval(interval);
        console.log(`\n✅ 观察结束，总共写入了 ${(written / 1024).toFixed(0)}KB`);
        console.log('   实际生产环境，这类问题会导致内存溢出！');
        writable.end();
        runManualDemo();
      }, 1000);
    }
  }

  keepWriting();
}

// =============================================
// 第三部分：手动实现背压控制
// =============================================
function runManualDemo() {
  console.log('\n═══════════════════════════════════════════');
  console.log('第三部分：手动实现背压控制');
  console.log('═══════════════════════════════════════════\n');

  console.log('在项目代码中，可以这样手动处理背压：\n');

  // 示例：可运行的手动背压控制
  const { Readable: R, Writable: W } = require('stream');

  class Producer extends R {
    constructor() {
      super({ highWaterMark: 4 * 1024 }); // 4KB 缓冲区
      this.data = Buffer.alloc(1024, 'P'); // 每次 1KB
    }

    _read() {
      // _read 由消费者按需调用，本身就有背压控制
      const canPush = this.push(this.data);
      if (!canPush) {
        console.log('  [生产者] 缓冲区满，停止生产 (等待 drain)');
      }
    }
  }

  class Consumer extends W {
    constructor() {
      super({ highWaterMark: 4 * 1024 }); // 4KB 缓冲区
      this.chunks = 0;
    }

    _write(chunk, encoding, callback) {
      this.chunks++;
      // 模拟慢消费
      setTimeout(() => {
        if (this.chunks % 5 === 0) {
          console.log(`  [消费者] 已处理 ${this.chunks} 块`);
        }
        callback();
      }, 30);
    }
  }

  console.log('▶ 手动背压控制的关键代码模式：');
  console.log(`
  function pump(readable, writable, callback) {
    let onData, onEnd, onDrain;

    // 1. 读取数据
    onData = (chunk) => {
      const canWrite = writable.write(chunk);

      // 2. 如果写缓冲区满了，暂停读取
      if (!canWrite) {
        readable.pause();
      }
    };

    // 3. 写缓冲区清空后，恢复读取
    onDrain = () => {
      readable.resume();
    };

    // 4. 读取完毕
    onEnd = () => {
      writable.end(callback);
    };

    readable.on('data', onData);
    readable.on('end', onEnd);
    writable.on('drain', onDrain);
  }
  `);

  console.log('▶ 运行手动背压控制...\n');

  const prod = new Producer();
  const cons = new Consumer();

  // 手动背压模式
  prod.on('data', (chunk) => {
    const canContinue = cons.write(chunk);
    if (!canContinue) {
      prod.pause();
      console.log('  [背压] 暂停生产者');
    }
  });

  cons.on('drain', () => {
    console.log('  [drain] 恢复生产者');
    prod.resume();
  });

  prod.on('end', () => {
    console.log('\n✅ 手动背压控制完成');
    cons.end();
    printSummary();
  });
}

// =============================================
// 总结输出
// =============================================
function printSummary() {
  console.log('\n═══════════════════════════════════════════');
  console.log('背压总结');
  console.log('═══════════════════════════════════════════\n');
  console.log('  背压的本质: 消费者速度 < 生产者速度时，防止内存溢出');
  console.log('');
  console.log('  关键方法:');
  console.log('    writable.write(chunk)  → 返回 false 表示背压');
  console.log('    readable.pause()       → 暂停数据发射');
  console.log('    readable.resume()      → 恢复数据发射');
  console.log('');
  console.log('  关键事件:');
  console.log('    writable.on(\'drain\')   → 缓冲区清空，可以继续写');
  console.log('    readable.on(\'data\')    → 有数据可读');
  console.log('');
  console.log('  highWaterMark 的作用:');
  console.log('    控制内部缓冲区大小上限（默认 16KB）');
  console.log('    达到 highWaterMark 时，write() 返回 false');
  console.log('    触发背压信号');
  console.log('');
  console.log('  pipe() 做了什么:');
  console.log('    1. readable.on(\'data\') → writable.write()');
  console.log('    2. write() 返回 false → readable.pause()');
  console.log('    3. writable.on(\'drain\') → readable.resume()');
  console.log('    4. readable.on(\'end\') → writable.end()');
  console.log('');
  console.log('  在项目中的体现:');
  console.log('    大文件下载: createReadStream.pipe(res)');
  console.log('    网络请求体解析: req.on(\'data\').on(\'end\')');
}

// =============================================
// 运行
// =============================================
runPipeDemo().then(() => {
  setTimeout(() => {
    monitorBuffer();
  }, 500);
});