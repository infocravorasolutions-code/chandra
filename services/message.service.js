const repo = require('../repositories/message.repo');
const { uploadToS3 } = require('../utils/s3');
const chatService = require('../services/chat.service');
const Message = require('../models/message.model');
const mongoose = require('mongoose');


exports.createMessage = async (data) => {
    try {
        // Convert string IDs to ObjectId if needed
        const messageData = {
            ...data,
            ChatId: mongoose.Types.ObjectId.isValid(data.ChatId) 
                ? new mongoose.Types.ObjectId(data.ChatId) 
                : data.ChatId,
            SenderId: mongoose.Types.ObjectId.isValid(data.SenderId) 
                ? new mongoose.Types.ObjectId(data.SenderId) 
                : data.SenderId,
            ParentMessageId: data.ParentMessageId && mongoose.Types.ObjectId.isValid(data.ParentMessageId)
                ? new mongoose.Types.ObjectId(data.ParentMessageId) 
                : data.ParentMessageId || null
        };
        
        const savedMessage = await repo.createMessage(messageData);
        
        // Update chat's LastMessage reference
        try {
            const chatRepo = require('../repositories/chat.repo');
            await chatRepo.updateLastMessage(messageData.ChatId, savedMessage._id);
        } catch (updateError) {
            console.error('Error updating chat LastMessage:', updateError);
            // Don't fail message creation if chat update fails
        }
        
        return savedMessage;
    } catch (err) {
        console.error('Error creating message:', err);
        throw new Error('Error creating message: ' + err.message);
    }
};

//TODO should this be in chatService ?
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
    const key = await uploadToS3(file);
    const { generatePresignedUrl } = require('../utils/s3');
    
    // Generate presigned URL for the uploaded file
    const url = await generatePresignedUrl(key, 'inline');
    
    return {
        key: key,
        name: file.originalname,
        url: url,
        size: file.size,
        mimetype: file.mimetype
    };
}

/**
 * Get paginated messages (cursor-based, with parent message populated)
 */
exports.getMessagesForChat = async (chatId, userId, before, limit = 20) => {
  try {
    // 1️⃣ Validate chat access (if chat exists)
    const chat = await chatService.getChatByChatId(chatId);
    
    if (chat) {
      // Verify user is a participant
      const isParticipant = chat.Participants?.some(
        (p) => p?.toString() === userId.toString()
      );
      if (!isParticipant) {
        const err = new Error('Access denied — not a participant of this chat');
        err.statusCode = 403;
        throw err;
      }
    } else {
      // Chat doesn't exist, but check if messages exist (chat might have been deleted)
      console.warn(`Chat ${chatId} not found, but checking for messages...`);
      // We'll still try to fetch messages - they might exist even if chat was deleted
    }

    // 2️⃣ Fetch messages (with parent populated)
    const messages = await repo.getMessagesBefore(chatId, before, limit);

    if (!messages.length) {
      // If no messages and no chat, return 404
      if (!chat) {
        const err = new Error('Chat not found');
        err.statusCode = 404;
        throw err;
      }
      return { ChatId: chatId, Data: [], Limit: limit, NextCursor: null };
    }

  // 3️⃣ Format messages for frontend
  const formatted = messages
    .map((msg) => ({
      _id: msg._id,
      Message: msg.Message,
      MessageType: msg.MessageType,
      Timestamp: msg.Timestamp,
      IsRead:
        msg.ReadBy?.some((id) => id.toString() === userId.toString()) || false,

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
    }))
    .reverse(); // oldest → newest for UI

    return {
      ChatId: chatId,
      Limit: limit,
      Data: formatted,
      NextCursor:
        messages.length > 0 ? messages[messages.length - 1].Timestamp : null,
    };
  } catch (error) {
    // Re-throw if it's already a formatted error with statusCode
    if (error.statusCode) {
      throw error;
    }
    // Otherwise, log and throw generic error
    console.error(`Error in getMessagesForChat for chat ${chatId}:`, error);
    const err = new Error(error.message || 'Failed to fetch messages');
    err.statusCode = 500;
    throw err;
  }
};


/**
 * Mark messages as read manually (for socket event or UI action).
 */
exports.markMessagesAsRead = async (chatId, userIds) => {
  return await repo.markMessagesAsRead(chatId, userIds);
};

