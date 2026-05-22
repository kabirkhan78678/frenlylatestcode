import { PrismaClient } from "@prisma/client";
import admin from '../utils/firebaseAdmin.js';
const prisma = new PrismaClient();

export function normalizeLanguage(language) {
    if (!language) {
        return 'sv';
    }

    const value = String(language).trim().toLowerCase();
    if (['english', 'en'].includes(value)) {
        return 'en';
    }

    if (['swedish', 'sv', 'svenska'].includes(value)) {
        return 'sv';
    }

    return 'sv';
}

const notificationTemplates = {
    message_sent: {
        title: { en: 'Chat notification', sv: 'Chattnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} sent you a message`,
            sv: `${actorName} skickade ett meddelande till dig`,
        }),
    },
    media_sent: {
        title: { en: 'Chat notification', sv: 'Chattnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} sent you a media`,
            sv: `${actorName} skickade media till dig`,
        }),
    },
    post_liked: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} liked your post`,
            sv: `${actorName} gillade ditt inlagg`,
        }),
    },
    post_commented: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} commented on your post`,
            sv: `${actorName} kommenterade ditt inlagg`,
        }),
    },
    blog_liked: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} liked your blog`,
            sv: `${actorName} gillade din blogg`,
        }),
    },
    blog_commented: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} commented on your blog`,
            sv: `${actorName} kommenterade din blogg`,
        }),
    },
    vlog_liked: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} liked your vlog`,
            sv: `${actorName} gillade din vlogg`,
        }),
    },
    vlog_commented: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} commented on your vlog`,
            sv: `${actorName} kommenterade din vlogg`,
        }),
    },
    follow_request_sent: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} sent you a follow request`,
            sv: `${actorName} skickade en foljeforfragan till dig`,
        }),
    },
    follow_request_accepted: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} accepted your follow request`,
            sv: `${actorName} accepterade din foljeforfragan`,
        }),
    },
    started_following: {
        title: { en: 'Feed notification', sv: 'Flodesnotis' },
        body: ({ actorName }) => ({
            en: `${actorName} is now following you`,
            sv: `${actorName} foljer dig nu`,
        }),
    },
};

async function getOrCreateUserSetting(userId) {
    let userSetting = await prisma.userSetting.findFirst({
        where: {
            userId: userId
        }
    });

    if (userSetting === null) {
        userSetting = await prisma.userSetting.create({
            data: {
                userId: userId,
                language: 'sv',
            }
        });
    }

    return userSetting;
}

async function getRecipientLanguage(toUserId) {
    const userSetting = await getOrCreateUserSetting(toUserId);
    return normalizeLanguage(userSetting.language);
}

function resolveNotificationContent(params, language, fallbackTitle) {
    const template = params.templateKey ? notificationTemplates[params.templateKey] : null;
    const titleByLanguage = template?.title ?? params.titleByLanguage ?? {};
    const bodyByLanguage = template?.body?.({
        actorName: params.actorName,
    }) ?? params.bodyByLanguage ?? {};

    return {
        title: titleByLanguage[language] ?? titleByLanguage.en ?? fallbackTitle,
        body: bodyByLanguage[language] ?? bodyByLanguage.en ?? params.body ?? params.content ?? '',
    };
}

function hasUsableToken(token) {
    return typeof token === 'string' && token.trim().length > 0;
}

function buildPushMessage({ token, title, body, data = {} }) {
    const normalizedData = Object.fromEntries(
        Object.entries(data)
            .filter(([, value]) => value !== undefined && value !== null)
            .map(([key, value]) => [key, String(value)])
    );

    return {
        token,
        notification: {
            title,
            body,
        },
        data: normalizedData,
        android: {
            priority: 'high',
            notification: {
                sound: 'default',
            },
        },
        apns: {
            headers: {
                'apns-priority': '10',
                'apns-push-type': 'alert',
            },
            payload: {
                aps: {
                    sound: 'default',
                    badge: 1,
                    contentAvailable: true,
                },
            },
        },
    };
}

function logPushFailure(error, { toUserId, token, data }) {
    const errorCode = error?.code ?? error?.errorInfo?.code;
    const tokenPreview = typeof token === 'string' && token.length > 12
        ? `${token.slice(0, 8)}...${token.slice(-4)}`
        : token;

    if (errorCode === 'messaging/third-party-auth-error') {
        console.error('iOS push failed: Firebase/APNs authentication issue.', {
            toUserId,
            errorCode,
            tokenPreview,
            data,
            hint: 'Check Firebase Cloud Messaging APNs key, Apple Team ID, Bundle ID, and Firebase project mismatch.',
        });
        return;
    }

    console.error('Push notification send failed.', {
        toUserId,
        errorCode,
        tokenPreview,
        data,
        message: error?.message,
    });
}

async function clearInvalidUserToken(userId, errorCode) {
    const invalidTokenErrors = new Set([
        'messaging/invalid-registration-token',
        'messaging/registration-token-not-registered',
    ]);

    if (!userId || !invalidTokenErrors.has(errorCode)) {
        return;
    }

    await prisma.user.update({
        where: { id: userId },
        data: { fcm_token: null },
    });
}

