// controllers/messageController.js
import { PrismaClient } from '@prisma/client';
import { emitSocketEvent, markMessagesAsSeen } from '../utils/socket.js';
import { ChatEventEnum } from '../utils/constants.js';
import Joi from 'joi';
import dotenv from 'dotenv';
dotenv.config();
import { createNormalNotification, sendNotificationRelateToMessage } from '../utils/notification.js';
import { updateUnreadCount } from '../utils/helper.js';
const baseurl = process.env.BASE_URL;
const prisma = new PrismaClient();
import { uploadFileToS3, deleteFileFromS3 } from '../utils/s3-helpers.js';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getAudioDuration } from '../utils/audioDuration.js';

// allowed mime types (adjust if needed)
const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
const GIF_MIMES = ['image/gif'];
const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska'];
const AUDIO_MIMES = [
    'audio/mpeg', // mp3
    'audio/mp4', // sometimes m4a
    'audio/x-m4a',
    'audio/m4a',
    'audio/aac',
    'audio/x-aac',
    'audio/ogg',
    'audio/wav',
];

// fallback mime detection from filename extension
function mimeFromFilename(filename) {
    if (!filename) return null;
    const ext = (filename.split('.').pop() || '').toLowerCase();
    switch (ext) {
        case 'mp3': return 'audio/mpeg';
        case 'm4a': return 'audio/mp4'; // using audio/mp4; audio/m4a also acceptable
        case 'aac': return 'audio/aac';
        case 'wav': return 'audio/wav';
        case 'ogg': return 'audio/ogg';
        case 'flac': return 'audio/flac';
        case 'mp4': return 'video/mp4';
        case 'mov': return 'video/quicktime';
        case 'jpg':
        case 'jpeg': return 'image/jpeg';
        case 'png': return 'image/png';
        case 'gif': return 'image/gif';
        case 'webp': return 'image/webp';
        default: return null;
    }
}

function inferAttachmentType(mime, filename) {
    if (!mime && !filename) return null;

    if (mime) {
        if (IMAGE_MIMES.includes(mime)) return 'image';
        if (GIF_MIMES.includes(mime)) return 'gif';
        if (VIDEO_MIMES.includes(mime)) return 'video';
        if (AUDIO_MIMES.includes(mime)) return 'audio';
    }

    if (filename) {
        const ext = (filename.split('.').pop() || '').toLowerCase();
        if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
        if (['gif'].includes(ext)) return 'gif';
        if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return 'video';
        if (['mp3', 'm4a', 'aac', 'wav', 'ogg'].includes(ext)) return 'audio';
    }

    return 'file';
}

/**
 * Small buffer-based signature checks (best-effort)
 * Returns a mime string when detected, otherwise null.
 */
