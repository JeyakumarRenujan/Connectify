const socket = io();
const videoGrid = document.getElementById("video-grid");
const roomId = new URLSearchParams(window.location.search).get("room");
const username = localStorage.getItem("username");

document.getElementById("room-display").innerText = "Room: " + roomId;

let localStream;
let peers = {};
let participantCount = 1;
let userNames = {};
let localMuteStates = {};
let localCameraStates = {};
let focusedId = null;   // 🔥 focus state

/* ================= CUSTOM MIRRORED PIP VARIABLES ================= */
let pipCanvas = null;
let pipContext = null;
let pipVideo = null;
let pipAnimationFrame = null;
let pipStream = null;
/* ================================================================ */

/* ================= SCREEN SHARE VARIABLES ================= */
let isScreenSharing = false;
let cameraTrack = null;
let screenTrack = null;
let screenShareStream = null;
/* ========================================================= */

const configuration = {
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        }
    ]
};

async function init() {

    localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        }
    });

    cameraTrack = localStream.getVideoTracks()[0];

    addVideoStream(localStream, "local", username);
    updateParticipantCount();

    socket.emit("join-room", roomId, username);

    document.getElementById("chat-message")
        .addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                sendMessage();
            }
        });

    socket.on("user-connected", (userId, remoteName) => {
        userNames[userId] = remoteName;
        connectToNewUser(userId);
    });

    socket.on("offer", async (offer, userId, remoteName) => {

        userNames[userId] = remoteName;

        const peer = createPeerConnection(userId);

        await peer.setRemoteDescription(new RTCSessionDescription(offer));

        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);

        socket.emit("answer", answer, userId);
    });

    socket.on("answer", async (answer, userId) => {
        if (peers[userId]) {
            await peers[userId].setRemoteDescription(
                new RTCSessionDescription(answer)
            );
        }
    });

    socket.on("ice-candidate", (candidate, userId) => {
        if (peers[userId]) {
            peers[userId].addIceCandidate(
                new RTCIceCandidate(candidate)
            );
        }
    });

    socket.on("chat-message", (message, sender) => {
        addMessage(sender, message);
    });

    socket.on("mute-status", (userId, isMuted) => {
        localMuteStates[userId] = isMuted;
        const icon = document.getElementById("mute-" + userId);
        if (icon) icon.style.display = isMuted ? "block" : "none";
    });

    socket.on("camera-status", (userId, isOn) => {

        localCameraStates[userId] = isOn;

        const container = document.getElementById("container-" + userId);
        if (!container) return;

        const video = document.getElementById(userId);
        let avatar = document.getElementById("avatar-" + userId);

        if (!isOn) {

            if (!avatar) {
                avatar = document.createElement("div");
                avatar.classList.add("avatar");
                avatar.id = "avatar-" + userId;
                avatar.innerText =
                    (userNames[userId]?.charAt(0).toUpperCase()) || "?";
                container.appendChild(avatar);
            }

            if (video) video.style.display = "none";

        } else {

            if (video) video.style.display = "block";
            if (avatar) avatar.remove();
        }
    });

    socket.on("user-disconnected", (userId) => {

        if (peers[userId]) {
            peers[userId].close();
            delete peers[userId];
        }

        const container = document.getElementById("container-" + userId);
        if (container) container.remove();

        delete userNames[userId];
        delete localMuteStates[userId];
        delete localCameraStates[userId];

        updateParticipantCount();

        if (focusedId === userId) {
            removeFocusMode();
        }
    });
}

function createPeerConnection(userId) {

    const peer = new RTCPeerConnection(configuration);

    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });

    peer.ontrack = (event) => {

        if (document.getElementById("container-" + userId)) return;

        const remoteName = userNames[userId] || "Participant";
        addVideoStream(event.streams[0], userId, remoteName);
    };

    peer.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit("ice-candidate", event.candidate, userId);
        }
    };

    peers[userId] = peer;
    return peer;
}