async function sendPushNotification({ token, toUserId, title, body, data }) {
    if (!hasUsableToken(token)) {
        console.log("User does not have valid fcm token");
        return;
    }

    const message = buildPushMessage({
        token: token.trim(),
        title,
        body,
        data,
    });

    try {
        const response = await admin.messaging().send(message);
        console.log('Successfully sent message:', response);
    } catch (error) {
        logPushFailure(error, { toUserId, token, data });
        console.error('Error sending message:', error);
        await clearInvalidUserToken(toUserId, error?.code);
    }
}

export async function sendNotificationRelateToVlog(params) {
    console.log("here ")
    const updateUserSetting = await getOrCreateUserSetting(params.toUserId);
    console.log(updateUserSetting.feedNotification)
    if (!updateUserSetting.feedNotification) {
        console.log("User has not allowed  feed notifications")
        return;
    }
    if (params.token === null) {
        console.log("User does not have fcm token")
        return;
    }
    console.log("till here ")
    const language = normalizeLanguage(updateUserSetting.language);
    const { title, body } = resolveNotificationContent(params, language, 'Feed notification');
    await sendPushNotification({
        token: params.token,
        toUserId: params.toUserId,
        title,
        body,
        data: {
            vlog_id: params.vlogId,
            type: 'vlog'
        },
    });
}
export async function sendNotificationRelateToBlog(params) {
    console.log("here ")
    const updateUserSetting = await getOrCreateUserSetting(params.toUserId);
    console.log(updateUserSetting.feedNotification)
    if (!updateUserSetting.feedNotification) {
        console.log("User has not allowed  feed notifications")
        return;
    }
    if (params.token === null) {
        console.log("User does not have fcm token")
        return;
    }
    console.log("till here ")
    const language = normalizeLanguage(updateUserSetting.language);
    const { title, body } = resolveNotificationContent(params, language, 'Feed notification');
    await sendPushNotification({
        token: params.token,
        toUserId: params.toUserId,
        title,
        body,
        data: {
            blog_id: params.blogId,
            type: 'blog'
        },
    });
}
export async function sendNotificationRelateToPost(params) {
    console.log("here ")
    const updateUserSetting = await getOrCreateUserSetting(params.toUserId);
    console.log(updateUserSetting.feedNotification)
    if (!updateUserSetting.feedNotification) {
        console.log("User has not allowed  feed notifications")
        return;
    }
    if (params.token === null) {
        console.log("User does not have fcm token")
        return;
    }
    console.log("till here ")
    const language = normalizeLanguage(updateUserSetting.language);
    const { title, body } = resolveNotificationContent(params, language, 'Feed notification');
    await sendPushNotification({
        token: params.token,
        toUserId: params.toUserId,
        title,
        body,
        data: {
            post_id: params.postId,
            type: "post"
        },
    });
}
export async function sendNotificationRelateToFollow(params) {
    console.log("here ")
    const updateUserSetting = await getOrCreateUserSetting(params.toUserId);
    console.log(updateUserSetting.feedNotification)
    if (!updateUserSetting.feedNotification) {
        console.log("User has not allowed  feed notifications")
        return;
    }
    if (params.token === null) {
        console.log("User does not have fcm token")
        return;
    }
    console.log("till here ")
    const language = normalizeLanguage(updateUserSetting.language);
    const { title, body } = resolveNotificationContent(params, language, 'Feed notification');
    await sendPushNotification({
        token: params.token,
        toUserId: params.toUserId,
        title,
        body,
        data: {
            user_id: params.userId,
            type: params.type
        },
    });
}
export async function sendNotificationRelateToMessage(params) {

    const updateUserSetting = await getOrCreateUserSetting(params.toUserId);
    console.log(updateUserSetting.chatNotification)
    if (!updateUserSetting.chatNotification) {
        console.log("User has not allowed  Chat notifications")
        return;
    }
    if (params.token === null) {
        console.log("User does not have fcm token")
        return;
    }
    console.log("till here ")
    const language = normalizeLanguage(updateUserSetting.language);
    const { title, body } = resolveNotificationContent(params, language, 'Chat notification');
    await sendPushNotification({
        token: params.token,
        toUserId: params.toUserId,
        title,
        body,
        data: {
            chat_id: params.chatId,
            type: "chat"
        },
    });
}

export async function createNormalNotification(params) {
    try {
        const language = await getRecipientLanguage(params.toUserId);
        const { body } = resolveNotificationContent(params, language, '');
        const data = {
            toUserId: params.toUserId,
            byUserId: params.byUserId,
            data: params.data,
            content: body,
            type: params.type
        }
        const notification = await prisma.notification.create({
            data: data
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


}

// 23-10

export async function createNormalNotificationForUser(params) {
    try {
        const language = await getRecipientLanguage(params.toUserId);
        const { body } = resolveNotificationContent(params, language, '');
        const data = {
            toUserId: params.toUserId,
            byAdminId: params.byAdminId,
            data: params.data,
            content: body,
            type: params.type
        }
        const notification = await prisma.notification.create({
            data: data
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
}

export async function sendNotificationRelateToAppToUser(params) {
    console.log("here ")
    if (params.token === null) {
        console.log("User does not have fcm token")
        return;
    }
    console.log("till here ")
    const language = await getRecipientLanguage(params.toUserId);
    const { title, body } = resolveNotificationContent(params, language, 'App notification');
    await sendPushNotification({
        token: params.token,
        toUserId: params.toUserId,
        title,
        body,
        data: {
            type: params.type
        },
    });
}
