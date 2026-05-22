import Joi from "joi";
import { PrismaClient } from "@prisma/client";
import path from 'path'
import dotenv from "dotenv";
import { fileURLToPath } from 'url';

import { createNormalNotification, sendNotificationRelateToPost } from "../utils/notification.js";
import { getPostLikeStatus, getPostSaveStatus, getReportedPostIdsByUser, getReportedUserIdsByUser, shouldHideLikes } from "../utils/helper.js";
import { deleteFileFromS3, uploadFileToS3 } from "../utils/s3-helpers.js";
dotenv.config();
const prisma = new PrismaClient();
const baseurl = process.env.BASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export async function createPost(req, res) {
    try {
        const { caption, location } = req.body;
        console.log(req.body);
        const schema = Joi.object({
            caption: Joi.string().required(),
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
        else {
            let image_url = null;
            let fileKey = null;
            if (req.file) {

                const s3Response = await uploadFileToS3(req.file);
                image_url = s3Response.Location;
                fileKey = s3Response.Key
            }
            const post = await prisma.post.create({
                data: {
                    caption: caption,
                    location: location,
                    userId: req.user.id,
                    image_url: image_url,
                    fileKey: fileKey
                }
            })

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Post Created Successfully',
                post: post
            })
        }

    } catch (error) {
        return res.json({
            success: false,
            message: "Internal server error",
            status: 500,
            error: error
        })
    }
}
export async function editPost(req, res) {
    try {
        const { caption, id } = req.body;
        console.log(req.body);
        const schema = Joi.object({
            caption: Joi.string().optional(),
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
        else {
            const post = await prisma.post.findUnique({
                where: {
                    id: parseInt(id),
                    userId: req.user.id
                }
            });
            if (!post) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Post Not Found',
                })
            }
            let image_url = null
            let fileKey = null
            if (req.file) {
                if (post.fileKey) {
                    await deleteFileFromS3(post.fileKey)
                }
                const s3Response = await uploadFileToS3(req.file);
                image_url = s3Response.Location;
                fileKey = s3Response.Key
            }
            await prisma.post.update({
                where: {
                    id: parseInt(id)
                },
                data: {
                    caption: caption ? caption : post.caption,
                    image_url: image_url ? image_url : post.image_url,
                    fileKey: fileKey ? fileKey : post.fileKey
                }
            })

            const updatePost = await prisma.post.findUnique({
                where: {
                    id: parseInt(id),
                    userId: req.user.id
                }
            });

            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Post Updated Successfully',
                post: updatePost
            })
        }

    } catch (error) {
        console.log(error)
        return res.json({
            success: false,
            message: "Internal server error",
            status: 500,
            error: error
        })
    }
}
export async function getAllPosts(req, res) {
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
        const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
        const reportedPostIds = await getReportedPostIdsByUser(req.user.id)
        const posts = await prisma.post.findMany({
            where: {
                id: {
                    notIn: reportedPostIds
                },
                userId: {
                    notIn: [...blockedUserIDs, req.user.id, ...reportedUserIds],
                    in: [...userIFollowIds, ...userPublicIds]
                },
                caption: {
                    contains: search
                },
            }, include: {
                user: true
            }, orderBy: {
                createdAt: "desc"
            },
            skip: parseInt((page - 1) * limit), take: parseInt(limit),
        })
        const postIds = posts.map(({ id }) => id);
        const likeStatus = await getPostLikeStatus(req.user.id, postIds);
        const likeStatusMap = likeStatus.reduce(
            (map, { postId, status }) => ({ ...map, [postId]: status }),
            {}
        );
        const saveStatus = await getPostSaveStatus(req.user.id, postIds);
        const saveStatusMap = saveStatus.reduce(
            (map, { postId, status }) => ({ ...map, [postId]: status }),
            {}
        );

        // Get all user settings for posts to check hideLikes
        const userIds = [...new Set(posts.map(post => post.userId))];
        const userSettings = await prisma.userSetting.findMany({
            where: {
                userId: { in: userIds }
            }
        });
        const userSettingsMap = userSettings.reduce((map, setting) => {
            map[setting.userId] = setting;
            return map;
        }, {});

        const ans = await Promise.all(posts.map(async (post) => {
            const userSetting = userSettingsMap[post.userId];
            const hideLikes = await shouldHideLikes(post.userId, req.user.id);

            // Get like count (hide if needed)
            const likeCount = await prisma.reactPost.count({
                where: { postId: post.id }
            });

            return {
                ...post,
                alreadySaved: saveStatusMap[post.id.toString()],
                commentAllowed: userSetting?.commentsAllowed ?? true,
                alreadyLiked: likeStatusMap[post.id.toString()],
                hideLikes: hideLikes, // Add this field
                numberOfLikes: hideLikes ? 0 : likeCount, // Hide like count if needed
                actualLikeCount: likeCount // Keep actual count for internal use if needed
            }
        }))

        return res.status(200).json({
            success: true,
            status: 200,
            message: 'Posts',
            posts: ans
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: 'Internal Server Error',
            error: error
        })
    }
}
export async function commentOnPost(req, res) {
    try {
        let { postId } = req.params;
        const { content } = req.body;
        postId = parseInt(postId);
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

        const post = await prisma.post.findUnique({
            where: {
                id: postId
            },
            include: {
                user: true
            }
        })

        if (!post) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Post Not Found',
            })
        }
        const createComment = await prisma.commentPost.create({
            data: {
                content: content,
                createByUserId: req.user.id,
                postId: postId
            }
        })
        await prisma.post.update({
            where: {
                id: post.id
            },
            data: {
                numberOfComments: (post.numberOfComments + 1)
            }
        })
        if (req.user.id !== post.user.id) {
            await createNormalNotification({
                toUserId: post.user.id,
                byUserId: req.user.id,
                data: {
                    id: postId,
                    image_url: post.image_url
                },
                type: 'post',
                templateKey: 'post_commented',
                actorName: req.user.full_name
            })

            await sendNotificationRelateToPost({
                token: post.user.fcm_token,
                toUserId: post.user.id,
                templateKey: 'post_commented',
                actorName: req.user.full_name,
                postId: postId
            })
        }

        return res.status(200).json({
            status: 200,
            message: 'Commented on the post',
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
export async function saveOrUnSavePost(req, res) {
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
        let { postId } = req.params;

        postId = parseInt(postId);

        const post = await prisma.post.findUnique({
            where: {
                id: postId
            }
        })

        if (!post) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'post Not Found',
            })
        }
        const savePost = await prisma.savePost.findFirst({
            where: {
                postId: postId,
                saveByUserId: req.user.id
            }
        })

        if (savePost) {

            await prisma.savePost.delete({
                where: {
                    id: savePost.id,
                    saveByUserId: req.user.id,
                    postId: postId
                }
            })
            if (post.numberOfSaves > 0) {
                await prisma.post.update({
                    where: {
                        id: postId
                    },
                    data: {
                        numberOfSaves: post.numberOfSaves - 1,
                    }
                })
            }

            return res.status(200).json({
                status: 200,
                message: 'Post Unsaved',
                success: true
            })
        }
        else {

            const savePost = await prisma.savePost.create({
                data: {
                    postId: postId,
                    saveByUserId: req.user.id,
                    categoryId: parseInt(categoryId)
                }
            })
            await prisma.post.update({
                where: {
                    id: postId
                },
                data: {
                    numberOfSaves: post.numberOfSaves + 1,
                }
            })
            return res.status(200).json({
                status: 200,
                message: 'Post Saved',
                success: true,
                savePost: savePost
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
export async function getMySavedPosts(req, res) {
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
        const mySavedPosts = await prisma.savePost.findMany({
            where: {
                saveByUserId: req.user.id,
                categoryId: categoryId && parseInt(categoryId)
            }, include: {
                post: {
                    include: {
                        user: true
                    }
                }
            }, orderBy: {
                createdAt: 'desc'
            }, skip: parseInt((page - 1) * limit), take: parseInt(limit)
        })
        await Promise.all(mySavedPosts.map(async ({ post }) => {
            // const likeCount = await prisma..count({
            //     where: {
            //         postId: post.id,
            //         createByUserId: {
            //             notIn: blockedUserIDs
            //         }
            //     }
            // })
            const commentCount = await prisma.commentPost.count({
                where: {
                    postId: post.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const saveCount = await prisma.savePost.count({
                where: {
                    postId: post.id,
                    saveByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            post.numberOfComments = commentCount;
            post.numberOfSaves = saveCount;

            const userSetting = await prisma.userSetting.findFirst({
                where: {
                    userId: post.user.id
                }
            })
            post.commentAllowed = userSetting.commentsAllowed

        }))
        return res.status(200).json({
            status: 200,
            message: 'My Saved Posts',
            success: true,
            mySavedPosts: mySavedPosts
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
export async function getCommentsOnPost(req, res) {
    try {
        let { postId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        postId = parseInt(postId);

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true
            }
        })).map((user) => user.userBlockedId);


        const comments = await prisma.commentPost.findMany({
            where: {
                postId: postId,
                createByUserId: {
                    notIn: blockedUserIDs
                }
            },
            include: {
                user: true,
            },
            orderBy: {
                createdAt: 'desc'
            },
            skip: (parseInt(page) - 1) * parseInt(limit),
            take: parseInt(limit)
        });

        await Promise.all(comments.map(async (comment) => {

            comment.isMyComment = comment.user.id === req.user.id;


            const likeCount = await prisma.reactCommentPost.count({
                where: {
                    CommentPostId: comment.id
                }
            });
            comment.numberOfLikes = likeCount;

            const userLiked = await prisma.reactCommentPost.findFirst({
                where: {
                    CommentPostId: comment.id,
                    createByUserId: req.user.id
                }
            });
            comment.isLikedByMe = !!userLiked;
        }));

        return res.status(200).json({
            status: 200,
            message: 'Comments on the post',
            success: true,
            comments: comments
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 500, // Corrected status code
            message: 'Internal Server Error',
            success: false,
            error: error.message
        });
    }
}
export async function deleteComment(req, res) {
    try {
        let { postId, id } = req.params;
        postId = parseInt(postId);
        id = parseInt(id);
        const post = await prisma.post.findUnique({
            where: {
                id: postId
            }
        })

        if (!post) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Post Not Found',
            })
        }
        const comment = await prisma.commentPost.findUnique({
            where: {
                id: id,
                postId: postId
            }
        })

        if (!comment) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Comment Not Found',
            })
        }

        const deleteComment = await prisma.commentPost.delete({
            where: {
                id: id,
                createByUserId: req.user.id
            }
        })
        if (post.numberOfComments > 0) {
            await prisma.post.update({
                where: {
                    id: post.id
                },
                data: {
                    numberOfComments: (post.numberOfComments - 1)
                }
            })
        }

        return res.status(200).json({
            status: 200,
            message: 'Comment on the post Deleted',
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
export async function getPostById(req, res) {
    try {
        let { postId } = req.params;
        postId = parseInt(postId);

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);

        const post = await prisma.post.findUnique({
            where: {
                id: postId
            },
            include: {
                user: true
            }
        });

        if (!post) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Post Not Found",
            });
        }

        const checkSaved = await prisma.savePost.findFirst({
            where: {
                postId: postId,
                saveByUserId: req.user.id,
            },
        });

        const checkReact = await prisma.reactPost.findFirst({
            where: {
                postId: postId,
                createByUserId: req.user.id,
            },
        });

        let alreadyLiked = !!checkReact;
        let alreadySaved = !!checkSaved;

        const commentCount = await prisma.commentPost.count({
            where: {
                postId: post.id,
                createByUserId: {
                    notIn: blockedUserIDs,
                },
            },
        });

        const saveCount = await prisma.savePost.count({
            where: {
                postId: post.id,
                saveByUserId: {
                    notIn: blockedUserIDs,
                },
            },
        });

        // like count
        const likeCount = await prisma.reactPost.count({
            where: {
                postId: post.id,
                // agar blockedUser ko filter karna hai to yaha bhi add kar sakte ho:
                // createByUserId: { notIn: blockedUserIDs },
            },
        });

        post.numberOfComments = commentCount;
        post.numberOfSaves = saveCount;

        const userSetting = await prisma.userSetting.findFirst({
            where: {
                userId: post.userId, // important: userId, not setting ka id
            },
        });

        const hideLikes = !!userSetting?.hideLikes;

        return res.status(200).json({
            status: 200,
            message: "Post",
            success: true,
            post: {
                ...post,
                alreadySaved,
                alreadyLiked,
                commentAllowed: userSetting?.commentsAllowed ?? true,
                hideLikes: hideLikes,
                numberOfLikes: hideLikes ? 0 : likeCount,
            },
        });
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 200,
            message: "Internal Server Error",
            success: false,
            error: error,
        });
    }
}

export async function deletePost(req, res) {
    try {
        let { postId } = req.params;
        postId = parseInt(postId);

        const post = await prisma.post.findUnique({
            where: {
                id: postId,
                userId: req.user.id
            }
        })
        if (!post) {
            return res.status(400).json({
                status: 200,
                message: 'Post Not found',
                success: false,
            })
        }

        await prisma.post.delete({
            where: {
                id: postId
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Post Deleted Successfully',
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
export async function likeOrUnlikePost(req, res) {
    try {
        let { postId } = req.params;

        postId = parseInt(postId);

        const post = await prisma.post.findUnique({
            where: {
                id: postId
            },
            include: {
                user: true
            }
        })

        if (!post) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Post Not Found',
            })
        }
        const reactPost = await prisma.reactPost.findFirst({
            where: {
                postId: postId,
                createByUserId: req.user.id
            }
        })

        if (reactPost) {
            await prisma.reactPost.delete({
                where: {
                    id: reactPost.id,
                    postId: postId,
                    createByUserId: req.user.id
                }
            })
            let numberOfLikes = (await prisma.post.findUnique({
                where: {
                    id: postId
                },
                select: {
                    numberOfLikes: true
                }
            })).numberOfLikes

            if (numberOfLikes > 0) {
                numberOfLikes = numberOfLikes - 1;
            }
            await prisma.post.update({
                where: {
                    id: postId
                },
                data: {
                    numberOfLikes: numberOfLikes
                }
            })

            return res.status(200).json({
                status: 200,
                message: 'Unliked the post',
                success: true
            })
        }
        else {
            const likePost = await prisma.reactPost.create({
                data: {
                    postId: postId,
                    createByUserId: req.user.id
                }
            })
            let numberOfLikes = (await prisma.post.findUnique({
                where: {
                    id: postId
                },
                select: {
                    numberOfLikes: true
                }
            })).numberOfLikes

            numberOfLikes = numberOfLikes + 1;
            await prisma.post.update({
                where: {
                    id: postId
                },
                data: {
                    numberOfLikes: numberOfLikes
                }
            })

            if (req.user.id !== post.user.id) {
                console.log("++++_+_+_+_+_+++")
                await createNormalNotification({
                    toUserId: post.user.id,
                    byUserId: req.user.id,
                    data: {
                        id: postId,
                        image_url: post.image_url
                    },
                    type: 'post',
                    templateKey: 'post_liked',
                    actorName: req.user.full_name
                })

                await sendNotificationRelateToPost({
                    token: post.user.fcm_token,
                    toUserId: post.user.id,
                    templateKey: 'post_liked',
                    actorName: req.user.full_name,
                    postId: postId
                })
            }

            // const likedPost = await prisma.reactPost.findUnique({
            //     where:{
            //         id:likePost.id
            //     },
            //     include:{
            //         user:true
            //     }
            // });
            // console.log(likedPost)
            return res.status(200).json({
                status: 200,
                message: 'Liked the post',
                success: true,
                likePost: likePost
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
export async function sharePost(req, res) {
    try {
        let { postId } = req.params;

        postId = parseInt(postId);

        const post = await prisma.post.findUnique({
            where: {
                id: postId
            }
        })
        if (!post) {
            return res.status(400).json({
                status: 200,
                message: 'Post Not found',
                success: false,
            })
        }

        const updatepost = await prisma.post.update({
            where: {
                id: post.id
            },
            data: {
                numberOfShares: post.numberOfShares + 1
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Shared the post',
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
export async function likeOrUnlikePostComment(req, res) {
    try {
        let { CommentPostId } = req.params;
        CommentPostId = parseInt(CommentPostId); // Ensure CommentPostId is an integer

        // Find the comment post to be liked or unliked
        const commentOnPost = await prisma.commentPost.findUnique({
            where: {
                id: CommentPostId
            },
            include: {
                user: true // Assuming you want to include the comment author's info
            }
        });

        // If comment not found, return 404
        if (!commentOnPost) {
            return res.status(404).json({
                success: false,
                status: 404,
                message: 'Comment not found'
            });
        }

        // Check if the user has already liked the comment post
        const existingReaction = await prisma.reactCommentPost.findFirst({
            where: {
                CommentPostId: CommentPostId,
                createByUserId: req.user.id
            }
        });

        if (existingReaction) {
            // If reaction exists, unlike (delete) the reaction
            await prisma.reactCommentPost.delete({
                where: {
                    id: existingReaction.id
                }
            });

            // Optionally, handle any counters (e.g., numberOfLikes) if such a field exists in your schema

            return res.status(200).json({
                status: 200,
                message: 'Unliked the comment post',
                success: true
            });
        } else {
            // If no reaction, like (create) a new reaction
            const newLike = await prisma.reactCommentPost.create({
                data: {
                    CommentPostId: CommentPostId,
                    createByUserId: req.user.id
                }
            });

            // Optionally, handle any counters (e.g., numberOfLikes)

            return res.status(200).json({
                status: 200,
                message: 'Liked the comment post',
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

export async function reportPost(req, res) {
    try {

        let { PostId, reason } = req.body;
        const schema = Joi.alternatives(
            Joi.object({
                reason: Joi.string().optional(),
                PostId: Joi.number().required(),
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

        PostId = parseInt(PostId);

        // const myPlan = await getActivePlanForUser(req.user.id);
        // const myActivePlan = myPlan.myPlan.plan;

        const post = await prisma.post.findUnique({
            where: {
                id: parseInt(PostId)
            }
        })

        if (!post) {
            return res.status(400).json({
                status: 200,
                message: 'Post Not Found',
                success: true,
            })
        }

        const alreadyReported = await prisma.reportPost.findFirst({
            where: {
                reportedByUserId: req.user.id,
                reportedToPostId: parseInt(PostId)
            }
        })
        if (alreadyReported) {
            return res.status(400).json({
                status: 400,
                message: 'Post Profile Already Reported',
                success: false,
            })
        }

        await prisma.reportPost.create({
            data: {
                reportedByUserId: req.user.id,
                reportedToPostId: parseInt(PostId),
                reason: reason
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Post Profile Reported Successfully',
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
