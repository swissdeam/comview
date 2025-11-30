// client.js
(() => {
  const socket = io({ query: {} });
  const pathname = location.pathname;

  // determine role by path
  const isAdminPage = pathname.startsWith("/admin") && !pathname.endsWith("login.html");

  // viewer elements
  const viewerPlayer = document.getElementById("viewerPlayer");
  const playPauseBtn = document.getElementById("playPauseBtn");
  const metaTitle = document.getElementById("metaTitle");
  const metaDesc = document.getElementById("metaDesc");
  const metaStreamer = document.getElementById("metaStreamer");
  const metaViewers = document.getElementById("metaViewers");
  const metaTitleSmall = document.getElementById("metaTitleSmall");

  // admin elements
  const adminPlayer = document.getElementById("adminPlayer");
  const adminPlay = document.getElementById("adminPlay");
  const adminPause = document.getElementById("adminPause");
  const adminSeek30 = document.getElementById("adminSeek30");
  const adminSeekm30 = document.getElementById("adminSeek-30");
  const metaForm = document.getElementById("metaForm");
  const saveMeta = document.getElementById("saveMeta");
  const clearMeta = document.getElementById("clearMeta");
  const adminList = document.getElementById("adminList");
  const addAdminForm = document.getElementById("addAdminForm");

  // helper to update meta blocks
  function applyMeta(meta) {
    if (metaTitle) metaTitle.textContent = meta.title || "—";
    if (metaDesc) metaDesc.textContent = meta.description || "—";
    if (metaStreamer) metaStreamer.textContent = meta.streamer || "—";
    if (metaViewers) metaViewers.textContent = (meta.viewers || 0);
    if (metaTitleSmall) metaTitleSmall.textContent = meta.title || "—";
  }

  // ----------------- VIEWER logic -----------------
  if (viewerPlayer) {
    // viewer: hide native controls (no progress bar) — allow only local pause/play
    viewerPlayer.controls = false;

    // local play/pause button
    playPauseBtn && playPauseBtn.addEventListener("click", () => {
      if (viewerPlayer.paused) {
        viewerPlayer.play();
        playPauseBtn.textContent = "Pause";
      } else {
        viewerPlayer.pause();
        playPauseBtn.textContent = "Play";
      }
    });

    // incoming video change
    socket.on("video-changed", (url) => {
      viewerPlayer.src = url;
      viewerPlayer.load();
      // when new video arrives, set to paused state until admin starts
      viewerPlayer.pause();
      playPauseBtn && (playPauseBtn.textContent = "Play");
    });

    // admin events override viewer playback
    socket.on("admin-play", (playback) => {
      if (!viewerPlayer.src) return;
      const now = playback.time + ((Date.now() - playback.lastUpdate) / 1000);
      if (Math.abs(viewerPlayer.currentTime - now) > 0.7) {
        viewerPlayer.currentTime = now;
      }
      viewerPlayer.play().catch(()=>{}); // start playback
      playPauseBtn && (playPauseBtn.textContent = "Pause");
    });

    socket.on("admin-pause", (playback) => {
      if (!viewerPlayer.src) return;
      viewerPlayer.currentTime = playback.time;
      viewerPlayer.pause();
      playPauseBtn && (playPauseBtn.textContent = "Play");
    });

    socket.on("admin-seek", (playback) => {
      if (!viewerPlayer.src) return;
      viewerPlayer.currentTime = playback.time;
    });

    // heartbeat sync corrections
    socket.on("admin-sync", (playback) => {
      if (!viewerPlayer.src) return;
      const now = playback.time + ((Date.now() - playback.lastUpdate) / 1000);
      if (Math.abs(viewerPlayer.currentTime - now) > 0.8) {
        viewerPlayer.currentTime = now;
      }
      if (playback.playing) {
        viewerPlayer.play().catch(()=>{});
        playPauseBtn && (playPauseBtn.textContent = "Pause");
      } else {
        viewerPlayer.pause();
        playPauseBtn && (playPauseBtn.textContent = "Play");
      }
    });

    // initial state
    socket.on("current-state", (state) => {
      if (state.currentVideo) {
        viewerPlayer.src = state.currentVideo;
        viewerPlayer.load();
      }
      applyMeta(state.streamMeta || {});
      // if admin is playing at moment, we will receive admin-sync eventually
    });

    socket.on("meta-updated", (meta) => {
      applyMeta(meta);
    });

    socket.on("admin-disconnected", () => {
      // show small alert (console for simplicity)
      console.warn("Admin disconnected — stream paused.");
    });
  }

  // ----------------- ADMIN logic -----------------
  if (isAdminPage && adminPlayer) {
    // identify as admin socket
    socket.emit("admin-register");

    // load initial state from server
    socket.on("current-state", (state) => {
      if (state.currentVideo) {
        adminPlayer.src = state.currentVideo;
        adminPlayer.load();
      }
      applyMeta(state.streamMeta || {});
      if (state.playback && state.playback.playing) {
        // don't auto play in browser due to autoplay policies — admin should press Play
      }
    });

    // meta update live
    socket.on("meta-updated", (meta) => {
      applyMeta(meta);
    });

    // controls
    adminPlay && adminPlay.addEventListener("click", () => {
      const t = adminPlayer.currentTime || 0;
      socket.emit("admin-play", t);
    });
    adminPause && adminPause.addEventListener("click", () => {
      const t = adminPlayer.currentTime || 0;
      socket.emit("admin-pause", t);
    });
    adminSeek30 && adminSeek30.addEventListener("click", () => {
      adminPlayer.currentTime = (adminPlayer.currentTime || 0) + 30;
      socket.emit("admin-seek", adminPlayer.currentTime);
    });
    adminSeekm30 && adminSeekm30.addEventListener("click", () => {
      adminPlayer.currentTime = Math.max((adminPlayer.currentTime || 0) - 30, 0);
      socket.emit("admin-seek", adminPlayer.currentTime);
    });

    // periodic heartbeat (helps keep viewers in sync)
    setInterval(() => {
      socket.emit("admin-heartbeat", { time: adminPlayer.currentTime || 0, playing: !adminPlayer.paused });
    }, 2000);

    // meta form send
    saveMeta && saveMeta.addEventListener("click", async () => {
      const title = document.getElementById("metaTitleIn").value;
      const description = document.getElementById("metaDescIn").value;
      const streamer = document.getElementById("metaStreamerIn").value;
      // POST to server
      await fetch("/api/meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, streamer })
      });
      // local apply
      applyMeta({ title, description, streamer });
    });
    clearMeta && clearMeta.addEventListener("click", () => {
      document.getElementById("metaTitleIn").value = "";
      document.getElementById("metaDescIn").value = "";
      document.getElementById("metaStreamerIn").value = "";
    });

    // admin management
    if (addAdminForm) {
      addAdminForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = e.target.id.value.trim();
        const password = e.target.password.value;
        const displayName = e.target.displayName.value;
        const res = await fetch("/api/admins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, password, displayName })
        });
        if (res.ok) {
          e.target.reset();
          loadAdmins();
        } else {
          alert("Ошибка добавления админа");
        }
      });
    }

    async function loadAdmins() {
      try {
        const res = await fetch("/api/admins");
        if (!res.ok) throw new Error("auth");
        const data = await res.json();
        adminList.innerHTML = data.map(a => `<li>${a.displayName} (${a.id}) <button class="btn ghost" data-id="${a.id}">Delete</button></li>`).join("");
        adminList.querySelectorAll("button[data-id]").forEach(b => {
          b.addEventListener("click", async (ev) => {
            const id = ev.target.getAttribute("data-id");
            if (!confirm("Remove admin " + id + "?")) return;
            await fetch("/api/admins/" + id, { method: "DELETE" });
            loadAdmins();
          });
        });
      } catch (e) {
        console.error("Load admins failed", e);
      }
    }
    loadAdmins();
  }

  // if on admin login page: nothing else needed (server handles)
})();
