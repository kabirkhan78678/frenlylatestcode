import Joi from "joi";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";
import { randomStringAsBase64Url, countUserContent } from "../utils/helper.js";
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import path from 'path'
import hbs from "nodemailer-express-handlebars";
import localStorage from 'localStorage'
import { createNormalNotificationForUser, sendNotificationRelateToAppToUser } from "../utils/notification.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const prisma = new PrismaClient();
const baseurl = process.env.BASE_URL;
var transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    auth: {
        user: "kpatel74155@gmail.com",
        pass: "mitbpoatzprnwfac",
    },
    tls: {
        rejectUnauthorized: false, // This allows self-signed certificates
    },
});

const handlebarOptions = {
    viewEngine: {
        partialsDir: path.resolve(__dirname, "../view/"),
        defaultLayout: false,
    },
    viewPath: path.resolve(__dirname, "../view/"),
};
transporter.use("compile", hbs(handlebarOptions));
export async function login(req, res) {
    try {
        const secretKey = process.env.SECRET_KEY;
        const { email, password, fcm_token } = req.body;
        const schema = Joi.alternatives(
            Joi.object({
                //email: Joi.string().min(5).max(255).email({ tlds: { allow: false } }).lowercase().required(),
                email: Joi.string()
                    .min(5)
                    .max(255)
                    .email({ tlds: { allow: false } })
                    .lowercase()
                    .required(),
                password: Joi.string().min(8).max(15).required().messages({
                    "any.required": "{{#label}} is required!!",
                    "string.empty": "can't be empty!!",
                    "string.min": "minimum 8 value required",
                    "string.max": "maximum 15 values allowed",
                }),
                fcm_token: Joi.string().optional(),
            })
        );
        console.log('req.body', req.body)
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
        } else {
            const user = await prisma.admin.findUnique({
                where: {
                    email: email,
                },
            });
            if (!user || !(await bcrypt.compare(password, user.password))) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid credentials",
                    status: 400,
                });
            }
            if (fcm_token) {
                await prisma.admin.update({
                    where: {
                        email: email,
                    },
                    data: {
                        fcm_token: fcm_token,
                    },
                });
            }

            const userData = await prisma.admin.findUnique({
                where: {
                    email: email,
                },
            });

            const token = jwt.sign(
                { adminId: user.id, email: user.email },
                secretKey,
                { expiresIn: "3d" }
            );
            return res.json({
                status: 200,
                success: true,
                message: "Login successful!",
                token: token,
                admin: userData,
            });
        }
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

export async function forgotPassword(req, res) {
    try {
        const { email } = req.body;
        const schema = Joi.alternatives(
            Joi.object({
                email: Joi.string().min(5).max(255).email({ tlds: { allow: false } }).lowercase().required(),
            })
        );
        const result = schema.validate({ email });
        if (result.error) {
            const message = result.error.details.map((i) => i.message).join(",");
            return res.json({
                message: result.error.details[0].message,
                error: message,
                missingParams: result.error.details[0].message,
                status: 400,
                success: false,
            });
        } else {
            const admin = await prisma.admin.findUnique({
                where: {
                    email: email,
                }
            })
            if (admin) {
                const genToken = randomStringAsBase64Url(20);
                await prisma.admin.update({
                    where: {
                        email: email
                    },
                    data: {
                        token: genToken
                    }
                })

                const adminToken = (await prisma.admin.findUnique({
                    where: {
                        email: email,
                    },
                    select: {
                        token: true,
                    }
                })).token;

                let mailOptions = {
                    from: "yashrajmandloi0511@gmail.com",
                    to: email,
                    subject: "Forgot Password",
                    template: "forget_template",
                    context: {
                        image_logo: `${baseurl}/mainLogo.png`,
                        href_url: `${baseurl}/admin/verifyPassword/${adminToken}`,
                        msg: `Please click below link to change password.`,
                    },
                };
                transporter.sendMail(mailOptions, async function (error, info) {
                    if (error) {
                        console.log(error)
                        return res.json({
                            success: false,
                            message: "Mail Not Delivered",
                        });
                    } else {
                        return res.json({
                            success: true,
                            message:
                                "Password reset link sent successfully. Please check your email ",
                        });
                    }
                });
            } else {
                return res.json({
                    success: false,
                    message: "Email address not found. Please enter a valid email",
                    status: 400,
                });
            }
        }
    } catch (error) {
        console.log(error);
        return res.status(500).json({
            status: 500,
            message: "Internal Server Error",
            success: false,
            error: error,
        });
    }
};

