const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let users = {};
let muteStates = {};
let cameraStates = {};
let screenShareStates = {};
let roomStartTimes = {};   // 🔥 NEW

io.on("connection", (socket) => {

    socket.on("join-room", (roomId, username) => {

        socket.join(roomId);

        users[socket.id] = {
            roomId,
            username: username || "Guest"
        };

        // Default states
        muteStates[socket.id] = false;
        cameraStates[socket.id] = true;
        screenShareStates[socket.id] = false;

        // 🔥 Set room start time only once (first person who starts room)
        if (!roomStartTimes[roomId]) {
            roomStartTimes[roomId] = Date.now();
        }

        console.log(`${username} joined room ${roomId}`);

        // 🔥 Send room start time to current user
        io.to(socket.id).emit("room-start-time", roomStartTimes[roomId]);

        // 🔥 Send existing users to new joiner
        const existingUsers = [];
        Object.keys(users).forEach((id) => {
            if (id !== socket.id && users[id].roomId === roomId) {
                existingUsers.push({
                    userId: id,
                    username: users[id].username
                });
            }
        });
        io.to(socket.id).emit("existing-users", existingUsers);

        // Notify others
        socket.to(roomId).emit("user-connected", socket.id, username);

        // 🔥 SEND EXISTING MUTE STATES
        Object.keys(muteStates).forEach((id) => {
            if (id !== socket.id && users[id] && users[id].roomId === roomId) {
                io.to(socket.id).emit("mute-status", id, muteStates[id]);
            }
        });

        // 🔥 SEND EXISTING CAMERA STATES
        Object.keys(cameraStates).forEach((id) => {
            if (id !== socket.id && users[id] && users[id].roomId === roomId) {
                io.to(socket.id).emit("camera-status", id, cameraStates[id]);
            }
        });

        // 🔥 SEND EXISTING SCREEN SHARE STATES
        Object.keys(screenShareStates).forEach((id) => {
            if (id !== socket.id && users[id] && users[id].roomId === roomId) {
                io.to(socket.id).emit("screen-share-status", id, screenShareStates[id]);
            }
        });

        // ================= SIGNALING =================

        socket.on("offer", (offer, targetId) => {
            const user = users[socket.id];
            if (!user) return;

            io.to(targetId).emit(
                "offer",
                offer,
                socket.id,
                user.username
            );
        });

        socket.on("answer", (answer, targetId) => {
            io.to(targetId).emit("answer", answer, socket.id);
        });

        socket.on("ice-candidate", (candidate, targetId) => {
            io.to(targetId).emit("ice-candidate", candidate, socket.id);
        });

        // ================= GROUP CHAT =================

        socket.on("chat-message", (message) => {
            const user = users[socket.id];
            if (!user) return;

            io.to(user.roomId).emit(
                "chat-message",
                message,
                user.username
            );
        });

        // ================= PRIVATE CHAT =================

        socket.on("private-message", ({ targetId, message }) => {
            const sender = users[socket.id];
            const receiver = users[targetId];

            if (!sender || !receiver) return;

            // only allow private chat inside same room
            if (sender.roomId !== receiver.roomId) return;

            io.to(targetId).emit(
                "private-message",
                sender.username,
                message
            );
        });

        // ================= MUTE =================

        socket.on("mute-status", (isMuted) => {

            const user = users[socket.id];
            if (!user) return;

            muteStates[socket.id] = isMuted;

            socket.to(user.roomId).emit(
                "mute-status",
                socket.id,
                isMuted
            );
        });

        // ================= CAMERA =================

        socket.on("camera-status", (isOn) => {

            const user = users[socket.id];
            if (!user) return;

            cameraStates[socket.id] = isOn;

            socket.to(user.roomId).emit(
                "camera-status",
                socket.id,
                isOn
            );
        });

        // ================= SCREEN SHARE =================

        socket.on("screen-share-status", (isSharing) => {

            const user = users[socket.id];
            if (!user) return;

            screenShareStates[socket.id] = isSharing;

            socket.to(user.roomId).emit(
                "screen-share-status",
                socket.id,
                isSharing
            );
        });

        // ================= DISCONNECT =================

        socket.on("disconnect", () => {

            const user = users[socket.id];
            if (!user) return;

            const roomId = user.roomId;

            socket.to(roomId).emit("user-disconnected", socket.id);

            delete users[socket.id];
            delete muteStates[socket.id];
            delete cameraStates[socket.id];
            delete screenShareStates[socket.id];

            // 🔥 clear room start time if room becomes empty
            const roomStillHasUsers = Object.values(users).some(
                (u) => u.roomId === roomId
            );

            if (!roomStillHasUsers) {
                delete roomStartTimes[roomId];
            }
        });
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Server running on port " + PORT);
});