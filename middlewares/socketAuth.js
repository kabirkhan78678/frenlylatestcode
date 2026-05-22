// utils/socketAuth.js
import jwt from "jsonwebtoken";

export function socketAuth(socket, next) {
    try {
        const authHeader = socket.handshake.headers?.authorization || "";
        const tokenFromHeader = authHeader.startsWith("Bearer ")
            ? authHeader.replace("Bearer ", "")
            : authHeader || null;
        const tokenFromAuth = socket.handshake.auth?.token || null;
        const tokenFromQuery = socket.handshake.query?.token || null;

        const token = tokenFromHeader || tokenFromAuth || tokenFromQuery;
        if (!token) {
            const err = new Error("unauthorized: token missing");
            err.data = { content: "Please provide token" };
            return next(err);
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.SECRET_KEY);
        } catch (e) {
            const err = new Error("unauthorized: invalid token");
            err.data = { content: "Invalid token" };
            return next(err);
        }

        socket.authUserId = Number(decoded.userId);
        return next();
    } catch (err) {
        return next(err);
    }
}