export async function verifyPassword(req, res) {
    try {
        const id = req.params.token;

        console.log(id)

        if (!id) {
            return res.status(400).send("Invalid link");
        }
        else {
            const admin = await prisma.admin.findFirst({
                where: {
                    token: id
                }
            })
            const token = admin.token;
            if (token) {
                console.log("here is the vertoken");
                localStorage.setItem('vertoken', JSON.stringify(token));
                res.render(path.join(__dirname, '../view/', 'forgetPasswordAdmin.ejs'), { msg: "" });
            }
            else {
                res.render(path.join(__dirname, '../view/', 'forgetPasswordAdmin.ejs'), { msg: "This admin is not Registered" });

            }
        }
    }
    catch (err) {
        console.log(err);
        res.send(`<div class="container">
          <p>404 Error, Page Not Found</p>
          </div> `);
    }
};

export async function changePassword(req, res) {
    try {
        const { password, confirm_password } = req.body;
        const token = JSON.parse(localStorage.getItem('vertoken'));
        const schema = Joi.alternatives(
            Joi.object({
                password: Joi.string().min(8).required().messages({
                    "any.required": "{{#label}} is required!!",
                    "string.empty": "can't be empty!!",
                    "string.min": "minimum 8 value required",
                    "string.max": "maximum 10 values allowed",
                }),
                confirm_password: Joi.string().min(8).required().messages({
                    "any.required": "{{#label}} is required!!",
                    "string.empty": "can't be empty!!",
                    "string.min": "minimum 8 value required",
                    "string.max": "maximum 10 values allowed",
                }),
            })
        )
        const result = schema.validate({ password, confirm_password });
        if (result.error) {
            const message = result.error.details.map((i) => i.message).join(",");
            res.render(path.join(__dirname, '../view/', 'forgetPasswordAdmin.ejs'), {
                message: result.error.details[0].message,
                error: message,
                missingParams: result.error.details[0].message,
                msg: message
            });

        }
        else {
            if (password == confirm_password) {
                const admin = await prisma.admin.findFirst({
                    where: {
                        token: token
                    }
                });


                if (admin) {
                    const hashedPassword = await bcrypt.hash(password, 10);
                    await prisma.admin.update({
                        where: {
                            id: admin.id
                        },
                        data: {
                            password: hashedPassword
                        }
                    })
                    // console.log("result2",result2)
                    res.sendFile(path.join(__dirname, '../view/message.html'), { msg: "" });
                    // else {
                    //   res.render(path.join(__dirname ,'../view/', 'forgetPassword.ejs'), { msg: "Internal Error Occured, Please contact Support." });
                    // }
                }
                else {
                    return res.json({
                        message: "Admin not found please register your account",
                        success: false,
                        status: 400,
                    })
                }
            }
            else {
                res.render(path.join(__dirname, '../view/', 'forgetPasswordAdmin.ejs'),
                    { msg: "Password and Confirm Password do not match" });
            }
        }
    }
    catch (error) {
        console.log(error);

        res.render(path.join(__dirname, '/view/', 'forgetPasswordAdmin.ejs'),
            { msg: "Internal server error" })
    }
};

