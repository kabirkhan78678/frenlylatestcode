import Joi from "joi";
import { PrismaClient } from "@prisma/client";
import path from 'path'
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { getBlogLikeStatus, getBlogSaveStatus, getReportedBlogIdsByUser, getReportedUserIdsByUser } from "../utils/helper.js";
import { createNormalNotification, sendNotificationRelateToBlog } from "../utils/notification.js";
import { uploadFileToS3 } from "../utils/s3-helpers.js";
dotenv.config();
const prisma = new PrismaClient();
const baseurl = process.env.BASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createBlog(req, res) {
    try {
        const { title, body, tags } = req.body;
        console.log(req.body);
        console.log(typeof tags);
        const schema = Joi.object({
            title: Joi.string().required(),
            body: Joi.string().required(),
            location: Joi.string().optional().allow('')
        });
        console.log(JSON.stringify(tags))
        const tagsnew = JSON.stringify(tags)
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
            const blog = await prisma.blog.create({
                data: {
                    title: title,
                    body: body,
                    image_url: image_url,
                    userId: req.user.id,
                    tags: tagsnew
                }
            })
            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Blog Created Successfully',
                blog: blog
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
export async function editBlog(req, res) {
    try {
        const { title, body, tags, id } = req.body;
        console.log(req.body);
        console.log(typeof tags);
        const schema = Joi.object({
            title: Joi.string().optional(),
            body: Joi.string().optional(),
            tags: Joi.array().optional(),
            id: Joi.number().required(),
        });
        console.log(JSON.stringify(tags))
        const tagsnew = JSON.stringify(tags)
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
            const blog = await prisma.blog.findUnique({
                where: {
                    id: parseInt(id),
                    userId: req.user.id
                }
            });
            if (!blog) {
                return res.status(400).json({
                    success: false,
                    status: 400,
                    message: 'Blog Not Found',
                })
            }
            let image_url = null
            let fileKey = null
            if (req.file) {
                if (blog.fileKey) {
                    await deleteFileFromS3(blog.fileKey)
                }
                const s3Response = await uploadFileToS3(req.file);
                image_url = s3Response.Location;
                fileKey = s3Response.Key
            }
            let blogData = {
                title: title ? title : blog.title,
                body: body ? body : blog.body,
                tags: tags ? tagsnew : blog.tags,
                image_url: image_url ? image_url : blog.image_url,
                fileKey: fileKey ? fileKey : blog.fileKey
            };
            const updateblog = await prisma.blog.update({
                where: {
                    id: parseInt(id)
                },
                data: blogData,
            })
            const blogs = 'as';
            return res.status(200).json({
                success: true,
                status: 200,
                message: 'Blog Updated Successfully',
                blog: updateblog
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

export async function getAllBlogs(req, res) {
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
        })).map((follow) => follow.followingId);

        const reportedUserIds = await getReportedUserIdsByUser(req.user.id);
        const reportedBlogIds = await getReportedBlogIdsByUser(req.user.id)
        const filterQuery = {
            ...(search && {
                OR: [
                    { tags: { contains: search } },
                    { title: { contains: search } }
                ]
            }),
            ...{
                userId: {
                    notIn: [...blockedUserIDs, req.user.id, ...reportedUserIds],
                    in: [...userIFollowIds, ...userPublicIds]
                },
            }, ...{
                id: {
                    notIn: reportedBlogIds
                }
            }
        };

        const blogs = await prisma.blog.findMany({
            where: filterQuery,
            include: {
                user: {
                    select: {
                        id: true,
                        full_name: true,
                        city: true,
                        country: true,
                        avatar_url: true,
                        cover_photo_url: true,
                        handle: true
                    }
                }
            },
            orderBy: {
                createdAt: "desc"
            },
            skip: parseInt((page - 1) * limit),
            take: parseInt(limit),
        });

        const blogIds = blogs.map(({ id }) => id);
        const likeStatus = await getBlogLikeStatus(req.user.id, blogIds);
        const saveStatus = await getBlogSaveStatus(req.user.id, blogIds);
        const likeStatusMap = likeStatus.reduce(
            (map, { blogId, status }) => ({ ...map, [blogId]: status }),
            {}
        );
        const saveStatusMap = saveStatus.reduce(
            (map, { blogId, status }) => ({ ...map, [blogId]: status }),
            {}
        );

        const ans = await Promise.all(blogs.map(async (blog) => {
            // Get user settings to check hideLikes
            const userSetting = await prisma.userSetting.findFirst({
                where: {
                    userId: blog.user.id
                }
            });

            const hideLikes = userSetting?.hideLikes || false;

            const likeCount = await prisma.reactBlog.count({
                where: {
                    blogId: blog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            });

            const commentCount = await prisma.blogComment.count({
                where: {
                    blogId: blog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            });

            const saveCount = await prisma.saveBlog.count({
                where: {
                    blogId: blog.id,
                    saveByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            });

            // Only set alreadyLiked if hideLikes is false
            let alreadyLiked = null;
            if (!hideLikes) {
                alreadyLiked = likeStatusMap[blog.id.toString()];
            }

            return {
                ...blog,
                alreadyLiked: alreadyLiked,
                alreadySaved: saveStatusMap[blog.id.toString()],
                numberOfLikes: hideLikes ? null : likeCount, // Hide like count if hideLikes is true
                numberOfSaves: saveCount,
                numberOfComments: commentCount,
                commentAllowed: userSetting?.commentsAllowed || true,
                hideLikes: hideLikes // Include hideLikes in response
            };
        }));

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Blogs',
            blogs: ans
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            status: error,
            message: 'Internal Server Error',
            error: error
        });
    }
}


export async function likeOrUnlikeBlog(req, res) {
    try {
        let { blogId } = req.params;

        blogId = parseInt(blogId);

        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId
            },
            include: {
                user: true
            }
        })

        if (!blog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Blog Not Found',
            })
        }
        const reactBlog = await prisma.reactBlog.findFirst({
            where: {
                blogId: blogId,
                createByUserId: req.user.id
            }
        })

        if (reactBlog) {
            await prisma.reactBlog.delete({
                where: {
                    id: reactBlog.id,
                    blogId: blogId,
                    createByUserId: req.user.id
                }
            })
            let numberOfLikes = (await prisma.blog.findUnique({
                where: {
                    id: blogId
                },
                select: {
                    numberOfLikes: true
                }
            })).numberOfLikes

            if (numberOfLikes > 0) {
                numberOfLikes = numberOfLikes - 1;
            }
            await prisma.blog.update({
                where: {
                    id: blogId
                },
                data: {
                    numberOfLikes: numberOfLikes
                }
            })

            return res.status(200).json({
                status: 200,
                message: 'Unliked the blog',
                success: true
            })
        }
        else {
            const likeBlog = await prisma.reactBlog.create({
                data: {
                    blogId: blogId,
                    createByUserId: req.user.id
                }
            })
            let numberOfLikes = (await prisma.blog.findUnique({
                where: {
                    id: blogId
                },
                select: {
                    numberOfLikes: true
                }
            })).numberOfLikes

            numberOfLikes = numberOfLikes + 1;
            await prisma.blog.update({
                where: {
                    id: blogId
                },
                data: {
                    numberOfLikes: numberOfLikes
                }
            })
            if (req.user.id !== blog.user.id) {
                await createNormalNotification({
                    toUserId: blog.user.id,
                    byUserId: req.user.id,
                    data: {
                        id: blogId,
                        image_url: blog.image_url
                    },
                    type: 'blog',
                    templateKey: 'blog_liked',
                    actorName: req.user.full_name
                })

                await sendNotificationRelateToBlog({
                    token: blog.user.fcm_token,
                    toUserId: blog.user.id,
                    templateKey: 'blog_liked',
                    actorName: req.user.full_name,
                    blogId: blogId
                })
            }

            // const likedBlog = await prisma.reactBlog.findUnique({
            //     where:{
            //         id:likeBlog.id
            //     },
            //     include:{
            //         user:true
            //     }
            // });
            // console.log(likedBlog)
            return res.status(200).json({
                status: 200,
                message: 'Liked the blog',
                success: true,
                likeBlog: likeBlog
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

export async function commentOnBlog(req, res) {
    try {
        let { blogId } = req.params;
        const { content } = req.body;
        blogId = parseInt(blogId);
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

        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId
            },
            include: {
                user: true
            }
        })

        if (!blog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Blog Not Found',
            })
        }
        const createComment = await prisma.blogComment.create({
            data: {
                content: content,
                createByUserId: req.user.id,
                blogId: blogId
            }
        })
        await prisma.blog.update({
            where: {
                id: blog.id
            },
            data: {
                numberOfComments: (blog.numberOfComments + 1)
            }
        })
        if (req.user.id !== blog.user.id) {
            await createNormalNotification({
                toUserId: blog.user.id,
                byUserId: req.user.id,
                data: {
                    id: blogId,
                    image_url: blog.image_url
                },
                type: 'blog',
                templateKey: 'blog_commented',
                actorName: req.user.full_name
            })

            await sendNotificationRelateToBlog({
                token: blog.user.fcm_token,
                toUserId: blog.user.id,
                templateKey: 'blog_commented',
                actorName: req.user.full_name,
                blogId: blogId
            })
        }

        return res.status(200).json({
            status: 200,
            message: 'Commented on the blog',
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
        let { blogId, id } = req.params;
        blogId = parseInt(blogId);
        id = parseInt(id);
        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId
            }
        })

        if (!blog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Blog Not Found',
            })
        }
        const comment = await prisma.blogComment.findUnique({
            where: {
                id: id,
                blogId: blogId
            }
        })

        if (!comment) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Comment Not Found',
            })
        }
        else {
            const deleteComment = await prisma.blogComment.delete({
                where: {
                    id: id,
                    createByUserId: req.user.id,
                    blogId: blogId
                }
            })
            if (blog.numberOfComments > 0) {
                await prisma.blog.update({
                    where: {
                        id: blog.id
                    },
                    data: {
                        numberOfComments: (blog.numberOfComments - 1)
                    }
                })
            }

            return res.status(200).json({
                status: 200,
                message: 'Comment on the blog Deleted',
                success: true,
                comment: deleteComment
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
// export async function getCommentsOnBlog(req, res) {
//     try {
//         let { blogId } = req.params;
//         const { page = 1, limit = 10 } = req.query;
//         console.log('skip', (parseInt(page) - 1) * limit);
//         console.log('take', limit)
//         blogId = parseInt(blogId);
//         const blockedUserIDs = (await prisma.userBlocked.findMany({
//             where: {
//                 userId: req.user.id
//             },
//             select: {
//                 userBlockedId: true,
//             }
//         })).map((user) => user.userBlockedId);
//         const comments = await prisma.blogComment.findMany({
//             where: {
//                 blogId: blogId,
//                 createByUserId: {
//                     notIn: blockedUserIDs
//                 }
//             },
//             include: {
//                 user: true
//             },
//             orderBy: {
//                 createdAt: 'desc'
//             },
//             skip: (parseInt(page) - 1) * limit, // Specify the number of items to skip
//             take: parseInt(limit), // Specify the number of items to take
//         });
//         await Promise.all(comments.map((comment) => {
//             if (comment.user.avatar_url) {
//                 comment.user.avatar_url = `${baseurl}/images/${comment.user.avatar_url}`
//             }
//             if (comment.user.cover_photo_url) {
//                 comment.user.cover_photo_url = `${baseurl}/images/${comment.user.cover_photo_url}`
//             }
//             if (comment.user.id === req.user.id) {
//                 comment.isMyComment = true
//             }
//             else {
//                 comment.isMyComment = false
//             }
//         }))
//         return res.status(200).json({
//             status: 200,
//             message: 'Comments on the blog',
//             success: true,
//             comments: comments
//         })


//     } catch (error) {
//         console.log(error);
//         return res.status(500).json({
//             status: 200,
//             message: 'Internal Server Error',
//             success: false,
//             error: error
//         })
//     }


// }
export async function getCommentsOnBlog(req, res) {
    try {
        let { blogId } = req.params;
        const { page = 1, limit = 10 } = req.query;
        blogId = parseInt(blogId);

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true
            }
        })).map((user) => user.userBlockedId);

        const comments = await prisma.blogComment.findMany({
            where: {
                blogId: blogId,
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
            skip: (parseInt(page) - 1) * limit,
            take: parseInt(limit)
        });

        await Promise.all(comments.map(async (comment) => {

            comment.isMyComment = comment.user.id === req.user.id;

            const likeCount = await prisma.reactBlogComment.count({
                where: {
                    BlogCommentId: comment.id
                }
            });
            comment.numberOfLikes = likeCount;

            const userLiked = await prisma.reactBlogComment.findFirst({
                where: {
                    BlogCommentId: comment.id,
                    createByUserId: req.user.id
                }
            });
            comment.isLikedByMe = !!userLiked;
        }));

        return res.status(200).json({
            status: 200,
            message: 'Comments on the blog',
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
export async function saveOrUnSaveBlog(req, res) {
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
        let { blogId } = req.params;

        blogId = parseInt(blogId);

        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId
            }
        })

        if (!blog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Blog Not Found',
            })
        }
        const saveBlog = await prisma.saveBlog.findFirst({
            where: {
                blogId: blogId,
                saveByUserId: req.user.id
            }
        })

        if (saveBlog) {

            await prisma.saveBlog.delete({
                where: {
                    id: saveBlog.id,
                    saveByUserId: req.user.id,
                    blogId: blogId
                }
            })
            if (blog.numberOfSaves > 0) {
                await prisma.blog.update({
                    where: {
                        id: blogId
                    },
                    data: {
                        numberOfSaves: blog.numberOfSaves - 1,
                    }
                })
            }

            return res.status(200).json({
                status: 200,
                message: 'Blog Unsaved',
                success: true
            })
        }
        else {

            const saveBlog = await prisma.saveBlog.create({
                data: {
                    blogId: blogId,
                    saveByUserId: req.user.id,
                    categoryId: categoryId
                }
            })
            await prisma.blog.update({
                where: {
                    id: blogId
                },
                data: {
                    numberOfSaves: blog.numberOfSaves + 1,
                }
            })
            return res.status(200).json({
                status: 200,
                message: 'Blog Saved',
                success: true,
                saveBlog: saveBlog
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
export async function getMySavedBlogs(req, res) {
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
        const mySavedBlogs = await prisma.saveBlog.findMany({
            where: {
                saveByUserId: req.user.id,
                categoryId: categoryId && parseInt(categoryId)
            }, include: {
                blog: {
                    include: {
                        user: true
                    }
                }
            }, orderBy: {
                createdAt: 'desc'
            }, skip: parseInt((page - 1) * limit), take: parseInt(limit)
        })
        await Promise.all(mySavedBlogs.map(async ({ blog }) => {
            const likeCount = await prisma.reactBlog.count({
                where: {
                    blogId: blog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const commentCount = await prisma.blogComment.count({
                where: {
                    blogId: blog.id,
                    createByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            const saveCount = await prisma.saveBlog.count({
                where: {
                    blogId: blog.id,
                    saveByUserId: {
                        notIn: blockedUserIDs
                    }
                }
            })
            blog.numberOfLikes = likeCount;
            blog.numberOfComments = commentCount;
            blog.numberOfSaves = saveCount;

            const userSetting = await prisma.userSetting.findFirst({
                where: {
                    userId: blog.user.id
                }
            })
            blog.commentAllowed = userSetting.commentsAllowed
        }))
        return res.status(200).json({
            status: 200,
            message: 'My Saved Blogs',
            success: true,
            mySavedBlogs: mySavedBlogs
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

export async function getBlogById(req, res) {
    try {
        let { blogId } = req.params;
        blogId = parseInt(blogId, 10);

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);

        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId
            },
            include: {
                user: true
            }
        });

        if (!blog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: "Blog Not Found",
            });
        }

        const checkSaved = await prisma.saveBlog.findFirst({
            where: {
                blogId: blogId,
                saveByUserId: req.user.id,
            },
        });

        const checkReact = await prisma.reactBlog.findFirst({
            where: {
                blogId: blogId,
                createByUserId: req.user.id,
            },
        });

        let alreadyLiked = !!checkReact;
        let alreadySaved = !!checkSaved;

        const commentCount = await prisma.blogComment.count({
            where: {
                blogId: blog.id,
                createByUserId: {
                    notIn: blockedUserIDs,
                },
            },
        });

        const saveCount = await prisma.saveBlog.count({
            where: {
                blogId: blog.id,
                saveByUserId: {
                    notIn: blockedUserIDs,
                },
            },
        });

        // like count
        const likeCount = await prisma.reactBlog.count({
            where: {
                blogId: blog.id,
                // if you want to exclude blocked users from like count, uncomment:
                // createByUserId: { notIn: blockedUserIDs },
            },
        });

        blog.numberOfComments = commentCount;
        blog.numberOfSaves = saveCount;

        const userSetting = await prisma.userSetting.findFirst({
            where: {
                userId: blog.userId, // same approach as posts
            },
        });

        const hideLikes = !!userSetting?.hideLikes;

        return res.status(200).json({
            status: 200,
            message: "Blog",
            success: true,
            blog: {
                ...blog,
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
            status: 500,
            message: "Internal Server Error",
            success: false,
            error: error,
        });
    }
}



export async function shareBlog(req, res) {
    try {
        let { blogId } = req.params;

        blogId = parseInt(blogId);

        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId
            }
        })
        if (!blog) {
            return res.status(400).json({
                status: 200,
                message: 'Blog Not found',
                success: false,
            })
        }

        const updateblog = await prisma.blog.update({
            where: {
                id: blog.id
            },
            data: {
                numberOfShares: blog.numberOfShares + 1
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Shared the blog',
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
export async function deleteBlog(req, res) {
    try {
        let { blogId } = req.params;
        blogId = parseInt(blogId);

        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId,
                userId: req.user.id
            }
        })

        if (!blog) {
            return res.status(400).json({
                status: 200,
                message: 'Blog Not found',
                success: false,
            })
        }

        await prisma.blog.delete({
            where: {
                id: blogId
            }
        })

        return res.status(200).json({
            status: 200,
            message: 'Blog Deleted Successfully',
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


export async function likeOrUnlikeBlogComment(req, res) {
    try {
        let { BlogCommentId } = req.params;
        BlogCommentId = parseInt(BlogCommentId);


        const commentOnBlog = await prisma.blogComment.findUnique({
            where: {
                id: BlogCommentId
            },
            include: {
                user: true
            }
        });

        if (!commentOnBlog) {
            return res.status(400).json({
                success: false,
                status: 400,
                message: 'Blog comment not found',
            });
        }


        const existingReaction = await prisma.reactBlogComment.findFirst({
            where: {
                BlogCommentId: BlogCommentId,
                createByUserId: req.user.id
            }
        });

        if (existingReaction) {
            await prisma.reactBlogComment.delete({
                where: {
                    id: existingReaction.id
                }
            });

            let numberOfLikes = commentOnBlog.numberOfLikes > 0 ? commentOnBlog.numberOfLikes - 1 : 0;

            await prisma.blogComment.update({
                where: {
                    id: BlogCommentId
                },
                data: {
                    numberOfLikes: numberOfLikes
                }
            });

            return res.status(200).json({
                status: 200,
                message: 'Unliked the blog comment',
                success: true
            });
        } else {
            const newLike = await prisma.reactBlogComment.create({
                data: {
                    BlogCommentId: BlogCommentId,
                    createByUserId: req.user.id
                }
            });

            let numberOfLikes = commentOnBlog.numberOfLikes + 1;

            await prisma.blogComment.update({
                where: {
                    id: BlogCommentId
                },
                data: {
                    numberOfLikes: numberOfLikes
                }
            });

            return res.status(200).json({
                status: 200,
                message: 'Liked the blog comment',
                success: true,
                likeBlog: newLike
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

export async function reportBlog(req, res) {
    try {
        let { blogId, reason } = req.body;

        const schema = Joi.object({
            reason: Joi.string().optional(),
            blogId: Joi.number().required(),
        });

        const result = schema.validate(req.body);
        if (result.error) {
            const message = result.error.details.map((i) => i.message).join(",");
            return res.status(400).json({
                message: result.error.details[0].message,
                error: message,
                missingParams: result.error.details[0].message,
                status: 400,
                success: false,
            });
        }

        blogId = parseInt(blogId);

        const blog = await prisma.blog.findUnique({
            where: { id: blogId },
        });

        if (!blog) {
            return res.status(400).json({
                status: 400,
                message: 'Blog Not Found',
                success: false,
            });
        }

        const alreadyReported = await prisma.reportBlog.findFirst({
            where: {
                reportedByUserId: req.user.id,
                reportedToBlogId: blogId,
            },
        });

        if (alreadyReported) {
            return res.status(400).json({
                status: 400,
                message: 'Blog Already Reported',
                success: false,
            });
        }

        await prisma.reportBlog.create({
            data: {
                reportedByUserId: req.user.id,
                reportedToBlogId: blogId,
                reason: reason
            },
        });

        return res.status(200).json({
            status: 200,
            message: 'Blog Reported Successfully',
            success: true,
        });

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 500,
            message: 'Internal Server Error',
            success: false,
            error: error.message,
        });
    }
}
