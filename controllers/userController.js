import Joi from "joi";
import jwt from 'jsonwebtoken'
import { PrismaClient } from "@prisma/client";
import bcrypt from 'bcrypt';
import path from 'path'
import dotenv from "dotenv";
import crypto from 'crypto'
import nodemailer from 'nodemailer';
import { fileURLToPath } from 'url';
import hbs from "nodemailer-express-handlebars";
import localStorage from 'localStorage'
import { getReportedUserIdsByUser, randomStringAsBase64Url } from "../utils/helper.js";
import { getLocation } from "../utils/getLocation.js";
import { createNormalNotification, normalizeLanguage, sendNotificationRelateToFollow } from "../utils/notification.js";
import { deleteFileFromS3, uploadFileToS3 } from "../utils/s3-helpers.js";
import axios from "axios";

dotenv.config();
const prisma = new PrismaClient();
const baseurl = process.env.BASE_URL;
export const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const transporter = nodemailer.createTransport({
  host: "mailcluster.loopia.se",
  port: 465, // 465 for SSL
  secure: true,
  auth: {
    user: "no-reply@frenly.se",
    pass: "m4KxkweQXd3acX@"
  }
});

const handlebarOptions = {
  viewEngine: {
    partialsDir: path.resolve(__dirname, "../view/"),
    defaultLayout: false,
  },
  viewPath: path.resolve(__dirname, "../view/"),
};

transporter.use("compile", hbs(handlebarOptions));

function normalizeUserSettingLanguage(language) {
  return normalizeLanguage(language);
}

function normalizeUserSettingPayload(userSetting) {
  if (!userSetting) {
    return userSetting;
  }

  return {
    ...userSetting,
    language: normalizeUserSettingLanguage(userSetting.language),
  };
}

export async function signup(req, res) {
  try {
    console.log("here");

    const { email, password, full_name, username } = req.body;
    console.log(req.body);
    console.log("after")
    const schema = Joi.alternatives(Joi.object({
      email: Joi.string().min(5).max(255).email({ tlds: { allow: false } }).lowercase().required(),
      password: Joi.string().min(8).max(15).required(),
      full_name: Joi.string().max(255).required(),
      username: Joi.string().min(3).max(20).required(),

    }))
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

    const user = await prisma.user.findUnique({
      where: {
        email: email
      }
    })
    if (user) {
      return res.status(400).json({
        success: false,
        message: "Already have an account, Please Login",
        status: 400,
      });
    }
    const act_token = crypto.randomBytes(16).toString('hex');
    let mailOptions = {
      from: '"Frenly" <no-reply@frenly.se>',
      to: email,
      subject: 'Activate Account',
      template: 'signupemail',
      context: {
        // href_url: `http://192.168.1.35:3000verifyUser/` + `${act_token}`,
        href_url: `${baseurl}/user/verifyUser/${act_token}`,
        image_logo: `${baseurl}/image/logo.png`,
        msg: `Please click below link to activate your account.`

      }
    };
    transporter.sendMail(mailOptions, async function (error, info) {
      if (error) {
        console.log("error", error)
        return res.status(400).json({
          success: false,
          status: 400,
          message: 'Mail Not delivered'
        });
      }
      else {
        const hashedPassword = await bcrypt.hash(password, 10);
        console.log(hashedPassword)
        // Save the user with the hashed password using Prisma
        const createdUser = await prisma.user.create({
          data: {
            email: email,
            password: hashedPassword,
            full_name: full_name,
            act_token: act_token,
            handle: username
          }
        })
        await prisma.userSetting.create({
          data: {
            userId: createdUser.id,
            language: 'sv',
          }
        })
        console.log('account created')

        return res.status(200).json({
          success: true,
          message: "Email verification required. Check your inbox for a confirmation link",
          status: 200,
        });
      }
    });

  } catch (error) {
    console.log(error)
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      status: 500,
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
      const user = await prisma.user.findUnique({
        where: {
          email: email,
        }
      })
      if (user) {
        const genToken = randomStringAsBase64Url(20);
        await prisma.user.update({
          where: {
            email: email
          },
          data: {
            token: genToken
          }
        })

        const userToken = (await prisma.user.findUnique({
          where: {
            email: email,
          },
          select: {
            token: true,
          }
        })).token;

        let mailOptions = {
          from: '"Frenly" <no-reply@frenly.se>',
          to: email,
          subject: "Forgot Password",
          template: "forget_template",
          context: {
            image_logo: `${baseurl}/images/logo.png`,
            href_url: `${baseurl}/user/verifyPassword/${userToken}`,
            msg: `Vänligen klicka på länken nedan för att byta lösenord.`,
          },
        };
        transporter.sendMail(mailOptions, async function (error, info) {
          if (error) {
            return res.json({
              success: false,
              message: error,
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
    return res.json({
      success: false,
      message: "Internal server error",
      status: 500,
      error: error,
    });
  }
};


export async function resetPassword(req, res) {
  try {
    // User already decoded by middleware
    const userId = req.user.id;

    const { old_password, new_password, confirm_password } = req.body;

    // 1. Validate input
    const schema = Joi.object({
      old_password: Joi.string().min(8).max(15).required(),
      new_password: Joi.string().min(8).max(15).required(),
      confirm_password: Joi.string().valid(Joi.ref("new_password")).required()
        .messages({ "any.only": "Passwords do not match" }),
    });

    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.message });
    }

    // 2. Fetch logged-in user
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // 3. Verify old password
    const isPasswordValid = await bcrypt.compare(old_password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ success: false, message: "Old password is incorrect" });
    }

    // 4. Update new password
    const hashedPassword = await bcrypt.hash(new_password, 10);

    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    return res.status(200).json({
      success: true,
      message: "Password reset successfully",
    });

  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
}

export async function verifyPassword(req, res) {
  try {
    const id = req.params.token;

    console.log(id)

    if (!id) {
      return res.status(400).send("Invalid link");
    }
    else {
      const user = await prisma.user.findFirst({
        where: {
          token: id
        }
      })
      const token = user.token;
      if (token) {
        console.log("here is the vertoken");
        localStorage.setItem('vertoken', JSON.stringify(token));
        res.render(path.join(__dirname, '../view/', 'forgetPassword.ejs'), { msg: "" });
      }
      else {
        res.render(path.join(__dirname, '../view/', 'forgetPassword.ejs'), { msg: "This User is not Registered" });

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

    // ❌ NO VALIDATION AT ALL
    if (!password || !confirm_password) {
      return res.render(
        path.join(__dirname, '../view/', 'forgetPassword.ejs'),
        { msg: "Password is required" }
      );
    }

    if (password !== confirm_password) {
      return res.render(
        path.join(__dirname, '../view/', 'forgetPassword.ejs'),
        { msg: "Password and Confirm Password do not match" }
      );
    }

    const user = await prisma.user.findFirst({
      where: { token }
    });

    if (!user) {
      return res.render(
        path.join(__dirname, '../view/', 'forgetPassword.ejs'),
        { msg: "User not found" }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword }
    });

    res.sendFile(path.join(__dirname, '../view/message.html'));

  } catch (error) {
    console.log(error);
    res.render(
      path.join(__dirname, '../view/', 'forgetPassword.ejs'),
      { msg: "Internal server error" }
    );
  }
}


export async function verifyUserEmail(req, res) {
  try {
    const act_token = req.params.id;

    if (!act_token) {
      return res.status(400).sendFile(path.join(__dirname, '../view/notverify.html'));
    }

    console.log("act_token", act_token);

    const user = await prisma.user.findFirst({
      where: {
        act_token: act_token
      }
    });

    if (!user) {
      return res.status(404).sendFile(path.join(__dirname, '../view/notverify.html'));
    }

    await prisma.user.update({
      where: {
        id: user.id
      },
      data: {
        isVerified: true,
        act_token: null
      }
    });

    return res.sendFile(path.join(__dirname, '../view/verify.html'));
  }
  catch (error) {
    console.log(error);
    return res.status(500).send(`<div class="container">
      <p>404 Error, Page Not Found</p>
      </div> `);
  }
};
export async function login(req, res) {
  try {
    const secretKey = process.env.SECRET_KEY;

    const { email, password, fcm_token, country, city } = req.body;

    // ✅ Validation
    const schema = Joi.object({
      email: Joi.string().email({ tlds: { allow: false } }).required(),
      password: Joi.string().min(8).max(15).required(),
      fcm_token: Joi.string().optional(),
      country: Joi.string().optional(),
      city: Joi.string().optional(),

    });

    const { error } = schema.validate({
      email,
      password,
      fcm_token,
      country,
      city
    });

    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        status: 400,
      });
    }

    // ✅ Find user
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({
        success: false,
        message: "Invalid login credentials",
        status: 400,
      });
    }

    if (!user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Please verify your account",
        status: 400,
      });
    }

    if (user.status === 0) {
      return res.status(400).json({
        success: false,
        message: "Your account has been blocked by the administrator",
        status: 400,
      });
    }

    // ✅ Prepare update object
    let updateData = {};

    // FCM token update
    if (fcm_token) {
      updateData.fcm_token = fcm_token;
    }

    // ✅ Location handling (optional + safe)
    if (country) {
      updateData.country = country;
    }

    if (city) {
      updateData.city = city;
    }

    // ✅ Update user (only once)
    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    // ✅ Get final user data
    const userData = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        fcm_token: true,
        avatar_url: true,
        cover_photo_url: true,
        bio: true,
        handle: true,
        full_name: true,
        numberOfFollower: true,
        numberOfFollowing: true,
        country: true,
        city: true,
      },
    });

    // ✅ Ensure user setting exists
    const userSetting = await prisma.userSetting.findFirst({
      where: { userId: user.id },
    });

    if (!userSetting) {
      await prisma.userSetting.create({
        data: {
          userId: user.id,
          language: 'sv',
        },
      });
    }

    // ✅ Generate token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      secretKey,
      { expiresIn: "24w" }
    );

    return res.json({
      status: 200,
      success: true,
      message: "Login successful!",
      token,
      user: userData,
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      status: 500,
    });
  }
}