export async function passwordChange(req, res) {
    try {
        const { currPassword, newPassword } = req.body;

        const schema = Joi.alternatives(
            Joi.object({
                //email: Joi.string().min(5).max(255).email({ tlds: { allow: false } }).lowercase().required(),
                currPassword: Joi.string().min(8).required().messages({
                    "any.required": "{{#label}} is required!!",
                    "string.empty": "can't be empty!!",
                    "string.min": "minimum 8 value required",
                    "string.max": "maximum 15 values allowed",
                }),

                newPassword: Joi.string().min(8).required().messages({
                    "any.required": "{{#label}} is required!!",
                    "string.empty": "can't be empty!!",
                    "string.min": "minimum 8 value required",
                    "string.max": "maximum 15 values allowed",
                }),
            })
        );
        const result = schema.validate({ currPassword, newPassword });

        if (result.error) {
            const message = result.error.details.map((i) => i.message).join(",");
            return res.json({
                message: result.error.details[0].message,
                error: message,
                missingParams: result.error.details[0].message,
                status: 400,
                success: false,
            });
        } else {
            const admin = await prisma.admin.findUnique({
                where: {
                    id: req.user.id,
                },
            });

            if (!admin || !(await bcrypt.compare(currPassword, admin.password))) {
                return res.status(400).json({
                    success: false,
                    message: "Current Password is Incorrect",
                    status: 400,
                });
            }
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            await prisma.admin.update({
                where: {
                    id: req.user.id,
                },
                data: {
                    password: hashedPassword,
                },
            });

            return res.json({
                status: 200,
                success: true,
                message: "Password changed successfully",
            });
        }
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

// export async function reportedUserProfiles(req, res) {
//     try {

//         const reportProfiles = await prisma.reportUser.findMany({
//             include: {
//                 reportedTo: true
//             },
//             orderBy: {
//                 createdAt: 'desc'
//             }
//         });

//         return res.status(200).json({
//             status: 200,
//             message: 'Reported Post Profiles',
//             success: true,
//             reportProfiles,
//             count: reportProfiles.length
//         });
//     } catch (error) {
//         console.log(error);
//         return res.status(500).json({
//             status: 500,
//             message: 'Internal Server Error',
//             success: false,
//             error: error.message
//         });
//     }
// }

export async function reportedUserProfiles(req, res) {
    try {

        const reportProfiles = await prisma.reportUser.findMany({
            include: {
                reportedTo: true,
            },
            orderBy: {
                createdAt: 'desc'
            }
        })
        await Promise.all(reportProfiles.map(async (reportProfile) => {
            const reportedBy = await prisma.user.findUnique({
                where: {
                    id: reportProfile.reportedByUserId
                }
            })
            reportProfile.reportedByUser = reportedBy

            return reportProfile
        }))
        return res.status(200).json({
            status: 200,
            message: 'Reported Profiles ',
            success: true,
            reportProfiles,
            count: reportProfiles.length
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

export async function reportedBlogProfiles(req, res) {
    try {

        const reportProfiles = await prisma.reportBlog.findMany({
            include: {
                reportedTo: true,
                user: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        await Promise.all(reportProfiles.map(async (reportProfile) => {
            const reportedBy = await prisma.user.findUnique({
                where: {
                    id: reportProfile.reportedByUserId
                }
            })
            reportProfile.reportedByUser = reportedBy

            return reportProfile
        }))

        return res.status(200).json({
            status: 200,
            message: 'Reported Blog Profiles',
            success: true,
            reportProfiles,
            count: reportProfiles.length
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

export async function reportedPostProfiles(req, res) {
    try {

        const reportProfiles = await prisma.reportPost.findMany({
            include: {
                reportedTo: true,
                user: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        await Promise.all(reportProfiles.map(async (reportProfile) => {
            const reportedBy = await prisma.user.findUnique({
                where: {
                    id: reportProfile.reportedByUserId
                }
            })
            reportProfile.reportedByUser = reportedBy

            return reportProfile
        }))

        return res.status(200).json({
            status: 200,
            message: 'Reported Post Profiles',
            success: true,
            reportProfiles,
            count: reportProfiles.length
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

export async function reportedVlogProfiles(req, res) {
    try {

        const reportProfiles = await prisma.reportVlog.findMany({
            include: {
                reportedTo: true,
                user: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        await Promise.all(reportProfiles.map(async (reportProfile) => {
            const reportedBy = await prisma.user.findUnique({
                where: {
                    id: reportProfile.reportedByUserId
                }
            })
            reportProfile.reportedByUser = reportedBy

            return reportProfile
        }))

        return res.status(200).json({
            status: 200,
            message: 'Reported Vlog Profiles',
            success: true,
            reportProfiles,
            count: reportProfiles.length
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

export async function getMyProfile(req, res) {
    try {
        const id = req.user.id;

        const admin = await prisma.admin.findUnique({
            where: {
                id: id
            },
        });

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'Admin not found',
                status: 404
            });
        }

        return res.status(200).json({
            success: true,
            status: 200,
            admin
        });

    } catch (error) {
        console.log('error', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            status: 500,
            error
        });
    }
}

export async function editProfile(req, res) {
    try {
        const { full_name } = req.body;
        const schema = Joi.alternatives(
            Joi.object({
                full_name: Joi.string().optional(),
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
        const admin = await prisma.admin.findUnique({
            where: {
                id: req.user.id
            }
        })

        if (!admin) {
            return res.status(400).json({
                status: 400,
                message: 'Admin Not Found',
                success: false,
            })
        }

        await prisma.admin.update({
            where: {
                id: admin.id
            },
            data: {
                full_name: full_name ? full_name : admin.full_name,
            }
        })
        return res.json({
            status: 200,
            success: true,
            message: "Profile Updated Successfully",
            data: admin
        });

    } catch (error) {
        console.log(error)
        return res.status(500).json({
            status: 500,
            message: 'Internal Server Error',
            success: false,
            error: error
        })
    }
}

export const getAllVerifiedUser = async (req, res) => {
    try {
        const { search, date, status } = req.query;
        const filterQuery = {
            isVerified: true,
            ...(date && {
                createdAt: {
                    gte: new Date(new Date(date).setUTCHours(0, 0, 0, 0)),  // Start of the given date
                    lte: new Date(new Date(date).setUTCHours(23, 59, 59, 999))  // End of the given date
                }
            }),
            ...(status && { status: parseInt(status) }),
            ...(search && {
                OR: [
                    { full_name: { contains: search } },
                    { handle: { contains: search } },
                ]
            }),
        };

        const users = await prisma.user.findMany({
            where: filterQuery,
            orderBy: {
                createdAt: "desc",
            },
        });

        await Promise.all(users.map(async (user) => {
            const count = await countUserContent(user.id);
            user.count = count;
        }));

        res.status(200).json({
            success: true,
            status: 200,
            data: {
                users,
                totalUsers: users.length
            }
        });
    } catch (error) {
        console.log('error', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            status: 500,
            error
        });
    }
};

export async function toggleUserStatus(req, res) {
    try {
        const { id } = req.params;

        await prisma.user.findUnique({
            where: { id: parseInt(id) },
        });

        const user = await prisma.user.findUnique({ where: { id: parseInt(id) } });

        if (!user) {
            return res.status(404).json({ error: 'User not found.' });
        }

        const newStatus = user.status === 1 ? 0 : 1;

        const updatedUser = await prisma.user.update({
            where: { id: parseInt(id) },
            data: { status: newStatus },
        });

        return res.status(200).json({ message: `User  ${newStatus === 1 ? 'Activated' : 'Deactivated'} Successfully`, updatedUser });
    } catch (error) {
        console.log('error', error)
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            status: 500,
            error
        });
    }
};

export const getdashboard = async (req, res) => {
    try {
        const { search, date, status } = req.query;

        const filterQuery = {
            isVerified: true,
            ...(date && {
                createdAt: {
                    gte: new Date(new Date(date).setUTCHours(0, 0, 0, 0)),  // Start of the given date
                    lte: new Date(new Date(date).setUTCHours(23, 59, 59, 999))  // End of the given date
                }
            }),
            ...(status && { status: parseInt(status) }),
            ...(search && {
                OR: [
                    { full_name: { contains: search } },
                    { handle: { contains: search } },
                ]
            }),
        };

        const users = await prisma.user.findMany({
            where: filterQuery,
            orderBy: {
                createdAt: 'desc',
            },
            take: 5,
        });
        const totalUsers = await prisma.user.count({
            where: {
                isVerified: true
            },
        });
        const totalBlogs = await prisma.blog.count();
        const totalPosts = await prisma.post.count();
        const totalVlogs = await prisma.vlog.count();

        res.status(200).json({
            success: true,
            status: 200,
            users,
            totalCounts: {
                totalBlogs,
                totalPosts,
                totalVlogs,
                totalUsers
            },
        });
    } catch (error) {
        console.log('error', error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            status: 500,
            error,
        });
    }
};

export async function getAllBlogs(req, res) {
    try {
        const { search, date } = req.query;

        const filterQuery = {
            ...(date && {
                createdAt: {
                    gte: new Date(new Date(date).setUTCHours(0, 0, 0, 0)),  // Start of the given date
                    lte: new Date(new Date(date).setUTCHours(23, 59, 59, 999))  // End of the given date
                }
            }),
            ...(search && {
                OR: [
                    { tags: { contains: search } },
                    { title: { contains: search } }
                ]
            }),
        };

        const blogs = await prisma.blog.findMany({
            where: filterQuery,
            include: {
                user: true,
            },
            orderBy: {
                createdAt: 'desc'
            },
        });

        return res.status(200).json({
            status: 200,
            message: 'All Blogs Fetched Successfully',
            success: true,
            blogs,
        });
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

export async function getAllPosts(req, res) {
    try {
        const { search, date } = req.query;

        const filterQuery = {
            ...(date && {
                createdAt: {
                    gte: new Date(new Date(date).setUTCHours(0, 0, 0, 0)),  // Start of the given date
                    lte: new Date(new Date(date).setUTCHours(23, 59, 59, 999))  // End of the given date
                }
            }),
            ...(search && {
                OR: [
                    { caption: { contains: search } },
                ]
            }),
        };

        const posts = await prisma.post.findMany({
            where: filterQuery,
            include: {
                user: true,

            },
            orderBy: {
                createdAt: 'desc'
            },
        });

        return res.status(200).json({
            status: 200,
            message: 'All Posts Fetched Successfully',
            success: true,
            posts,
        });
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


export async function getAllVlogs(req, res) {
    try {

        const { search, date } = req.query;

        const filterQuery = {
            ...(date && {
                createdAt: {
                    gte: new Date(new Date(date).setUTCHours(0, 0, 0, 0)),  // Start of the given date
                    lte: new Date(new Date(date).setUTCHours(23, 59, 59, 999))  // End of the given date
                }
            }),
            ...(search && {
                OR: [
                    { title: { contains: search } },
                ]
            }),
        };

        const vlogs = await prisma.vlog.findMany({
            where: filterQuery,
            include: {
                user: true,

            },
            orderBy: {
                createdAt: 'desc'
            },
        });

        return res.status(200).json({
            status: 200,
            message: 'All Vlogs Fetched Successfully',
            success: true,
            vlogs
        });
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

export async function getBlogById(req, res) {
    try {

        let { blogId } = req.params;
        blogId = parseInt(blogId);

        const blog = await prisma.blog.findUnique({
            where: {
                id: blogId,
            },
            include: {
                user: true,

            },
        });

        return res.status(200).json({
            status: 200,
            message: 'Blog Fetched Successfully',
            success: true,
            blog,
        });
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

export async function getPostById(req, res) {
    try {

        let { postId } = req.params;
        postId = parseInt(postId);

        const post = await prisma.post.findUnique({
            where: {
                id: postId,
            },
            include: {
                user: true,

            },
        });

        return res.status(200).json({
            status: 200,
            message: 'Post Fetched Successfully',
            success: true,
            post,
        });
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

export async function getVlogById(req, res) {
    try {

        let { vlogId } = req.params;
        vlogId = parseInt(vlogId);

        const post = await prisma.vlog.findUnique({
            where: {
                id: vlogId,
            },
            include: {
                user: true,

            },
        });

        return res.status(200).json({
            status: 200,
            message: 'Vlog Fetched Successfully',
            success: true,
            post,
        });
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

export async function deleteBlog(req, res) {
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

export async function deleteVlog(req, res) {
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

export async function deletePost(req, res) {
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

export async function sendNotificationToUsersBulk(req, res) {
    try {
        const { body } = req.body;
        const schema = Joi.alternatives(
            Joi.object({
                body: Joi.string().required(),
            })
        );
        console.log(req.body);
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

        const users = await prisma.user.findMany({
        });
        console.log(">>>>>>", users.length)
        const admin = await prisma.admin.findMany();
        await Promise.all(users.map(async (user) => {
            await createNormalNotificationForUser({
                toUserId: user.id,
                byAdminId: admin[0].id,
                data: {},
                type: "Bulk_Notification",
                content: body
            })
            await sendNotificationRelateToAppToUser({
                token: user.fcm_token,
                toUserId: user.id,
                body: body,
                data: {},
                type: "Bulk_Notification",
            })
        }))
        return res.status(200).json({
            status: 200,
            message: 'Bulk Notification Successfully Sended to users ',
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

export const addTermsAndConditions = async (req, res) => {
    const {
        id,
        content
    } = req.body;

    const schema = Joi.object({
        id: Joi.number().required(),
        content: Joi.string().required(),
    });

    const { error } = schema.validate(req.body);
    if (error) {
        const message = error.details.map((i) => i.message).join(", ");
        return res.status(400).json({
            message: message,
            missingParams: error.details[0].message,
            status: 400,
            success: false,
        });
    }

    try {
        const termsAndCondition = await prisma.termsAndConditions.update({
            where: { id: parseInt(id) },
            data: {
                content: content,
            },
        });

        return res.status(200).json({
            status: 200,
            message: 'Terms and Condition Updated Successfully',
            termsAndCondition: termsAndCondition,
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
};

export const getTermsAndConditions = async (req, res) => {
    try {
        const termsandCondition = await prisma.termsAndConditions.findMany({
            orderBy: {
                id: 'desc'
            }
        });

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Blogs',
            termsandCondition
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

export const addPrivacyPolicy = async (req, res) => {
    const {
        id,
        content
    } = req.body;

    const schema = Joi.object({
        id: Joi.number().required(),
        content: Joi.string().required(),
    });

    const { error } = schema.validate(req.body);
    if (error) {
        const message = error.details.map((i) => i.message).join(", ");
        return res.status(400).json({
            message: message,
            missingParams: error.details[0].message,
            status: 400,
            success: false,
        });
    }

    try {
        const PrivacyPolicy = await prisma.privacyPolicy.update({
            where: { id: parseInt(id) },
            data: {
                content
            }
        });

        return res.status(200).json({
            status: 200,
            message: 'Privacy And Policy Updated Successfully',
            PrivacyPolicy: PrivacyPolicy,
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

export const getPrivacyPolicy = async (req, res) => {
    try {
        const PrivacyPolicy = await prisma.privacyPolicy.findMany({
            orderBy: {
                id: 'desc'
            }
        });

        res.status(200).json({
            success: true,
            status: 200,
            message: 'Blogs',
            PrivacyPolicy
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


export async function changeBankIdToggle(req, res) {
    try {
        const { toogle } = req.body;

        const schema = Joi.alternatives(
            Joi.object({
                toogle: Joi.number().integer().required(), 
            })
        );
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
        } else {
            const admin = await prisma.admin.findUnique({
                where: {
                    id: req.user.id,
                },
            });

           
            await prisma.admin.update({
                where: {
                    id: req.user.id,
                },
                data: {
                    bankIdToggle: parseInt(toogle),
                },
            });

            return res.json({
                status: 200,
                success: true,
                message: "Toggle updated successfully",
            });
        }
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