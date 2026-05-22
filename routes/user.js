import express from "express";
import { checkBankIdUser, acceptFollowRequest, addCategory, bankIdLogin, blockUser, changePassword, checkIn, checkUsernameAvailability, deleteAccount, deleteCategory, editProfile, follow, forgotPassword, getAllUsers, getLastSeen, getMyBlockedUser, getMyCategories, getMyFollowers, getMyProfile, getMySavedUsers, getMySettings, getUser, getUserFollowers, getUserFollowings, getUserWhomIFollow, login, offlineStatus, onlineStatus, reportUserProfile, saveOrUnSaveProfile, signup, terms, unBlockUser, unFollow, updateMySettings, updateProfileVisibility, verifyPassword, verifyUserEmail, getToggleStatus, socialMediaUrl, instagram_callback, connected_account, deleteddd, deauthorize, fetchUsersInstaFeed, deleteAccountWeb, resetPassword } from "../controllers/userController.js";
import { upload } from "../middlewares/upload.js";
import { auth } from "../middlewares/auth.js";

export const userRouter = express.Router();

userRouter.post('/signup', signup);

userRouter.get('/verifyUser/:id', verifyUserEmail)

userRouter.post('/login', login);

userRouter.post('/forgotPassword', forgotPassword);

userRouter.get('/verifyPassword/:token', verifyPassword);

userRouter.post('/changePassword', changePassword);

userRouter.post('/resetPassword', auth, resetPassword);

userRouter.post('/editProfile', auth, upload.fields([{ name: 'avatar', maxCount: 1 }, { name: 'cover', maxCount: 1 }]), editProfile)

userRouter.get('/', auth, getAllUsers);

userRouter.post('/block/:id', auth, blockUser);

userRouter.post('/follow/:id', auth, follow);

userRouter.post('/unfollow/:id', auth, unFollow);

userRouter.get('/followers', auth, getMyFollowers);

userRouter.get('/followings', auth, getUserWhomIFollow);

userRouter.post('/save/:userId', auth, saveOrUnSaveProfile);

userRouter.get('/saved', auth, getMySavedUsers);

userRouter.get('/blocked', auth, getMyBlockedUser);

userRouter.delete('/', auth, deleteAccount);

userRouter.get('/myProfile', auth, getMyProfile);

userRouter.get('/settings', auth, getMySettings);

userRouter.patch('/settings', auth, updateMySettings);

userRouter.post('/addCategory', auth, addCategory);

userRouter.post("/checkUsername", checkUsernameAvailability);

userRouter.post('/checkIn', auth, checkIn);

userRouter.get('/getCategories', auth, getMyCategories);

userRouter.delete('/category/:id', auth, deleteCategory);

userRouter.post('/online', auth, onlineStatus);

userRouter.post('/offline', auth, offlineStatus);

userRouter.get("/getLastSeen/:userId", auth, getLastSeen);

userRouter.delete('/unblock/:id', auth, unBlockUser);

userRouter.get('/terms', terms);

userRouter.get('/getToggleStatus', getToggleStatus);

userRouter.get('/socialMediaUrl', socialMediaUrl);

userRouter.get('/:userId', auth, getUser);

userRouter.post('/acceptFollowRequest', acceptFollowRequest);

userRouter.patch('/updateProfileVisibilty', auth, updateProfileVisibility);

userRouter.get('/getUserFollowers/:userId', auth, getUserFollowers);

userRouter.get('/getUserFollowings/:userId', auth, getUserFollowings);

userRouter.post('/reportProfile', auth, reportUserProfile);

userRouter.post('/bankIdLogin', bankIdLogin);

userRouter.post('/checkBankId', checkBankIdUser);


userRouter.post("/deleteAccountWeb", deleteAccountWeb);


// ----------------------testing------------------------karan developer sync meta instagram-----------------//

userRouter.get('/auth/instagram', connected_account);
userRouter.get("/auth/instagram/callback", instagram_callback);
userRouter.get('/auth/instagram/deauthorize', deauthorize);
userRouter.get("/auth/instagram/delete", deleteddd);

userRouter.get("/ig/media", fetchUsersInstaFeed);