async function connectToNewUser(userId) {

    const peer = createPeerConnection(userId);

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);

    socket.emit("offer", offer, userId);
}

function addVideoStream(stream, id, name) {

    if (document.getElementById("container-" + id)) return;

    const container = document.createElement("div");
    container.classList.add("video-container");
    container.id = "container-" + id;

    container.addEventListener("click", () => toggleFocus(id));

    const video = document.createElement("video");
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.id = id;

    // 🔥 FIX: Mute only local video
    if (id === "local") {
        video.muted = true;
    }

    const label = document.createElement("div");
    label.classList.add("video-label");
    label.innerText = id === "local" ? `You (${username})` : name;

    const muteIcon = document.createElement("div");
    muteIcon.classList.add("mute-icon");
    muteIcon.innerText = "🔇";
    muteIcon.id = "mute-" + id;
    muteIcon.style.display = localMuteStates[id] ? "block" : "none";

    container.appendChild(video);
    container.appendChild(label);
    container.appendChild(muteIcon);

    videoGrid.appendChild(container);

    updateParticipantCount();

    // 🔥 VERY IMPORTANT FIX
    // Apply stored camera state AFTER video is added

    if (localCameraStates[id] === false) {

        video.style.display = "none";

        const avatar = document.createElement("div");
        avatar.classList.add("avatar");
        avatar.id = "avatar-" + id;
        avatar.innerText =
            id === "local"
                ? username.charAt(0).toUpperCase()
                : (userNames[id]?.charAt(0).toUpperCase() || "?");

        container.appendChild(avatar);
    }
}

/* ================= FOCUS MODE ================= */

function toggleFocus(id) {

    if (focusedId === id) {
        removeFocusMode();
        return;
    }

    focusedId = id;
    videoGrid.classList.add("focus-mode");

    const allContainers = Array.from(document.querySelectorAll(".video-container"));

    const focusedContainer = document.getElementById("container-" + id);
    if (!focusedContainer) return;

    focusedContainer.classList.add("focused");

    // Move focused video to top
    videoGrid.prepend(focusedContainer);

    // Create bottom row
    let bottomRow = document.querySelector(".bottom-row");
    if (!bottomRow) {
        bottomRow = document.createElement("div");
        bottomRow.classList.add("bottom-row");
        videoGrid.appendChild(bottomRow);
    }

    bottomRow.innerHTML = "";

    allContainers.forEach(container => {
        if (container.id !== "container-" + id) {
            container.classList.remove("focused");
            bottomRow.appendChild(container);
        }
    });
}

function removeFocusMode() {

    focusedId = null;
    videoGrid.classList.remove("focus-mode");

    const bottomRow = document.querySelector(".bottom-row");

    if (bottomRow) {
        const children = Array.from(bottomRow.children);
        children.forEach(child => videoGrid.appendChild(child));
        bottomRow.remove();
    }

    document.querySelectorAll(".video-container").forEach(c => {
        c.classList.remove("focused");
    });
}

/* ================= CHAT ================= */

function sendMessage() {
    const input = document.getElementById("chat-message");
    if (input.value.trim() !== "") {
        socket.emit("chat-message", input.value);
        input.value = "";
    }
}

function addMessage(sender, message) {

    const messages = document.getElementById("messages");

    const div = document.createElement("div");
    div.classList.add("chat-bubble");

    div.innerHTML = `<strong>${sender}</strong><br>${message}`;

    messages.appendChild(div);
    messages.scrollTop = messages.scrollHeight;
}

/* ================= MEDIA CONTROLS ================= */

function toggleMute() {

    const audioTrack = localStream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;

    const isMuted = !audioTrack.enabled;
    localMuteStates["local"] = isMuted;

    const icon = document.getElementById("mute-local");
    if (icon) icon.style.display = isMuted ? "block" : "none";

    socket.emit("mute-status", isMuted);
}

