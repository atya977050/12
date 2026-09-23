const socket = io();

const myId =
  localStorage.getItem("alhelbawy_chat_user_id") ||
  crypto.randomUUID();

const myName =
  localStorage.getItem("alhelbawy_chat_name") ||
  "فرج";

localStorage.setItem("alhelbawy_chat_user_id", myId);
localStorage.setItem("alhelbawy_chat_name", myName);

const chatId = "demo";

const messages = document.querySelector("#messages");
const form = document.querySelector("#composer");
const input = document.querySelector("#text");

socket.on("connect", () => {
  document.querySelector("#status").textContent = "متصل";

  socket.emit("user:join", {
    userId: myId,
    name: myName
  });

  socket.emit("chat:history", {
    chatId
  });
});

socket.on("disconnect", () => {
  document.querySelector("#status").textContent = "غير متصل";
});

socket.on("chat:history", ({ messages: history }) => {
  messages.innerHTML = "";

  history.forEach(renderMessage);
});

socket.on("chat:message", (message) => {
  if (message.chatId === chatId) {
    renderMessage(message);
  }
});

socket.on("presence:update", (users) => {
  const other = users.find(
    user => user.userId !== myId
  );

  const online = !!other;

  document.querySelector("#presence").textContent =
    online ? "متصل الآن" : "غير متصل";

  document.querySelector("#chatPresence").textContent =
    online ? "متصل الآن" : "غير متصل";
});

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const text = input.value.trim();

  if (!text) return;

  socket.emit("chat:send", {
    chatId,
    senderId: myId,
    senderName: myName,
    text
  });

  input.value = "";
  input.focus();
});

function renderMessage(message) {
  const element = document.createElement("div");

  element.className =
    "msg" +
    (message.senderId === myId ? " mine" : "");

  element.textContent = message.text;

  const small = document.createElement("small");

  small.textContent =
    `${message.senderName} • ` +
    new Date(message.createdAt).toLocaleTimeString(
      "ar-EG",
      {
        hour: "2-digit",
        minute: "2-digit"
      }
    );

  element.appendChild(small);

  messages.appendChild(element);

  messages.scrollTop = messages.scrollHeight;
}

const fileInput = document.querySelector("#fileInput");
const attachButton = document.querySelector("#attachButton");
const startCamera = document.querySelector("#startCamera");
const recordAudio = document.querySelector("#recordAudio");
const stopRecording = document.querySelector("#stopRecording");
const localPreview = document.querySelector("#localPreview");
const mediaPanel = document.querySelector("#mediaPanel");
const remoteVideo = document.querySelector("#remoteVideo");
const callVideos = document.querySelector("#callVideos");
const callButton = document.querySelector("#callButton");
const endCallButton = document.querySelector("#endCallButton");

let localStream = null;
let peerConnection = null;
let callStarted = false;
let pendingIceCandidates = [];

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function createPeerConnection() {
  if (peerConnection) {
    peerConnection.close();
  }

  peerConnection = new RTCPeerConnection(rtcConfig);

  if (localStream) {
    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;

    if (stream) {
      remoteVideo.srcObject = stream;
      callVideos.classList.add("visible");
      mediaPanel.classList.remove("hidden");
    }
  };

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) return;

    socket.emit("webrtc:ice", {
      chatId,
      candidate: event.candidate
    });
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection.connectionState;

    if (state === "connected") {
      callButton.textContent = "متصل";
      console.log("WEBRTC_CONNECTED");
    }

    if (
      state === "failed" ||
      state === "disconnected" ||
      state === "closed"
    ) {
      callButton.textContent = "📞 بدء المكالمة";
    }
  };

  return peerConnection;
}

async function ensureLocalMedia() {
  if (localStream) return localStream;

  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true
  });

  localPreview.srcObject = localStream;
  callVideos.classList.add("visible");
  mediaPanel.classList.remove("hidden");

  return localStream;
}

async function startCall() {
  try {
    if (!window.isSecureContext) {
      throw new Error("الكاميرا والمكالمات تحتاج اتصال HTTPS آمن");
    }

    await ensureLocalMedia();

    pendingIceCandidates = [];

    createPeerConnection();

    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });

    await peerConnection.setLocalDescription(offer);

    callStarted = true;
    callButton.disabled = true;
    endCallButton.disabled = false;

    socket.emit("call:join", { chatId });

    socket.emit("webrtc:offer", {
      chatId,
      offer: peerConnection.localDescription
    });

    console.log("WEBRTC_OFFER_SENT");
  } catch (error) {
    console.error("WEBRTC_START_ERROR", error);
    alert("تعذر بدء المكالمة: " + error.message);
  }
}

async function endCall() {
  socket.emit("call:end", { chatId });

  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  localPreview.srcObject = null;
  remoteVideo.srcObject = null;
  callVideos.classList.remove("visible");

  callStarted = false;
  callButton.disabled = false;
  endCallButton.disabled = true;
  callButton.textContent = "📞 بدء المكالمة";
}

callButton.addEventListener("click", startCall);
endCallButton.addEventListener("click", endCall);

socket.on("call:peer-joined", async () => {
  if (!callStarted) return;
});

socket.on("webrtc:offer", async ({ offer }) => {
  try {
    if (!offer) return;

    await ensureLocalMedia();

    pendingIceCandidates = [];

    createPeerConnection();

    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(offer)
    );

    await flushPendingIceCandidates();

    const answer = await peerConnection.createAnswer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });

    await peerConnection.setLocalDescription(answer);

    callStarted = true;
    callButton.disabled = true;
    endCallButton.disabled = false;

    socket.emit("webrtc:answer", {
      chatId,
      answer: peerConnection.localDescription
    });

    console.log("WEBRTC_ANSWER_SENT");
  } catch (error) {
    console.error("WEBRTC_OFFER_ERROR", error);
    alert("تعذر استقبال المكالمة: " + error.message);
  }
});

