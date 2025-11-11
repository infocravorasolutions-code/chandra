// socket.js
const { Server } = require('socket.io');
const chatService = require('../services/chat.service');
const messageService = require('../services/message.service');
const pushService = require('../services/pushNotification.service');
const userService = require('../services/user.service');

const frontendUrl =
    process.env.NODE_ENV === 'production'
        ? 'https://workflow-ui-virid.vercel.app'
        : 'http://localhost:4200';

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

  io.on('connection', (socket) => {
        console.log('🔌 New client connected:', socket.id);

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

                await chatService.markChatAsRead(chatId, [userId]);
                await messageService.markMessagesAsRead(chatId, [userId]);

                // ✅ Notify others in the chat (for read ticks)
                io.to(`chat_${chatId}`).emit('messagesRead', { chatId, userIds: [userId] });

                console.log(`🟢 ${userId} joined room chat_${chatId}`);
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

                // 2️⃣ Emit to all users in the chat room (real-time)
                io.to(`chat_${chatId}`).emit('newMessage', savedMessage);

                // 3️⃣ Identify currently active users in this chat
                const connectedSockets = await io.in(`chat_${chatId}`).fetchSockets();
                const activeUserIds = connectedSockets.map((s) => s.data.userId);
                const readers = activeUserIds.filter((id) => id !== userId);

                // 4️⃣ Mark message as read for all active users (except sender)
                if (readers.length > 0) {
                    await chatService.markChatAsRead(chatId, readers);
                    await messageService.markMessagesAsRead(chatId, readers);

                    // 5️⃣ Notify everyone (sender + other clients) that messages were read
                    io.to(`chat_${chatId}`).emit('messagesRead', {
                        chatId,
                        userIds: readers,
                    });

                    console.log(`👀 Active readers in chat ${chatId}:`, readers);
                }

                // 6️⃣ Fetch chat participants for offline notifications
                const chat = await chatService.getChatByChatId(chatId);
                if (!chat) {
                    console.warn(`Chat ${chatId} not found`);
                    return;
                }

                // Recipients = all except sender
                const recipients = chat.Participants?.filter(
                    (p) => p.toString() !== userId.toString()
                ) || [];

                // Determine offline users = participants not in active socket list
                const offlineUserIds = recipients.filter(
                    (id) => !activeUserIds.includes(id.toString())
                );

                console.log(
                    `🔔 Offline participants in chat ${chatId}:`,
                    offlineUserIds
                );

                try {
                    // 1️⃣ Fetch users with their tokens
                    const offlineTokens = userService.getTokensByIds(offlineUserIds);

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

                        // 4️⃣ Send push to all tokens
                        await pushService.sendPushToTokens(offlineTokens, title, body, {
                            chatId: chatId.toString(),
                            enquiryId: chat.EnquiryId.toString(),
                            type: 'new_message',
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


        /**
         * TODO Typing indicators
         */
        socket.on('typing', ({ chatId, userId, isTyping }) => {
            socket.to(`chat_${chatId}`).emit('userTyping', { userId, isTyping });
        });

        /**
         * Handle disconnection
         */
        socket.on('disconnect', () => {
            socket.leaveAll();
            console.log('⚡ Client disconnected:', socket.id);
        });
    });

    return io;
}

module.exports = initSocket;