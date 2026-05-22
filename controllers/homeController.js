import { PrismaClient } from "@prisma/client";
import path from 'path'
import dotenv from "dotenv";
import { fileURLToPath } from 'url';
import { getReportedBlogIdsByUser, getReportedPostIdsByUser, getReportedUserIdsByUser, getReportedVlogIdsByUser } from "../utils/helper.js";

dotenv.config();
const prisma = new PrismaClient();
const baseurl = process.env.BASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export async function homePage(req, res) {
    try {
        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            }
        })).map(({ followingId }) => followingId);

        const myFollowersIDs = (await prisma.follow.findMany({
            where: {
                followingId: req.user.id,
                status: 1
            }
        })).map(({ followerId }) => followerId);

        const userIRequestedToFollow = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 0
            },
        })).map((follow) => follow.followingId)


        const friendsArray = myFollowersIDs.filter((ele) => userIFollowIds.includes(ele))

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);
        const userWithCities = await prisma.user.groupBy({
            by: ['city'],
            where: {
                id: {
                    notIn: [...blockedUserIDs, req.user.id],
                    in: friendsArray
                },
            },
            _count: {
                id: true
            }, orderBy: {
                _count: {
                    id: 'desc'
                }
            }, take: 3
        });

        const reportedUserIds = await getReportedUserIdsByUser(req.user.id)

        console.log(userWithCities)

        const usersInCities = await Promise.all(userWithCities.map(async cityData => {
            const usersInCity = await prisma.user.findMany({
                where: {
                    city: cityData.city,
                    id: {
                        notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                        in: friendsArray
                    },
                    isOnline: 1,
                    lastSeen:null
                },
                select: {
                    id: true,
                    // email: true,
                    // full_name: true,
                    avatar_url: true,
                    country: true
                    // cover_photo_url: true,
                    // createdAt: true,
                    // updatedAt: true
                }, take: 6
            });
            const userCount = await prisma.user.count({
                where: {
                    city: cityData.city,
                    id: {
                        notIn: [...blockedUserIDs, req.user.id],
                        in: friendsArray
                    },
                    isOnline: 1,
                    lastSeen:null
                },
            })
            const usersWithModifiedAvatar = usersInCity.map(user => ({
                ...user,
            }));
            const country = usersInCity.map((user) => user.country);

            console.log('country', country);

            if (userCount > 0) {
                return { city: cityData.city, userCount: userCount, users: usersWithModifiedAvatar, country: country[0] };
            }
            else {
                return {}
            }


        }));

        const userPublicIds = (await prisma.user.findMany({
            where: {
                isPrivate: false
            }
        })).map((user) => user.id);

        const reportedVlogIds = await getReportedVlogIdsByUser(req.user.id)
        const vlogs = await prisma.vlog.findMany({
            where: {
                id:{
                    notIn:reportedVlogIds
                },
                userId: {
                    notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                    in: [...userPublicIds, ...userIFollowIds]
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 3
        })


        const reportedBlogIds = await getReportedBlogIdsByUser(req.user.id)
        const blogs = await prisma.blog.findMany({
            where: {
                id:{
                    notIn:reportedBlogIds,
                },
                userId: {
                    notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                    in: [...userPublicIds, ...userIFollowIds]
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 3
        })

        const discoverNewUser = await prisma.user.findMany({
            where: {
                id: {
                    notIn: [...userIFollowIds, req.user.id, ...blockedUserIDs, ...userIRequestedToFollow,...reportedUserIds]
                },
                isVerified: true
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 3
        })

        await Promise.all(discoverNewUser.map(async (user) => {
            user.isFollowed = false;
            if (userIFollowIds.includes(user.id)) {
                user.followState = 2
            }
            else if (userIRequestedToFollow.includes(user.id)) {
                user.followState = 1
            }
            else {
                user.followState = 0
            }
            const numberOfFollower = await prisma.follow.count({
                where: { followingId: parseInt(user.id), status: 1 }
            });
            user.numberOfFollower = numberOfFollower;

            const numberOfFollowing = await prisma.follow.count({
                where: { followerId: parseInt(user.id), status: 1 }
            });
            user.numberOfFollowing = numberOfFollowing;

        }))

        const reportedPostIds = await getReportedPostIdsByUser(req.user.id)
        const posts = await prisma.post.findMany({
            where: {
                id:{
                    notIn:reportedPostIds
                },
                userId: {
                    notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                    in: [...userPublicIds, ...userIFollowIds]
                },
            },
            include: {
                user: {
                    select: {
                        avatar_url: true,
                        cover_photo_url: true,
                        full_name: true,
                        handle: true,
                        id: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            },
            take: 3
        })

        // const friends = await prisma.user.findMany({
        //     where: {
        //         id: {
        //             notIn:[...blockedUserIDs,req.user.id],
        //             in: [...userIFollowIds, ...myFollowersIDs]
        //         }
        //     }
        // })
        const filteredUsersInCities = usersInCities.filter(cityData => Object.keys(cityData).length !== 0);

        return res.status(200).json({
            success: true,
            message: "Data Fetched",
            status: 200,
            usersInCities: filteredUsersInCities,
            vlogs: vlogs,
            blogs: blogs,
            discoverUsers: discoverNewUser,
            // friends: friends,
            posts: posts
        })
    } catch ({ error }) {
        console.log(error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            status: 500,
            error: error
        })
    }
}
export async function activeFriends(req, res) {
    try {
        const { page = 1, limit = 10 } = req.query;
        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            }
        })).map(({ followingId }) => followingId);

        const myFollowersIDs = (await prisma.follow.findMany({
            where: {
                followingId: req.user.id,
                status: 1
            }
        })).map(({ followerId }) => followerId);

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);
        const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
        const friendsArray = myFollowersIDs.filter((ele) => userIFollowIds.includes(ele))
        const userWithCities = await prisma.user.groupBy({
            by: ['city'],
            where: {
                id: {
                    notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                    in: friendsArray
                }
            },
            _count: {
                id: true
            }, orderBy: {
                _count: {
                    id: 'desc'
                }
            }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
        });



        const usersInCities = await Promise.all(userWithCities.map(async cityData => {
            const usersInCity = await prisma.user.findMany({
                where: {
                    city: cityData.city,
                    id: {
                        notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                        in: friendsArray
                    }, isOnline: 1,
                    lastSeen:null
                },
                select: {
                    id: true,
                    // email: true,
                    // full_name: true,
                    avatar_url: true,
                    country: true
                    // cover_photo_url: true,
                    // createdAt: true, 
                    // updatedAt: true
                }, take: 6
            });

            const userCount = await prisma.user.count({
                where: {
                    city: cityData.city,
                    id: {
                        notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                        in: [...userIFollowIds, ...myFollowersIDs]
                    },
                    isOnline: 1,
                    lastSeen:null
                },
            })

            const usersWithModifiedAvatar = usersInCity.map(user => ({
                ...user,
            }));
            const country = usersInCity.map(({ country }) => country);

            if (userCount > 0) {
                return { city: cityData.city, userCount: userCount, users: usersWithModifiedAvatar, country: country[0] };
            }
            else {
                return {}
            }
        }));
        const filteredUsersInCities = usersInCities.filter(cityData => Object.keys(cityData).length !== 0);
        return res.status(200).json({
            success: true,
            status: 200,
            message: "Active Friends",
            activeFriends: filteredUsersInCities,
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: "Internal Server Error",
            error: error,
        })
    }

}

