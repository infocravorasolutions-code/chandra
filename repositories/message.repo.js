const Message = require('../models/message.model');

/**
 * Creates a new message.
 * @param {Object} message - The message document to insert.
 */
exports.createMessage = async (message) => {
  try {
    return await Message.create(message);
  } catch (error) {
    throw new Error('Error creating message: ' + error.message);
  }
};

/**
 * Fetch all messages for a specific ChatId, sorted by Timestamp ascending.
 * @param {ObjectId|String} chatId - The chat whose messages to fetch.
 */
exports.getMessagesByChatId = async (chatId) => {
  const mongoose = require('mongoose');
  // Convert chatId to ObjectId if needed
  const chatObjectId = mongoose.Types.ObjectId.isValid(chatId) 
    ? new mongoose.Types.ObjectId(chatId) 
    : chatId;
  
  return await Message.find({ ChatId: chatObjectId })
    .sort({ Timestamp: 1 })
    .lean();
};

/**
 * Fetch paginated messages for a chat before a given timestamp.
 * Populates ParentMessageId so reply info is available.
 */
exports.getMessagesBefore = async (chatId, before, limit = 20) => {
  try {
    const mongoose = require('mongoose');
    // Convert chatId to ObjectId if needed
    const chatObjectId = mongoose.Types.ObjectId.isValid(chatId) 
      ? new mongoose.Types.ObjectId(chatId) 
      : chatId;
    
    const query = { ChatId: chatObjectId };
    if (before) {
      const beforeDate = before instanceof Date ? before : new Date(before);
      query.Timestamp = { $lt: beforeDate };
    }

    return await Message.find(query)
      .sort({ Timestamp: -1 }) // newest first for efficient cursor pagination
      .limit(limit)
      .populate({
        path: 'ParentMessageId',
        select: 'Message SenderId', // only fields needed for reply bubble
      })
      .lean();
  } catch (error) {
    throw new Error('Error fetching paginated messages: ' + error.message);
  }
};


/**
 * Marks all messages in a chat as read by a given user.
 * @param {ObjectId|String} chatId
 * @param {Array<ObjectId|String>} userIds
 */
exports.markMessagesAsRead = async (chatId, userIds) => {
  if (!Array.isArray(userIds)) userIds = [userIds];
  
  const mongoose = require('mongoose');
  // Convert to ObjectId if needed
  const chatObjectId = mongoose.Types.ObjectId.isValid(chatId) 
    ? new mongoose.Types.ObjectId(chatId) 
    : chatId;
  
  const userObjectIds = userIds.map(userId => 
    mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId
  );

  return Message.updateMany(
    { ChatId: chatObjectId, ReadBy: { $nin: userObjectIds } },
    { $addToSet: { ReadBy: { $each: userObjectIds } } }
  );
};

/**
 * Deletes all messages in a specific chat.
 * @param {ObjectId} chatId - The chat whose messages to delete.
 */
exports.deleteMessagesByChatId = async (chatId) => {
  try {
    const result = await Message.deleteMany({ ChatId: chatId });
    return result;
  } catch (error) {
    throw new Error('Error deleting messages for ChatId ' + chatId + ': ' + error.message);
  }
};

exports.deleteMessagesByChatIds = async (chatIds) => {
  try {
    const result = await Message.deleteMany({ ChatId: { $in: chatIds } });
    return result;
  } catch (err) {
    console.error(`❌ Error deleting messages for Chats ${chatIds}:`, err);
    throw err;
  }
};
