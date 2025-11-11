const repo = require('../repositories/chat.repo');
const Message = require('../models/message.model');
const messageService = require('../services/message.service');
const mongoose = require('mongoose');

/**
 * Creates a single chat if not already existing.
 *
 * @param {Object} data
 * @param {ObjectId} data.EnquiryId
 * @param {String} data.EnquiryName
 * @param {String} data.Type - 'admin-client' | 'admin-designer'
 * @param {Array<ObjectId>} data.Participants
 */
exports.createChat = async (EnquiryId, EnquiryName, Type, Participants) => {
  try {
    // Validate required fields
    if (!EnquiryId) {
      throw new Error('EnquiryId is required to create chat');
    }
    if (!EnquiryName) {
      throw new Error('EnquiryName is required to create chat');
    }
    if (!Type || (Type !== 'admin-client' && Type !== 'admin-designer')) {
      throw new Error('Type must be either "admin-client" or "admin-designer"');
    }

    // Check for existing chat
    const existingChat = await repo.findChatByEnquiryAndType(EnquiryId, Type);
    if (existingChat) {
      console.log(`Chat already exists for Enquiry ${EnquiryId} (${Type})`);
      return existingChat;
    }

    // Create chat document
    const chat = await repo.createChat({
      EnquiryId,
      EnquiryName,
      Type,
      Participants: Participants || [],
    });

    console.log(`Created chat for Enquiry ${EnquiryId} (${Type})`);
    return chat;
  } catch (error) {
    // Handle duplicate key error - might be from invalid null values in DB
    if (error.code === 11000 && error.keyPattern && error.keyValue) {
      // MongoDB error uses lowercase field names in keyValue
      const keyValue = error.keyValue || {};
      const enquiryIdValue = keyValue.enquiryId || keyValue.EnquiryId;
      const typeValue = keyValue.type || keyValue.Type;
      
      if (enquiryIdValue === null || typeValue === null) {
        console.error(`⚠️ Duplicate key error with null values detected. This indicates corrupted data in database.`);
        console.error(`   Attempting to clean up invalid chat documents...`);
        // Try to delete invalid chats
        try {
          await repo.deleteInvalidChats();
          console.log(`✅ Cleaned up invalid chats. Please retry creating the enquiry.`);
        } catch (cleanupError) {
          console.error(`❌ Failed to cleanup invalid chats:`, cleanupError);
        }
        throw new Error('Database contains invalid chat data. Please contact administrator to clean up chats with null EnquiryId or Type.');
      }
    }
    console.error(`Error creating chat for Enquiry ${EnquiryId} (${Type}):`, error);
    throw error;
  }
};

/**
 * Updates participants for an existing chat.
 *
 * @param {ObjectId} EnquiryId
 * @param {String} Type
 * @param {Array<ObjectId>} Participants
 */
exports.updateParticipants = async (EnquiryId, Type, Participants) => {
  try {
    const result = await repo.updateParticipants(EnquiryId, Type, Participants);
    console.log(`Updated participants for chat ${Type} (Enquiry ${EnquiryId})`);
    return result;
  } catch (error) {
    console.error(`Error updating participants for chat ${Type} (Enquiry ${EnquiryId}):`, error);
    throw error;
  }
};

/**
 * Adds a participant if not already present in the chat.
 *
 * @param {ObjectId} EnquiryId
 * @param {String} Type
 * @param {ObjectId} UserId
 */
exports.addParticipantIfMissing = async (EnquiryId, Type, UserId) => {
  try {
    await repo.addParticipantIfMissing(EnquiryId, Type, UserId);
    console.log(`Checked participant ${UserId} for chat (${Type}) Enquiry ${EnquiryId}`);
  } catch (err) {
    console.error(`Failed to add participant ${UserId} to chat (${Type}) for Enquiry ${EnquiryId}`, err);
  }
};

/**
 * Get paginated chats for a user (aggregation-based).
 *
 * @param {ObjectId} userId - Logged-in user
 * @param {Number} userRole - User's role (1=Admin, 2=Coral, 3=Cad, 4=Client)
 * @param {String} userClientId - User's clientId (null for non-clients)
 * @param {Number} page - Page number (1-based)
 * @param {Number} limit - Items per page
 * @param {String} search - Optional search term
 * @param {String} chatType - Optional chat type filter ('admin-client' or 'admin-designer')
 * @param {String} enquiryId - Optional enquiry ID to filter chats by specific enquiry
 */