export async function getUsersByCity(req, res) {
    try {
        const { city } = req.params;

        const { page = 1, limit = 10 } = req.query;
        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            }
        })).map(({ followingId }) => followingId);

        const myFollowersIDs = (await prisma.follow.findMany({
            where: {
                followingId: req.user.id,
                status: 1
            }
        })).map(({ followerId }) => followerId);

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);
        const friendsArray = myFollowersIDs.filter((ele) => userIFollowIds.includes(ele))
        const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
        const usersInCity = await prisma.user.findMany({
            where: {
                city: city,
                id: {
                    notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                    in: friendsArray
                }, isOnline: 1
            },
            select: {
                id: true,
                avatar_url: true,
                full_name: true,
                handle: true
            }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
        });
        const userIRequestedToFollow = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 0
            },
        })).map((follow) => follow.followingId)

        await Promise.all(usersInCity.map(async (user) => {
            if (userIFollowIds.includes(user.id)) {
                user.followState = 2
            }
            else if (userIRequestedToFollow.includes(user.id)) {
                user.followState = 1
            }
            else {
                user.followState = 0
            }

            if (userIFollowIds.includes(user.id)) {
                user.isFollowed = true
            }
            else {
                user.isFollowed = false
            }
            const numberOfFollowers = await prisma.follow.count({
                where: {
                    followingId: user.id
                }
            })
            user.numberOfFollower = numberOfFollowers
        }))

        const userCount = await prisma.user.count({
            where: {
                city: city,
                id: {
                    notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                    in: friendsArray
                }, isOnline: 1
            },
        })

        return res.status(200).json({
            status: 200,
            message: `Users in city ${city}`,
            success: true,
            users: usersInCity,
            userCount: userCount
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

export async function discoverUsers(req, res) {
    try {
        const { page = 1, limit = 10 } = req.query;
        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            }
        })).map(({ followingId }) => followingId);

        const userIRequestedToFollow = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 0
            },
        })).map((follow) => follow.followingId)

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);
        const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
        const discoverNewUser = await prisma.user.findMany({
            where: {
                id: {
                    notIn: [...userIFollowIds, req.user.id, ...blockedUserIDs, ...userIRequestedToFollow,...reportedUserIds]
                },
                isVerified: true
            }, orderBy: {
                createdAt: 'desc'
            }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
        })
        await Promise.all(discoverNewUser.map(async (newUser) => {
            newUser.isFollowed = false
            if (userIFollowIds.includes(newUser.id)) {
                newUser.followState = 2
            }
            else if (userIRequestedToFollow.includes(newUser.id)) {
                newUser.followState = 1
            }
            else {
                newUser.followState = 0
            }
            const numberOfFollower = await prisma.follow.count({
                where: { followingId: parseInt(newUser.id), status: 1 }
            });
            newUser.numberOfFollower = numberOfFollower;

            const numberOfFollowing = await prisma.follow.count({
                where: { followerId: parseInt(newUser.id), status: 1 }
            });
            newUser.numberOfFollowing = numberOfFollowing;

        }))
        return res.status(200).json({
            success: true,
            status: 200,
            message: "Discover Users",
            discoverUsers: discoverNewUser,
        })

    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: "Internal Server Error",
            error: error,
        })
    }
}