export async function editProfile(req, res) {
  try {
    const { full_name, bio, handle } = req.body;
    const token = JSON.parse(localStorage.getItem('vertoken'));
    const schema = Joi.alternatives(
      Joi.object({
        full_name: Joi.string().optional(),
        bio: Joi.string().optional(),
        handle: Joi.string().optional(),
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
    else {
      // console.log("email", req.body)
      // const user = await prisma.user.findUnique({
      //   where: {
      //     id: {
      //       not: req.user.id
      //     },
      //     email: email,
      //   }
      // })
      // console.log(user)
      // if (user) {
      //   return res.json({
      //     success: false,
      //     message: "User with this email already exits ,please user different email",
      //     status: 400,
      //   });
      // }
      console.log(req.user.id, "userId")
      const userWithHandleExists = await prisma.user.findUnique({
        where: {
          NOT: {
            id: req.user.id
          },
          handle: handle,
        }
      });

      if (userWithHandleExists) {
        return res.status(400).json({
          success: false,
          message: "User name already exists ,try different User Name",
          status: 500,
        })
      }

      let avatar_url = null;
      let fileKey = null;
      let coverfileKey = null;
      let cover_photo_url = null;
      if (req.files && req.files['avatar'] && req.files['avatar'][0]) {
        console.log(req.files['avatar'][0])
        if (req.user.fileKey) {
          await deleteFileFromS3(req.user.fileKey)
        }

        const s3Response = await uploadFileToS3(req.files['avatar'][0]);
        avatar_url = s3Response.Location;
        fileKey = s3Response.Key
      }
      if (req.files && req.files['cover'] && req.files['cover'][0]) {
        if (req.user.coverfileKey) {
          await deleteFileFromS3(req.user.coverfileKey)
        }
        const s3Response = await uploadFileToS3(req.files['cover'][0]);
        cover_photo_url = s3Response.Location;
        coverfileKey = s3Response.Key
      }
      let userData = {
        // email: email ? email : req.user.email,
        full_name: full_name ? full_name : req.user.full_name,
        bio: bio ? bio : req.user.bio,
        handle: handle ? handle : req.user.handle,
        avatar_url: avatar_url ? avatar_url : req.user.avatar_url,
        fileKey: fileKey ? fileKey : req.user.fileKey,
        cover_photo_url: cover_photo_url ? cover_photo_url : req.user.cover_photo_url,
        coverfileKey: coverfileKey ? coverfileKey : req.user.coverfileKey
      };
      await prisma.user.update({
        where: {
          id: req.user.id,
        },
        data: userData
      })
      const updatedUser = await prisma.user.findUnique({
        where: {
          id: req.user.id
        },
      })
      return res.status(200).json({
        success: true,
        message: "Profile Updated Successfully",
        status: 200,
        user: updatedUser
      })
    }
  }
  catch (error) {
    console.log(error);
    return res.json({
      success: false,
      message: "Internal server error",
      status: 500,
      error: error
    })
  }
};
export async function blockUser(req, res) {
  try {
    const { id } = req.params;

    const user = await prisma.user.findUnique({
      where: {
        id: parseInt(id)
      }
    })
    if (!user) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User Not Found',
      })
    }

    const alreadyBlocked = await prisma.userBlocked.findFirst({
      where: {
        userId: req.user.id,
        userBlockedId: parseInt(id)
      }
    })
    if (alreadyBlocked) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User Already Blocked',
      })
    }

    await prisma.userBlocked.create({
      data: {
        userId: req.user.id,
        userBlockedId: parseInt(id)
      }
    })
    return res.status(200).json({
      success: true,
      message: "User Blocked Successfully",
      status: 200,
    })

  } catch (error) {
    return res.json({
      success: false,
      message: "Internal server error",
      status: 500,
      error: error,
    });
  }

}
export async function unBlockUser(req, res) {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: {
        id: parseInt(id)
      }
    })
    if (!user) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User Not Found',
      })

    }

    const blockedData = await prisma.userBlocked.findFirst({
      where: {
        userId: req.user.id,
        userBlockedId: parseInt(id)
      }
    })
    if (!blockedData) {
      return res.status(200).json({
        success: true,
        message: "User Blocked Not Found",
        status: 200,
      })
    }
    const isFollowing = await prisma.follow.findFirst({
      where: {
        followerId: parseInt(id),
        followingId: req.user.id
      }
    })
    if (isFollowing) {
      await prisma.follow.delete({
        where: {
          id: isFollowing.id
        }
      })
    }
    const isFollowed = await prisma.follow.findFirst({
      where: {
        followerId: req.user.id,
        followingId: parseInt(id)
      }
    })
    if (isFollowed) {
      await prisma.follow.delete({
        where: {
          id: isFollowed.id
        }
      })
    }
    await prisma.userBlocked.delete({
      where: {
        id: blockedData.id
      }
    })
    return res.status(200).json({
      success: true,
      message: "User Unblocked Successfully",
      status: 200,
    })

  } catch (error) {
    console.log(error)
    return res.json({
      success: false,
      message: "Internal server error",
      status: 500,
      error: error,
    });
  }

}
// export async function getAllUsers(req, res) {

//   try {
//     const { search, page = 1, limit = 10 } = req.query;
//     const blockedUserIDs = (await prisma.userBlocked.findMany({
//       where: {
//         userId: req.user.id
//       },
//       select: {
//         userBlockedId: true,
//       }
//     })).map((user) => user.userBlockedId);

