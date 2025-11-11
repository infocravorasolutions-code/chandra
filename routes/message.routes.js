const express = require('express');
const router = express.Router();
const controller = require('../controllers/message.controller');
const authenticateToken = require('../middleware/authenticateToken');
const chatUpload = require('../middleware/chatUpload');

//upload media
router.post('/upload', 
    authenticateToken, 
    chatUpload,
    controller.uploadMedia);

router.get('/:chatId/messages', authenticateToken, controller.getChatMessages);
module.exports = router;