exports.getChatsForUser = async (userId, userRole, userClientId, page = 1, limit = 10, search = '', chatType = null, enquiryId = null) => {
  try {
    const { total, data } = await repo.getChatsForUserAgg(userId, userRole, userClientId, page, limit, search, chatType, enquiryId);

    // Format chats for frontend
    const formatted = await Promise.all(
      (data || []).map(async (chat) => {
        try {
          // Get last read entry
          const lastReadEntry = chat.LastRead?.find(
            (r) => r?.UserId?.toString() === userId.toString()
          );
          const lastReadAt = lastReadEntry?.LastReadAt || new Date(0);

          // Compute unread message count TODO service calling model
          // Convert to ObjectId to ensure proper query
          const chatObjectId = mongoose.Types.ObjectId.isValid(chat._id) 
            ? new mongoose.Types.ObjectId(chat._id) 
            : chat._id;
          const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
          
          let unreadCount = 0;
          try {
            unreadCount = await Message.countDocuments({
              ChatId: chatObjectId,
              Timestamp: { $gt: lastReadAt },
              SenderId: { $ne: userObjectId },
            });
          } catch (countError) {
            console.error(`Error counting unread messages for chat ${chat._id}:`, countError);
            unreadCount = 0;
          }

          // Prepare last message preview
          const lm = chat.LastMessage;
          const messageText = lm
            ? lm.MessageType === 'text'
              ? lm.Message
              : lm.MessageType === 'image'
              ? '📷 Photo'
              : lm.MessageType === 'video'
              ? '🎥 Video'
              : '📎 Attachment'
            : '(no messages yet)';

          return {
            _id: chat._id,
            EnquiryId: chat.EnquiryId,
            EnquiryName: chat.EnquiryName,
            Type: chat.Type,
            LastMessage: {
              Text: messageText,
              Timestamp: lm?.Timestamp || chat.UpdatedAt,
              Sender: lm?.Sender?.Name || null,
            },
            UnreadCount: unreadCount,
            UpdatedAt: chat.UpdatedAt,
          };
        } catch (chatError) {
          console.error(`Error formatting chat ${chat._id}:`, chatError);
          // Return a minimal chat object to prevent crash
          return {
            _id: chat._id,
            EnquiryId: chat.EnquiryId,
            EnquiryName: chat.EnquiryName || 'Unknown',
            Type: chat.Type,
            LastMessage: {
              Text: '(no messages yet)',
              Timestamp: chat.UpdatedAt || new Date(),
              Sender: null,
            },
            UnreadCount: 0,
            UpdatedAt: chat.UpdatedAt || new Date(),
          };
        }
      })
    );

    return {
      Total: total || 0,
      page,
      limit,
      TotalPages: Math.ceil((total || 0) / limit),
      Data: formatted,
    };
  } catch (error) {
    console.error('Error in getChatsForUser:', error);
    // Return empty result instead of crashing
    return {
      Total: 0,
      page,
      limit,
      TotalPages: 0,
      Data: [],
    };
  }
};

exports.getChatByChatId = async (chatId) => {
    return repo.getChatByChatId(chatId);
}

/**
 * Mark all messages in a chat as read and update last read timestamps.
 * Supports multiple users in a single operation.
 */
exports.markChatAsRead = async (chatId, userIds) => {
  try {
    if (!Array.isArray(userIds)) userIds = [userIds];
    // 2️⃣ Update last read timestamps (chat collection)

    await repo.updateLastRead(chatId, userIds);

    return { success: true, updatedUsers: userIds };
  } catch (err) {
    console.error(`❌ Failed to mark chat ${chatId} as read:`, err);
    throw err;
  }
};

exports.deleteChatsByEnquiryId = async (enquiryId) => {
  try {
    const chats = await repo.findChatsByEnquiryId(enquiryId);
    if (!chats || chats.length === 0) {
      console.log(`ℹ️ No chats found for Enquiry ${enquiryId}`);
      return { success: true, deletedChats: 0, deletedMessages: 0 };
    }

    const chatIds = chats.map(c => c._id);

    // 2️⃣ Delete all messages linked to these chatIds
    const messageResult = await messageService.deleteMessagesByChatIds(chatIds);

    // 3️⃣ Delete the chat documents themselves
    const chatResult = await repo.deleteChatsByEnquiryId(enquiryId);
    
    console.log(`🧹 Cleanup complete for Enquiry ${enquiryId}`);
    return {
      success: true,
      deletedChats: chatResult.deletedCount,
      deletedMessages: messageResult.deletedCount
    };
  } catch (error) {
    console.error(`❌ Error deleting messages for enquiry ${enquiryId}:`, error);
    throw error;
  }
};