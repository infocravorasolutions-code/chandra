const chatService = require('../services/chat.service')

exports.getUserChats = async (req, res) => {
  try {
    const userId = req.user._id;
    const userRole = req.user.role;
    const userClientId = req.user.clientId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const chatType = req.query.type || null; // Optional: 'admin-client' or 'admin-designer'
    const enquiryId = req.query.enquiryId || null; // Optional: Filter by specific EnquiryId
console.log(userId, userRole, userClientId, page, limit, search, chatType, enquiryId);
    const result = await chatService.getChatsForUser(
      userId, 
      userRole, 
      userClientId, 
      page, 
      limit, 
      search, 
      chatType,
      enquiryId
    );

    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(error.statusCode || 500).json({
      message: error.message || 'Failed to fetch chats',
    });
  }
};