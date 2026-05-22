// routes/message.js
import express from "express";
import { auth } from "../middlewares/auth.js";
import {
    clearChat,
    getAllMessages,
    sendMessage,
} from "../controllers/messageController.js";
import multer from "multer";

export const messageRouter = express.Router();

// Multer config: memory storage (S3 ke liye best)
const upload = multer({
    storage: multer.memoryStorage(),
});

messageRouter.post("/:chatId", auth, (req, res, next) => {
    console.log("message upload content-type:", req.headers["content-type"]);
    console.log("message upload content-length:", req.headers["content-length"]);
    console.log("message upload transfer-encoding:", req.headers["transfer-encoding"]);

    upload.single("file")(req, res, (err) => {
        if (err) {
            console.error("message upload multer error:", err);
            return res.status(400).json({
                status: 400,
                success: false,
                message: "Attachment upload failed",
                error: err.message,
                code: err.code ?? null,
            });
        }

        console.log("message upload parsed body:", req.body);
        console.log(
            "message upload parsed file:",
            req.file
                ? {
                    fieldname: req.file.fieldname,
                    originalname: req.file.originalname,
                    mimetype: req.file.mimetype,
                    size: req.file.size,
                }
                : null
        );

        next();
    });
}, sendMessage);

messageRouter.get("/:chatId", auth, getAllMessages);
messageRouter.delete("/:chatId", auth, clearChat);
