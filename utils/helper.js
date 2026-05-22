import crypto from 'crypto'
import base64url from 'base64url'
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient()
export function randomStringAsBase64Url(size) {
  return base64url(crypto.randomBytes(size));
}
export async function getBlogLikeStatus(createByUserId, blogIds) {
  const liked = await prisma.reactBlog.findMany({
    where: {
      createByUserId: createByUserId,
      blogId: {
        in: blogIds
      }
    }
  })
  const likedMap = liked.reduce((map, item) => ({ ...map, [item.blogId]: true }), {});
  return blogIds.map((id) => ({ blogId: id, status: likedMap[id.toString()] || false }))

}
export async function getPostLikeStatus(createByUserId, postIds) {
  const liked = await prisma.reactPost.findMany({
    where: {
      createByUserId: createByUserId,
      postId: {
        in: postIds
      }
    }
  })
  const likedMap = liked.reduce((map, item) => ({ ...map, [item.postId]: true }), {});
  return postIds.map((id) => ({ postId: id, status: likedMap[id.toString()] || false }))

}
export async function getVlogLikeStatus(createByUserId, vlogIds) {
  const liked = await prisma.reactVlog.findMany({
    where: {
      createByUserId: createByUserId,
      vlogId: {
        in: vlogIds
      }
    }
  })
  const likedMap = liked.reduce((map, item) => ({ ...map, [item.vlogId]: true }), {});
  return vlogIds.map((id) => ({ vlogId: id, status: likedMap[id.toString()] || false }))

}
export async function getBlogSaveStatus(saveByUserId, blogIds) {
  const liked = await prisma.saveBlog.findMany({
    where: {
      saveByUserId: saveByUserId,
      blogId: {
        in: blogIds
      }
    }
  })
  const likedMap = liked.reduce((map, item) => ({ ...map, [item.blogId]: true }), {});

  return blogIds.map((id) => ({ blogId: id, status: likedMap[id.toString()] || false }))

}

export async function getPostSaveStatus(saveByUserId, postIds) {
  const liked = await prisma.savePost.findMany({
    where: {
      saveByUserId: saveByUserId,
      postId: {
        in: postIds
      }
    }
  })
  const likedMap = liked.reduce((map, item) => ({ ...map, [item.postId]: true }), {});

  return postIds.map((id) => ({ postId: id, status: likedMap[id.toString()] || false }))

}

export async function getVlogSaveStatus(saveByUserId, vlogIds) {
  const liked = await prisma.saveVlog.findMany({
    where: {
      saveByUserId: saveByUserId,
      vlogId: {
        in: vlogIds
      }
    }
  })
  const likedMap = liked.reduce((map, item) => ({ ...map, [item.vlogId]: true }), {});

  return vlogIds.map((id) => ({ vlogId: id, status: likedMap[id.toString()] || false }))

}
export async function updateUnreadCount(chatId, userId) {
  try {
    // Find the UnreadCount record for the user and chat
    const unreadCount = await prisma.unreadCount.findFirst({
      where: {
        userId: userId,
        chatId: parseInt(chatId)
      }
    });

    if (unreadCount) {
      // If UnreadCount exists, update the unreadCount by 1
      await prisma.unreadCount.update({
        where: {
          id: unreadCount.id
        },
        data: {
          unreadCount: unreadCount.unreadCount + 1
        }
      });
    } else {
      // If UnreadCount does not exist, create a new one
      await prisma.unreadCount.create({
        data: {
          userId: userId,
          chatId: parseInt(chatId),
          unreadCount: 1
        }
      });
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

export async function countUserContent(userId) {
  try {
    const blogCount = await prisma.blog.count({
      where: {
        userId: userId,
      },
    });

    const postCount = await prisma.post.count({
      where: {
        userId: userId,
      },
    });

    const vlogCount = await prisma.vlog.count({
      where: {
        userId: userId,
      },
    });
    return {
      blogCount,
      postCount,
      vlogCount,
    };
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

export async function getReportedUserIdsByUser(userId) {
  const reports = await prisma.reportUser.findMany({
    where: {
      reportedByUserId: userId,
    },
    select: {
      reportedToUserId: true
    }
  });

  // Return an array of reported post IDs
  return reports.map(report => report.reportedToUserId);
}

export async function getReportedPostIdsByUser(userId) {
  const reports = await prisma.reportPost.findMany({
    where: {
      reportedByUserId: userId,
    },
    select: {
      reportedToPostId: true
    }
  });

  // Return an array of reported event IDs
  return reports.map(report => report.reportedToPostId);
}

export async function getReportedVlogIdsByUser(userId) {
  const reports = await prisma.reportVlog.findMany({
    where: {
      reportedByUserId: userId,

    },
    select: {
      reportedToVlogId: true
    }
  });

  // Return an array of reported community IDs
  return reports.map(report => report.reportedToVlogId);
}

export async function getReportedBlogIdsByUser(userId) {
  const reports = await prisma.reportBlog.findMany({
    where: {
      reportedByUserId: userId,

    },
    select: {
      reportedToBlogId: true
    }
  });

  // Return an array of reported community IDs
  return reports.map(report => report.reportedToBlogId);
}

export async function shouldHideLikes(userId, viewingUserId = null) {
  try {
    // If no specific viewing user provided, assume public view
    if (!viewingUserId) {
      const userSetting = await prisma.userSetting.findFirst({
        where: { userId: userId }
      });
      return userSetting?.hideLikes || false;
    }

    // Check if viewing user follows the profile owner (for private accounts)
    const isFollowing = await prisma.follow.findFirst({
      where: {
        followerId: viewingUserId,
        followingId: userId,
        status: 1 // accepted
      }
    });

    if (isFollowing) {
      const userSetting = await prisma.userSetting.findFirst({
        where: { userId: userId }
      });
      return userSetting?.hideLikes || false;
    }

    // For non-followers viewing private accounts, default to hiding likes
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (user?.isPrivate) {
      return true; // Hide likes for non-followers of private accounts
    }

    const userSetting = await prisma.userSetting.findFirst({
      where: { userId: userId }
    });
    return userSetting?.hideLikes || false;

  } catch (error) {
    console.error('Error checking hide likes setting:', error);
    return false; // Default to showing likes on error
  }
}