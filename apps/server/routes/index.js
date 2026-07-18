/**
 * 路由配置
 * 定义所有 API 路由及其对应的控制器处理函数
 */
const Router = require('../router');
const fileController = require('../controllers/fileController');
const authController = require('../controllers/authController');
const uploadController = require('../controllers/uploadController');

const router = new Router();

// =============================================
// Phase 5: 认证 API
// =============================================
router.post('/api/auth/login', authController.login);       // 登录签发 JWT
router.post('/api/auth/refresh', authController.refresh);   // 刷新令牌
router.get('/api/auth/verify', authController.verify);      // 验证令牌
router.post('/api/auth/logout', authController.logout);     // 登出撤销令牌

// =============================================
// Phase 2: 基础 CRUD
// =============================================
router.get('/api/files', fileController.list);
router.get('/api/files/info', fileController.info);
router.get('/api/files/download', fileController.download);

router.post('/api/files/upload', fileController.upload);
router.post('/api/files/mkdir', fileController.mkdir);

router.delete('/api/files', fileController.remove);
router.put('/api/files/move', fileController.move);

// =============================================
// Phase 3: 进阶功能
// =============================================
router.get('/api/files/search', fileController.search);   // 文件搜索
router.get('/api/files/preview', fileController.preview); // 文件预览
router.get('/api/files/hash', fileController.hash);       // 文件哈希
router.get('/api/files/logs', fileController.logs);       // 操作日志

// =============================================
// Phase 5: 分片上传 API
// =============================================
router.post('/api/files/upload/init', uploadController.init);       // 初始化分片上传
router.post('/api/files/upload/chunk', uploadController.chunk);     // 上传单个分片
router.post('/api/files/upload/complete', uploadController.complete); // 合并分片
router.get('/api/files/upload/status', uploadController.status);   // 查询上传状态
router.post('/api/files/upload/abort', uploadController.abort);    // 取消上传

module.exports = router;
