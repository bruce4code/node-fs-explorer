/**
 * 路由配置
 * 定义所有 API 路由及其对应的控制器处理函数
 */
const Router = require('../router');
const fileController = require('../controllers/fileController');

const router = new Router();

// =============================================
// 文件浏览与查询
// =============================================
router.get('/api/files', fileController.list);
router.get('/api/files/info', fileController.info);
router.get('/api/files/download', fileController.download);

// =============================================
// 文件创建与写入
// =============================================
router.post('/api/files/upload', fileController.upload);
router.post('/api/files/mkdir', fileController.mkdir);

// =============================================
// 文件删除与移动
// =============================================
router.delete('/api/files', fileController.remove);
router.put('/api/files/move', fileController.move);

module.exports = router;