function toggleVideo() {

    const videoTrack = localStream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;

    const isOn = videoTrack.enabled;

    localCameraStates["local"] = isOn;

    const container = document.getElementById("container-local");
    const video = document.getElementById("local");
    let avatar = document.getElementById("avatar-local");

    if (!isOn) {

        // 🔥 Hide video
        if (video) video.style.display = "none";

        // 🔥 Show avatar if not exists
        if (!avatar) {
            avatar = document.createElement("div");
            avatar.classList.add("avatar");
            avatar.id = "avatar-local";
            avatar.innerText = username.charAt(0).toUpperCase();
            container.appendChild(avatar);
        }

    } else {

        // 🔥 Show video again
        if (video) video.style.display = "block";

        // 🔥 Remove avatar
        if (avatar) avatar.remove();
    }

    // 🔥 Inform others
    socket.emit("camera-status", isOn);
}

/* ================= SCREEN SHARE ================= */

async function toggleScreenShare() {
    if (isScreenSharing) {
        await stopScreenShare();
    } else {
        await startScreenShare();
    }
}

async function startScreenShare() {
    try {
        screenShareStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        });

        screenTrack = screenShareStream.getVideoTracks()[0];
        if (!screenTrack) return;

        const oldTrack = localStream.getVideoTracks()[0];

        localStream.removeTrack(oldTrack);
        localStream.addTrack(screenTrack);

        replaceVideoTrackForAllPeers(screenTrack);

        const localVideo = document.getElementById("local");
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.style.transform = "none";
        }

        showPresentingState();

        isScreenSharing = true;

        const btn = document.getElementById("screen-share-btn");
        if (btn) btn.innerText = "⛔";

        screenTrack.onended = async () => {
            if (isScreenSharing) {
                await stopScreenShare();
            }
        };
    } catch (error) {
        console.error("Screen share error:", error);
        alert("Screen sharing failed or was cancelled");
    }
}

async function stopScreenShare() {
    try {
        if (!cameraTrack || !screenTrack) return;

        const currentTrack = localStream.getVideoTracks()[0];

        if (currentTrack) {
            localStream.removeTrack(currentTrack);
        }

        localStream.addTrack(cameraTrack);

        replaceVideoTrackForAllPeers(cameraTrack);

        const localVideo = document.getElementById("local");
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.style.transform = "scaleX(-1)";
        }

        hidePresentingState();

        if (screenTrack) {
            screenTrack.stop();
        }

        if (screenShareStream) {
            screenShareStream.getTracks().forEach(track => track.stop());
        }

        screenTrack = null;
        screenShareStream = null;
        isScreenSharing = false;

        const btn = document.getElementById("screen-share-btn");
        if (btn) btn.innerText = "🖥️";
    } catch (error) {
        console.error("Stop screen share error:", error);
    }
}

function replaceVideoTrackForAllPeers(newTrack) {
    Object.values(peers).forEach(peer => {
        const sender = peer.getSenders().find(s =>
            s.track && s.track.kind === "video"
        );

        if (sender) {
            sender.replaceTrack(newTrack);
        }
    });
}

function showPresentingState() {
    const container = document.getElementById("container-local");
    const video = document.getElementById("local");

    if (!container) return;

    if (video) {
        video.style.display = "none";
    }

    let presentingBadge = document.getElementById("presenting-local");

    if (!presentingBadge) {
        presentingBadge = document.createElement("div");
        presentingBadge.classList.add("presenting-badge");
        presentingBadge.id = "presenting-local";
        presentingBadge.innerHTML = `
            <div class="presenting-icon">🖥️</div>
            <div class="presenting-text">You are presenting</div>
        `;
        container.appendChild(presentingBadge);
    }
}

