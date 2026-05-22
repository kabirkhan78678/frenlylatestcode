import { PrismaClient } from '@prisma/client';
import Joi from 'joi';
import { emitSocketEvent } from '../utils/socket.js'; // Assuming you have this utility function
import { ChatEventEnum } from '../utils/constants.js';

import dotenv from "dotenv";
dotenv.config();
const baseurl = process.env.BASE_URL;
const prisma = new PrismaClient();

async function ensureChatsExistForUsers(currentUserId, candidateUserIds) {
    const uniqueCandidateIds = [...new Set(
        (candidateUserIds || [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id !== currentUserId)
    )];

    if (uniqueCandidateIds.length === 0) {
        return;
    }

    for (const targetUserId of uniqueCandidateIds) {
        const existingChat = await prisma.chat.findFirst({
            where: {
                AND: [
                    { participants: { some: { id: currentUserId } } },
                    { participants: { some: { id: targetUserId } } },
                ],
            },
            select: { id: true },
        });

        if (!existingChat) {
            await prisma.chat.create({
                data: {
                    name: "One on one chat",
                    participants: {
                        connect: [
                            { id: currentUserId },
                            { id: targetUserId },
                        ],
                    },
                },
            });
        }
    }
}

export async function createOrGetAOneOnOneChat(req, res) {
    const { receiverId } = req.params;

    try {
        const currentUserId = Number(req.user.id);
        const receiverIdInt = Number(receiverId);

        // Check if receiver exists
        const receiver = await prisma.user.findUnique({
            where: { id: receiverIdInt }
        });

        if (!receiver) {
            //throw new ApiError(404, "Receiver does not exist");
            return res.status(404).json({
                status: 404,
                message: 'Receiver does not exist',
                success: false,
            })

        }
        if (receiver.avatar_url) {
            receiver.avatar_url = `${baseurl}/images/${receiver.avatar_url}`
        }
        if (receiver.cover_photo_url) {
            receiver.cover_photo_url = `${baseurl}/images/${receiver.cover_photo_url}`
        }
        // Check if receiver is not the user who is requesting a chat
        if (receiver.id === currentUserId) {
            //throw new ApiError(400, "You cannot chat with yourself");
            return res.status(400).json({
                status: 404,
                message: 'You cannot chat with yourself',
                success: false,
            })
        }

        // Check if a chat already exists between the users
        let existingChat = await prisma.chat.findFirst({
            where: {
                AND: [
                    { participants: { some: { id: currentUserId } } },
                    { participants: { some: { id: receiverIdInt } } },
                ],
            },
            include: {
                participants: true,
            },
        });

        if (!existingChat) {
            const orphanChat = await prisma.chat.findFirst({
                where: {
                    lastMessageId: null,
                    participants: {
                        none: {},
                    },
                    ChatMessage: {
                        none: {},
                    },
                },
                orderBy: {
                    id: 'asc',
                },
            });

            if (orphanChat) {
                existingChat = await prisma.chat.update({
                    where: { id: orphanChat.id },
                    data: {
                        participants: {
                            connect: [
                                { id: currentUserId },
                                { id: receiverIdInt },
                            ],
                        },
                    },
                    include: {
                        participants: true,
                    },
                });
                console.warn('Repaired orphan chat by reconnecting participants', {
                    chatId: existingChat.id,
                    participantIds: existingChat.participants.map((participant) => participant.id),
                });
            }
        }

        if (req.user.avatar_url) {
            req.user.avatar_url = `${baseurl}/images/${req.user.avatar_url}`
        }
        if (req.user.cover_photo_url) {
            req.user.cover_photo_url = `${baseurl}/images/${req.user.cover_photo_url}`
        }

        if (existingChat) {

            return res.status(200).json({
                status: 200,
                message: 'Chat retrieved successfully',
                success: true,
                payload: { ...existingChat, participants: [req.user, receiver] }
            })
        }

        // Create a new chat
        const newChat = await prisma.chat.create({
            data: {
                name: "One on one chat",
                participants: {
                    connect: [
                        { id: currentUserId },
                        { id: receiverIdInt }
                    ]
                }
            },
            include: {
                participants: true,
            },
        });

        // Emit socket event to inform participants about the new chat
        const payload = {
            ...newChat,
            participants: [req.user, receiver]
        };

        // Emit event to all participants except the current user
        payload.participants.forEach(participant => {
            if (participant.id !== req.user.id) {
                emitSocketEvent(req, participant.id.toString(), ChatEventEnum.NEW_CHAT_EVENT, payload);
            }
        });
        return res.status(201).json({
            status: 201,
            message: 'Chat created successfully',
            success: true,
            payload: payload
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 200,
            message: 'Internal Server Error',
            success: false,
            error: error
        })

    }
};
export async function getAllChats(req, res) {
    try {
        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);

        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            },
            select: {
                followingId: true,
            }
        })).map(({ followingId }) => followingId);

        const myFollowersIDs = (await prisma.follow.findMany({
            where: {
                followingId: req.user.id,
                status: 1
            },
            select: {
                followerId: true,
            }
        })).map(({ followerId }) => followerId);

        const friendsArray = myFollowersIDs.filter((id) => userIFollowIds.includes(id));
        const chatSeedUserIds = [...friendsArray]
            .filter((id) => !blockedUserIDs.includes(id));

        await ensureChatsExistForUsers(req.user.id, chatSeedUserIds);

        const chats = await prisma.chat.findMany({
            where: {
                participants: {
                    some:
                        { id: req.user.id },
                    none: {
                        id: {
                            in: blockedUserIDs
                        }
                    }
                }
            },
            include: {
                participants: true,
                lastMessage: true,
            }, orderBy: {
                lastMessage: {
                    updatedAt: 'desc'
                }
            }
        })
        await Promise.all(chats.map((chat) => {
            chat.participants.map(async (participant) => {
                // const unreadCountData = await prisma.unreadCount.findFirst({
                //     where:{
                //         chatId:chat.id,
                //         userId:participant.id
                //     }
                // })
                // if(unreadCountData)
                // {
                //     participant.unreadCount = unreadCountData.unreadCount
                // }
                // else{
                //     participant.unreadCount = 0
                // }

                // if(participant.avatar_url){
                //     console.log('here');
                //     console.log('particpanturl',participant.avatar_url);
                //     participant.avatar_url = `${baseurl}/images/${participant.avatar_url}`
                // }
                // if(participant.cover_photo_url){
                //     participant.cover_photo_url = `${baseurl}/images/${participant.cover_photo_url}`
                // }
                return participant
            })
            return chat
        }))
        // await Promise.all(chats.map(async (chat) => {
        //     chat.participants = await Promise.all(chat.participants.map(async (participant) => {
        //         const unreadCountData = await prisma.unreadCount.findFirst({
        //             where: {
        //                 chatId: chat.id,
        //                 userId: participant.id
        //             }
        //         });
        //         console.log(unreadCountData, "unreadcountdata");
        //         participant.unreadCount = unreadCountData ? unreadCountData.unreadCount : 0;
        //         return participant;
        //     }));
        //     return chat;
        // }));
        await Promise.all(chats.map(async (chat) => {
            const unreadCountData = await prisma.unreadCount.findFirst({
                where: {
                    chatId: chat.id,
                    userId: req.user.id
                }
            });
            chat.unreadCount = unreadCountData ? unreadCountData.unreadCount : 0;
        }));
        return res.status(200).json({
            status: 200,
            message: 'Chats Retrieved Successfully',
            success: true,
            chats: chats
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 200,
            message: 'Internal Server Error',
            success: false,
            error: error
        })


    }
};
export async function deleteChat(req, res) {
    try {
        const { chatId } = req.params;
        const chat = await prisma.chat.findUnique({
            where: {
                id: parseInt(chatId)
            },
            include: {
                participants: true
            }
        })
        if (!chat) {
            return res.status(404).json({
                status: 404,
                message: 'Chat does not exists',
                success: false,
            })
        }
        const otherParticipant = chat.participants.find((participant) => participant.id !== req.user.id)
        emitSocketEvent(
            req,
            otherParticipant.id.toString(),
            ChatEventEnum.LEAVE_CHAT_EVENT,
            chat
        );
        await prisma.chat.delete({
            where: {
                id: parseInt(chatId)
            }
        });
        return res.status(200).json({
            status: 200,
            message: 'Chat Deleted Successfully',
            success: true,
        })


    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 200,
            message: 'Internal Server Error',
            success: false,
            error: error
        })

    }

};
export async function activateDeactivateChat(req, res) {
    try {
        const { chatId } = req.body;
        const schema = Joi.alternatives(Joi.object({
            chatId: Joi.number().required()
        }))
        const result = schema.validate(req.body);
        if (result.error) {
            const message = result.error.details.map((i) => i.message).join(",");
            return res.json({
                message: result.error.details[0].message,
                error: message,
                missingParams: result.error.details[0].message,
                status: 400,
                success: false,
            });
        }
        const isActivateChat = await prisma.activeChat.findFirst({
            where: {
                userId: req.user.id,
                chatId: chatId
            }
        })
        if (isActivateChat) {
            await prisma.activeChat.delete({
                where: {
                    id: isActivateChat.id
                }
            })
            return res.status(200).json({
                status: 200,
                message: 'Chat Deactivated Successfullt',
                success: true,
            })

        }
        else {
            const activateChat = await prisma.activeChat.create({
                data: {
                    userId: req.user.id,
                    chatId: chatId
                }
            })
            return res.status(200).json({
                status: 200,
                message: 'Chat Activated',
                success: true,
            })
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 200,
            message: 'Internal Server Error',
            success: false,
            error: error
        })

    }
};

