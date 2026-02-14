const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

let users = {};
let muteStates = {};
let cameraStates = {};   // 🔥 NEW

io.on("connection", (socket) => {

    socket.on("join-room", (roomId, username) => {

        socket.join(roomId);

        users[socket.id] = {
            roomId,
            username: username || "Guest"
        };

        // Default states
        muteStates[socket.id] = false;
        cameraStates[socket.id] = true;  // default camera ON

        console.log(`${username} joined room ${roomId}`);

        // Notify others
        socket.to(roomId).emit("user-connected", socket.id, username);

        // 🔥 SEND EXISTING MUTE STATES
        Object.keys(muteStates).forEach((id) => {
            if (id !== socket.id) {
                io.to(socket.id).emit("mute-status", id, muteStates[id]);
            }
        });

        // 🔥 SEND EXISTING CAMERA STATES
        Object.keys(cameraStates).forEach((id) => {
            if (id !== socket.id) {
                io.to(socket.id).emit("camera-status", id, cameraStates[id]);
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

        // ================= CHAT =================

        socket.on("chat-message", (message) => {
            const user = users[socket.id];
            if (!user) return;

            io.to(user.roomId).emit(
                "chat-message",
                message,
                user.username
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

        // ================= DISCONNECT =================

        socket.on("disconnect", () => {

            const user = users[socket.id];
            if (!user) return;

            socket.to(user.roomId).emit("user-disconnected", socket.id);

            delete users[socket.id];
            delete muteStates[socket.id];
            delete cameraStates[socket.id];
        });
    });
});

server.listen(3000, () => {
    console.log("Server running on http://localhost:3000");
});
