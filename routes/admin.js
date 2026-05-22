import express from "express";
import { adminAuth } from "../middlewares/adminAuth.js";
import { login, forgotPassword, reportedUserProfiles, reportedBlogProfiles,reportedPostProfiles,reportedVlogProfiles, verifyPassword, editProfile, getMyProfile, getAllVerifiedUser, toggleUserStatus, getdashboard, getAllBlogs, getAllPosts, getAllVlogs, getBlogById, getPostById, getVlogById, deleteBlog, deleteVlog, deletePost, changePassword, passwordChange,sendNotificationToUsersBulk, addTermsAndConditions, getTermsAndConditions, addPrivacyPolicy, getPrivacyPolicy ,changeBankIdToggle  } from "../controllers/adminController.js";
import { upload } from "../middlewares/upload.js";
import { blogUpload } from "../middlewares/blogUpload.js";

export const adminRouter = express.Router();


adminRouter.post("/login", login);

adminRouter.post("/forgotPassword",  forgotPassword);

adminRouter.post("/changePassword",changePassword );

adminRouter.get('/verifyPassword/:token', verifyPassword);

adminRouter.post("/changePassword",changePassword );

adminRouter.post("/resetPassword", adminAuth, passwordChange);

adminRouter.get("/reportedUserProfiles", adminAuth,reportedUserProfiles);

adminRouter.get("/reportedBlogProfiles", adminAuth,reportedBlogProfiles);

adminRouter.get("/reportedPostProfiles",adminAuth, reportedPostProfiles);

adminRouter.get("/reportedVlogProfiles", adminAuth,reportedVlogProfiles);

adminRouter.post('/editProfile', adminAuth, editProfile);

adminRouter.get('/myProfile', adminAuth, getMyProfile);

adminRouter.get('/getAllUser',  getAllVerifiedUser);

adminRouter.put('/toggle-status/:id', toggleUserStatus);                                                                          

adminRouter.get('/getdashboard', adminAuth, getdashboard);

adminRouter.get('/getAllblog',adminAuth,getAllBlogs);

adminRouter.get('/getAllposts', adminAuth, getAllPosts);

adminRouter.get('/getAllvlog',adminAuth, getAllVlogs);

adminRouter.get('/getblog/:blogId', adminAuth, getBlogById);

adminRouter.get('/getpost/:postId', adminAuth, getPostById);

adminRouter.get('/getvlog/:vlogId',adminAuth, getVlogById);

adminRouter.delete('/deleteBlog/:blogId', adminAuth, deleteBlog);

adminRouter.delete('/deleteVlog/:vlogId', adminAuth, deleteVlog);

adminRouter.delete('/deletePost/:postId', adminAuth, deletePost);

adminRouter.post('/sendNotification', adminAuth, sendNotificationToUsersBulk);

adminRouter.post('/addTermsAndConditions', adminAuth, addTermsAndConditions);

adminRouter.get('/getTermsAndConditions', adminAuth, getTermsAndConditions);

adminRouter.post('/addPrivacyPolicy', adminAuth, addPrivacyPolicy);

adminRouter.get('/getPrivacyPolicy', adminAuth, getPrivacyPolicy);

adminRouter.post("/changeBankIdToggle", adminAuth, changeBankIdToggle);







