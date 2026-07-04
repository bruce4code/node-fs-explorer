/**
 * pathValidator 单元测试
 * 使用 Node.js 内置测试框架 node:test（Node 18+）
 *
 * 运行: node --test test/pathValidator.test.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const pathValidator = require('../core/pathValidator');

const PROJECT_ROOT = path.resolve(__dirname, '..');

// =============================================
// resolveSafePath 测试
// =============================================
describe('pathValidator.resolveSafePath', () => {
  it('应解析当前目录 "." 为项目根目录', () => {
    const result = pathValidator.resolveSafePath('.');
    assert.strictEqual(result, PROJECT_ROOT);
  });

  it('应解析子目录的相对路径', () => {
    const result = pathValidator.resolveSafePath('cli');
    assert.strictEqual(result, path.join(PROJECT_ROOT, 'cli'));
  });

  it('应解析多级相对路径', () => {
    const result = pathValidator.resolveSafePath('cli/commands');
    assert.strictEqual(result, path.join(PROJECT_ROOT, 'cli', 'commands'));
  });

  it('应抛出错误 - 路径穿越 ../../', () => {
    assert.throws(
      () => pathValidator.resolveSafePath('../../etc/passwd'),
      { message: /directory traversal/i },
    );
  });

  it('应抛出错误 - 路径穿越 ../../../', () => {
    assert.throws(
      () => pathValidator.resolveSafePath('../../../'),
      { message: /directory traversal/i },
    );
  });

  it('应抛出错误 - 绝对路径在项目外', () => {
    assert.throws(
      () => pathValidator.resolveSafePath('/tmp'),
      { message: /directory traversal/i },
    );
  });

  it('应抛出错误 - 路径穿越到上级目录 ../', () => {
    assert.throws(
      () => pathValidator.resolveSafePath('../'),
      { message: /directory traversal/i },
    );
  });

  it('应抛出错误 - 编码混淆的路径穿越', () => {
    assert.throws(
      () => pathValidator.resolveSafePath('core/../../etc/passwd'),
      { message: /directory traversal/i },
    );
  });

  it('应处理空输入为当前目录', () => {
    const result = pathValidator.resolveSafePath('');
    assert.strictEqual(result, PROJECT_ROOT);
  });

  it('应处理 undefined 为当前目录', () => {
    const result = pathValidator.resolveSafePath(undefined);
    assert.strictEqual(result, PROJECT_ROOT);
  });

  it('应允许项目根目录本身', () => {
    const result = pathValidator.resolveSafePath(PROJECT_ROOT);
    assert.strictEqual(result, PROJECT_ROOT);
  });
});

// =============================================
// ensureExists 测试
// =============================================
describe('pathValidator.ensureExists', () => {
  it('应返回存在的路径', () => {
    const result = pathValidator.ensureExists(__dirname);
    assert.strictEqual(result, __dirname);
  });

  it('应返回存在的项目根目录', () => {
    const result = pathValidator.ensureExists(PROJECT_ROOT);
    assert.strictEqual(result, PROJECT_ROOT);
  });

  it('应抛出错误 - 路径不存在', () => {
    assert.throws(
      () => pathValidator.ensureExists('/nonexistent/random/path/12345'),
      { message: /does not exist/i },
    );
  });

  it('应验证文件存在', () => {
    // 用当前文件自身做验证
    const result = pathValidator.ensureExists(__filename);
    assert.strictEqual(result, __filename);
  });
});

// =============================================
// getProjectRoot 测试
// =============================================
describe('pathValidator.getProjectRoot', () => {
  it('应返回项目根目录', () => {
    const root = pathValidator.getProjectRoot();
    assert.strictEqual(root, PROJECT_ROOT);
  });

  it('项目根目录下应包含 package.json', () => {
    const root = pathValidator.getProjectRoot();
    const pkgPath = path.join(root, 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json 应该存在于项目根目录');
  });
});
