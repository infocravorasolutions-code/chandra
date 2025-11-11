const Chat = require('../models/chat.model');
const mongoose = require('mongoose');
const { ObjectId } = require('mongodb');

/**
 * Finds one chat by EnquiryId and Type.
 */
exports.findChatByEnquiryAndType = async (enquiryId, type) => {
  return Chat.findOne({ EnquiryId: enquiryId, Type: type });
};

/**
 * Creates a new chat document.
 */
exports.createChat = async (chatData) => {
  return Chat.create(chatData);
};

/**
 * Updates Participants for an existing chat.
 */
exports.updateParticipants = async (enquiryId, type, participants) => {
  return Chat.updateOne(
    { EnquiryId: enquiryId, Type: type },
    { $set: { Participants: participants } }
  );
};

/**
 * Add a participant if not already present.
 */
exports.addParticipantIfMissing = async (enquiryId, type, userId) => {
  return Chat.updateOne(
    { EnquiryId: enquiryId, Type: type },
    { $addToSet: { Participants: userId } }
  );
};

/**
 * Update chat's LastMessage and UpdatedAt timestamp.
 */
exports.updateLastMessage = async (chatId, messageId) => {
  // Convert to ObjectId if needed
  const chatObjectId = mongoose.Types.ObjectId.isValid(chatId) 
    ? new mongoose.Types.ObjectId(chatId) 
    : chatId;
  const messageObjectId = mongoose.Types.ObjectId.isValid(messageId) 
    ? new mongoose.Types.ObjectId(messageId) 
    : messageId;
  
  return Chat.updateOne(
    { _id: chatObjectId },
    {
      $set: {
        LastMessage: messageObjectId,
        UpdatedAt: new Date()
      }
    }
  );
};

/**
 * Aggregation for getting chats for a user with optional search and pagination.
 * 
 * @param {ObjectId} userId - User ID
 * @param {Number} userRole - User role (1=Admin, 2=Coral, 3=Cad, 4=Client)
 * @param {String} userClientId - User's clientId (null for non-clients)
 * @param {Number} page - Page number
 * @param {Number} limit - Items per page
 * @param {String} search - Optional search term
 * @param {String} chatType - Optional chat type filter ('admin-client' or 'admin-designer')
 * @param {String} enquiryId - Optional enquiry ID to filter chats by specific enquiry
 */
exports.getChatsForUserAgg = async (userId, userRole, userClientId, page = 1, limit = 10, search = '', chatType = null, enquiryId = null) => {
  try {
    const skip = (page - 1) * limit;

    // Convert userId to ObjectId if needed
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new ObjectId(String(userId)) 
      : userId;

    // Role constants
    const ROLE_ADMIN = 1;
    const ROLE_CLIENT = 4;

    // Match only chats the user is part of
    const match = {
        $and: [{ Participants: userObjectId }]
    };

    // Filter by chat type if provided
    if (chatType && (chatType === 'admin-client' || chatType === 'admin-designer')) {
      match.$and.push({ Type: chatType });
    }

    // Filter by specific enquiry ID if provided (takes priority over search)
    if (enquiryId && mongoose.Types.ObjectId.isValid(enquiryId)) {
      match.$and.push({ EnquiryId: new ObjectId(String(enquiryId)) });
    }

    // Optional search filter by EnquiryName or EnquiryId (only if enquiryId not provided)
    if (!enquiryId && search && search.trim() !== '') {
      const searchRegex = new RegExp(search, 'i');
      const orConditions = [{ EnquiryName: searchRegex }];

      if (mongoose.Types.ObjectId.isValid(search)) {
        orConditions.push({ EnquiryId: new ObjectId(String(search)) });
      }

      match.$and.push({ $or: orConditions });
    }

    // Build pipeline
    const pipeline = [
      { $match: match },

      // Lookup enquiry to get ClientId for client ownership filtering
      {
        $lookup: {
          from: 'enquiries',
          localField: 'EnquiryId',
          foreignField: '_id',
          as: 'EnquiryDoc'
        }
      },
      { $unwind: { path: '$EnquiryDoc', preserveNullAndEmptyArrays: true } },

      // Filter by client ownership for client users
      ...(userRole === ROLE_CLIENT && userClientId ? [
        {
          $match: {
            'EnquiryDoc.ClientId': userClientId
          }
        }
      ] : []),

      // Lookup last message
      {
        $lookup: {
          from: 'messages',
          localField: 'LastMessage',
          foreignField: '_id',
          as: 'LastMessageDoc'
        }
      },
      { $unwind: { path: '$LastMessageDoc', preserveNullAndEmptyArrays: true } },

      // Lookup sender of last message
      {
        $lookup: {
          from: 'users',
          localField: 'LastMessageDoc.SenderId',
          foreignField: '_id',
          as: 'LastMessageSender'
        }
      },
      { $unwind: { path: '$LastMessageSender', preserveNullAndEmptyArrays: true } },

      // Project only required fields
      {
        $project: {
          _id: 1,
          EnquiryId: 1,
          EnquiryName: 1,
          Type: 1,
          UpdatedAt: 1,
          Participants: 1,
          LastRead: 1,
          LastMessage: {
            Message: '$LastMessageDoc.Message',
            MessageType: '$LastMessageDoc.MessageType',
            Timestamp: '$LastMessageDoc.Timestamp',
            Sender: {
              _id: '$LastMessageSender._id',
              Name: '$LastMessageSender.Name'
            }
          }
        }
      },

      // Sort + paginate
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          data: [
            { $sort: { UpdatedAt: -1 } },
            { $skip: skip },
            { $limit: limit }
          ]
        }
      },
      { $unwind: { path: '$metadata', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          total: { $ifNull: ['$metadata.total', 0] },
          data: 1
        }
      }
    ];

    const result = await Chat.aggregate(pipeline);
    const normalized = result?.[0] || { total: 0, data: [] };

    return {
      total: normalized.total || 0,
      data: normalized.data || []
    };
  } catch (error) {
    console.error('Error in getChatsForUserAgg:', error);
    // Return empty result instead of throwing
    return {
      total: 0,
      data: []
    };
  }
};

