const Chat = require('../models/chat.model');
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
  return Chat.updateOne(
    { _id: chatId },
    {
      $set: {
        LastMessage: messageId,
        UpdatedAt: new Date()
      }
    }
  );
};

/**
 * Aggregation for getting chats for a user with optional search and pagination.
 */
exports.getChatsForUserAgg = async (userId, page = 1, limit = 10, search = '') => {
  const skip = (page - 1) * limit;

    // Match only chats the user is part of
    const match = {
        $and: [{ Participants: new ObjectId(String(userId)) }]
    };

  // Optional search filter by EnquiryName or EnquiryId
  if (search && search.trim() !== '') {
    const searchRegex = new RegExp(search, 'i');
    const orConditions = [{ EnquiryName: searchRegex }];

    if (ObjectId.isValid(search)) {
      orConditions.push({ EnquiryId: new ObjectId(String(search)) });
    }

    match.$and.push({ $or: orConditions });
  }

  const pipeline = [
    { $match: match },

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
    total: normalized.total,
    data: normalized.data
  };
};

/**
 * Fetch chat by its ID.
 */
exports.getChatByChatId = async (chatId) => {
  return Chat.findById(chatId);
};


/**
 * Bulk update chat last read timestamps for one or more users.
 *
 * @param {ObjectId} chatId - Chat ID
 * @param {Array<ObjectId>} userIds - One or more user IDs
 */
exports.updateLastRead = async (chatId, userIds) => {
  if (!Array.isArray(userIds)) userIds = [userIds];
  const now = new Date();

  // Step 1️⃣ Add new users to LastRead if missing
  const addOps = userIds.map(userId => ({
    updateOne: {
      filter: { _id: chatId, 'LastRead.UserId': { $ne: userId } },
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
    { _id: chatId },
    {
      $set: {
        'LastRead.$[elem].LastReadAt': now,
        UpdatedAt: now
      }
    },
    {
      arrayFilters: [{ 'elem.UserId': { $in: userIds } }]
    }
  );

  return { success: true, updatedUsers: userIds, updatedAt: now };
};

exports.updateLastMessage = async (chatId, messageId) => {
  return Chat.updateOne(
    { _id: chatId },
    {
      $set: { LastMessage: messageId, UpdatedAt: new Date() }
    }
  );
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
exports.findChatsByEnquiryId = async (enquiryId,user) => {
  return Chat.find({ EnquiryId: enquiryId,Participants:{$in:[user._id]}})
    .populate({
      path: 'LastMessage',
    })
    .lean();
};

