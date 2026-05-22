import express from "express";
import { auth } from "../middlewares/auth.js";
import { deleteNotification, getFollowRequests, getMyNotifications, markAllRead, markAsRead ,deleteAllNotification} from "../controllers/notificationController.js";


export const notificationRouter = express.Router();


notificationRouter.get('/', auth, getMyNotifications);

notificationRouter.put('/', auth, markAllRead);

notificationRouter.patch('/:id', auth, markAsRead);

notificationRouter.delete('/deleteAll',auth,deleteAllNotification);

notificationRouter.delete('/:notificationId', auth, deleteNotification);

notificationRouter.get('/followRequests', auth, getFollowRequests)


