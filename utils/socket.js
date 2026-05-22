// utils/socket.js
import jwt from "jsonwebtoken";
import { ChatEventEnum } from "../utils/constants.js";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
import dotenv from "dotenv";
dotenv.config();

/* --------------------------------------------------------
   USER STATUS EMIT (online/offline + lastSeenAllowed)
---------------------------------------------------------*/
const emitUserStatus = async (io, userId, isOnline, lastSeen) => {
  try {
    const setting = await prisma.userSetting.findFirst({
      where: { userId: Number(userId) },
    });

    const lastSeenAllowed = setting?.lastSeen ?? true;

    io.emit(ChatEventEnum.USER_STATUS_UPDATED, {
      userId: Number(userId),
      isOnline: isOnline ? 1 : 0,
      lastSeen: lastSeenAllowed ? lastSeen : null,
      lastSeenAllowed,
    });
  } catch (err) {
    console.error("emitUserStatus error:", err);
  }
};

/* --------------------------------------------------------
   MARK MESSAGES AS SEEN
---------------------------------------------------------*/
const markMessagesAsSeen = async (chatId, userId, io) => {
  const chatIdInt = Number(chatId);

  console.log(
    "🟢 markMessagesAsSeen CALLED => chatId:",
    chatIdInt,
    "userId:",
    userId
  );

  const unseenMessages = await prisma.chatMessage.findMany({
    where: {
      chatId: chatIdInt,
      senderId: { not: userId },
      seen: false,
    },
    select: { id: true },
  });

  const messageIds = unseenMessages.map((m) => m.id);

  if (messageIds.length > 0) {
    await prisma.chatMessage.updateMany({
      where: { id: { in: messageIds } },
      data: { seen: true, is_read: true },
    });
    console.log("✅ updated seen for:", messageIds);
  }

  await prisma.unreadCount.upsert({
    where: { userId_chatId: { userId, chatId: chatIdInt } },
    update: { unreadCount: 0 },
    create: { userId, chatId: chatIdInt, unreadCount: 0 },
  });

  io.in(chatIdInt.toString()).emit(ChatEventEnum.MESSAGE_SEEN_EVENT, {
    chatId: chatIdInt,
    seenBy: userId,
    messageIds,
  });

  io.to(userId.toString()).emit(ChatEventEnum.MESSAGE_SEEN_EVENT, {
    chatId: chatIdInt,
    seenBy: userId,
    messageIds,
  });

  return { count: messageIds.length, messageIds };
};

/* --------------------------------------------------------
   JOIN / LEAVE EVENTS
---------------------------------------------------------*/
const mountJoinChatEvent = (io, socket) => {
  socket.on(ChatEventEnum.JOIN_CHAT_EVENT, async (chatId) => {
    if (!chatId) return;

    const chatIdInt = Number(chatId);
    console.log(`🤝 JOIN_CHAT_EVENT: user ${socket.user?.id} joined ${chatIdInt}`);

    socket.join(chatIdInt.toString());

    if (socket.user?.id) {
      await markMessagesAsSeen(chatIdInt, socket.user.id, io);
    }
  });

  socket.on(ChatEventEnum.LEAVE_CHAT_EVENT, (chatId) => {
    if (!chatId) return;

    const chatIdInt = Number(chatId);
    socket.leave(chatIdInt.toString());
    console.log(`🚪 LEAVE_CHAT_EVENT: user ${socket.user?.id} left ${chatIdInt}`);
  });
};

/* --------------------------------------------------------
   TYPING EVENTS
---------------------------------------------------------*/
const mountParticipantTypingEvent = (socket) => {
  socket.on(ChatEventEnum.TYPING_EVENT, (chatId) => {
    if (!chatId) return;

    socket.to(chatId.toString()).emit(ChatEventEnum.TYPING_EVENT, {
      chatId,
      userId: socket.user?.id,
    });
  });
};

const mountParticipantStoppedTypingEvent = (socket) => {
  socket.on(ChatEventEnum.STOP_TYPING_EVENT, (chatId) => {
    if (!chatId) return;

    socket.to(chatId.toString()).emit(ChatEventEnum.STOP_TYPING_EVENT, {
      chatId,
      userId: socket.user?.id,
    });
  });
};