function detectMimeFromBuffer(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) return null;
    try {
        // MP4/M4A: 'ftyp' typically appears at offset 4
        const ftyp = buffer.slice(4, 8).toString('utf8');
        if (ftyp === 'ftyp') {
            // default to audio/mp4 for mp4 container files when extension indicates audio (m4a),
            // otherwise audio/mp4 is safe for .m4a produced by browsers/recorders.
            return 'audio/mp4';
        }

        // OggS for ogg
        if (buffer.slice(0, 4).toString('utf8') === 'OggS') return 'audio/ogg';

        // MP3 with ID3 tag starts with "ID3"
        if (buffer.slice(0, 3).toString('utf8') === 'ID3') return 'audio/mpeg';

        // WAV RIFF header
        if (buffer.slice(0, 4).toString('utf8') === 'RIFF' && buffer.slice(8, 12).toString('utf8') === 'WAVE') return 'audio/wav';

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * resolveMimeForUpload(file)
 * - Prefer multer's mime if it's specific and not application/octet-stream
 * - Fall back to filename extension mapping
 * - Fall back to a tiny signature probe on the buffer
 * - Finally fall back to whatever file.mimetype gives (possibly application/octet-stream)
 */
function resolveMimeForUpload(file) {
    if (!file) return null;

    const detected = (file?.mimetype && file.mimetype !== 'application/octet-stream') ? file.mimetype : null;
    if (detected) return detected;

    const extMime = mimeFromFilename(file?.originalname);
    if (extMime) return extMime;

    const bufMime = detectMimeFromBuffer(file?.buffer);
    if (bufMime) return bufMime;

    // final fallback
    return file?.mimetype || 'application/octet-stream';
}

function normalizeId(value) {
    const normalized = Number(value);
    return Number.isInteger(normalized) ? normalized : null;
}

async function resolveAccessibleChat(chatIdOrUserId, currentUserId) {
    const normalizedId = normalizeId(chatIdOrUserId);
    if (normalizedId === null) {
        return { status: 'invalid' };
    }

    const directChat = await prisma.chat.findFirst({
        where: {
            id: normalizedId,
            participants: {
                some: { id: currentUserId },
            },
        },
        include: { participants: true },
    });

    if (directChat) {
        return { status: 'ok', chat: directChat, resolvedBy: 'chatId' };
    }

    if (normalizedId === currentUserId) {
        return { status: 'self_user_id' };
    }

    const chatByParticipant = await prisma.chat.findFirst({
        where: {
            AND: [
                {
                    participants: {
                        some: { id: currentUserId },
                    },
                },
                {
                    participants: {
                        some: { id: normalizedId },
                    },
                },
            ],
        },
        include: { participants: true },
        orderBy: { updatedAt: 'desc' },
    });

    if (chatByParticipant) {
        return { status: 'ok', chat: chatByParticipant, resolvedBy: 'participantId' };
    }

    const existingChat = await prisma.chat.findUnique({
        where: { id: normalizedId },
        select: {
            id: true,
            participants: {
                select: { id: true },
            },
        },
    });

    if (existingChat) {
        return {
            status: 'forbidden',
            participantIds: existingChat.participants.map((participant) => participant.id),
        };
    }

    return { status: 'missing' };
}

export async function sendMessage(req, res) {
    try {
        // DEBUG
        console.log('SENDMESSAGE CONTROLLER VERSION 2');
        console.log('sendMessage params:', req.params);
        console.log('sendMessage body:', req.body);
        console.log('sendMessage file:', req.file ? { originalname: req.file.originalname, size: req.file.size, mimetype: req.file.mimetype } : null);

        const currentUserId = normalizeId(req.user?.id);
        if (currentUserId === null) {
            return res.status(401).json({ status: 401, success: false, message: 'Invalid authenticated user' });
        }

        // 1) chatId validate
        const rawChatId = req.params?.chatId ?? req.body?.chatId;
        if (!rawChatId) return res.status(400).json({ status: 400, success: false, message: 'chatId is required in URL' });
        const chatIdInt = Number(rawChatId);
        if (!Number.isInteger(chatIdInt)) return res.status(400).json({ status: 400, success: false, message: 'Invalid chatId' });

        // 2) basic fields
        const {
            content,
            isLink,
            isLinkId,
            isUrl,
            attachmentUrl: bodyAttachmentUrl,
            fileKey: bodyFileKey,
            mimeType: bodyMimeType,
            durationSeconds: bodyDuration,
            fileSize: bodyFileSize,
        } = req.body;

        const file = req.file || null;

        let attachmentUrl = bodyAttachmentUrl ?? null;
        let fileKey = bodyFileKey ?? null;
        let mimeType = bodyMimeType ?? null;
        let durationSeconds = bodyDuration ? Number(bodyDuration) : null;
        let fileSize = bodyFileSize ? Number(bodyFileSize) : null;
        let attachmentType = null;

        console.log('sendMessage initial attachment state:', {
            attachmentUrl,
            fileKey,
            mimeType,
            durationSeconds,
            fileSize,
            hasFile: Boolean(file),
        });

        // 3) chat + participant check
        const chat = await prisma.chat.findFirst({
            where: {
                id: chatIdInt,
                participants: {
                    some: { id: currentUserId },
                },
            },
            include: {
                participants: {
                    select: { id: true, full_name: true },
                },
            },
        });
        if (!chat) {
            const existingChat = await prisma.chat.findUnique({
                where: { id: chatIdInt },
                include: {
                    participants: {
                        select: { id: true, full_name: true },
                    },
                },
            });

            if (!existingChat) return res.status(404).json({ status: 404, success: false, message: 'Chat does not exist' });

            console.warn('sendMessage participant validation failed', {
                chatId: chatIdInt,
                currentUserId,
                participantIds: existingChat.participants.map((participant) => participant.id),
            });
            return res.status(403).json({ status: 403, success: false, message: 'You are not a participant of this chat' });
        }

        // 4) FILE case: derive mime, compute duration for audio, upload with contentType
        if (file) {
            console.log('sendMessage entering file branch');
            const maxSizeBytes = 150 * 1024 * 1024; // 150MB
            if (file.size > maxSizeBytes) return res.status(400).json({ status: 400, success: false, message: 'File too large' });

            // derive mimeType: prefer multer's, then ext, then buffer probe
            const resolvedMime = resolveMimeForUpload(file);
            mimeType = resolvedMime;
            fileSize = file.size;
            attachmentType = inferAttachmentType(mimeType, file.originalname);

            console.log('DERIVED mimeType:', mimeType, 'attachmentType:', attachmentType, 'filename:', file.originalname);

            // compute audio duration BEFORE upload if audio
            if (attachmentType === 'audio') {
                try {
                    const seconds = await getAudioDuration(file);
                    durationSeconds = seconds ?? null;
                    console.log('Computed audio duration (s):', durationSeconds);
                } catch (err) {
                    console.warn('Failed to compute audio duration:', err?.message ?? err);
                }
            }

            // Upload to S3 and pass explicit contentType (ensure your uploadFileToS3 supports this signature)
            console.log('sendMessage before S3 upload', {
                originalname: file.originalname,
                resolvedMimeType: mimeType,
                attachmentType,
                fileSize,
            });
            const uploadResult = await uploadFileToS3(file, mimeType); // <-- pass mimeType
            console.log('sendMessage after S3 upload', uploadResult);
            attachmentUrl = uploadResult.Location;
            fileKey = uploadResult.Key;
        } else if (attachmentUrl && bodyMimeType) {
            console.log('sendMessage entering pre-uploaded attachment branch');
            // signed-upload / pre-upload case. Prefer client to include duration for audio.
            mimeType = bodyMimeType;
            attachmentType = inferAttachmentType(bodyMimeType, bodyFileKey ?? null);
            // If audio and bodyDuration missing: you can implement server-side S3 fetch+probe (costly),
            // or require client to send durationSeconds.
        }

        console.log('sendMessage final attachment state before DB:', {
            attachmentType,
            attachmentUrl,
            fileKey,
            mimeType,
            durationSeconds,
            fileSize,
        });

        // 5) DB create + chat update
        const { createdMessage, updatedChat } = await prisma.$transaction(async (tx) => {
            const createdMessage = await tx.chatMessage.create({
                data: {
                    content: content ?? null,
                    senderId: currentUserId,
                    chatId: chatIdInt,
                    isLink: isLink ? parseInt(isLink) : 0,
                    isLinkId: isLinkId ?? null,
                    isUrl: isUrl ?? null,
                    attachmentType: attachmentType ?? null,
                    attachmentUrl: attachmentUrl ?? null,
                    fileKey: fileKey ?? null,
                    mimeType: mimeType ?? null,
                    durationSeconds: durationSeconds ?? null,
                    fileSize: fileSize ?? null,
                    seen: false,
                    is_read: false,
                },
            });

            console.log('sendMessage created message payload:', createdMessage);

            const updatedChat = await tx.chat.update({ where: { id: chatIdInt }, data: { lastMessageId: createdMessage.id }, include: { participants: true } });

            return { createdMessage, updatedChat };
        });

        const socketMessage = await prisma.chatMessage.findUnique({ where: { id: createdMessage.id }, include: { sender: true, chat: true } });

        // 6) sockets + unread (existing logic)
        const io = req.app.get('io');
        let userIdsInRoom = new Set();
        if (io) {
            const socketsInRoom = await io.in(chatIdInt.toString()).fetchSockets();
            userIdsInRoom = new Set(socketsInRoom.map((s) => Number(s.user?.id)).filter(Boolean));
        } else {
            console.warn("Socket IO instance not found on req.app. Did you set app.set('io', io)?");
        }

        let anyReceiverInRoom = false;
        for (const participant of updatedChat.participants) {
            const participantId = Number(participant.id);
            if (participantId === currentUserId) continue;

            if (userIdsInRoom.has(participantId)) {
                anyReceiverInRoom = true;
                if (io && typeof markMessagesAsSeen === 'function') {
                    try { await markMessagesAsSeen(chatIdInt, participantId, io); } catch (err) { console.error('Error while markMessagesAsSeen for participant:', participantId, err); }
                }
                emitSocketEvent(req, participantId.toString(), ChatEventEnum.MESSAGE_RECEIVED_EVENT, socketMessage);
            } else {
                const isActiveChat = await prisma.activeChat.findFirst({ where: { userId: participantId, chatId: chatIdInt } });
                if (!isActiveChat) {
                    await createNormalNotification({ toUserId: participantId, byUserId: currentUserId, data: { chatId: chatIdInt }, templateKey: 'message_sent', actorName: req.user.full_name });
                    await sendNotificationRelateToMessage({ token: participant.fcm_token, toUserId: participantId, templateKey: 'message_sent', actorName: req.user.full_name, chatId: chatIdInt });
                }

                await prisma.unreadCount.upsert({
                    where: { userId_chatId: { userId: participantId, chatId: chatIdInt } },
                    update: { unreadCount: { increment: 1 } },
                    create: { userId: participantId, chatId: chatIdInt, unreadCount: 1 },
                });

                emitSocketEvent(req, participantId.toString(), ChatEventEnum.MESSAGE_RECEIVED_EVENT, socketMessage);
                emitSocketEvent(req, participantId.toString(), ChatEventEnum.UNREAD_COUNT_UPDATED, { chatId: chatIdInt, userId: participantId, increment: 1 });
            }
        }

        if (anyReceiverInRoom) {
            socketMessage.seen = true;
            socketMessage.is_read = true;
        }

        emitSocketEvent(req, chatIdInt.toString(), ChatEventEnum.MESSAGE_SENT_EVENT, socketMessage);

        return res.status(200).json({ status: 200, success: true, message: 'Message sent successfully', data: socketMessage });
    } catch (error) {
        console.error('sendMessage error:', error);
        return res.status(500).json({ status: 500, success: false, message: 'Internal Server Error', error: error?.message ?? error });
    }
}

/**
 * uploadAttachmentAndCreateMessage
 * - multipart/form-data with field `file`
 */
export async function uploadAttachmentAndCreateMessage(req, res) {
    try {
        const currentUserId = normalizeId(req.user?.id);
        if (currentUserId === null) return res.status(401).json({ status: 401, message: 'Invalid authenticated user', success: false });

        const rawChatId = req.params?.chatId ?? req.body?.chatId;
        if (!rawChatId) return res.status(400).json({ status: 400, message: 'chatId is required', success: false });
        const chatIdInt = Number(rawChatId);
        if (!Number.isInteger(chatIdInt)) return res.status(400).json({ status: 400, message: 'Invalid chatId', success: false });

        const file = req.file;
        if (!file) return res.status(400).json({ status: 400, message: 'File is required', success: false });

        const maxSizeBytes = 150 * 1024 * 1024; // 150MB
        if (file.size > maxSizeBytes) return res.status(400).json({ status: 400, message: 'File too large', success: false });

        const chat = await prisma.chat.findFirst({
            where: {
                id: chatIdInt,
                participants: {
                    some: { id: currentUserId },
                },
            },
            include: {
                participants: {
                    select: { id: true, full_name: true },
                },
            },
        });
        if (!chat) {
            const existingChat = await prisma.chat.findUnique({
                where: { id: chatIdInt },
                include: {
                    participants: {
                        select: { id: true, full_name: true },
                    },
                },
            });

            if (!existingChat) return res.status(404).json({ status: 404, message: 'Chat does not exists', success: false });

            console.warn('uploadAttachmentAndCreateMessage participant validation failed', {
                chatId: chatIdInt,
                currentUserId,
                participantIds: existingChat.participants.map((participant) => participant.id),
            });
            return res.status(403).json({ status: 403, success: false, message: 'You are not a participant of this chat' });
        }

        // derive mime and type using resolver
        const detectedMime = resolveMimeForUpload(file);
        const mimeType = detectedMime;
        const attachmentType = inferAttachmentType(mimeType, file.originalname);

        // compute duration for audio BEFORE upload
        let computedDuration = null;
        if (attachmentType === 'audio') {
            try {
                computedDuration = await getAudioDuration(file);
            } catch (e) {
                console.warn('Failed to compute audio duration (uploadAttachmentAndCreateMessage):', e?.message ?? e);
                computedDuration = null;
            }
        }

        // upload with explicit contentType
        const { Location, Key } = await uploadFileToS3(file, mimeType);

        const { createdMessage, updatedChat } = await prisma.$transaction(async (tx) => {
            const created = await tx.chatMessage.create({
                data: {
                    content: null,
                    senderId: currentUserId,
                    chatId: chatIdInt,
                    attachmentType,
                    attachmentUrl: Location,
                    fileKey: Key,
                    mimeType: mimeType,
                    durationSeconds: computedDuration ?? null,
                    fileSize: file.size,
                    seen: false,
                    is_read: false,
                },
            });

            const updated = await tx.chat.update({ where: { id: chatIdInt }, data: { lastMessageId: created.id }, include: { participants: true } });

            return { createdMessage: created, updatedChat: updated };
        });

        const socketMessage = await prisma.chatMessage.findUnique({ where: { id: createdMessage.id }, include: { sender: true, chat: true } });

        const io = req.app.get('io');
        let userIdsInRoom = new Set();
        if (io) {
            const socketsInRoom = await io.in(chatIdInt.toString()).fetchSockets();
            userIdsInRoom = new Set(socketsInRoom.map((s) => Number(s.user?.id)).filter(Boolean));
        } else {
            console.warn("Socket IO instance not found on req.app. Did you set app.set('io', io)?");
        }

        let anyReceiverInRoom = false;
        for (const participant of updatedChat.participants) {
            const participantId = Number(participant.id);
            if (participantId === currentUserId) continue;

            if (userIdsInRoom.has(participantId)) {
                anyReceiverInRoom = true;
                if (io && typeof markMessagesAsSeen === 'function') {
                    try { await markMessagesAsSeen(chatIdInt, participantId, io); } catch (err) { console.error('Error while markMessagesAsSeen for participant:', participantId, err); }
                }
                emitSocketEvent(req, participantId.toString(), ChatEventEnum.MESSAGE_RECEIVED_EVENT, socketMessage);
            } else {
                const isActiveChat = await prisma.activeChat.findFirst({ where: { userId: participantId, chatId: chatIdInt } });
                if (!isActiveChat) {
                    await createNormalNotification({ toUserId: participantId, byUserId: currentUserId, data: { chatId: chatIdInt }, templateKey: 'media_sent', actorName: req.user.full_name });
                    await sendNotificationRelateToMessage({ token: participant.fcm_token, toUserId: participantId, templateKey: 'media_sent', actorName: req.user.full_name, chatId: chatIdInt });
                }

                await prisma.unreadCount.upsert({
                    where: { userId_chatId: { userId: participantId, chatId: chatIdInt } },
                    update: { unreadCount: { increment: 1 } },
                    create: { userId: participantId, chatId: chatIdInt, unreadCount: 1 },
                });

                emitSocketEvent(req, participantId.toString(), ChatEventEnum.MESSAGE_RECEIVED_EVENT, socketMessage);
                emitSocketEvent(req, participantId.toString(), ChatEventEnum.UNREAD_COUNT_UPDATED, { chatId: chatIdInt, userId: participantId, increment: 1 });
            }
        }

        if (anyReceiverInRoom) {
            socketMessage.seen = true;
            socketMessage.is_read = true;
        }

        emitSocketEvent(req, chatIdInt.toString(), ChatEventEnum.MESSAGE_SENT_EVENT, socketMessage);

        return res.status(201).json({ status: 201, message: 'Uploaded and message created', payload: socketMessage, success: true });
    } catch (error) {
        console.log('uploadAttachmentAndCreateMessage error:', error);
        return res.status(500).json({ status: 500, message: 'Internal Server Error', success: false, error: error?.message ?? error });
    }
}

// getAllMessages / clearChat unchanged (keep your existing implementations)
export async function getAllMessages(req, res) {
    try {
        const currentUserId = normalizeId(req.user?.id);
        if (currentUserId === null) {
            return res.status(401).json({ status: 401, message: 'Invalid authenticated user', success: false });
        }

        const { chatId } = req.params;
        const resolvedChat = await resolveAccessibleChat(chatId, currentUserId);

        if (resolvedChat.status === 'invalid') {
            return res.status(400).json({ status: 400, message: 'Invalid chatId', success: false });
        }

        if (resolvedChat.status === 'self_user_id') {
            return res.status(400).json({
                status: 400,
                message: 'Use the chat id here, not your own user id',
                success: false,
            });
        }

        if (resolvedChat.status === 'forbidden') {
            return res.status(403).json({
                status: 403,
                message: 'You are not a participant of this chat',
                success: false,
            });
        }

        if (resolvedChat.status === 'missing') {
            return res.status(404).json({
                status: 404,
                message: 'Chat does not exist. Pass the chat id, not senderId/userId.',
                success: false,
            });
        }

        const resolvedChatId = resolvedChat.chat.id;
        const messages = await prisma.chatMessage.findMany({
            where: { chatId: resolvedChatId },
            include: { sender: true, chat: true },
            orderBy: { createdAt: 'desc' },
        });
        const unreadCountData = await prisma.unreadCount.findFirst({ where: { userId: currentUserId, chatId: resolvedChatId } });
        if (unreadCountData) await prisma.unreadCount.update({ where: { id: unreadCountData.id }, data: { unreadCount: 0 } });

        return res.status(200).json({
            status: 200,
            message: 'Messages',
            success: true,
            chatId: resolvedChatId,
            resolvedBy: resolvedChat.resolvedBy,
            messages,
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ status: 500, message: 'Internal Server Error', success: false, error });
    }
}

export async function clearChat(req, res) {
    try {
        const currentUserId = normalizeId(req.user?.id);
        if (currentUserId === null) {
            return res.status(401).json({ status: 401, message: 'Invalid authenticated user', success: false });
        }

        const { chatId } = req.params;
        const normalizedChatId = normalizeId(chatId);
        if (normalizedChatId === null) {
            return res.status(400).json({ status: 400, message: 'Invalid chatId', success: false });
        }

        const chat = await prisma.chat.findFirst({
            where: {
                id: normalizedChatId,
                participants: {
                    some: { id: currentUserId },
                },
            },
            include: { participants: true },
        });

        if (!chat) {
            const existingChat = await prisma.chat.findUnique({
                where: { id: normalizedChatId },
                select: { id: true },
            });

            if (!existingChat) {
                return res.status(404).json({ status: 404, message: 'Chat does not exist', success: false });
            }

            return res.status(403).json({ status: 403, message: 'You are not a participant of this chat', success: false });
        }

        await prisma.chatMessage.deleteMany({ where: { chatId: normalizedChatId } });
        return res.status(200).json({ status: 200, message: 'Chat Cleared Successfully', success: true });
    } catch (error) {
        console.log(error);
        return res.status(500).json({ status: 200, message: 'Internal Server Error', success: false, error });
    }
}