//     const users = await prisma.user.findMany({
//       where: {
//         id: {
//           notIn: [...blockedUserIDs, req.user.id]
//         },
//         isVerified: true,
//         handle: {
//           contains: search
//         }
//       }, select: {
//         id: true,
//         full_name: true,
//         avatar_url: true,
//         handle: true
//       }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
//     });

//     await Promise.all(users.map((user) => {
//       if (user.avatar_url) {
//         user.avatar_url = `${baseurl}/images/${user.avatar_url}`
//       }
//     }))

//     return res.status(200).json({
//       success: true,
//       message: "users",
//       users: users,
//       status: 200,
//     })
//   } catch ({ error }) {
//     return res.status(500).json({
//       success: false,
//       message: "Internal server error",
//       status: 500,
//       error: error,
//     });
//   }




// }
// export async function follow(req, res) {
//   const userToFollowId = parseInt(req.params.id);
//   const userId = req.user.id;
//   try {
//     // Check if both users exist
//     const user = await prisma.user.findUnique({ where: { id: userId } });
//     const userToFollow = await prisma.user.findUnique({ where: { id: userToFollowId } });

//     if (!user || !userToFollow) {
//       return res.status(404).json({
//         success: false,
//         status: 400,
//         message: 'User or user to follow not found'
//       });
//     }

//     // Check if the follow relationship already exists
//     const existingFollow = await prisma.follow.findFirst({
//       where: {
//         followerId: userId,
//         followingId: userToFollowId,
//       },
//     });

//     if (existingFollow) {
//       return res.status(400).json({
//         success: false,
//         status: 400,
//         message: 'Already following this user',
//       });
//     }

//     // Create the follow relationship
//     await prisma.follow.create({
//       data: {
//         followerId: userId,
//         followingId: userToFollowId,
//       },
//     });
//     let numberOfFollower = (await prisma.user.findUnique({
//       where: {
//         id: userToFollowId
//       }
//     })).numberOfFollower
//     numberOfFollower = numberOfFollower + 1;
//     await prisma.user.update({
//       where: {
//         id: userToFollowId,
//       },
//       data: {
//         numberOfFollower: numberOfFollower
//       }
//     })
//     let numberOfFollowing = (await prisma.user.findUnique({
//       where: {
//         id: userId
//       }
//     })).numberOfFollowing
//     numberOfFollowing = numberOfFollowing + 1;

//     await prisma.user.update({
//       where: {
//         id: userId,
//       },
//       data: {
//         numberOfFollowing: numberOfFollowing
//       }
//     })

//     await createNormalNotification({
//       toUserId: userToFollowId,
//       byUserId: req.user.id,
//       data: {
//         userId: req.user.id
//       },
//       content: `${req.user.full_name} Followed you`
//     })

//     await sendNotificationRelateToFollow({
//       token: userToFollow.fcm_token,
//       toUserId: userToFollowId,
//       body: `${req.user.full_name} Followed you`,
//       userId: req.user.id
//     })

//     return res.status(200).json({ success: true, status: 200, message: 'Successfully followed user' });
//   } catch (error) {
//     console.error('Error:', error);
//     return res.status(500).json({ success: false, status: 500, message: 'Internal server error', error: error });
//   }
// };
export async function getAllUsers(req, res) {

  try {
    const { search, page = 1, limit = 10 } = req.query;
    const blockedUserIDs = (await prisma.userBlocked.findMany({
      where: {
        userId: req.user.id
      },
      select: {
        userBlockedId: true,
      }
    })).map((user) => user.userBlockedId);
    const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
    const whereClause = {
      id: {
        notIn: [...blockedUserIDs, req.user.id, ...reportedUserIds],
      },
      isVerified: true,
    };

    if (search) {
      whereClause.OR = [
        {
          handle: {
            contains: search,
          },
        },
        {
          full_name: {
            contains: search,
          },
        },
      ];
    }

    const users = await prisma.user.findMany({
      where: whereClause, select: {
        id: true,
        full_name: true,
        avatar_url: true,
        handle: true
      }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
    });


    return res.status(200).json({
      success: true,
      message: "users",
      users: users,
      status: 200,
    })
  } catch ({ error }) {
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      status: 500,
      error: error,
    });
  }




}
export async function follow(req, res) {
  const userToFollowId = parseInt(req.params.id);
  const userId = req.user.id;
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const userToFollow = await prisma.user.findUnique({ where: { id: userToFollowId } });

    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        status: 400,
        message: 'User to follow not found'
      });
    }

    const existingFollow = await prisma.follow.findFirst({
      where: {
        followerId: userId,
        followingId: userToFollowId,
      },
    });

    if (existingFollow) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Follow request already exists or already following',
      });
    }

    if (userToFollow.isPrivate) {
      // Create a follow request
      await prisma.follow.create({
        data: {
          followerId: userId,
          followingId: userToFollowId,
          status: 0, // pending
        },
      });

      await createNormalNotification({
        toUserId: userToFollowId,
        byUserId: userId,
        type: 'followRequest',
        data: {
          userId: userId,
          fullName: user.full_name,
          avatarUrl: user.avatar_url
        },
        templateKey: 'follow_request_sent',
        actorName: user.full_name
      });
      await sendNotificationRelateToFollow({
        token: userToFollow.fcm_token,
        toUserId: userToFollowId,
        templateKey: 'follow_request_sent',
        actorName: req.user.full_name,
        userId: req.user.id,
        type: "followRequest",
      })

      return res.status(200).json({ success: true, status: 200, message: 'Follow request sent' });
    } else {
      // Follow directly if the account is public
      await prisma.follow.create({
        data: {
          followerId: userId,
          followingId: userToFollowId,
          status: 1, // accepted
        },
      });

      // Update follower and following count
      await prisma.user.update({
        where: { id: userToFollowId },
        data: { numberOfFollower: { increment: 1 } }
      });

      await prisma.user.update({
        where: { id: userId },
        data: { numberOfFollowing: { increment: 1 } }
      });

      await createNormalNotification({
        toUserId: userToFollowId,
        byUserId: userId,
        type: 'followAccept',
        data: {},
        templateKey: 'started_following',
        actorName: user.full_name
      });
      await sendNotificationRelateToFollow({
        token: userToFollow.fcm_token,
        toUserId: userToFollowId,
        templateKey: 'started_following',
        actorName: req.user.full_name,
        userId: req.user.id,
        type: "followAccept",
      })

      return res.status(200).json({ success: true, status: 200, message: 'Successfully followed user' });
    }
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ success: false, status: 500, message: 'Internal server error', error: error });
  }
};