/**
 * REST endpoint to create a message in a chat (if you want REST-based message creation)
 * Also updates unread counts and emits socket events using emitSocketEvent(req,...)
 */
export async function createMessageREST(req, res) {
    try {
        const { chatId } = req.params;
        const { content, isLink, isLinkId, isUrl } = req.body;
        const senderId = req.user.id;

        const newMessage = await prisma.chatMessage.create({
            data: {
                chatId: parseInt(chatId),
                content: content ?? null,
                senderId,
                isLink: isLink ? 1 : 0,
                isLinkId: isLinkId ?? null,
                isUrl: isUrl ?? null,
            },
        });

        await prisma.chat.update({ where: { id: parseInt(chatId) }, data: { lastMessageId: newMessage.id } });

        // get participants and update unreadCount, emit events
        const chat = await prisma.chat.findUnique({ where: { id: parseInt(chatId) }, include: { participants: true } });
        const otherParticipants = (chat.participants || []).filter((p) => p.id !== senderId);

        for (const participant of otherParticipants) {
            await prisma.unreadCount.upsert({
                where: {
                    userId_chatId: {
                        userId: participant.id,
                        chatId: parseInt(chatId),
                    },
                },
                update: { unreadCount: { increment: 1 } },
                create: { userId: participant.id, chatId: parseInt(chatId), unreadCount: 1 },
            });

            emitSocketEvent(req, participant.id.toString(), ChatEventEnum.UNREAD_COUNT_UPDATED, {
                chatId: parseInt(chatId),
                userId: participant.id,
                increment: 1,
            });
        }

        // emit message to chat room
        emitSocketEvent(req, parseInt(chatId).toString(), ChatEventEnum.MESSAGE_SENT_EVENT, {
            ...newMessage,
            sender: { id: senderId, full_name: req.user.full_name, avatar_url: req.user.avatar_url },
        });

        return res.status(201).json({ status: 201, message: "Message created", payload: newMessage, success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 500, message: "Internal Server Error", success: false, error });
    }
}

