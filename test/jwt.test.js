/**
 * JWT 工具库单元测试
 *
 * 运行: node --test test/jwt.test.js
 */
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');
const jwt = require('../packages/node-utils/jwt');

const SECRET = 'test-secret-key-12345';
const WRONG_SECRET = 'wrong-secret';

describe('JWT 工具库', () => {
  // 每个测试前清理黑名单
  beforeEach(() => {
    jwt._blacklist.clear();
  });

  describe('sign/verify 基本功能', () => {
    it('应签发并验证通过 token', () => {
      const payload = { sub: 'user1', name: 'alice' };
      const token = jwt.sign(payload, SECRET, { expiresIn: 3600 });

      assert.ok(typeof token === 'string');
      assert.strictEqual(token.split('.').length, 3);

      const decoded = jwt.verify(token, SECRET);
      assert.strictEqual(decoded.sub, 'user1');
      assert.strictEqual(decoded.name, 'alice');
      assert.ok(decoded.iat);
      assert.ok(decoded.exp);
      assert.strictEqual(decoded.exp - decoded.iat, 3600);
    });

    it('应包含 iat 和 exp 声明', () => {
      const token = jwt.sign({ sub: 'test' }, SECRET, { expiresIn: 60 });
      const decoded = jwt.verify(token, SECRET);

      assert.ok(decoded.iat > 0, '应包含 iat');
      assert.ok(decoded.exp > decoded.iat, 'exp 应大于 iat');
      assert.strictEqual(decoded.exp - decoded.iat, 60);
    });

    it('应支持自定义 issuer', () => {
      const token = jwt.sign({ sub: 'test' }, SECRET, { expiresIn: 60, issuer: 'my-app' });
      const decoded = jwt.verify(token, SECRET);

      assert.strictEqual(decoded.iss, 'my-app');
    });
  });

  describe('签名验证', () => {
    it('错误密钥应拒绝 token', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET);
      assert.throws(
        () => jwt.verify(token, WRONG_SECRET),
        { code: 'INVALID_SIGNATURE' },
      );
    });

    it('篡改 payload 应拒绝 token', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET);
      const parts = token.split('.');
      // 篡改 payload
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: 'admin', iat: 0, exp: 9999999999 })).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      assert.throws(
        () => jwt.verify(tamperedToken, SECRET),
        { code: 'INVALID_SIGNATURE' },
      );
    });

    it('篡改 signature 应拒绝 token', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET);
      const parts = token.split('.');
      // 篡改签名最后一位
      const lastChar = parts[2][parts[2].length - 1];
      const newChar = lastChar === 'A' ? 'B' : 'A';
      const tamperedSig = parts[2].slice(0, -1) + newChar;
      const tamperedToken = `${parts[0]}.${parts[1]}.${tamperedSig}`;

      assert.throws(
        () => jwt.verify(tamperedToken, SECRET),
        { code: 'INVALID_SIGNATURE' },
      );
    });
  });

  describe('格式验证', () => {
    it('非字符串应拒绝', () => {
      assert.throws(
        () => jwt.verify(null, SECRET),
        { code: 'INVALID_FORMAT' },
      );
      assert.throws(
        () => jwt.verify(123, SECRET),
        { code: 'INVALID_FORMAT' },
      );
    });

    it('段数不正确应拒绝', () => {
      assert.throws(
        () => jwt.verify('a.b', SECRET),
        { code: 'INVALID_FORMAT' },
      );
      assert.throws(
        () => jwt.verify('a.b.c.d', SECRET),
        { code: 'INVALID_FORMAT' },
      );
    });

    it('payload 不是有效 JSON 应拒绝', () => {
      const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url');
      const badPayload = Buffer.from('not-json').toString('base64url');
      const data = `${header}.${badPayload}`;
      const sig = require('crypto').createHmac('sha256', SECRET).update(data).digest('base64url');
      const token = `${data}.${sig}`;

      assert.throws(
        () => jwt.verify(token, SECRET),
        { code: 'INVALID_FORMAT' },
      );
    });
  });

  describe('过期验证', () => {
    it('已过期的 token 应拒绝', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET, { expiresIn: -1 });
      assert.throws(
        () => jwt.verify(token, SECRET),
        { code: 'EXPIRED' },
      );
    });

    it('未过期的 token 应通过', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET, { expiresIn: 3600 });
      const decoded = jwt.verify(token, SECRET);
      assert.strictEqual(decoded.sub, 'user1');
    });
  });

  describe('黑名单（撤销）', () => {
    it('撤销后的 token 应拒绝', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET, { expiresIn: 3600 });

      // 撤销前验证通过
      const decoded = jwt.verify(token, SECRET);
      assert.strictEqual(decoded.sub, 'user1');

      // 撤销
      jwt.revoke(token, SECRET);

      // 撤销后应拒绝
      assert.throws(
        () => jwt.verify(token, SECRET),
        { code: 'REVOKED' },
      );
    });

    it('isRevoked 应正确检测撤销状态', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET, { expiresIn: 3600 });
      const payload = jwt.verify(token, SECRET);

      assert.strictEqual(jwt.isRevoked(payload, token), false);

      jwt.revoke(token, SECRET);
      assert.strictEqual(jwt.isRevoked(payload, token), true);
    });
  });

  describe('刷新令牌', () => {
    it('应刷新有效 token 并返回新 token', () => {
      const token = jwt.sign({ sub: 'user1', name: 'alice' }, SECRET, { expiresIn: 3600 });

      const newToken = jwt.refresh(token, SECRET, { expiresIn: 7200 });
      assert.ok(newToken !== token, '新 token 应不同于旧 token');

      // 新 token 应验证通过
      const decoded = jwt.verify(newToken, SECRET);
      assert.strictEqual(decoded.sub, 'user1');
      assert.strictEqual(decoded.name, 'alice');
      assert.strictEqual(decoded.exp - decoded.iat, 7200);
    });

    it('刷新后旧 token 应被撤销', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET, { expiresIn: 3600 });

      jwt.refresh(token, SECRET);

      assert.throws(
        () => jwt.verify(token, SECRET),
        { code: 'REVOKED' },
      );
    });

    it('过期太久无法刷新', () => {
      // 签发一个已过期很久的 token
      const token = jwt.sign({ sub: 'user1' }, SECRET, { expiresIn: -1000 });

      assert.throws(
        () => jwt.refresh(token, SECRET),
        { code: 'EXPIRED' },
      );
    });

    it('签名无效无法刷新', () => {
      const token = jwt.sign({ sub: 'user1' }, SECRET);
      const parts = token.split('.');
      const badSig = parts[2].slice(0, -1) + (parts[2][parts[2].length - 1] === 'A' ? 'B' : 'A');
      const badToken = `${parts[0]}.${parts[1]}.${badSig}`;

      assert.throws(
        () => jwt.refresh(badToken, SECRET),
        { code: 'INVALID_SIGNATURE' },
      );
    });
  });

  describe('base64url 编码', () => {
    it('应正确处理特殊字符', () => {
      const payload = { sub: '用户', emoji: '🎉', data: '<>&+"\'/' };
      const token = jwt.sign(payload, SECRET);
      const decoded = jwt.verify(token, SECRET);

      assert.strictEqual(decoded.sub, '用户');
      assert.strictEqual(decoded.emoji, '🎉');
      assert.strictEqual(decoded.data, '<>&+"\'/');
    });
  });
});