/**
 * Fetch chat by its ID.
 */
exports.getChatByChatId = async (chatId) => {
  try {
    // Convert string to ObjectId if needed
    if (!mongoose.Types.ObjectId.isValid(chatId)) {
      console.warn(`Invalid chatId format: ${chatId}`);
      return null;
    }
    
    const objectId = new mongoose.Types.ObjectId(chatId);
    const chat = await Chat.findById(objectId);
    
    if (!chat) {
      console.warn(`Chat not found in database: ${chatId}`);
    }
    
    return chat;
  } catch (error) {
    console.error(`Error fetching chat ${chatId}:`, error);
    return null;
  }
};


/**
 * Bulk update chat last read timestamps for one or more users.
 *
 * @param {ObjectId|String} chatId - Chat ID
 * @param {Array<ObjectId|String>} userIds - One or more user IDs
 */
exports.updateLastRead = async (chatId, userIds) => {
  if (!Array.isArray(userIds)) userIds = [userIds];
  const now = new Date();

  // Convert chatId to ObjectId if needed
  const chatObjectId = mongoose.Types.ObjectId.isValid(chatId) 
    ? new mongoose.Types.ObjectId(chatId) 
    : chatId;

  // Convert userIds to ObjectId if needed
  const userObjectIds = userIds.map(userId => 
    mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId
  );

  // Step 1️⃣ Add new users to LastRead if missing
  const addOps = userObjectIds.map(userId => ({
    updateOne: {
      filter: { _id: chatObjectId, 'LastRead.UserId': { $ne: userId } },
      update: {
        $push: { LastRead: { UserId: userId, LastReadAt: now } },
        $set: { UpdatedAt: now }
      }
    }
  }));

  if (addOps.length > 0) {
    await Chat.bulkWrite(addOps);
  }

  // Step 2️⃣ Update LastReadAt for existing users
  await Chat.updateOne(
    { _id: chatObjectId },
    {
      $set: {
        'LastRead.$[elem].LastReadAt': now,
        UpdatedAt: now
      }
    },
    {
      arrayFilters: [{ 'elem.UserId': { $in: userObjectIds } }]
    }
  );

  return { success: true, updatedUsers: userObjectIds, updatedAt: now };
};


exports.deleteChatsByEnquiryId = async (enquiryId) => {
  try {
    const result = await Chat.deleteMany({ EnquiryId: enquiryId });
    console.log(`🗑️ Deleted ${result.deletedCount} chats for Enquiry ${enquiryId}`);
    return result;
  } catch (err) {
    console.error(`❌ Error deleting chats for Enquiry ${enquiryId}:`, err);
    throw err;
  }
};

/**
 * Find all chats by EnquiryId.
 */
exports.findChatsByEnquiryId = async (enquiryId) => {
  return Chat.find({ EnquiryId: enquiryId }).lean();
};

/**
 * Delete invalid chats with null EnquiryId or Type (cleanup function).
 */
exports.deleteInvalidChats = async () => {
  try {
    const result = await Chat.deleteMany({
      $or: [
        { EnquiryId: null },
        { Type: null },
        { EnquiryId: { $exists: false } },
        { Type: { $exists: false } }
      ]
    });
    console.log(`🧹 Cleaned up ${result.deletedCount} invalid chat(s) with null EnquiryId or Type`);
    return result;
  } catch (err) {
    console.error(`❌ Error deleting invalid chats:`, err);
    throw err;
  }
};