function hidePresentingState() {
    const video = document.getElementById("local");
    const presentingBadge = document.getElementById("presenting-local");

    if (video) {
        video.style.display = "block";
    }

    if (presentingBadge) {
        presentingBadge.remove();
    }
}

/* =============================================== */

function toggleChat() {
    const chat = document.getElementById("chat-panel");
    chat.classList.toggle("hidden");
}

function updateParticipantCount() {
    const counter = document.getElementById("participant-count");
    participantCount = document.querySelectorAll(".video-container").length;
    if (counter) {
        counter.innerText = "Participants: " + participantCount;
    }
}

/* ================= CUSTOM MIRRORED PIP ================= */

async function startMirroredPiP() {
    const localVideo = document.getElementById("local");

    if (!localVideo) {
        alert("Local video not found");
        return;
    }

    if (!localVideo.srcObject) {
        alert("Local video stream not ready");
        return;
    }

    if (!pipCanvas) {
        pipCanvas = document.createElement("canvas");
        pipContext = pipCanvas.getContext("2d");
    }

    if (!pipVideo) {
        pipVideo = document.createElement("video");
        pipVideo.autoplay = true;
        pipVideo.muted = true;
        pipVideo.playsInline = true;
        pipVideo.style.position = "fixed";
        pipVideo.style.left = "-9999px";
        pipVideo.style.width = "1px";
        pipVideo.style.height = "1px";
        pipVideo.style.opacity = "0";
        document.body.appendChild(pipVideo);
    }

    const width = localVideo.videoWidth || 640;
    const height = localVideo.videoHeight || 480;

    pipCanvas.width = width;
    pipCanvas.height = height;

    function drawMirroredFrame() {
        if (!localVideo.srcObject) return;

        pipContext.clearRect(0, 0, width, height);
        pipContext.save();
        pipContext.translate(width, 0);
        pipContext.scale(-1, 1);
        pipContext.drawImage(localVideo, 0, 0, width, height);
        pipContext.restore();

        pipAnimationFrame = requestAnimationFrame(drawMirroredFrame);
    }

    if (pipAnimationFrame) {
        cancelAnimationFrame(pipAnimationFrame);
    }

    drawMirroredFrame();

    if (pipStream) {
        pipStream.getTracks().forEach(track => track.stop());
    }

    pipStream = pipCanvas.captureStream(25);
    pipVideo.srcObject = pipStream;

    await pipVideo.play();

    if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
    }

    await pipVideo.requestPictureInPicture();
}

async function stopMirroredPiP() {
    if (document.pictureInPictureElement) {
        try {
            await document.exitPictureInPicture();
        } catch (error) {
            console.log("PiP exit error:", error);
        }
    }

    if (pipAnimationFrame) {
        cancelAnimationFrame(pipAnimationFrame);
        pipAnimationFrame = null;
    }

    if (pipStream) {
        pipStream.getTracks().forEach(track => track.stop());
        pipStream = null;
    }
}

async function toggleMirroredPiP() {
    try {
        if (document.pictureInPictureElement) {
            await stopMirroredPiP();
        } else {
            await startMirroredPiP();
        }
    } catch (error) {
        console.error("Custom mirrored PiP error:", error);
        alert("Mirrored PiP failed on this browser");
    }
}

document.addEventListener("leavepictureinpicture", () => {
    if (pipAnimationFrame) {
        cancelAnimationFrame(pipAnimationFrame);
        pipAnimationFrame = null;
    }

    if (pipStream) {
        pipStream.getTracks().forEach(track => track.stop());
        pipStream = null;
    }
});

/* ==================================================== */

function endCall() {

    const confirmEnd = confirm("Are you sure you want to leave the meeting?");
    if (!confirmEnd) return;

    stopMirroredPiP();

    if (isScreenSharing) {
        stopScreenShare();
    }

    hidePresentingState();

    localStream.getTracks().forEach(track => track.stop());
    Object.values(peers).forEach(peer => peer.close());

    window.location.href = "/";
}

init();