async function flushPendingIceCandidates() {
  if (!peerConnection || !peerConnection.remoteDescription) return;

  const pending = pendingIceCandidates.splice(0);

  for (const candidate of pending) {
    try {
      await peerConnection.addIceCandidate(
        new RTCIceCandidate(candidate)
      );
    } catch (error) {
      console.error("WEBRTC_PENDING_ICE_ERROR", error);
    }
  }
}

socket.on("webrtc:answer", async ({ answer }) => {
  if (!peerConnection || !answer) return;

  try {
    await peerConnection.setRemoteDescription(
      new RTCSessionDescription(answer)
    );

    await flushPendingIceCandidates();
  } catch (error) {
    console.error("WEBRTC_ANSWER_ERROR", error);
  }
});

socket.on("webrtc:ice", async ({ candidate }) => {
  if (!candidate) return;

  if (!peerConnection || !peerConnection.remoteDescription) {
    pendingIceCandidates.push(candidate);
    return;
  }

  try {
    await peerConnection.addIceCandidate(
      new RTCIceCandidate(candidate)
    );
  } catch (error) {
    console.error("WEBRTC_ICE_ERROR", error);
  }
});

socket.on("call:ended", () => {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  pendingIceCandidates = [];
  remoteVideo.srcObject = null;
  callVideos.classList.remove("visible");
  callStarted = false;
  callButton.disabled = false;
  endCallButton.disabled = true;
  callButton.textContent = "📞 بدء المكالمة";
});


let mediaRecorder = null;
let audioChunks = [];

attachButton.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];

  if (!file) return;

  try {
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch("/api/upload", {
      method: "POST",
      body: formData
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || "فشل رفع الملف");
    }

    socket.emit("chat:send", {
      chatId,
      senderId: myId,
      senderName: myName,
      attachment: result.file
    });

    fileInput.value = "";
  } catch (error) {
    alert("تعذر رفع الملف: " + error.message);
  }
});

startCamera.addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("المتصفح لا يدعم الوصول إلى الكاميرا والميكروفون");
    }

    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true
    });

    localPreview.srcObject = localStream;
    localPreview.muted = true;
    localPreview.autoplay = true;
    localPreview.playsInline = true;

    callVideos.classList.add("visible");
    mediaPanel.classList.remove("hidden");

    console.log("CAMERA_STARTED");
  } catch (error) {
    console.error("CAMERA_ERROR", error);
    alert("تعذر تشغيل الكاميرا والميكروفون: " + error.message);
  }
});

recordAudio.addEventListener("click", async () => {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("المتصفح لا يدعم تسجيل الصوت");
    }

    if (!window.MediaRecorder) {
      throw new Error("المتصفح لا يدعم تسجيل الصوت");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    audioChunks = [];

    const mimeTypes = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4"
    ];

    const supportedType =
      mimeTypes.find(type => MediaRecorder.isTypeSupported(type)) || "";

    mediaRecorder = supportedType
      ? new MediaRecorder(stream, { mimeType: supportedType })
      : new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(audioChunks, {
          type: mediaRecorder.mimeType || "audio/webm"
        });

        stream.getTracks().forEach(track => track.stop());

        if (!blob.size) {
          throw new Error("لم يتم تسجيل أي صوت");
        }

        const extension =
          blob.type.includes("mp4") ? "m4a" : "webm";

        const file = new File(
          [blob],
          `voice-${Date.now()}.${extension}`,
          { type: blob.type }
        );

        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/upload", {
          method: "POST",
          body: formData
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.error || "فشل رفع التسجيل");
        }

        socket.emit("chat:send", {
          chatId,
          senderId: myId,
          senderName: myName,
          attachment: {
            ...result.file,
            kind: "audio"
          }
        });

        console.log("AUDIO_RECORDING_SENT");
      } catch (error) {
        console.error("AUDIO_UPLOAD_ERROR", error);
        alert("تعذر إرسال التسجيل: " + error.message);
      } finally {
        recordAudio.disabled = false;
        stopRecording.disabled = true;
        mediaRecorder = null;
        audioChunks = [];
      }
    };

    mediaRecorder.start();

    recordAudio.disabled = true;
    stopRecording.disabled = false;

    console.log("AUDIO_RECORDING_STARTED");
  } catch (error) {
    console.error("AUDIO_RECORDING_ERROR", error);
    alert("تعذر بدء التسجيل: " + error.message);
  }
});
stopRecording.addEventListener("click", () => {
  if (!mediaRecorder) return;

  mediaRecorder.stop();

  recordAudio.disabled = false;
  stopRecording.disabled = true;
});

function renderAttachment(attachment, container) {
  if (!attachment) return;

  const type = attachment.type || "";
  const url = attachment.url;
  const name = attachment.name || "ملف";

  if (type.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = url;
    img.className = "message-image";
    img.alt = name;
    container.appendChild(img);
    return;
  }

  if (type.startsWith("video/")) {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.className = "message-video";
    container.appendChild(video);
    return;
  }

  if (type.startsWith("audio/") || attachment.kind === "audio") {
    const audio = document.createElement("audio");
    audio.src = url;
    audio.controls = true;
    container.appendChild(audio);
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener";
  link.textContent = `📎 ${name}`;
  link.className = "file-link";

  container.appendChild(link);
}