/* --------------------------------------------------------
   MAIN SOCKET.IO INITIALIZER
---------------------------------------------------------*/
const initializeSocketIO = (io) => {
  return io.on("connection", async (socket) => {
    try {
      console.log("🧲 New socket connection attempt:", socket.id);

      const authHeader = socket.handshake.headers?.authorization || "";
      const rawToken =
        (authHeader.startsWith("Bearer ")
          ? authHeader.replace("Bearer ", "")
          : authHeader) || socket.handshake.auth?.token;

      if (!rawToken) {
        console.log("❌ No token provided");
        socket.emit("unauthorized", { message: "Token missing" });
        return socket.disconnect();
      }

      let decoded;
      try {
        decoded = jwt.verify(rawToken, process.env.SECRET_KEY);
      } catch (err) {
        socket.emit("unauthorized", { message: "Invalid token" });
        return socket.disconnect();
      }

      const userId = Number(decoded.userId);
      const user = await prisma.user.findUnique({ where: { id: userId } });

      if (!user) {
        socket.emit("unauthorized", { message: "User not found" });
        return socket.disconnect();
      }

      socket.user = user;

      socket.join(user.id.toString());

      await prisma.user.update({
        where: { id: user.id },
        data: { isOnline: 1, lastSeen: null },
      });

      socket.emit(ChatEventEnum.CONNECTED_EVENT);

      await emitUserStatus(io, user.id, 1, null);

      mountJoinChatEvent(io, socket);
      mountParticipantTypingEvent(socket);
      mountParticipantStoppedTypingEvent(socket);

      /* --------------------------------------------------------
         MESSAGE SENT EVENT
      ---------------------------------------------------------*/
      socket.on(ChatEventEnum.MESSAGE_SENT_EVENT, async (payload) => {
        try {
          const { chatId, content, isLink, isLinkId, isUrl } = payload;
          const senderId = socket.user.id;

          if (!chatId) return;

          const chatIdInt = Number(chatId);

          const newMessage = await prisma.chatMessage.create({
            data: {
              chatId: chatIdInt,
              content,
              senderId,
              isLink: isLink ? 1 : 0,
              isLinkId: isLinkId ?? null,
              isUrl: isUrl ?? null,
              seen: false,
              is_read: false,
            },
          });

          await prisma.chat.update({
            where: { id: chatIdInt },
            data: { lastMessageId: newMessage.id },
          });

          const chat = await prisma.chat.findUnique({
            where: { id: chatIdInt },
            include: { participants: true },
          });

          const otherParticipants = (chat?.participants || [])
            .map((p) => Number(p.userId))
            .filter((uid) => uid !== senderId);

          const socketsInRoom = await io.in(chatIdInt.toString()).fetchSockets();
          const usersInRoom = new Set(
            socketsInRoom.map((s) => Number(s.user?.id)).filter(Boolean)
          );

          const presentUsers = otherParticipants.filter((uid) =>
            usersInRoom.has(uid)
          );

          if (presentUsers.length > 0) {
            await prisma.chatMessage.update({
              where: { id: newMessage.id },
              data: { seen: true, is_read: true },
            });
          }

          for (const participant of otherParticipants) {
            if (usersInRoom.has(participant)) {
              await markMessagesAsSeen(chatIdInt, participant, io);
            } else {
              await prisma.unreadCount.upsert({
                where: {
                  userId_chatId: { userId: participant, chatId: chatIdInt },
                },
                update: { unreadCount: { increment: 1 } },
                create: { userId: participant, chatId: chatIdInt, unreadCount: 1 },
              });

              io.to(participant.toString()).emit(
                ChatEventEnum.UNREAD_COUNT_UPDATED,
                {
                  chatId: chatIdInt,
                  userId: participant,
                  increment: 1,
                }
              );
            }
          }

          const fullMessage = {
            ...newMessage,
            seen: presentUsers.length > 0 ? true : newMessage.seen,
            is_read: presentUsers.length > 0 ? true : newMessage.is_read,
            sender: {
              id: senderId,
              full_name: user.full_name,
              avatar_url: user.avatar_url,
            },
          };

          io.in(chatIdInt.toString()).emit(
            ChatEventEnum.MESSAGE_SENT_EVENT,
            fullMessage
          );
        } catch (err) {
          console.error("MESSAGE SENT ERROR:", err);
        }
      });

      /* --------------------------------------------------------
         CUSTOM DISCONNECT EVENT
      ---------------------------------------------------------*/
      socket.on(ChatEventEnum.DISCONNECT_EVENT, async () => {
        try {
          if (socket.user?.id) {
            const lastSeen = new Date();

            await prisma.user.update({
              where: { id: socket.user.id },
              data: { lastSeen, isOnline: 0 },
            });

            await emitUserStatus(io, socket.user.id, 0, lastSeen);
          }
        } catch (e) {
          console.error("Error on DISCONNECT_EVENT:", e);
        }
      });

      /* --------------------------------------------------------
         SOCKET.IO INTERNAL DISCONNECT
      ---------------------------------------------------------*/
      socket.on("disconnect", async (reason) => {
        try {
          console.log("socket.io disconnect:", socket.id, "reason:", reason);

          if (socket.user?.id) {
            const lastSeen = new Date();

            await prisma.user.update({
              where: { id: socket.user.id },
              data: { lastSeen, isOnline: 0 },
            });

            await emitUserStatus(io, socket.user.id, 0, lastSeen);
          }
        } catch (e) {
          console.error("Error on disconnect event:", e);
        }
      });
    } catch (error) {
      console.error("Socket connection error:", error);
      socket.disconnect();
    }
  });
};

/* --------------------------------------------------------
   EXPORT HELPERS
---------------------------------------------------------*/
const emitSocketEvent = (req, roomId, event, payload) => {
  const io = req.app.get("io");
  if (!io) return;

  io.in(roomId).emit(event, payload);
};

export {
  initializeSocketIO,
  emitSocketEvent,
  ChatEventEnum,
  markMessagesAsSeen,
  emitUserStatus,
};
