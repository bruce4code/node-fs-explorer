/**
 * 路由配置
 * 定义所有 API 路由及其对应的控制器处理函数
 */
const Router = require('../router');
const fileController = require('../controllers/fileController');

const router = new Router();

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

module.exports = router;
