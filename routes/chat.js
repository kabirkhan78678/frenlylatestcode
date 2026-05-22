import express from "express";
import { auth } from "../middlewares/auth.js";
import { activateDeactivateChat, createOrGetAOneOnOneChat, deleteChat, getAllChats, createMessageREST, markChatMessagesAsSeen, } from "../controllers/chatController.js";

export const chatRouter = express.Router();




chatRouter.get('/', auth, getAllChats);

chatRouter.post('/chatStatus', auth, activateDeactivateChat);

chatRouter.post('/:receiverId', auth, createOrGetAOneOnOneChat);

chatRouter.delete('/:chatId', auth, deleteChat)

// create message via REST
chatRouter.post("/:chatId/message", auth, createMessageREST);

// mark messages as seen (REST)
chatRouter.post("/mark-seen", auth, markChatMessagesAsSeen);




