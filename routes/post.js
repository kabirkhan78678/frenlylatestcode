import express from "express";
import { auth } from "../middlewares/auth.js";
import { postUpload } from "../middlewares/postUpload.js";
import { commentOnPost, createPost, deleteComment, deletePost, editPost, getAllPosts, getCommentsOnPost, getMySavedPosts, getPostById, likeOrUnlikePost, saveOrUnSavePost, sharePost,likeOrUnlikePostComment, reportPost} from "../controllers/postController.js";

export const postRouter = express.Router();


postRouter.post('/', auth, postUpload.single("image"), createPost);

postRouter.patch('/', auth, postUpload.single("image"), editPost);

postRouter.get('/', auth, getAllPosts);

postRouter.post('/comment/:postId', auth, commentOnPost);

postRouter.delete('/:postId/comment/:id', auth, deleteComment);

postRouter.get('/comment/:postId', auth, getCommentsOnPost);

postRouter.post('/react/comment/:CommentPostId',auth, likeOrUnlikePostComment);

postRouter.post('/save/:postId', auth, saveOrUnSavePost);

postRouter.get('/saved', auth, getMySavedPosts);

postRouter.get('/:postId', auth, getPostById);

postRouter.delete('/:postId', auth, deletePost);

postRouter.post('/react/:postId', auth, likeOrUnlikePost);

postRouter.post('/share/:postId', auth, sharePost);

postRouter.post('/reportPost',auth,reportPost);