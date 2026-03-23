const repo = require('../repositories/message.repo');
const { uploadToS3 } = require('../utils/s3');
const chatService = require('../services/chat.service');


exports.createMessage = async (data) => {
    try {
        return await repo.createMessage(data);
    } catch (err) {
        throw new Error('Error creating message: ' + err.message);
    }
};

exports.getMessageById = async (messageId) => {
    try {
        return await repo.getMessageById(messageId);
    } catch (err) {
        throw new Error('Error retrieving message: ' + err.message);
    }
};

exports.editMessage = async (messageId, userId, newMessage) => {
    try {
        return await repo.editMessage(messageId, userId, newMessage);
    } catch (err) {
        throw new Error('Error editing message: ' + err.message);
    }
};

exports.softDeleteMessage = async (messageId, userId) => {
    try {
        return await repo.softDeleteMessage(messageId, userId);
    } catch (err) {
        throw new Error('Error deleting message: ' + err.message);
    }
};


exports.deleteMessageById = async (messageId) => {
    try {
        return await repo.deleteMessageById(messageId);
    } catch (err) {
        throw new Error('Error deleting message: ' + err.message);
    }
};

//Delete all messages by chat Id
exports.deleteMessagesByChatId = async (chatId) => {
    try {
        return await repo.deleteMessagesByChatId(chatId);
    } catch (err) {
        throw new Error('Error deleting messages: ' + err.message);
    }
};

/**
 * Delete all messages for given Chat IDs.
 * @param {Array<ObjectId>} chatIds
 */
exports.deleteMessagesByChatIds = async (chatIds) => {
  if (!chatIds?.length) return { deletedCount: 0 };

  try {
    const result = await repo.deleteMessagesByChatIds(chatIds);
    return result;
  } catch (err) {
    console.error(`❌ Error deleting messages for chats ${chatIds}:`, err);
    throw err;
  }
};

exports.uploadMedia = async (file) => {
    return await uploadToS3(file);
}

/**
 * Get paginated messages (cursor-based, with parent message populated)
 */
exports.getMessagesForChat = async (chatId, userId, before, limit = 20) => {
  // 1️⃣ Validate chat access
  // Try to find chat by chatId first
  let chat = await chatService.getChatByChatId(chatId);
  if (!chat) {
    const err = new Error('Chat not found');
    err.statusCode = 404;
    throw err;
  }
  
  // Use the actual chat._id for message queries
  const actualChatId = chat._id;

  const isParticipant = chat.Participants.some(
    (p) => p.toString() === userId.toString()
  );
  if (!isParticipant) {
    const err = new Error('Access denied — not a participant of this chat');
    err.statusCode = 403;
    throw err;
  }

  // 2️⃣ Fetch messages (with parent populated)
  const messages = await repo.getMessagesBefore(actualChatId, before, limit);

  if (!messages.length) {
    return { ChatId: actualChatId, Data: [] };
  }

  // 3️⃣ Format messages for frontend
  const formatted = messages
    .map((msg) => ({
      _id: msg._id,
      Message: msg.Message,
      MessageType: msg.MessageType,
      Timestamp: msg.Timestamp,
      IsRead:
        msg.ReadBy?.some((receipt) => receipt.userId?.toString() === userId.toString()) || false,
      IsEdited: msg.IsEdited || false,
      IsDeleted: msg.IsDeleted || false,
      // Format: [{ userId: "user123", readAt: "2024-01-15T10:35:23.456Z" }]
      ReadBy: (msg.ReadBy || []).map((receipt) => ({
        userId: receipt.userId?.toString() || receipt.userId,
        readAt: receipt.readAt // Date object will be serialized to ISO 8601 string in JSON response
      })).filter(receipt => receipt.userId && receipt.readAt), // Filter out any invalid entries

      // only senderId, frontend already has user info cached
      SenderId: msg.SenderId,

      // populated parent message
      ReplyTo: msg.ParentMessageId
        ? {
            _id: msg.ParentMessageId._id,
            Message: msg.ParentMessageId.Message,
            SenderId: msg.ParentMessageId.SenderId,
          }
        : null,

      // optional media info
      Media: msg.MediaUrl
        ? {
            Url: msg.MediaUrl,
            Name: msg.MediaName,
            Size: msg.MediaSize,
          }
        : null,
      ...(msg.AudioDuration && {
        audioDuration: msg.AudioDuration
      }),
    }))
    .reverse(); // oldest → newest for UI

  return {
    ChatId: actualChatId,
    Limit: limit,
    Data: formatted,
    NextCursor:
      messages.length > 0 ? messages[messages.length - 1].Timestamp : null,
  };
};


/**
 * Mark messages as read manually (for socket event or UI action).
 */
exports.markMessagesAsRead = async (chatId, userIds, messageIds = null) => {
  return await repo.markMessagesAsRead(chatId, userIds, messageIds);
};

