import Joi from "joi";
import { PrismaClient } from "@prisma/client";
import path from 'path'
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import { getReportedUserIdsByUser, getReportedVlogIdsByUser, getVlogLikeStatus, getVlogSaveStatus } from "../utils/helper.js";
import { createNormalNotification, sendNotificationRelateToVlog } from "../utils/notification.js";
import { deleteFileFromS3, uploadFileToS3 } from "../utils/s3-helpers.js";
dotenv.config();
const prisma = new PrismaClient();
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);
const baseurl = process.env.BASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export async function createVlog(req, res) {
    try {
        const { title, description, location } = req.body;
        console.log(req.body);
        const schema = Joi.object({
            title: Joi.string().max(100).required(),
            description: Joi.string().max(500).required(),
            location: Joi.string().optional().allow('')
        });

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
        console.log("req.file", req.file);
        // Check if video file is uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'File is missing',
            });
        }


        if (req.file.mimetype !== 'video/mp4' && req.file.mimetype !== 'video/webm' && req.file.mimetype !== 'video/ogg' && req.file.mimetype !== 'application/octet-stream') {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Please Upload Video file',
            });
        }
        // Generate thumbnail
        // const videoPath = req.file.path;
        // const thumbnailFilename = `${Date.now()}-${req.file.filename.split('.')[0]}.jpg`; // Unique filename for the thumbnail
        // const publicFolderPath = path.join(__dirname, '..', 'public'); // Path to the 'public' folder
        // const thumbnailsFolderPath = path.join(publicFolderPath, 'thumbnails'); // Path to the 'thumbnails' folder
        // //const thumbnailPath = path.join(thumbnailsFolderPath, thumbnailFilename); // Path for saving the thumbnail
        // console.log("thumbnailsFolderPath", thumbnailsFolderPath);
        // console.log("thumbnailFilename", thumbnailFilename)
        // ffmpeg(videoPath)
        //     .screenshots({
        //         timestamps: ['50%'], // Take a screenshot at 50% of the video duration
        //         folder: thumbnailsFolderPath, // Save thumbnails in the 'thumbnails' folder
        //         filename: thumbnailFilename,
        //         size: '640x360', // Thumbnail size
        //     })
        //     .on('end', async () => {
        //         // Thumbnail generated successfully, store it in database
        //         const videoUrl = `${req.file.filename}`;
        //         const thumbnailUrl = `${thumbnailFilename}`;

        //         const vlog = await prisma.vlog.create({
        //             data: {
        //                 title: title,
        //                 description: description,
        //                 userId: req.user.id,
        //                 video_url: videoUrl,
        //                 thumbnail_url: thumbnailUrl,
        //             }
        //         });

        //         return res.status(200).json({
        //             success: true,
        //             status: 200,
        //             message: 'Vlog Created Successfully',
        //             vlog: vlog
        //         });
        //     })
        //     .on('error', (error) => {
        //         console.error('FFmpeg thumbnail generation error:', error);
        //         return res.status(500).json({
        //             success: false,
        //             status: 500,
        //             message: 'Failed to generate thumbnail',
        //             error: error.message,
        //         });
        //     });
        let video_url = null;
        let fileKey = null;
        if (req.file) {

            const s3Response = await uploadFileToS3(req.file);
            video_url = s3Response.Location;
            fileKey = s3Response.Key
        }
        const vlog = await prisma.vlog.create({
            data: {
                title: title,
                description,
                location,
                video_url,
                fileKey,
                userId: req.user.id
            }
        })
        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Vlog Created Successfully',
            vlog: vlog
        });

    } catch (error) {
        console.error('Error in createVlog:', error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error',
            error: error.message,
        });
    }
}
export async function editVlog(req, res) {
    try {
        const { title, description, id } = req.body;
        console.log(req.body);
        const schema = Joi.object({
            title: Joi.string().max(100).optional(),
            description: Joi.string().max(500).optional(),
            id: Joi.number().required()
        });
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
        const vlog = await prisma.vlog.findUnique({
            where: {
                id: parseInt(id),
                userId: req.user.id
            }
        })
        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Vlog Not Found',
            })
        }



        // Check if video file is uploaded
        if (!req.file) {

            await prisma.vlog.update({
                where: {
                    id: parseInt(id)
                },
                data: {
                    title: title ? title : vlog.title,
                    description: description ? description : vlog.description,
                }
            })
            return res.status(200).json({
                success: false,
                status: 200,
                message: 'Vlog updated successfully',
            });
        }
        console.log("req.file", req.file)
        if (req.file.mimetype !== 'video/mp4' && req.file.mimetype !== 'video/webm' && req.file.mimetype !== 'video/ogg') {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Please Upload Video file',
            });
        }
        let video_url = null
        let fileKey = null
        if (req.file) {
            if (vlog.fileKey) {
                await deleteFileFromS3(vlog.fileKey)
            }
            const s3Response = await uploadFileToS3(req.file);
            video_url = s3Response.Location;
            fileKey = s3Response.Key
        }
        await prisma.vlog.update({
            where: {
                id: parseInt(id)
            },
            data: {
                title: title ? title : vlog.title,
                description: description ? description : vlog.description,
                video_url: video_url ? video_url : vlog.video_url,
                fileKey: fileKey ? fileKey : vlog.fileKey
            }
        })
        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Vlog Updated Successfully',
        });
        // Generate thumbnail
        // const videoPath = req.file.path;
        // const thumbnailFilename = `${Date.now()}-${req.file.filename.split('.')[0]}.jpg`; // Unique filename for the thumbnail
        // const publicFolderPath = path.join(__dirname, '..', 'public'); // Path to the 'public' folder
        // const thumbnailsFolderPath = path.join(publicFolderPath, 'thumbnails'); // Path to the 'thumbnails' folder
        // //const thumbnailPath = path.join(thumbnailsFolderPath, thumbnailFilename); // Path for saving the thumbnail
        // console.log("thumbnailsFolderPath", thumbnailsFolderPath);
        // console.log("thumbnailFilename", thumbnailFilename)
        // ffmpeg(videoPath)
        //     .screenshots({
        //         timestamps: ['50%'], // Take a screenshot at 50% of the video duration
        //         folder: thumbnailsFolderPath, // Save thumbnails in the 'thumbnails' folder
        //         filename: thumbnailFilename,
        //         size: '640x360', // Thumbnail size
        //     })
        //     .on('end', async () => {
        //         // Thumbnail generated successfully, store it in database
        //         const videoUrl = `${req.file.filename}`;
        //         const thumbnailUrl = `${thumbnailFilename}`;

        //         // const vlog = await prisma.vlog.update({
        //         //     data: {
        //         //         title: title,
        //         //         description: description,
        //         //         userId: req.user.id,
        //         //         video_url: videoUrl,
        //         //         thumbnail_url: thumbnailUrl,
        //         //     }
        //         // });

        //         await prisma.vlog.update({
        //             where: {
        //                 id: parseInt(id)
        //             },
        //             data: {
        //                 title: title ? title : vlog.title,
        //                 description: description ? description : vlog.description,
        //                 video_url: videoUrl,
        //                 thumbnail_url: thumbnailUrl
        //             }
        //         })

        //         return res.status(200).json({
        //             success: true,
        //             status: 200,
        //             message: 'Vlog Updated Successfully',
        //         });
        //     })
        //     .on('error', (error) => {
        //         console.error('FFmpeg thumbnail generation error:', error);
        //         return res.status(500).json({
        //             success: false,
        //             status: 500,
        //             message: 'Failed to generate thumbnail',
        //             error: error.message,
        //         });
        //     });


    } catch (error) {
        console.error('Error in createVlog:', error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal server error',
            error: error.message,
        });
    }
}
export async function getAllVlogs(req, res) {
    try {
        const { search, page = 1, limit = 10 } = req.query;
        console.log(req.query);
        console.log(page, limit);
        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);
        const userPublicIds = (await prisma.user.findMany({
            where: {
                isPrivate: false
            }
        })).map((user) => user.id);
        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            },
        })).map((follow) => follow.followingId)

        const reportedUserIds = await getReportedUserIdsByUser(req.user.id);
        const reportedVlogIds = await getReportedVlogIdsByUser(req.user.id);

        const vlogs = await prisma.vlog.findMany({
            where: {
                id: {
                    notIn: reportedVlogIds
                },
                userId: {
                    notIn: [...blockedUserIDs, req.user.id, ...reportedUserIds],
                    in: [...userIFollowIds, ...userPublicIds]
                },
                title: {
                    contains: search
                },
            }, include: {
                user: {
                    select: {
                        id: true,
                        full_name: true,
                        city: true,
                        country: true,
                        avatar_url: true,
                        cover_photo_url: true,
                        handle: true,
                        numberOfFollower: true
                    }
                }
            }, orderBy: {
                createdAt: 'desc'
            }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
        })
        console.log('vlogs', vlogs);
        const vlogIds = vlogs.map(({ id }) => id);
        console.log("vlogIds", vlogIds)
        const likeStatus = await getVlogLikeStatus(req.user.id, vlogIds);
        const saveStatus = await getVlogSaveStatus(req.user.id, vlogIds)
        const likeStatusMap = likeStatus.reduce(
            (map, { vlogId, status }) => ({ ...map, [vlogId]: status }),
            {}
        );
        const saveStatusMap = saveStatus.reduce(
            (map, { vlogId, status }) => ({ ...map, [vlogId]: status }),
            {}
        );
        const ans = await Promise.all(vlogs.map(async (vlog) => {

            const likeCount = await prisma.reactVlog.count({
                where: {
                    vlogId: vlog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const commentCount = await prisma.commentVlog.count({
                where: {
                    vlogId: vlog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const saveCount = await prisma.saveVlog.count({
                where: {
                    vlogId: vlog.id,
                    saveByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const viewCount = await prisma.viewVlog.count({
                where: {
                    vlogId: vlog.id,
                    viewByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            vlog.user.numberOfFollower = await prisma.follow.count({
                where: {
                    followingId: vlog.user.id
                }
            })

            const userSetting = await prisma.userSetting.findFirst({
                where: {
                    userId: vlog.user.id
                }
            })

            return { ...vlog, alreadyLiked: likeStatusMap[vlog.id.toString()], alreadySaved: saveStatusMap[vlog.id.toString()], numberOfComment: commentCount, numberOfLikes: likeCount, numberOfSaves: saveCount, numberOfViews: viewCount, commentAllowed: userSetting.commentsAllowed }
        }))
        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Vlogs',
            vlogs: ans
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            status: error,
            message: 'Internal Server Error',
            error: error
        })
    }

}
export async function likeOrUnlikeVlog(req, res) {
    try {
        let { vlogId } = req.params;

        vlogId = parseInt(vlogId);

        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId
            },
            include: {
                user: true
            }
        })

        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Vlog Not Found',
            })
        }

        const reactVlog = await prisma.reactVlog.findFirst({
            where: {
                vlogId: vlogId,
                createByUserId: req.user.id
            }
        })

        if (reactVlog) {
            await prisma.reactVlog.delete({
                where: {
                    id: reactVlog.id,
                    vlogId: vlogId,
                    createByUserId: req.user.id,
                }
            })
            if (vlog.numberOfLikes > 0) {
                await prisma.vlog.update({
                    where: {
                        id: vlogId
                    },
                    data: {
                        numberOfLikes: vlog.numberOfLikes - 1,
                    }
                })
            }
            return res.status(200).json({
                status: 200,
                message: 'Unliked the Vlog',
                success: true
            })
        }
        else {
            const likeVlog = await prisma.reactVlog.create({
                data: {
                    vlogId: vlogId,
                    createByUserId: req.user.id
                }
            })
            await prisma.vlog.update({
                where: {
                    id: vlogId
                },
                data: {
                    numberOfLikes: vlog.numberOfLikes + 1
                }
            })
            // const vlogCreator = await prisma.vlog.findUnique()
            if (req.user.id !== vlog.user.id) {
                await createNormalNotification({
                    toUserId: vlog.user.id,
                    byUserId: req.user.id,
                    data: {
                        id: vlogId,
                        thumbnail_url: vlog.thumbnail_url,
                        video_url: vlog.video_url
                    },
                    type: 'vlog',
                    templateKey: 'vlog_liked',
                    actorName: req.user.full_name
                })

                await sendNotificationRelateToVlog({
                    token: vlog.user.fcm_token,
                    toUserId: vlog.user.id,
                    templateKey: 'vlog_liked',
                    actorName: req.user.full_name,
                    vlogId: vlogId
                })
            }


            return res.status(200).json({
                status: 200,
                message: 'Liked the vlog',
                success: true,
                likeVlog: likeVlog
            })
        }
    } catch (error) {

    }
}
export async function commentOnVlog(req, res) {
    try {
        let { vlogId } = req.params;
        const { content } = req.body;
        vlogId = parseInt(vlogId);
        const schema = Joi.object({
            content: Joi.string().max(255).required(),
        });

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

        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId
            },
            include: {
                user: true
            }
        })

        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'vlog Not Found',
            })
        }
        const createComment = await prisma.commentVlog.create({
            data: {
                content: content,
                createByUserId: req.user.id,
                vlogId: vlogId
            }
        })
        if (req.user.id !== vlog.user.id) {
            await createNormalNotification({
                toUserId: vlog.user.id,
                byUserId: req.user.id,
                data: {
                    id: vlogId,
                    thumbnail_url: vlog.thumbnail_url,
                    video_url: vlog.video_url
                },
                type: 'vlog',
                templateKey: 'vlog_commented',
                actorName: req.user.full_name
            })

            await sendNotificationRelateToVlog({
                token: vlog.user.fcm_token,
                toUserId: vlog.user.id,
                templateKey: 'vlog_commented',
                actorName: req.user.full_name,
                vlogId: vlogId
            })
        }

        await prisma.vlog.update({
            where: {
                id: vlog.id
            },
            data: {
                numberOfComments: (vlog.numberOfComments + 1)
            }
        })
        return res.status(200).json({
            status: 200,
            message: 'Commented on the vlog',
            success: true,
            comment: createComment
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
export async function deleteComment(req, res) {
    try {
        let { vlogId, id } = req.params;
        vlogId = parseInt(vlogId);
        id = parseInt(id);
        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId
            }
        })

        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'vlog Not Found',
            })
        }
        const comment = await prisma.commentVlog.findUnique({
            where: {
                id: id,
                vlogId: vlogId
            }
        })

        if (!comment) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Comment Not Found',
            })
        }

        const deleteComment = await prisma.commentVlog.delete({
            where: {
                id: id,
                createByUserId: req.user.id
            }
        })
        if (vlog.numberOfComments > 0) {
            await prisma.vlog.update({
                where: {
                    id: vlog.id
                },
                data: {
                    numberOfComments: (vlog.numberOfComments - 1)
                }
            })
        }

        return res.status(200).json({
            status: 200,
            message: 'Comment on the vlog Deleted',
            success: true,
            comment: deleteComment
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

export async function getCommentsOnVlog(req, res) {
    try {
        let { vlogId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        vlogId = parseInt(vlogId);

        const vlog = await prisma.vlog.findUnique({
            where: { id: vlogId }
        });

        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Vlog Not Found'
            });
        }

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: { userId: req.user.id },
            select: { userBlockedId: true }
        })).map(user => user.userBlockedId);


        const comments = await prisma.commentVlog.findMany({
            where: {
                vlogId: vlogId,
                createByUserId: { notIn: blockedUserIDs }
            },
            include: { user: true },
            orderBy: { createdAt: 'desc' },
            skip: (parseInt(page) - 1) * parseInt(limit),
            take: parseInt(limit)
        });


        await Promise.all(comments.map(async (comment) => {

            comment.isMyComment = comment.user.id === req.user.id;

            const likeCount = await prisma.reactCommentVlog.count({
                where: { CommentVlogId: comment.id }
            });
            comment.numberOfLikes = likeCount;

            const userLiked = await prisma.reactCommentVlog.findFirst({
                where: {
                    CommentVlogId: comment.id,
                    createByUserId: req.user.id
                }
            });
            comment.isLikedByMe = !!userLiked;
        }));

        return res.status(200).json({
            status: 200,
            message: 'Comments on the vlog',
            success: true,
            comments: comments
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 500,
            message: 'Internal Server Error',
            success: false,
            error: error.message
        });
    }
}