export async function unFollow(req, res) {
  const userToUnfollowId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    // Check if both users exist
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const userToUnfollow = await prisma.user.findUnique({ where: { id: userToUnfollowId } });

    if (!userToUnfollow) {
      return res.status(404).json({ success: false, status: 404, message: 'User to unfollow not found' });
    }

    // Check if the follow relationship exists
    const existingFollow = await prisma.follow.findFirst({
      where: {
        followerId: userId,
        followingId: userToUnfollowId,
        status: {
          not: 2
        }
      },
    });

    if (!existingFollow) {
      return res.status(400).json({ success: false, status: 400, message: 'Not following this user' });
    }

    if (existingFollow.status === 1) {
      if (user.numberOfFollowing > 0) {
        const numberOfFollowing = user.numberOfFollowing - 1;
        await prisma.user.update({
          where: {
            id: userId
          },
          data: {
            numberOfFollowing: numberOfFollowing
          }
        })
      }
      if (userToUnfollow.numberOfFollower > 0) {
        const numberOfFollower = userToUnfollow.numberOfFollower - 1;
        await prisma.user.update({
          where: {
            id: userToUnfollowId
          },
          data: {
            numberOfFollower: numberOfFollower
          }
        })
      }
    }

    // Delete the follow relationship
    await prisma.follow.delete({
      where: {
        id: existingFollow.id,
      },
    });

    const notification = await prisma.notification.findFirst({
      where: {
        byUserId: userId,
        toUserId: userToUnfollowId,
        type: "followAccept"
      }
    })
    if (notification) {
      await prisma.notification.delete({
        where: {
          id: notification.id
        }
      })
    }

    return res.status(200).json({ success: true, status: 200, message: 'Successfully unfollowed user' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ success: false, status: 500, message: 'Internal server error', error: error });
  }
};
export async function getMyFollowers(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = parseInt(req.user.id);
    const blockedUserIDs = (await prisma.userBlocked.findMany({
      where: {
        userId: req.user.id
      },
      select: {
        userBlockedId: true,
      }
    })).map((user) => user.userBlockedId);
    const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
    const followers = (await prisma.follow.findMany({
      where: {
        followingId: userId,
        followerId: {
          notIn: [...blockedUserIDs, ...reportedUserIds]
        },
        status: 1
      },
      select: {
        follower: true
      },
      skip: parseInt((page - 1) * limit), take: parseInt(limit),
    })).map((follow) => {
      return follow.follower;
    })
    const userIFollowIds = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 1
      },
    })).map((follow) => follow.followingId)
    const userIRequestedToFollow = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 0
      },
    })).map((follow) => follow.followingId)
    await Promise.all(followers.map((user) => {

      if (userIFollowIds.includes(user.id)) {
        user.followState = 2
      }
      else if (userIRequestedToFollow.includes(user.id)) {
        user.followState = 1
      }
      else {
        user.followState = 0
      }
      user.isFollowed = userIFollowIds.includes(user.id);
      return user
    }))
    return res.status(200).json({
      success: true,
      status: 200,
      followers: followers,
      total: followers.length
    })
  } catch (error) {
    return res.status(500).json({ success: false, status: 500, message: 'Internal server error', error: error });
  }

};
export async function getUserWhomIFollow(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;
    const userId = parseInt(req.user.id);
    const blockedUserIDs = (await prisma.userBlocked.findMany({
      where: {
        userId: req.user.id
      },
      select: {
        userBlockedId: true,
      }
    })).map((user) => user.userBlockedId);
    const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
    const followings = (await prisma.follow.findMany({
      where: {
        followerId: userId,
        followingId: {
          notIn: [...blockedUserIDs, ...reportedUserIds]
        },
        status: 1
      },
      select: {
        following: true
      }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
    })).map((follow) => {
      return follow.following;
    })
    const userIFollowIds = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 1
      },
    })).map((follow) => follow.followingId)
    const userIRequestedToFollow = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 0
      },
    })).map((follow) => follow.followingId)
    await Promise.all(followings.map((user) => {
      user.followState = 2
    }))
    return res.status(200).json({
      success: true,
      status: 200,
      followings: followings,
      total: followings.length
    })
  } catch (error) {
    return res.status(500).json({ success: false, status: 500, message: 'Internal server error', error: error });
  }

};
export async function saveOrUnSaveProfile(req, res) {
  try {
    let { userId } = req.params;

    userId = parseInt(userId);

    const user = await prisma.user.findUnique({
      where: {
        id: userId
      }
    })

    if (!user) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User Not Found',
      })
    }
    const saveUser = await prisma.saveUser.findFirst({
      where: {
        userId: userId,
        saveByUserId: req.user.id
      }
    })

    if (saveUser) {

      await prisma.saveUser.delete({
        where: {
          id: saveUser.id,
          saveByUserId: req.user.id,
          userId: userId
        }
      })
      if (user.numberOfSaves > 0) {
        await prisma.user.update({
          where: {
            id: userId
          },
          data: {
            numberOfSaves: user.numberOfSaves - 1,
          }
        })
      }

      return res.status(200).json({
        status: 200,
        message: 'UnSaved the user',
        success: true
      })
    }
    else {

      const saveUser = await prisma.saveUser.create({
        data: {
          userId: userId,
          saveByUserId: req.user.id
        }
      })
      await prisma.user.update({
        where: {
          id: userId
        },
        data: {
          numberOfSaves: user.numberOfSaves + 1,
        }
      })
      return res.status(200).json({
        status: 200,
        message: 'Saved the user',
        success: true,
        saveUser: saveUser
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
export async function getMySavedUsers(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;

    const userIFollowIds = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 1
      },
    })).map((follow) => follow.followingId)
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
    const mySavedUsers = await prisma.saveUser.findMany({
      where: {
        saveByUserId: req.user.id,
        userId: {
          notIn: blockedUserIDs
        }
      }, include: {
        user: true
      }, orderBy: {
        createdAt: 'desc'
      }, skip: parseInt((page - 1) * limit), take: parseInt(limit)
    })
    await Promise.all(mySavedUsers.map((data) => {

      if (userIFollowIds.includes(data.user.id)) {
        data.user.followState = 2
      }
      else if (userIRequestedToFollow.includes(data.user.id)) {
        data.user.followState = 1
      }
      else {
        data.user.followState = 0
      }
      data.user.isFollowed = userIFollowIds.includes(data.user.id);
      return data
    }))
    return res.status(200).json({
      status: 200,
      message: 'My Saved Users',
      success: true,
      mySavedUsers: mySavedUsers
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
export async function getMyBlockedUser(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;

    // const blockedUserIDs = (await prisma.userBlocked.findMany({
    //   where: {
    //     userId: req.user.id
    //   },
    //   select: {
    //     userBlockedId: true,
    //   }, orderBy: {
    //     createdAt: 'desc'
    //   }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
    // })).map((user) => user.userBlockedId);


    const total = await prisma.userBlocked.count({
      where: {
        userId: req.user.id
      }
    })
    const myBlockedUserList = await prisma.userBlocked.findMany({
      where: {
        userId: req.user.id
      },
      select: {
        userBlocked: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    })

    return res.status(200).json({
      status: 200,
      message: 'BLocked Users',
      total: total,
      success: true,
      myBlockedUserList: myBlockedUserList.map(({ userBlocked }) => userBlocked)
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
export async function deleteAccount(req, res) {
  try {
    const deleteAccount = await prisma.user.delete({
      where: {
        id: req.user.id
      }
    });

    return res.status(200).json({
      status: 200,
      message: 'Account deleted Successfully',
      success: true,
      deleteAccount: deleteAccount
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
export async function getUser(req, res) {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    console.log("userIds", userId);
    console.log("currentUserID", req.user.id);

    const blockedUserIDs = (await prisma.userBlocked.findMany({
      where: { userId: currentUserId },
      select: { userBlockedId: true },
    })).map((user) => user.userBlockedId);

    const user = await prisma.user.findUnique({
      where: { id: parseInt(userId) },
      include: {
        posts: {
          include: {
            user: true
          }
        },
        vlogs: {
          include: {
            user: true
          }
        },
        blogs: {
          include: {
            user: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({
        status: 404,
        message: 'User not found',
        success: false
      });
    }

    // Get the user's settings to check hideLikes
    const userSetting = await prisma.userSetting.findFirst({
      where: { userId: parseInt(userId) }
    });

    const hideLikes = userSetting?.hideLikes || false;

    const followStatus = await prisma.follow.findFirst({
      where: {
        followerId: currentUserId,
        followingId: parseInt(userId),
      }
    });

    let followState = 0;
    if (followStatus) {
      console.log(followStatus)
      followState = followStatus.status === 0 ? 1 : 2;
    }
    console.log("followStatus", followState)

    const numberOfFollower = await prisma.follow.count({
      where: { followingId: parseInt(userId), status: 1 }
    });
    user.numberOfFollower = numberOfFollower;

    const numberOfFollowing = await prisma.follow.count({
      where: { followerId: parseInt(userId), status: 1 }
    });
    user.numberOfFollowing = numberOfFollowing;

    user.numberOfPosts = user.posts.length;

    // Process vlogs - if hideLikes is true, don't show alreadyLiked status
    await Promise.all(user.vlogs.map(async (vlog) => {
      const isSaved = await prisma.saveVlog.findFirst({
        where: { vlogId: vlog.id, saveByUserId: currentUserId }
      });
      const numberOfViews = await prisma.viewVlog.count({
        where: { vlogId: vlog.id, viewByUserId: { notIn: blockedUserIDs } }
      });

      vlog.numberOfViews = numberOfViews;
      vlog.alreadySaved = !!isSaved;

      // Only show alreadyLiked if hideLikes is false
      if (!hideLikes) {
        const isLiked = await prisma.reactVlog.findFirst({
          where: { vlogId: vlog.id, createByUserId: currentUserId }
        });
        vlog.alreadyLiked = !!isLiked;
      } else {
        vlog.alreadyLiked = null; // or false, depending on your frontend needs
      }
    }));

    // Process posts and blogs similarly if they have like functionality
    // You'll need to add similar logic for posts and blogs if they have likes

    if (user.isPrivate && followState !== 2) {
      return res.status(200).json({
        status: 200,
        message: 'User is private',
        success: true,
        user: {
          ...user,
          posts: [],
          vlogs: [],
          blogs: [],
          numberOfPosts: user.posts.length,
          commentsAllowed: userSetting?.commentsAllowed || true,
          followState: followState,
          hideLikes: hideLikes, // Include hideLikes in response
        }
      });
    }

    return res.status(200).json({
      status: 200,
      message: 'User Data',
      success: true,
      user: {
        ...user,
        commentsAllowed: userSetting?.commentsAllowed || true,
        followState: followState,
        hideLikes: hideLikes, // Include hideLikes in response
      }
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      status: 500,
      message: 'Internal Server Error',
      success: false,
      error: error
    });
  }
}

export async function getMyProfile(req, res) {
  try {
    const blockedUserIDs = (await prisma.userBlocked.findMany({
      where: {
        userId: req.user.id
      },
      select: {
        userBlockedId: true,
      }
    })).map((user) => user.userBlockedId);

    const user = await prisma.user.findUnique({
      where: {
        id: req.user.id
      },
      include: {
        posts: {
          include: {
            user: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        vlogs: {
          include: {
            user: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        blogs: {
          include: {
            user: true
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        Category: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Get user settings for hideLikes
    const userSetting = await prisma.userSetting.findFirst({
      where: { userId: req.user.id }
    });

    const hideLikes = userSetting?.hideLikes || false;

    const reportedUserIds = await getReportedUserIdsByUser(req.user.id)
    const numberOfFollower = await prisma.follow.count({
      where: {
        followingId: req.user.id,
        followerId: {
          notIn: [...blockedUserIDs, ...reportedUserIds]
        },
        status: 1
      }
    })
    user.numberOfFollower = numberOfFollower

    const numberOfFollowings = await prisma.follow.count({
      where: {
        followerId: req.user.id,
        followingId: {
          notIn: [...blockedUserIDs, ...reportedUserIds]
        },
        status: 1
      }
    })
    user.numberOfFollowing = numberOfFollowings
    user.numberOfPosts = user.posts.length

    for (const vlog of user.vlogs) {
      const isSaved = await prisma.saveVlog.findFirst({
        where: {
          vlogId: vlog.id,
          saveByUserId: req.user.id
        }
      })
      const numberOfViews = await prisma.viewVlog.count({
        where: {
          vlogId: vlog.id,
          viewByUserId: {
            notIn: blockedUserIDs
          }
        }
      })
      vlog.numberOfViews = numberOfViews;

      // Only check and set alreadyLiked if hideLikes is false
      if (!hideLikes) {
        const isLiked = await prisma.reactVlog.findFirst({
          where: {
            vlogId: vlog.id,
            createByUserId: req.user.id
          }
        });
        vlog.alreadyLiked = !!isLiked;
      } else {
        vlog.alreadyLiked = null; // or false
      }

      vlog.alreadySaved = !!isSaved;
    }

    // Add hideLikes to user response
    user.hideLikes = hideLikes;

    return res.status(200).json({
      status: 200,
      message: 'User Data',
      success: true,
      user: user
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


export async function getMySettings(req, res) {
  try {
    let userSetting = await prisma.userSetting.findFirst({
      where: {
        userId: req.user.id
      }
    });

    if (!userSetting) {
      userSetting = await prisma.userSetting.create({
        data: {
          userId: req.user.id,
          language: 'sv',
        }
      });
    }

    return res.status(200).json({
      status: 200,
      message: ' User Settings',
      success: true,
      userSetting: normalizeUserSettingPayload(userSetting)
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

export async function updateMySettings(req, res) {
  try {
    const { lastSeen, commentsAllowed, chatNotification, feedNotification, language, hideLikes } = req.body;

    const schema = Joi.alternatives(Joi.object({
      lastSeen: Joi.boolean().optional(),
      commentsAllowed: Joi.boolean().optional(),
      chatNotification: Joi.boolean().optional(),
      feedNotification: Joi.boolean().optional(),
      hideLikes: Joi.boolean().optional(),
      language: Joi.string().trim().lowercase().valid('en', 'sv', 'english', 'swedish', 'svenska').optional()
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

    let user = await prisma.userSetting.findFirst({
      where: {
        userId: req.user.id
      }
    })

    if (!user) {
      user = await prisma.userSetting.create({
        data: {
          userId: req.user.id,
          language: 'sv',
        }
      });
    }

    const normalizedLanguage = normalizeUserSettingLanguage(language ?? user.language);

    const userSetting = await prisma.userSetting.update({
      where: {
        id: user.id
      },
      data: {
        lastSeen: lastSeen != null ? lastSeen : user.lastSeen,
        feedNotification: feedNotification != null ? feedNotification : user.feedNotification,
        commentsAllowed: commentsAllowed != null ? commentsAllowed : user.commentsAllowed,
        chatNotification: chatNotification != null ? chatNotification : user.chatNotification,
        hideLikes: hideLikes != null ? hideLikes : user.hideLikes, // Make sure to update hideLikes
        language: normalizedLanguage
      }
    });
    return res.status(200).json({
      status: 200,
      message: 'User Settings Updated',
      success: true,
      userSetting: normalizeUserSettingPayload(userSetting)
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

export async function addCategory(req, res) {
  try {
    const { name } = req.body;

    const schema = Joi.alternatives(Joi.object({
      name: Joi.string().max(15).required(),
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

    await prisma.category.create({
      data: {
        name: name,
        createByUserId: req.user.id,
      }
    })

    return res.status(200).json({
      status: 200,
      message: 'Category Created',
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

export async function checkUsernameAvailability(req, res) {
  try {
    const { username } = req.body;
    const schema = Joi.alternatives(Joi.object({
      username: Joi.string().min(3).max(20).required(),
    }))
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

    const user = await prisma.user.findUnique({
      where: {
        handle: username
      }
    });
    if (user) {
      return res.status(400).json({
        status: 400,
        message: 'Username Already Registered',
        success: false,
      })
    }
    else {
      return res.status(200).json({
        status: 200,
        message: 'Username Allowed',
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

export async function checkIn(req, res) {
  try {
    const { country, city } = req.body;

    const schema = Joi.object({
      country: Joi.string().required(),
      city: Joi.string().required(),
    });
    const result = schema.validate({ country, city });

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

    await prisma.user.update({
      where: { id: req.user.id },
      data: { country, city }
    });

    console.log("country", country,)
    await prisma.user.update({
      where: {
        id: req.user.id
      },
      data: {
        city: city,
        country: country
      }
    })

    return res.status(200).json({
      status: 200,
      message: 'Successfully checkedIn',
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
export async function getMyCategories(req, res) {
  try {
    const categories = await prisma.category.findMany({
      where: {
        createByUserId: req.user.id
      }
    })

    return res.status(200).json({
      status: 200,
      message: 'Fetched  the Categories',
      success: true,
      categories: categories
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

export async function onlineStatus(req, res) {
  try {
    await prisma.user.update({
      where: {
        id: req.user.id
      },
      data: {
        isOnline: 1,
        lastSeen: null,
      }
    })
    return res.status(200).json({
      status: 200,
      message: 'Online ',
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
export async function offlineStatus(req, res) {
  try {
    const time = new Date().toDateString();
    console.log()
    await prisma.user.update({
      where: {
        id: req.user.id
      },
      data: {
        isOnline: 0,
        lastSeen: new Date()
      }
    })
    return res.status(200).json({
      status: 200,
      message: 'Offline ',
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
export async function getLastSeen(req, res) {
  try {

    let { userId } = req.params;

    userId = parseInt(userId)
    const userSetting = await prisma.userSetting.findFirst({
      where: {
        userId: userId
      }
    });

    const user = await prisma.user.findUnique({
      where: {
        id: userId
      }
    })

    const data = {
      isLastSeenAllowed: userSetting.lastSeen,
      lastSeen: user.lastSeen
    }
    return res.status(200).json({
      status: 200,
      message: 'Last Seen Data ',
      success: true,
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

export async function deleteCategory(req, res) {
  try {
    let { id } = req.params;

    id = parseInt(id);

    const category = await prisma.category.findFirst({
      where: {
        id: id,
        createByUserId: req.user.id
      }
    })

    if (!category) {
      return res.status(400).json({
        status: 200,
        message: 'Category Not Found',
        success: false,
      })
    }

    await prisma.category.delete({
      where: {
        id: id,
        createByUserId: req.user.id
      }
    })
    return res.status(200).json({
      status: 200,
      message: 'Category Successfully deleted',
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

export async function terms(req, res) {
  res.render(path.join(__dirname, '../view/', 'terms.ejs'),
    { message: "" });
}

export async function acceptFollowRequest(req, res) {
  let { followerId, notificationId, userId } = req.body;
  const schema = Joi.alternatives(Joi.object({
    followerId: Joi.number().required(),// who raised the follow request
    notificationId: Joi.number().required(),
    userId: Joi.number().required() // who is accepting the request 
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
  } // ID of the user who sent the follow request
  // const userId = req.user.id; // ID of the logged-in user who is accepting the request

  try {

    const notification = await prisma.notification.findUnique({
      where: {
        id: parseInt(notificationId)
      }
    })

    if (!notification) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'Notification Not Found',
      })

    }

    followerId = parseInt(followerId);
    userId = parseInt(userId);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const followRequestUser = await prisma.user.findUnique({ where: { id: followerId } });

    if (!user || !followRequestUser) {
      return res.status(404).json({
        success: false,
        status: 400,
        message: 'User or User raised a request not found'
      });
    }
    const followRequest = await prisma.follow.findFirst({
      where: {
        followerId: followerId,
        followingId: userId,
        status: 0, // pending
      },
    });

    if (!followRequest) {
      return res.status(404).json({
        success: false,
        status: 404,
        message: 'Follow request not found',
      });
    }

    const userData = await prisma.user.findUnique({
      where: {
        id: parseInt(userId)
      }
    })

    const followerData = await prisma.user.findUnique({
      where: {
        id: followerId
      }
    })

    await prisma.follow.update({
      where: {
        id: followRequest.id,
      },
      data: {
        status: 1, // accepted
      },
    });
    await prisma.notification.delete({
      where: {
        id: parseInt(notificationId)
      },
    })


    await prisma.user.update({
      where: { id: userId },
      data: { numberOfFollower: { increment: 1 } }
    });

    await prisma.user.update({
      where: { id: followerId },
      data: { numberOfFollowing: { increment: 1 } }
    });

    await createNormalNotification({
      toUserId: followerId,
      byUserId: userId,
      type: '',
      data: {},
      templateKey: 'follow_request_accepted',
      actorName: userData.full_name
    });
    await sendNotificationRelateToFollow({
      token: followerData.fcm_token,
      toUserId: followerData.id,
      templateKey: 'follow_request_accepted',
      actorName: userData.full_name,
      userId: followerData.id,
      type: "",
    })
    return res.status(200).json({
      success: true,
      status: 200,
      message: 'Follow request accepted',
    });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({
      success: false,
      status: 500,
      message: 'Internal server error',
      error: error,
    });
  }
};

export async function updateProfileVisibility(req, res) {
  try {
    const { isPrivate } = req.body;

    const schema = Joi.alternatives(Joi.object({
      isPrivate: Joi.boolean().required(),
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

    await prisma.user.update({
      where: {
        id: req.user.id
      },
      data: {
        isPrivate: isPrivate != null ? isPrivate : false
      }
    })
    return res.status(200).json({
      status: 200,
      message: ' Update Profile Visibility',
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

export async function getUserFollowers(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;
    let { userId } = req.params;

    userId = parseInt(userId);

    const user = await prisma.user.findUnique({
      where: {
        id: parseInt(userId)
      }
    })
    if (!user) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User Not Found',
      })

    }

    const blockedUserIDs = (await prisma.userBlocked.findMany({
      where: {
        userId: req.user.id
      },
      select: {
        userBlockedId: true,
      }
    })).map((user) => user.userBlockedId);
    const followers = (await prisma.follow.findMany({
      where: {
        followingId: userId,
        followerId: {
          notIn: blockedUserIDs
        },
        status: 1
      },
      select: {
        follower: true
      },
      skip: parseInt((page - 1) * limit), take: parseInt(limit),
    })).map((follow) => {
      return follow.follower;
    })
    const userIFollowIds = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 1
      },
    })).map((follow) => follow.followingId)
    const userIRequestedToFollow = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 0
      },
    })).map((follow) => follow.followingId)
    await Promise.all(followers.map((user) => {
      if (userIFollowIds.includes(user.id)) {
        user.followState = 2
      }
      else if (userIRequestedToFollow.includes(user.id)) {
        user.followState = 1
      }
      else {
        user.followState = 0
      }

      user.isFollowed = true
      return user
    }))
    return res.status(200).json({
      success: true,
      status: 200,
      followers: followers,
      total: followers.length
    })
  } catch (error) {
    return res.status(500).json({ success: false, status: 500, message: 'Internal server error', error: error });
  }

};

export async function getUserFollowings(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;
    let { userId } = req.params;

    userId = parseInt(userId);

    const user = await prisma.user.findUnique({
      where: {
        id: parseInt(userId)
      }
    })
    if (!user) {
      return res.status(400).json({
        success: false,
        status: 400,
        message: 'User Not Found',
      })

    }


    const blockedUserIDs = (await prisma.userBlocked.findMany({
      where: {
        userId: req.user.id
      },
      select: {
        userBlockedId: true,
      }
    })).map((user) => user.userBlockedId);
    const followings = (await prisma.follow.findMany({
      where: {
        followerId: userId,
        followingId: {
          notIn: blockedUserIDs
        }
      },
      select: {
        following: true
      }, skip: parseInt((page - 1) * limit), take: parseInt(limit),
    })).map((follow) => {
      return follow.following;
    })

    const userIFollowIds = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 1
      },
    })).map((follow) => follow.followingId)
    const userIRequestedToFollow = (await prisma.follow.findMany({
      where: {
        followerId: req.user.id,
        status: 0
      },
    })).map((follow) => follow.followingId)
    await Promise.all(followings.map((user) => {

      if (userIFollowIds.includes(user.id)) {
        user.followState = 2
      }
      else if (userIRequestedToFollow.includes(user.id)) {
        user.followState = 1
      }
      else {
        user.followState = 0
      }
      user.isFollowed = true
    }))
    return res.status(200).json({
      success: true,
      status: 200,
      followings: followings,
      total: followings.length
    })
  } catch (error) {
    return res.status(500).json({ success: false, status: 500, message: 'Internal server error', error: error });
  }

};

export async function reportUserProfile(req, res) {
  try {

    let { userId, reason } = req.body;
    const schema = Joi.alternatives(
      Joi.object({
        reason: Joi.string().optional(),
        userId: Joi.number().required(),
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

    userId = parseInt(userId);


    const user = await prisma.user.findUnique({
      where: {
        id: parseInt(userId)
      }
    })

    if (!user) {
      return res.status(400).json({
        status: 200,
        message: 'User Not Found',
        success: true,
      })
    }

    const alreadyReported = await prisma.reportUser.findFirst({
      where: {
        reportedByUserId: req.user.id,
        reportedToUserId: parseInt(userId)
      }
    })
    if (alreadyReported) {
      return res.status(400).json({
        status: 400,
        message: 'Profile Already Reported',
        success: false,
      })
    }

    await prisma.reportUser.create({
      data: {
        reportedByUserId: req.user.id,
        reportedToUserId: parseInt(userId),
        reason: reason
      }
    })

    return res.status(200).json({
      status: 200,
      message: 'Profile Reported Successfully',
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



export async function bankIdLogin(req, res) {
  try {
    console.log("========== BANKID SIGNUP START ==========");
    const { full_name, personalNumber, email, password, username, country, city } = req.body;
    console.log("[BankID Step 1] Request received at /user/bankIdLogin");
    console.log("[BankID Step 2] Request body:", {
      full_name,
      personalNumber,
      email,
      username,
      country,
      city
    });
    const schema = Joi.alternatives(
      Joi.object({
        personalNumber: Joi.string().required(),
        full_name: Joi.string().required(),
        email: Joi.string().required(),
        password: Joi.string().required(),
        username: Joi.string().min(3).max(20).required(),
        fcm_token: Joi.string().optional(),
        country: Joi.string().optional(),
        city: Joi.string().optional(),
      })
    );
    const result = schema.validate(req.body);

    if (result.error) {
      const message = result.error.details.map((i) => i.message).join(",");
      console.log("[BankID Step 3] Validation failed:", message);
      console.log("========== BANKID SIGNUP END ==========");
      return res.status(400).json({
        message: result.error.details[0].message,
        error: message,
        missingParams: result.error.details[0].message,
        status: 400,
        success: false,
      });
    } else {
      console.log("[BankID Step 3] Validation passed");

      console.log("[BankID Step 4] Checking personal number in DB:", personalNumber);
      const userBankId = await prisma.user.findUnique({
        where: {
          personalNumber: personalNumber
        }
      })

      if (userBankId) {
        console.log("[BankID Step 5] Signup blocked: personal number already exists", personalNumber);
        console.log("========== BANKID SIGNUP END ==========");
        return res.status(400).json({
          success: false,
          message: "Ditt personnummer är redan registrerat på Frenly",
          status: 400,
        });
      }
      console.log("[BankID Step 5] Personal number is available");

      console.log("[BankID Step 6] Checking email in DB:", email);
      const userDetails = await prisma.user.findUnique({
        where: {
          email: email
        }
      })
      if (userDetails) {
        console.log("[BankID Step 7] Signup blocked: email already exists", email);
        console.log("========== BANKID SIGNUP END ==========");
        return res.status(400).json({
          success: false,
          message: "Din e-post är redan registrerad på Frenly.",
          status: 400,
        });
      }
      console.log("[BankID Step 7] Email is available");

      console.log("[BankID Step 8] Starting password hash");
      const hashedPassword = await bcrypt.hash(password, 10);
      console.log("[BankID Step 9] Password hashed successfully");

      console.log("[BankID Step 10] Creating user in DB");
      const createdUser = await prisma.user.create({
        data: {
          email: email,
          password: hashedPassword,
          full_name: full_name,
          handle: username,
          personalNumber: personalNumber,
          country: country || null,
          city: city || null,
          isVerified: true,
          act_token: null
        }
      });
      console.log("[BankID Step 11] User created successfully:", {
        id: createdUser.id,
        email: createdUser.email,
        personalNumber: createdUser.personalNumber
      });

      console.log("[BankID Step 12] Sending welcome mail to:", email);
      try {
        const info = await transporter.sendMail({
          from: '"Frenly" <no-reply@frenly.se>',
          to: email,
          subject: 'Welcome to Frenly',
          text: 'Your account has been successfully created and verified.\nWelcome to Frenly!',
          html: '<p>Your account has been successfully created and verified.</p><p>Welcome to Frenly!</p>',
        });
        console.log("[BankID Step 13] Welcome mail transporter response:", {
          messageId: info?.messageId,
          accepted: info?.accepted,
          rejected: info?.rejected,
          response: info?.response,
        });
      } catch (mailError) {
        console.error("[BankID Step 13] Welcome mail send error:", mailError);
      }

      console.log("[BankID Step 14] Sending success response to frontend");
      console.log("========== BANKID SIGNUP END ==========");

      return res.status(200).json({
        success: true,
        message: "BankID account created successfully",
        status: 200,
      });
    }
  } catch (error) {
    console.log("[BankID Fatal Error]:", error);
    console.log("========== BANKID SIGNUP END ==========");
    return res.status(500).json({
      success: false,
      message: "An internal server error occurred. Please try again later.",
      status: 500,
      error: error,
    });
  }
}

export async function checkBankIdUser(req, res) {
  try {
    const { personalNumber } = req.body;
    const schema = Joi.alternatives(
      Joi.object({
        personalNumber: Joi.string().required(),
      })
    );
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
    } else {
      const user = await prisma.user.findUnique({
        where: {
          personalNumber: personalNumber
        }
      })

      if (user) {
        return res.json({
          status: 200,
          success: false,
          message: "Ditt personnummer är redan registrerat på Frenly",
        });
      }
      else {
        return res.json({
          status: 200,
          success: true,
          message: "Start Process",
        });
      }

    }
  } catch (error) {
    console.log("BankID personal number check error:", error);
    return res.status(500).json({
      success: false,
      message: "An internal server error occurred. Please try again later.",
      status: 500,
      error: error,
    });
  }
}


async function generateUniqueHandle(full_name) {
  let baseHandle = full_name.toLowerCase().split(" ");
  let firstName = baseHandle[0];
  let lastInitial = baseHandle[1] ? baseHandle[1][0] : "";
  let handle = `${firstName}${lastInitial}`;
  let uniqueHandle = handle;
  let counter = 1;

  while (true) {
    const existingUser = await prisma.user.findFirst({
      where: { handle: uniqueHandle }
    });

    if (!existingUser) break;
    uniqueHandle = `${handle}${counter}`;
    counter++;
  }

  return uniqueHandle;
}

export async function getToggleStatus(req, res) {
  try {
    const admin = await prisma.admin.findUnique({
      where: {
        id: 1
      },
      select: {
        bankIdToggle: true
      }
    });

    res.status(200).json({
      success: true,
      status: 200,
      message: 'BankId Toggle',
      admin
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

export async function socialMediaUrl(req, res) {
  res.sendFile(path.join(__dirname, '../view/socialMediaUrl.html'));
}

// ------------------------using from facebook ------------------------------------------------------------//
export async function connected_account(req, res) {
  const appId = 785794310667998;
  const redirectUri = "https://www.frenly.se:4000/user/auth/instagram/callback";


  // For Instagram Graph API we use "instagram_basic" + "pages_show_list" + "pages_read_engagement"
  const scopes = [
    "instagram_basic",
    "pages_show_list",
    "pages_read_engagement",
    "business_management"
  ].join(",");

  const oauthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code`;

  return res.status(200).json({
    success: true,
    url: oauthUrl,
  });
};

// Step 2: Handle callback & exchange code for token
export async function instagram_callback(req, res) {
  const appId = 785794310667998;
  const META_APP_SECRET = "03fd727e0c41a15461d8f1ab10c32c8f"
  const { code } = req.query;
  console.log('req.query', req.query);

  if (!code) return res.status(400).json({ error: "Authorization code missing" });

  const redirectUri = "https://www.frenly.se:4000/user/auth/instagram/callback";
  // Exchange code for access token
  const tokenResponse = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`);

  const tokenData = await tokenResponse.json();
  if (tokenData.error) return res.status(400).json(tokenData);

  const userAccessToken = tokenData.access_token;
  console.log('userAccessToken', userAccessToken);

  // Step 3: Get Facebook User (and linked Pages)
  const meResponse = await fetch(`https://graph.facebook.com/me/accounts?access_token=${userAccessToken}`);
  const pages = await meResponse.json();

  // Step 4: For each page, check if Instagram Business account is linked
  let igAccounts = [];
  for (const page of pages.data || []) {
    const igResponse = await fetch(`https://graph.facebook.com/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`);
    const igData = await igResponse.json();
    if (igData.instagram_business_account) {
      igAccounts.push({
        page_id: page.id,
        page_name: page.name,
        instagram_id: igData.instagram_business_account.id
      });
    }
  }
  console.log('igAccounts', igAccounts);

  return res.json({
    success: true,
    access_token: userAccessToken,
    instagram_accounts: igAccounts
  });


};

export async function deauthorize(req, res) {
  console.log("Deauthorize called:", req.body);
  res.status(200).send("User deauthorized");
};

// Step 2: Handle callback & exchange code for token
export async function deleteddd(req, res) {
  console.log("Delete request:", req.body);

  const response = {
    url: "https://www.frenly.se/support/data-deletion", // user ko data deletion info dene ka page
    confirmation_code: req.body.user_id || "sample_confirmation_code"
  };

  res.status(200).json(response);

};


// GET /api/ig/media?pageId=180343398505184&igId=17841464470656478
// export async function fetchUsersInstaFeed(req, res) {
//   try {
//     // In prod, instead of query, fetch from DB by logged-in user mapping
//     const { pageAccessToken, igId } = req.query; // OR load from DB

//     if (!pageAccessToken || !igId) return res.status(400).json({ success: false, msg: 'missing params' });

//     const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username';
//     const mediaResp = await axios.get(`https://graph.facebook.com/v18.0/${igId}/media`, {
//       params: { fields, access_token: pageAccessToken, limit: 25 }
//     });

//     const media = mediaResp.data.data;

//     // handle carousel children if you want full urls
//     const fullMedia = [];
//     for (const item of media) {
//       if (item.media_type === 'CAROUSEL_ALBUM') {
//         const children = await axios.get(`https://graph.facebook.com/v18.0/${item.id}`, {
//           params: { fields: 'children{media_type,media_url,thumbnail_url}', access_token: pageAccessToken }
//         });
//         item.children = children.data.children?.data || [];
//       }
//       fullMedia.push(item);
//     }

//     return res.json({ success: true, media: fullMedia, paging: mediaResp.data.paging });
//   } catch (err) {
//     console.error(err.response?.data || err.message);
//     res.status(500).json({ success: false, error: err.response?.data || err.message });
//   }
// };


// ---------------------------------------------------for instgram ----------------------------------------------//


// // Step 1: Generate Auth URL
// export async function connected_account(req, res) {
//   const INSTAGRAM_APP_ID = "3317796871703789"; // apna Basic Display App ID
//   const REDIRECT_URI = "https://www.frenly.se:4000/user/auth/instagram/callback";

//   const authUrl = `https://api.instagram.com/oauth/authorize?client_id=${INSTAGRAM_APP_ID}&redirect_uri=${encodeURIComponent(
//     REDIRECT_URI
//   )}&scope=user_profile,user_media&response_type=code`;

//   return res.status(200).json({
//     success: true,
//     url: authUrl,
//   });
// }

// // Step 2: Handle callback & exchange code for token
// export async function instagram_callback(req, res) {
//   const INSTAGRAM_APP_ID = "3317796871703789";
//   const INSTAGRAM_APP_SECRET = "a3273fa0f946a87a23f1f306ed914cce";
//   const REDIRECT_URI = "https://www.frenly.se:4000/user/auth/instagram/callback";

//   const { code } = req.query;
//   if (!code) return res.status(400).json({ error: "Code missing" });

//   try {
//     // Exchange code -> short-lived token
//     const tokenRes = await fetch("https://api.instagram.com/oauth/access_token", {
//       method: "POST",
//       headers: { "Content-Type": "application/x-www-form-urlencoded" },
//       body: new URLSearchParams({
//         client_id: INSTAGRAM_APP_ID,
//         client_secret: INSTAGRAM_APP_SECRET,
//         grant_type: "authorization_code",
//         redirect_uri: REDIRECT_URI,
//         code,
//       }),
//     });

//     const tokenData = await tokenRes.json();
//     if (!tokenData.access_token) {
//       return res.status(400).json({ error: tokenData });
//     }

//     const shortToken = tokenData.access_token;

//     // Exchange short -> long-lived token
//     const longRes = await fetch(
//       `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${INSTAGRAM_APP_SECRET}&access_token=${shortToken}`
//     );
//     const longData = await longRes.json();

//     if (!longData.access_token) {
//       return res.status(400).json({ error: longData });
//     }

//     const longToken = longData.access_token;

//     return res.json({
//       success: true,
//       message: "Token generated successfully",
//       access_token: longToken,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Callback error", details: err.message });
//   }
// }

// // Step 3: Fetch user's Instagram Feed
// export async function fetchUsersInstaFeed(req, res) {
//   try {
//     let { access_token } = req.query;

//     const mediaRes = await fetch(
//       `https://graph.instagram.com/me/media?fields=id,caption,media_url,permalink,timestamp&access_token=${access_token}`
//     );
//     const media = await mediaRes.json();

//     return res.json(media);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: "Feed fetch error" });
//   }
// }



export async function fetchUsersInstaFeed(req, res) {
  try {
    // Expecting query params: ?accessToken=...&instagramId=...
    const { accessToken, instagramId } = req.query;
    console.log('req.query', req.query);

    if (!accessToken || !instagramId) {
      return res.status(400).json({ success: false, msg: "missing params" });
    }

    // Fields to fetch
    const fields = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,username";

    // Fetch media for instagramId
    const mediaResp = await axios.get(
      `https://graph.facebook.com/v18.0/${instagramId}/media`,
      {
        params: { fields, access_token: accessToken, limit: 25 },
      }
    );

    const media = mediaResp.data.data;

    // Handle carousel children (albums with multiple images/videos)
    const fullMedia = [];
    for (const item of media) {
      if (item.media_type === "CAROUSEL_ALBUM") {
        const children = await axios.get(
          `https://graph.facebook.com/v18.0/${item.id}`,
          {
            params: {
              fields: "children{media_type,media_url,thumbnail_url}",
              access_token: accessToken,
            },
          }
        );
        item.children = children.data.children?.data || [];
      }
      fullMedia.push(item);
    }

    return res.json({
      success: true,
      media: fullMedia,
      paging: mediaResp.data.paging,
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res
      .status(500)
      .json({ success: false, error: err.response?.data || err.message });
  }
}

export async function deleteAccountWeb(req, res) {
  try {
    const { email } = req.body;

    const schema = Joi.alternatives(
      Joi.object({
        email: Joi.string().required(),

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
    const user = await prisma.user.findUnique({
      where: {
        email: email
      }
    })
    if (user) {
      await prisma.user.delete({
        where: {
          email: email
        }
      })
    }

    return res.status(200).json({
      status: 200,
      message: 'Account Delete Successfully',
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