/**
 * Mark messages as seen (explicit REST API)
 */
export async function markChatMessagesAsSeen(req, res) {
    try {
        const { chatId } = req.body;
        const userId = req.user.id;

        // find unseen messages
        const unseenMessages = await prisma.chatMessage.findMany({
            where: { chatId: parseInt(chatId), senderId: { not: userId }, seen: false },
            select: { id: true },
        });
        const messageIds = unseenMessages.map((m) => m.id);

        if (messageIds.length > 0) {
            await prisma.chatMessage.updateMany({
                where: { id: { in: messageIds } },
                data: { seen: true },
            });
        }

        // reset unreadCount for this user/chat
        await prisma.unreadCount.upsert({
            where: { userId_chatId: { userId, chatId: parseInt(chatId) } },
            update: { unreadCount: 0 },
            create: { userId, chatId: parseInt(chatId), unreadCount: 0 },
        });

        // notify other participants
        const chat = await prisma.chat.findUnique({ where: { id: parseInt(chatId) }, include: { participants: true } });
        const payload = { chatId: parseInt(chatId), seenBy: userId, messageIds };

        (chat.participants || []).forEach((p) => {
            if (p.id !== userId) {
                emitSocketEvent(req, p.id.toString(), ChatEventEnum.MESSAGE_SEEN_EVENT, payload);
            }
        });

        return res.status(200).json({ status: 200, message: "Messages marked as seen", changed: messageIds.length, success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ status: 500, message: "Internal Server Error", success: false, error });
    }
}