export async function allFriends(req, res) {
    try {
        const { search, page = 1, limit = 10, city } = req.query;
        const userIFollowIds = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 1
            }
        })).map(({ followingId }) => followingId);

        const myFollowersIDs = (await prisma.follow.findMany({
            where: {
                followingId: req.user.id,
                status: 1
            }
        })).map(({ followerId }) => followerId);

        const userIRequestedToFollow = (await prisma.follow.findMany({
            where: {
                followerId: req.user.id,
                status: 0
            },
        })).map((follow) => follow.followingId)

        const blockedUserIDs = (await prisma.userBlocked.findMany({
            where: {
                userId: req.user.id
            },
            select: {
                userBlockedId: true,
            }
        })).map((user) => user.userBlockedId);

        const friendsArray = myFollowersIDs.filter((ele) => userIFollowIds.includes(ele));

        console.log(">>>>>>>>>>>friendsArray",friendsArray);
        console.log(">>>>>>>>>>>myFollowersIDs",myFollowersIDs);
        console.log(">>>>>>>>>>>userIFollowIds",userIFollowIds);
        console.log(">>>>>>>>>>>blockedUserIDs",blockedUserIDs);
        const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
        const friends = await prisma.user.findMany({
            where: {
                id: {
                    notIn: [...blockedUserIDs, req.user.id,...reportedUserIds],
                    in: friendsArray
                },
                full_name: {
                    contains: search
                },
                city: {
                    contains: city
                },
            }, select: {
                id: true,
                full_name: true,
                avatar_url: true,
                handle: true,
                numberOfFollower: true
            }, orderBy: {
                createdAt: 'desc'
            }, 
        })
        console.log(">>>>>>>>>>>friends",friends);
        await Promise.all(friends.map(async (friend) => {
            // console.log(friend);
            if (userIFollowIds.includes(friend.id)) {
                friend.followState = 2
            }
            else if (userIRequestedToFollow.includes(friend.id)) {
                friend.followState = 1
            }
            else {
                friend.followState = 0
            }
            const numberOfFollower = await prisma.follow.count({
                where: {
                    followingId: friend.id,
                    followerId: {
                        notIn: blockedUserIDs
                    },
                    status: 1
                }
            })
            console.log(friend.id, numberOfFollower)
            friend.numberOfFollower = numberOfFollower;
            return friend;
        }))

        return res.status(200).json({
            success: true,
            status: 200,
            message: "My Friends",
            friends: friends,
        })
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            success: false,
            status: 500,
            message: "Internal Server Error",
            error: error,
        })
    }

}