export async function saveOrUnSaveVlog(req, res) {
    try {
        const { categoryId } = req.body;
        const schema = Joi.alternatives(Joi.object({
            categoryId: Joi.number().optional(),
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
        let { vlogId } = req.params;

        vlogId = parseInt(vlogId);

        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId
            }
        })

        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'vlog Not Found',
            })
        }
        const saveVlog = await prisma.saveVlog.findFirst({
            where: {
                vlogId: vlogId,
                saveByUserId: req.user.id
            }
        })

        if (saveVlog) {

            await prisma.saveVlog.delete({
                where: {
                    id: saveVlog.id,
                    saveByUserId: req.user.id,
                    vlogId: vlogId
                }
            })
            if (vlog.numberOfSaves > 0) {
                await prisma.vlog.update({
                    where: {
                        id: vlogId
                    },
                    data: {
                        numberOfSaves: vlog.numberOfSaves - 1,
                    }
                })
            }

            return res.status(200).json({
                status: 200,
                message: 'Vlog Unsaved',
                success: true
            })
        }
        else {

            const saveVlog = await prisma.saveVlog.create({
                data: {
                    vlogId: vlogId,
                    saveByUserId: req.user.id,
                    categoryId: categoryId
                }
            })
            await prisma.vlog.update({
                where: {
                    id: vlogId
                },
                data: {
                    numberOfSaves: vlog.numberOfSaves + 1,
                }
            })
            return res.status(200).json({
                status: 200,
                message: 'Vlog Saved',
                success: true,
                saveVlog: saveVlog
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
}
export async function getMySavedVlogs(req, res) {
    try {
        const { page = 1, limit = 10, categoryId } = req.query;
        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);
        const mySavedVlogs = await prisma.saveVlog.findMany({
            where: {
                saveByUserId: req.user.id,
                categoryId: categoryId && parseInt(categoryId)
            }, include: {
                vlog: {
                    include: {
                        user: true
                    }
                }
            }, orderBy: {
                createdAt: 'desc'
            }, skip: parseInt((page - 1) * limit), take: parseInt(limit)
        })
        await Promise.all(mySavedVlogs.map(async ({ vlog }) => {
            const likeCount = await prisma.reactVlog.count({
                where: {
                    vlogId: vlog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const commentCount = await prisma.commentVlog.count({
                where: {
                    vlogId: vlog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const saveCount = await prisma.saveVlog.count({
                where: {
                    vlogId: vlog.id,
                    saveByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            vlog.numberOfComments = commentCount;
            vlog.numberOfLikes = likeCount;
            vlog.numberOfSaves = saveCount;

            const userSetting = await prisma.userSetting.findFirst({
                where: {
                    userId: vlog.user.id
                }
            })
            vlog.commentAllowed = userSetting.commentsAllowed
        }))
        return res.status(200).json({
            status: 200,
            message: 'My Saved Vlogs',
            success: true,
            mySavedVlogs: mySavedVlogs
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
export async function viewVlog(req, res) {
    try {
        let { vlogId } = req.params;

        vlogId = parseInt(vlogId);
        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId
            }
        })

        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'vlog Not Found',
            })
        }
        const alreadyViewed = await prisma.viewVlog.findFirst({
            where: {
                vlogId: vlogId,
                viewByUserId: req.user.id
            }
        })
        if (alreadyViewed) {
            return res.status(200).json({
                status: 200,
                message: 'Already Viewed the vlog',
                success: true,
            })
        }
        else {
            const viewVlog = await prisma.viewVlog.create({
                data: {
                    vlogId: vlogId,
                    viewByUserId: req.user.id
                }
            })
            await prisma.vlog.update({
                where: {
                    id: vlogId
                },
                data: {
                    numberOfViews: vlog.numberOfViews + 1,
                }
            })

            return res.status(200).json({
                status: 200,
                message: 'Viewed the vlog',
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

}
export async function getVlogById(req, res) {
    try {
        let { vlogId } = req.params;

        vlogId = parseInt(vlogId);

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);

        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId
            },
            include: {
                user: true
            }
        })
        if (!vlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Vlog Not Found',
            })
        }
        const checkReact = await prisma.reactVlog.findFirst({
            where: {
                vlogId: vlogId,
                createByUserId: req.user.id
            }
        })
        const checkSaved = await prisma.saveVlog.findFirst({
            where: {
                vlogId: vlogId,
                saveByUserId: req.user.id
            }
        })
        let alreadyLiked = false;

        let alreadySaved = false;
        if (checkReact) {
            alreadyLiked = true
        }
        if (checkSaved) {
            alreadySaved = true
        }

        const likeCount = await prisma.reactVlog.count({
            where: {
                vlogId: vlog.id,
                createByUserId: {
                    notIn: blockedUserIDs
                }
            }
        })
        const commentCount = await prisma.commentVlog.count({
            where: {
                vlogId: vlog.id,
                createByUserId: {
                    notIn: blockedUserIDs
                }
            }
        })
        const saveCount = await prisma.saveVlog.count({
            where: {
                vlogId: vlog.id,
                saveByUserId: {
                    notIn: blockedUserIDs
                }
            }
        })
        const viewCount = await prisma.viewVlog.count({
            where: {
                vlogId: vlog.id,
                viewByUserId: {
                    notIn: blockedUserIDs
                }
            }
        })
        vlog.numberOfComments = commentCount;
        vlog.numberOfLikes = likeCount;
        vlog.numberOfSaves = saveCount;
        vlog.numberOfViews = viewCount;

        const userSetting = await prisma.userSetting.findFirst({
            where: {
                userId: vlog.user.id
            }
        });
        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            }
        })).map(({ followingId }) => followingId);
        if (userIFollowIds.includes(vlog.user.id)) {
            vlog.isFollowed = true
        }
        else {
            vlog.isFollowed = false
        }

        return res.status(200).json({
            status: 200,
            message: 'Blog ',
            success: true,
            vlog: { ...vlog, alreadyLiked, alreadySaved, commentAllowed: userSetting.commentsAllowed }
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
export async function deleteVlog(req, res) {
    try {
        let { vlogId } = req.params;
        vlogId = parseInt(vlogId);

        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId,
                userId: req.user.id
            }
        })
        if (!vlog) {
            return res.status(400).json({
                status: 200,
                message: 'Vlog Not found',
                success: false,
            })
        }

        await prisma.vlog.delete({
            where: {
                id: vlogId
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Vlog Deleted Successfully',
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
}

export async function likeOrUnlikeVlogComment(req, res) {
    try {
        let { CommentVlogId } = req.params;
        CommentVlogId = parseInt(CommentVlogId);

        const commentOnVlog = await prisma.commentVlog.findUnique({
            where: {
                id: CommentVlogId
            },
            include: {
                user: true
            }
        });

        if (!commentOnVlog) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Vlog comment not found'
            });
        }

        const existingReaction = await prisma.reactCommentVlog.findFirst({
            where: {
                CommentVlogId: CommentVlogId,
                createByUserId: req.user.id
            }
        });

        if (existingReaction) {
            await prisma.reactCommentVlog.delete({
                where: {
                    id: existingReaction.id
                }
            });

            return res.status(200).json({
                status: 200,
                message: 'Unliked the vlog comment',
                success: true
            });
        } else {

            const newLike = await prisma.reactCommentVlog.create({
                data: {
                    CommentVlogId: CommentVlogId,
                    createByUserId: req.user.id
                }
            });

            return res.status(200).json({
                status: 200,
                message: 'Liked the vlog comment',
                success: true,
                likeData: newLike
            });
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({
            status: 500,
            message: 'Internal Server Error',
            success: false,
            error: error.message
        });
    }
}

export async function reportVlog(req, res) {
    try {

        let { VlogId, reason } = req.body;
        const schema = Joi.alternatives(
            Joi.object({
                reason: Joi.string().optional(),
                VlogId: Joi.number().required(),
            })
        )
        console.log("body", req.body)
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

        VlogId = parseInt(VlogId);

        // const myPlan = await getActivePlanForUser(req.user.id);
        // const myActivePlan = myPlan.myPlan.plan;

        const vlog = await prisma.vlog.findUnique({
            where: {
                id: parseInt(VlogId)
            }
        })

        if (!vlog) {
            return res.status(400).json({
                status: 200,
                message: 'Vlog Not Found',
                success: true,
            })
        }

        const alreadyReported = await prisma.reportVlog.findFirst({
            where: {
                reportedByUserId: req.user.id,
                reportedToVlogId: parseInt(VlogId)
            }
        })
        if (alreadyReported) {
            return res.status(400).json({
                status: 400,
                message: 'Vlog Profile Already Reported',
                success: false,
            })
        }

        await prisma.reportVlog.create({
            data: {
                reportedByUserId: req.user.id,
                reportedToVlogId: parseInt(VlogId),
                reason: reason
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Vlog Profile Reported Successfully',
            success: true,
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 500,
            message: 'Internal Server Error',
            success: false,
            error: error
        })

    }
}

export async function shareVlog(req, res) {
    try {
        let { vlogId } = req.params;

        vlogId = parseInt(vlogId);

        const vlog = await prisma.vlog.findUnique({
            where: {
                id: vlogId
            }
        })
        if (!vlog) {
            return res.status(400).json({
                status: 200,
                message: 'vlog Not found',
                success: false,
            })
        }

        const updatevlog = await prisma.vlog.update({
            where: {
                id: vlog.id
            },
            data: {
                numberOfShares: vlog.numberOfShares + 1
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Shared the vlog',
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
}
