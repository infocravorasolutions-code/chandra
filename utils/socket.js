// socket.js
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const chatService = require('../services/chat.service');
const messageService = require('../services/message.service');
const pushService = require('../services/pushNotification.service');
const userService = require('../services/user.service');
const notificationChannels = require('../utils/notificationChannels');
const Message = require('../models/message.model');

const frontendUrl =
    process.env.NODE_ENV === 'production'
        ? 'https://workflow-ui-virid.vercel.app'
        : 'http://localhost:4200';

/**
 * Calculate unread count for a specific chat and user
 */
async function getUnreadCount(chatId, userId) {
    try {
        const unreadCount = await Message.countDocuments({
            ChatId: chatId,
            SenderId: { $ne: userId },
            $or: [
                { ReadBy: { $exists: false } },
                { ReadBy: { $size: 0 } },
                { 'ReadBy.userId': { $nin: [userId] } }
            ]
        });
        return unreadCount;
    } catch (error) {
        console.error(`Error calculating unread count for chat ${chatId}:`, error);
        return 0;
    }
}

function initSocket(server) {
    const io = new Server(server, {
        cors: {
            origin: [
                'http://localhost:4200',
                'https://workflow-ui-virid.vercel.app'
            ],
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            credentials: true
        }
    });

    // 🔐 JWT Authentication Middleware for Socket.io
    io.use((socket, next) => {
        const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
        
        if (!token) {
            console.warn('⚠️ Socket connection rejected: No token provided');
            return next(new Error('Authentication error: No token provided'));
        }

        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            socket.userId = decoded.Id; // Store userId in socket for later use
            socket.data.userId = decoded.Id; // Also store in socket.data for consistency
            next();
        } catch (error) {
            console.warn('⚠️ Socket connection rejected: Invalid token', error.message);
            return next(new Error('Authentication error: Invalid or expired token'));
        }
    });

    io.on('connection', (socket) => {
        const userId = socket.userId;
        console.log(`🔌 New client connected: ${socket.id} (User: ${userId})`);

        // 🟢 Auto-join user to their personal room for global events
        socket.join(`user:${userId}`);
        console.log(`🟢 User ${userId} auto-joined personal room: user:${userId}`);

        /**
         * Join a specific chat room.
         */
        socket.on('joinChat', async ({ chatId, userId }) => {
            try {
                if (socket.data.chatId) {
                    socket.leave(`chat_${socket.data.chatId}`);
                }

                socket.join(`chat_${chatId}`);
                socket.data.userId = userId;
                socket.data.chatId = chatId;

                console.log(`🟢 ${userId} joined room chat_${chatId}`);

                // On join: mark all existing messages in this chat as read for this user (legacy behaviour).
                const readerId = socket.userId || userId;
                if (chatId && readerId) {
                    try {
                        const chat = await chatService.getChatByChatId(chatId);
                        const isParticipant =
                            chat &&
                            Array.isArray(chat.Participants) &&
                            chat.Participants.some((p) => String(p) === String(readerId));
                        if (isParticipant) {
                            await chatService.markChatAsRead(chatId, [readerId]);
                            await messageService.markMessagesAsRead(chatId, [readerId]);
                            const unreadCount = await getUnreadCount(chatId, readerId);
                            io.to(`user:${readerId}`).emit('messagesRead', {
                                chatId: chatId.toString(),
                                userId: readerId.toString(),
                                unreadCount
                            });
                            io.to(`chat_${chatId}`).emit('messagesRead', {
                                chatId: chatId.toString(),
                                userIds: [readerId.toString()],
                                unreadCount
                            });
                        }
                    } catch (readErr) {
                        console.error('joinChat mark-as-read error:', readErr);
                    }
                }
            } catch (err) {
                console.error('Error joining chat room:', err);
            }
        });

        /**
         * Leave chat room
         */
        socket.on('leaveChat', async ({ chatId, userId }) => {
            try {
                socket.leave(`chat_${chatId}`);
                socket.data.chatId = null;
                console.log(`🔴 ${userId} left room chat_${chatId}`);
            } catch (err) {
                console.error('Error leaving chat room:', err);
            }
        });

        /**
         * Join personal notification room for offline push notifications.
         */
        socket.on('joinNotificationRoom', async (userId) => {
            socket.join(`user_${userId}`);
            console.log(`🟢 ${userId} joined notifications room`);
        });

        socket.on('leaveNotificationRoom', async (userId) => {
            socket.leave(`user_${userId}`);
            console.log(`🔴 ${userId} left notifications room`);
        });

        /**
     * Handle sending a new message.
     */
        socket.on('sendMessage', async (data) => {
            const {
                chatId,
                userId,
                message,
                messageType,
                parentMessageId,
                mediaKey,
                mediaName,
                mediaUrl,
                mediaSize
            } = data;

            try {
                // 1️⃣ Save message in DB
                const savedMessage = await messageService.createMessage({
                    ChatId: chatId,
                    SenderId: userId,
                    Message: message,
                    MessageType: messageType,
                    ParentMessageId: parentMessageId || null,
                    MediaKey: mediaKey,
                    MediaName: mediaName,
                    MediaUrl: mediaUrl,
                    MediaSize: mediaSize
                });

                console.log(`💬 Message sent in chat ${chatId} by ${userId}`);
                await chatService.updateLastMessage(chatId, savedMessage._id);

                // 2️⃣ Fetch chat to get EnquiryId and Participants
                let chat = await chatService.getChatByChatId(chatId);
                
                if (!chat) {
                    console.warn(`Chat ${chatId} not found`);
                    socket.emit('error', { message: 'Chat not found' });
                    return;
                }

                // Chat channel type (already loaded — no extra query) for list UIs that filter admin-client vs admin-designer
                const chatChannelType = chat.Type != null ? String(chat.Type) : undefined;

                // 3️⃣ Format message data with required fields for frontend
                const messageData = {
                    _id: savedMessage._id.toString(),
                    id: savedMessage._id.toString(),
                    ChatId: chatId.toString(),
                    EnquiryId: chat.EnquiryId?.toString() || null, // REQUIRED for frontend
                    EnquiryName: chat.EnquiryName || undefined,
                    Type: chatChannelType,
                    ChatType: chatChannelType,
                    SenderId: userId.toString(),
                    Message: savedMessage.Message || '',
                    MessageType: savedMessage.MessageType || 'text',
                    Timestamp: savedMessage.Timestamp || savedMessage.createdAt,
                    CreatedAt: savedMessage.createdAt || savedMessage.Timestamp,
                    ParentMessageId: savedMessage.ParentMessageId?.toString() || null,
                    // Media fields if present
                    ...(savedMessage.MediaUrl && {
                        Media: {
                            Url: savedMessage.MediaUrl,
                            Name: savedMessage.MediaName,
                            Key: savedMessage.MediaKey,
                            Size: savedMessage.MediaSize
                        }
                    })
                };

                // 4️⃣ Emit to all users in the chat room (for real-time chat view)
                io.to(`chat_${chatId}`).emit('newMessage', messageData);

                // 5️⃣ 🆕 Emit to ALL chat participants via their personal rooms (for chat list updates)
                // This ensures users on the chat list screen receive the event even if they haven't joined the chat room
                const participants = chat.Participants || [];
                participants.forEach((participantId) => {
                    const participantIdStr = participantId.toString();
                    // Emit to each participant's personal room
                    io.to(`user:${participantIdStr}`).emit('newMessage', messageData);
                });
                
                console.log(`📤 Emitted newMessage to ${participants.length} participants via personal rooms`);

                // ──────────────────────────────────────────────────────────────
                // OPTIMISED: Auto-mark-read + per-user unread recount removed.
                //
                // Why: Each message was triggering markChatAsRead, markMessagesAsRead,
                //      fetchSockets, and N × getUnreadCount DB queries for active readers.
                //      This was the heaviest block per message.
                //
                // How unread works now:
                //   • Frontend increments unread locally on newMessage (chatListRealtimeCache.js)
                //   • Frontend resets unread on messagesRead event (joinChat + markMessagesRead)
                //   • Pull-to-refresh / GET /api/chats returns authoritative backend count
                //   • joinChat already marks all messages read for the joining user
                //
                // To restore: uncomment the block below.
                // ──────────────────────────────────────────────────────────────

                /*
                const connectedSocketsForRead = await io.in(`chat_${chatId}`).fetchSockets();
                const activeUserIdsForRead = connectedSocketsForRead.map((s) => s.data.userId);
                const readers = activeUserIdsForRead.filter((id) => id !== userId);

                if (readers.length > 0) {
                    await chatService.markChatAsRead(chatId, readers);
                    await messageService.markMessagesAsRead(chatId, readers);

                    const unreadCountPromises = readers.map(async (readerId) => {
                        const unreadCount = await getUnreadCount(chatId, readerId);
                        io.to(`user:${readerId}`).emit('messagesRead', {
                            chatId: chatId.toString(),
                            userId: readerId.toString(),
                            unreadCount: unreadCount
                        });
                        return { userId: readerId, unreadCount };
                    });
                    await Promise.all(unreadCountPromises);

                    io.to(`chat_${chatId}`).emit('messagesRead', {
                        chatId: chatId.toString(),
                        userIds: readers.map(id => id.toString())
                    });

                    console.log(`👀 Active readers in chat ${chatId}:`, readers);
                }
                */

                // Recipients = all except sender (for offline notifications)
                const recipients = participants.filter(
                    (p) => p.toString() !== userId.toString()
                );

                // Determine offline users — fetchSockets needed only for push notification targeting
                const connectedSockets = await io.in(`chat_${chatId}`).fetchSockets();
                const activeUserIds = connectedSockets.map((s) => s.data.userId);
                const offlineUserIds = recipients.filter(
                    (id) => !activeUserIds.includes(id.toString())
                );

                console.log(
                    `🔔 Offline participants in chat ${chatId}:`,
                    offlineUserIds
                );

                try {
                    // 1️⃣ Fetch users with their tokens
                    const offlineTokens = await userService.getTokensByIds(offlineUserIds);

                    if (offlineTokens.length === 0) {
                        console.log(`⚠️ No FCM tokens found for offline users in chat ${chatId}`);
                    } else {
                        // 3️⃣ Prepare notification details
                        const title = `💬 New message in enquiry ${chat.EnquiryName}`;
                        const body =
                            messageType === 'text'
                                ? message
                                : messageType === 'image'
                                    ? '📷 Image received'
                                    : messageType === 'video'
                                        ? '🎥 Video received'
                                        : `📎 ${mediaName || 'File attached'}`;

                        const messageChannelId = notificationChannels.getChannelIdByType('new_message');
                        // 4️⃣ Send push to all tokens
                        await pushService.sendPushToTokens(offlineTokens, title, body, {
                            chatId: chatId.toString(),
                            enquiryId: chat.EnquiryId?.toString(),
                            chatType: chat.Type,
                            link: `chats/${chatId.toString()}`, // Mobile app format (no leading slash)
                            type: 'new_message',
                            messageChannelId
                        });

                        console.log(`📲 Sent FCM push to ${offlineTokens.length} offline devices`);
                    }
                } catch (error) {
                    console.error(`❌ Error sending push notifications for chat ${chatId}:`, error);
                }

            } catch (err) {
                console.error('❌ Socket message error:', err);
                socket.emit('error', { message: 'Failed to send message' });
            }
        });


        // Handle editing a message
        socket.on('editMessage', async (data) => {
            const { messageId, userId, newMessage } = data;

            try {
                // 1️⃣ Fetch message
                const message = await messageService.getMessageById(messageId);

                if (!message) {
                    socket.emit('error', { message: 'Message not found' });
                    return;
                }

                // 2️⃣ Permission check
                if (message.SenderId.toString() !== userId.toString()) {
                    socket.emit('error', { message: 'You cannot edit this message' });
                    return;
                }

                // 3️⃣ Cannot edit deleted message
                if (message.IsDeleted) {
                    socket.emit('error', { message: 'Message already deleted' });
                    return;
                }

                // 4️⃣ Update message
                await messageService.editMessage(messageId, userId, newMessage);

                // 5️⃣ Get chat
                const chat = await chatService.getChatByChatId(message.ChatId);

                // 6️⃣ Prepare payload
                const payload = {
                    _id: message._id.toString(),
                    ChatId: message.ChatId.toString(),
                    Message: message.Message,
                    IsEdited: true,
                    EditedAt: message.EditedAt
                };

                // 7️⃣ Emit to chat room (open conversations)
                io.to(`chat_${message.ChatId}`).emit('messageEdited', payload);

                // 8️⃣ Emit to all participants (chat list updates)
                const participants = chat.Participants || [];
                participants.forEach((participantId) => {
                    io.to(`user:${participantId.toString()}`).emit('messageEdited', payload);
                });
                console.log(`✏️ Message ${messageId} edited by ${userId}`);

            } catch (err) {
                console.error('❌ Edit message error:', err);
                socket.emit('error', { message: 'Failed to edit message' });
            }
        });

        // Handle deleting a message
        socket.on('deleteMessage', async (data) => {
            const { messageId, userId } = data;

            try {
                // 1️⃣ Fetch message
                const message = await messageService.getMessageById(messageId);

                if (!message) {
                    socket.emit('error', { message: 'Message not found' });
                    return;
                }

                // 2️⃣ Permission check
                if (message.SenderId.toString() !== userId.toString()) {
                    socket.emit('error', { message: 'You cannot delete this message' });
                    return;
                }

                // 3️⃣ Prevent double delete
                if (message.IsDeleted) {
                    socket.emit('error', { message: 'Message already deleted' });
                    return;
                }

                // 4️⃣ Soft delete
                await messageService.softDeleteMessage(messageId, userId);


                // 5️⃣ Fetch chat
                const chat = await chatService.getChatByChatId(message.ChatId);

                const payload = {
                    _id: message._id.toString(),
                    ChatId: message.ChatId.toString(),
                    IsDeleted: true,
                    DeletedAt: message.DeletedAt
                };

                // 6️⃣ Emit to open chat windows
                io.to(`chat_${message.ChatId}`).emit('messageDeleted', payload);

                // 7️⃣ Emit to chat list users
                const participants = chat.Participants || [];
                participants.forEach((participantId) => {
                    io.to(`user:${participantId.toString()}`).emit('messageDeleted', payload);
                });
                console.log(`🗑️ Message ${messageId} deleted by ${userId}`);

            } catch (err) {
                console.error('❌ Delete message error:', err);
                socket.emit('error', { message: 'Failed to delete message' });
            }
        });




        /**
         * 🆕 Handle marking messages as read (for chat list unread count updates)
         */
        socket.on('markMessagesRead', async (data) => {
            const { chatId, messageIds } = data;
            const userId = socket.userId;

            try {
                if (!chatId) {
                    socket.emit('error', { message: 'chatId is required' });
                    return;
                }

                // 1️⃣ Mark messages as read in database.
                // If specific messageIds are provided, only mark those as read.
                await chatService.markChatAsRead(chatId, [userId]);
                await messageService.markMessagesAsRead(chatId, [userId], messageIds);

                // 2️⃣ Recalculate unread count for this user
                const unreadCount = await getUnreadCount(chatId, userId);

                // 3️⃣ Emit messagesRead event to user's personal room
                io.to(`user:${userId}`).emit('messagesRead', {
                    chatId: chatId.toString(),
                    userId: userId.toString(),
                    unreadCount: unreadCount,
                    messageIds: messageIds || []
                });

                console.log(`✅ User ${userId} marked messages as read in chat ${chatId}. Unread count: ${unreadCount}`);

                // 4️⃣ Also notify others in the chat room (for read receipts/ticks)
                io.to(`chat_${chatId}`).emit('messagesRead', {
                    chatId: chatId.toString(),
                    userIds: [userId.toString()],
                    unreadCount: unreadCount
                });

            } catch (err) {
                console.error('❌ Error marking messages as read:', err);
                socket.emit('error', { message: 'Failed to mark messages as read' });
            }
        });

        socket.on('typing', async ({ chatId, userId, isTyping }) => {
            socket.to(`chat_${chatId}`).emit('userTyping', { userId, isTyping, chatId });
        });

        /**
         * Handle disconnection
         */
        socket.on('disconnect', () => {
            const userId = socket.userId;
            socket.leaveAll();
            console.log(`⚡ Client disconnected: ${socket.id} (User: ${userId})`);
        });
    });

    return io;
}

module.exports = initSocket;