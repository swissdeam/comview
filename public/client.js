const socket = io();
const video = document.getElementById("player");

socket.on("video-changed", (url) => {
  video.src = url;
  video.load();
});

video.addEventListener("play", () => socket.emit("play", video.currentTime));
video.addEventListener("pause", () => socket.emit("pause", video.currentTime));
video.addEventListener("seeked", () => socket.emit("seek", video.currentTime));

socket.on("play", (time) => {
  if (Math.abs(video.currentTime - time) > 0.5) video.currentTime = time;
  video.play();
});

socket.on("pause", (time) => {
  video.pause();
  video.currentTime = time;
});

socket.on("seek", (time) => {
  video.currentTime = time;
});

socket.on("user-list", (users) => {
  const list = document.getElementById("userList");
  if (list) {
    list.innerHTML = users.map((u) => `<li>${u.id}</li>`).join("");
  }
});
