import express from "express";
import { auth } from "../middlewares/auth.js";
import { vlogUpload } from "../middlewares/vlogUpload.js";
import { commentOnVlog, createVlog, deleteComment, deleteVlog, editVlog, getAllVlogs, getCommentsOnVlog, getMySavedVlogs, getVlogById, likeOrUnlikeVlog, saveOrUnSaveVlog, viewVlog, likeOrUnlikeVlogComment, reportVlog, shareVlog } from "../controllers/vlogController.js";

export const vlogRouter = express.Router();


vlogRouter.post('/', auth, vlogUpload.single("video"), createVlog);

vlogRouter.patch('/', auth, vlogUpload.single("video"), editVlog);

vlogRouter.get('/', auth, getAllVlogs);

vlogRouter.post('/react/:vlogId', auth, likeOrUnlikeVlog);

vlogRouter.post('/comment/:vlogId', auth, commentOnVlog);

vlogRouter.delete('/:vlogId/comment/:id', auth, deleteComment);

vlogRouter.get('/comment/:vlogId', auth, getCommentsOnVlog);

vlogRouter.post('/react/comment/:CommentVlogId', auth, likeOrUnlikeVlogComment);

vlogRouter.post('/save/:vlogId', auth, saveOrUnSaveVlog);

vlogRouter.post('/view/:vlogId', auth, viewVlog);

vlogRouter.get('/saved', auth, getMySavedVlogs);

vlogRouter.get('/:vlogId', auth, getVlogById);

vlogRouter.delete('/:vlogId', auth, deleteVlog);

vlogRouter.post('/reportVlog', auth, reportVlog);

vlogRouter.post('/share/:vlogId', auth, shareVlog);
